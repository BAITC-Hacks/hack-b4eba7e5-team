"""Единственная точка общения с LLM. Роуты не трогают SDK напрямую — только эти функции.

- таймаут и ретраи (429/5xx/обрыв) делает сам SDK: timeout + max_retries;
- если задана OPENAI_FALLBACK_MODEL — ещё один заход на ней, когда основная модель недоступна;
- ошибки провайдера превращаются в LLMError с понятным текстом для пользователя;
- LLM_CACHE=true — ответы кешируются в SQLite: повтор того же запроса мгновенный и одинаковый;
- mock-режим (нет ключа или LLM_MOCK=true): детерминированные ответы, демо не зависит от сети.
"""

import asyncio
import hashlib
import json
import logging
import sqlite3
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path

import openai
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import get_settings
from app.logs import log_event

log = logging.getLogger("llm")

Message = dict[str, str]  # {"role": "system"|"user"|"assistant", "content": "..."}

_client: AsyncOpenAI | None = None


class LLMError(Exception):
    """Ошибка LLM, которую можно показать пользователю как есть."""

    def __init__(self, user_message: str, status_code: int = 502):
        super().__init__(user_message)
        self.user_message = user_message
        self.status_code = status_code


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        s = get_settings()
        _client = AsyncOpenAI(
            api_key=s.openai_api_key,
            base_url=s.openai_base_url,
            timeout=s.llm_timeout_s,
            max_retries=s.llm_max_retries,
        )
    return _client


# --- ошибки и запасная модель ---------------------------------------------------


def _is_quota(e: Exception) -> bool:
    """Кончился баланс: приходит как 429, но ждать и повторять бесполезно."""
    return isinstance(e, openai.RateLimitError) and (
        getattr(e, "code", None) == "insufficient_quota" or "insufficient_quota" in str(e)
    )


def _translate(e: Exception) -> LLMError:
    if _is_quota(e):
        return LLMError("Закончился баланс ключа ИИ-сервиса", 503)
    if isinstance(e, openai.APITimeoutError | TimeoutError):
        return LLMError("ИИ отвечает слишком долго, попробуйте ещё раз", 504)
    if isinstance(e, openai.LengthFinishReasonError):
        return LLMError("Ответ ИИ не уместился в лимит длины, упростите запрос", 502)
    if isinstance(e, openai.ContentFilterFinishReasonError):
        return LLMError("ИИ отказался отвечать на этот запрос", 422)
    if isinstance(e, openai.RateLimitError):
        return LLMError("ИИ сейчас перегружен, повторите через минуту", 503)
    if isinstance(e, openai.AuthenticationError | openai.PermissionDeniedError):
        return LLMError("Проблема с ключом доступа к ИИ", 502)
    if isinstance(e, openai.NotFoundError):
        return LLMError("Модель ИИ недоступна для этого ключа", 502)
    if isinstance(e, openai.BadRequestError):
        return LLMError("ИИ не принял запрос (слишком длинный или неверный формат)", 400)
    if isinstance(e, openai.APIConnectionError):
        return LLMError("Нет связи с ИИ-сервисом", 502)
    return LLMError("Ошибка ИИ-сервиса", 502)


def _is_transient(e: Exception) -> bool:
    """Временная недоступность модели — есть смысл попробовать запасную."""
    if _is_quota(e):
        return False
    return isinstance(
        e,
        TimeoutError
        | openai.APITimeoutError
        | openai.APIConnectionError
        | openai.RateLimitError
        | openai.InternalServerError,
    )


def _log_error(model: str, e: Exception) -> None:
    log_event(log, "llm_error", logging.WARNING, model=model, error=type(e).__name__, detail=str(e)[:500])


async def _attempt[R](model: str, call: Callable[[str], Awaitable[R]]) -> R:
    """Одна модель вместе со встроенными повторами SDK — не дольше LLM_TIMEOUT_S (для стрима — до начала ответа)."""
    async with asyncio.timeout(get_settings().llm_timeout_s):
        return await call(model)


async def _with_fallback[R](model: str, call: Callable[[str], Awaitable[R]]) -> tuple[R, str]:
    """Вызов на основной модели; при временной ошибке — один заход на запасной. Возвращает (ответ, модель)."""
    try:
        return await _attempt(model, call), model
    except (openai.OpenAIError, TimeoutError) as e:
        _log_error(model, e)
        fallback = get_settings().openai_fallback_model
        if not (_is_transient(e) and fallback and fallback != model):
            raise _translate(e) from e
        log_event(log, "llm_fallback", logging.WARNING, model=model, fallback=fallback)
        try:
            return await _attempt(fallback, call), fallback
        except (openai.OpenAIError, TimeoutError) as e2:
            _log_error(fallback, e2)
            raise _translate(e2) from e2


def _empty_answer(model: str, finish_reason: str | None) -> LLMError:
    # у моделей с рассуждениями весь лимит токенов может уйти на рассуждение — текст пустой
    log_event(log, "llm_empty", logging.WARNING, model=model, finish_reason=finish_reason)
    return LLMError("ИИ вернул пустой ответ, попробуйте ещё раз", 502)


def _usage_fields(resp) -> dict:
    u = getattr(resp, "usage", None)
    if not u:
        return {}
    return {"tokens_in": u.prompt_tokens, "tokens_out": u.completion_tokens}


# --- кеш ответов ----------------------------------------------------------------


def _cache_key(kind: str, model: str, messages: list[Message], extra: dict) -> str:
    raw = json.dumps([kind, model, messages, extra], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _cache_db() -> sqlite3.Connection:
    path = Path(get_settings().data_dir) / "llm_cache.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts REAL NOT NULL)"
    )
    return db


def _cache_get(key: str) -> str | None:
    if not get_settings().llm_cache:
        return None
    try:
        with _cache_db() as db:
            row = db.execute("SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
    except sqlite3.Error:
        log.exception("llm_cache_read_failed")
        return None
    if row:
        log_event(log, "llm_cache_hit", key=key[:12])
    return row[0] if row else None


def _cache_set(key: str, value: str) -> None:
    if not get_settings().llm_cache:
        return
    try:
        with _cache_db() as db:
            db.execute("INSERT OR REPLACE INTO cache VALUES (?, ?, ?)", (key, value, time.time()))
    except sqlite3.Error:
        log.exception("llm_cache_write_failed")


# --- публичные функции ------------------------------------------------------------


async def complete(messages: list[Message], *, model: str | None = None, **kwargs) -> str:
    """Обычный ответ текстом."""
    s = get_settings()
    if s.mock_mode:
        return _mock_reply(messages)
    model = model or s.openai_model
    key = _cache_key("text", model, messages, kwargs)
    if (cached := _cache_get(key)) is not None:
        return cached

    t0 = time.monotonic()
    resp, used = await _with_fallback(
        model, lambda m: client().chat.completions.create(model=m, messages=messages, **kwargs)
    )
    choice = resp.choices[0]
    text = choice.message.content or ""
    if not text.strip():
        raise _empty_answer(used, choice.finish_reason)
    log_event(log, "llm_ok", model=used, ms=int((time.monotonic() - t0) * 1000), **_usage_fields(resp))
    _cache_set(key, text)
    return text


async def complete_json[T: BaseModel](
    messages: list[Message], schema: type[T], *, model: str | None = None, **kwargs
) -> T:
    """Ответ строго по pydantic-схеме (structured outputs) — никакого парсинга JSON руками."""
    s = get_settings()
    if s.mock_mode:
        return _mock_model(schema)
    model = model or s.openai_model
    key = _cache_key(f"json:{schema.__name__}", model, messages, kwargs)
    if (cached := _cache_get(key)) is not None:
        return schema.model_validate_json(cached)

    t0 = time.monotonic()
    resp, used = await _with_fallback(
        model,
        lambda m: client().chat.completions.parse(
            model=m, messages=messages, response_format=schema, **kwargs
        ),
    )
    msg = resp.choices[0].message
    if msg.parsed is None:
        log_event(log, "llm_refusal", logging.WARNING, model=used, refusal=msg.refusal)
        raise LLMError("ИИ отказался отвечать на этот запрос", 422)
    log_event(log, "llm_ok", model=used, ms=int((time.monotonic() - t0) * 1000), **_usage_fields(resp))
    _cache_set(key, msg.parsed.model_dump_json())
    return msg.parsed


async def stream(messages: list[Message], *, model: str | None = None, **kwargs) -> AsyncIterator[str]:
    """Поток кусочков текста. Запасная модель подключается, только если основная не начала отвечать."""
    s = get_settings()
    if s.mock_mode:
        for word in _mock_reply(messages).split(" "):
            await asyncio.sleep(0.03)
            yield word + " "
        return
    model = model or s.openai_model
    key = _cache_key("text", model, messages, kwargs)
    if (cached := _cache_get(key)) is not None:
        for i in range(0, len(cached), 24):
            await asyncio.sleep(0.01)
            yield cached[i : i + 24]
        return

    t0 = time.monotonic()
    resp, used = await _with_fallback(
        model,
        lambda m: client().chat.completions.create(
            model=m, messages=messages, stream=True, stream_options={"include_usage": True}, **kwargs
        ),
    )
    parts: list[str] = []
    usage: dict = {}
    finish_reason = None
    try:
        async with asyncio.timeout(s.llm_timeout_s):
            async for chunk in resp:
                if chunk.usage:
                    usage = _usage_fields(chunk)
                if chunk.choices:
                    finish_reason = chunk.choices[0].finish_reason or finish_reason
                    if chunk.choices[0].delta.content:
                        parts.append(chunk.choices[0].delta.content)
                        yield parts[-1]
    except (openai.OpenAIError, TimeoutError) as e:
        _log_error(used, e)
        raise _translate(e) from e
    finally:
        await resp.close()
    if finish_reason != "stop":
        raise LLMError("Ответ ИИ не завершён. Попробуйте ещё раз", 502)
    text = "".join(parts)
    if not text.strip():
        raise _empty_answer(used, finish_reason)
    log_event(log, "llm_ok", model=used, stream=True, ms=int((time.monotonic() - t0) * 1000), **usage)
    _cache_set(key, text)


# --- mock -------------------------------------------------------------------------


def _mock_reply(messages: list[Message]) -> str:
    last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    return f"[mock] Ключ OpenAI не задан, это заглушка. Вы написали: «{last[:200]}»"


def _mock_model[T: BaseModel](schema: type[T]) -> T:
    """Заполняет схему пустыми значениями по типам — хватает, чтобы фронт отрисовался."""
    defaults = {str: "mock", int: 0, float: 0.0, bool: False, list: [], dict: {}}
    data = {}
    for name, field in schema.model_fields.items():
        if not field.is_required():
            continue
        origin = getattr(field.annotation, "__origin__", field.annotation)
        data[name] = defaults.get(origin, None)
    return schema.model_validate(data)
