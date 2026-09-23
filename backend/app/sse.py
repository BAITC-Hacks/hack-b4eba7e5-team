"""Server-Sent Events: один формат для всех стримов. Во фронте его читает streamSSE() из lib/api.ts."""

import json
import logging
from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse

from app.llm import LLMError
from app.logs import request_id_var

log = logging.getLogger("app.sse")


def event(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def stream_text(chunks: AsyncIterator[str]) -> StreamingResponse:
    """Поток текста → data: {"delta": "..."} … data: {"done": true}; ошибка → data: {"error", "request_id"}."""
    rid = request_id_var.get()

    async def events():
        try:
            async for delta in chunks:
                yield event({"delta": delta})
            yield event({"done": True})
        except LLMError as e:
            yield event({"error": e.user_message, "request_id": rid})
        except Exception:
            log.exception("stream_failed")
            yield event({"error": "Внутренняя ошибка сервера", "request_id": rid})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
