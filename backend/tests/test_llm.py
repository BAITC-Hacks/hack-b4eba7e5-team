"""Логика обёртки над LLM без сети: подменяем клиент фейком."""

import asyncio
from types import SimpleNamespace

import httpx
import openai
import pytest

from app import llm
from app.config import get_settings


def _err(cls, status: int, body: dict | None = None):
    resp = httpx.Response(status, request=httpx.Request("POST", "https://api.test/v1/chat/completions"))
    return cls("boom", response=resp, body=body)


def _reply(text: str):
    msg = SimpleNamespace(content=text, parsed=None, refusal=None)
    choice = SimpleNamespace(message=msg, finish_reason="stop" if text else "length")
    return SimpleNamespace(choices=[choice], usage=None)


class FakeCompletions:
    def __init__(self, script):
        self.script = list(script)  # по элементу на вызов: исключение или ответ
        self.models: list[str] = []

    async def create(self, *, model, messages, **kwargs):
        self.models.append(model)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def live(monkeypatch, tmp_path):
    """Живой режим (есть ключ) с фейковым клиентом."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()

    def install(script):
        fake = FakeCompletions(script)
        monkeypatch.setattr(llm, "client", lambda: SimpleNamespace(chat=SimpleNamespace(completions=fake)))
        return fake

    yield install
    get_settings.cache_clear()


MSG = [{"role": "user", "content": "hi"}]


async def test_fallback_on_5xx(live, monkeypatch):
    monkeypatch.setenv("OPENAI_FALLBACK_MODEL", "small-model")
    get_settings.cache_clear()
    fake = live([_err(openai.InternalServerError, 500), _reply("ok from fallback")])
    assert await llm.complete(MSG) == "ok from fallback"
    assert fake.models == [get_settings().openai_model, "small-model"]


async def test_no_fallback_on_quota(live, monkeypatch):
    monkeypatch.setenv("OPENAI_FALLBACK_MODEL", "small-model")
    get_settings.cache_clear()
    fake = live([_err(openai.RateLimitError, 429, {"code": "insufficient_quota", "message": "no money"})])
    with pytest.raises(llm.LLMError, match="баланс"):
        await llm.complete(MSG)
    assert len(fake.models) == 1


async def test_bad_key_message(live):
    live([_err(openai.AuthenticationError, 401)])
    with pytest.raises(llm.LLMError, match="ключ"):
        await llm.complete(MSG)


async def test_cache_hit_skips_model(live, monkeypatch):
    monkeypatch.setenv("LLM_CACHE", "true")
    get_settings.cache_clear()
    fake = live([_reply("first answer")])
    assert await llm.complete(MSG) == "first answer"
    assert await llm.complete(MSG) == "first answer"  # второй раз из кеша, скрипт фейка пуст
    assert len(fake.models) == 1


class SlowCompletions(FakeCompletions):
    """Первый вызов зависает дольше дедлайна, следующие — по скрипту."""

    async def create(self, *, model, messages, **kwargs):
        if not self.models:
            self.models.append(model)
            await asyncio.sleep(5)
        return await super().create(model=model, messages=messages, **kwargs)


async def test_deadline_then_fallback(live, monkeypatch):
    monkeypatch.setenv("LLM_TIMEOUT_S", "0.2")
    monkeypatch.setenv("OPENAI_FALLBACK_MODEL", "small-model")
    get_settings.cache_clear()
    fake = live([])
    slow = SlowCompletions([_reply("fast fallback")])
    monkeypatch.setattr(llm, "client", lambda: SimpleNamespace(chat=SimpleNamespace(completions=slow)))
    assert await llm.complete(MSG) == "fast fallback"
    assert slow.models[-1] == "small-model"
    assert fake.models == []


async def test_deadline_without_fallback(live, monkeypatch):
    monkeypatch.setenv("LLM_TIMEOUT_S", "0.2")
    get_settings.cache_clear()
    slow = SlowCompletions([])
    monkeypatch.setattr(llm, "client", lambda: SimpleNamespace(chat=SimpleNamespace(completions=slow)))
    with pytest.raises(llm.LLMError, match="долго"):
        await llm.complete(MSG)


async def test_empty_answer_is_error(live):
    live([_reply("")])
    with pytest.raises(llm.LLMError, match="пустой"):
        await llm.complete(MSG)


class FakeStream:
    def __init__(self, finish_reason, delay=0):
        self.finish_reason = finish_reason
        self.delay = delay
        self.closed = False

    async def __aiter__(self):
        yield SimpleNamespace(
            usage=None,
            choices=[SimpleNamespace(finish_reason=None, delta=SimpleNamespace(content="Начало ответа"))],
        )
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.finish_reason is not None:
            yield SimpleNamespace(
                usage=None,
                choices=[
                    SimpleNamespace(finish_reason=self.finish_reason, delta=SimpleNamespace(content=None))
                ],
            )

    async def close(self):
        self.closed = True


@pytest.mark.parametrize("reason", [None, "length", "content_filter"])
async def test_incomplete_provider_stream_is_error_and_not_cached(live, monkeypatch, reason):
    monkeypatch.setenv("LLM_CACHE", "true")
    get_settings.cache_clear()
    response = FakeStream(reason)
    live([response])
    with pytest.raises(llm.LLMError, match="не завершён"):
        _ = [part async for part in llm.stream(MSG)]
    assert response.closed
    key = llm._cache_key("text", get_settings().openai_model, MSG, {})
    assert llm._cache_get(key) is None


async def test_provider_stream_has_deadline_and_closes(live, monkeypatch):
    monkeypatch.setenv("LLM_TIMEOUT_S", "0.02")
    get_settings.cache_clear()
    response = FakeStream("stop", delay=1)
    live([response])
    with pytest.raises(llm.LLMError, match="долго"):
        _ = [part async for part in llm.stream(MSG)]
    assert response.closed


async def test_complete_provider_stream_is_cached(live, monkeypatch):
    monkeypatch.setenv("LLM_CACHE", "true")
    get_settings.cache_clear()
    response = FakeStream("stop")
    fake = live([response])
    assert "".join([part async for part in llm.stream(MSG)]) == "Начало ответа"
    assert "".join([part async for part in llm.stream(MSG)]) == "Начало ответа"
    assert response.closed
    assert len(fake.models) == 1
