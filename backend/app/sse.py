"""Общий SSE: статус, текст/результат, heartbeat, явное завершение или ошибка."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import suppress

from fastapi.responses import StreamingResponse

from app.llm import LLMError
from app.logs import request_id_var

log = logging.getLogger("app.sse")


def event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def stream_events(source: AsyncIterator[dict]) -> StreamingResponse:
    rid = request_id_var.get()

    async def events():
        pending = None
        try:
            while True:
                pending = asyncio.create_task(anext(source))
                while not (await asyncio.wait({pending}, timeout=10))[0]:
                    yield event({"ping": True})
                try:
                    item = pending.result()
                except StopAsyncIteration:
                    break
                yield event(item)
            yield event({"done": True})
        except LLMError as exc:
            yield event({"error": exc.user_message, "request_id": rid})
        except Exception:
            log.exception("stream_failed")
            yield event({"error": "Внутренняя ошибка сервера", "request_id": rid})
        finally:
            if pending is not None:
                pending.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await pending
            await source.aclose()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def stream_text(chunks: AsyncIterator[str]) -> StreamingResponse:
    async def events():
        try:
            async for delta in chunks:
                yield {"delta": delta}
        finally:
            await chunks.aclose()

    return stream_events(events())
