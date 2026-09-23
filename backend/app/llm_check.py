"""Проверка ключа и модели: uv run python -m app.llm_check [модель ...]

Печатает доступные модели семейства gpt/o и делает короткий запрос к каждой указанной
(по умолчанию — к OPENAI_MODEL и OPENAI_FALLBACK_MODEL) с замером времени.
"""

import asyncio
import sys
import time

from app import llm
from app.config import get_settings


async def main(models: list[str]) -> int:
    s = get_settings()
    if not s.openai_api_key:
        print("OPENAI_API_KEY не задан")
        return 1
    print(f"base_url: {s.openai_base_url or 'https://api.openai.com/v1'}")
    try:
        ids = sorted(m.id for m in (await llm.client().models.list()).data)
        chat_ids = [i for i in ids if i.startswith(("gpt", "o"))] or ids
        print(f"моделей доступно: {len(ids)}; чатовые: {', '.join(chat_ids[:40])}")
    except Exception as e:  # noqa: BLE001 — это диагностика, показываем любую ошибку
        print(f"список моделей не получен: {type(e).__name__}: {e}")

    ok = True
    for model in models or [m for m in (s.openai_model, s.openai_fallback_model) if m]:
        t0 = time.monotonic()
        try:
            resp = await llm.client().chat.completions.create(
                model=model, messages=[{"role": "user", "content": "Ответь одним словом: работает?"}]
            )
            text = (resp.choices[0].message.content or "").strip()
            print(f"OK   {model}: {int((time.monotonic() - t0) * 1000)} мс → {text[:60]!r}")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"FAIL {model}: {type(e).__name__}: {str(e)[:300]}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
