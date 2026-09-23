"""Общий лимит дорогих запросов процесса; не доверяет подменяемым IP-заголовкам."""

from collections import deque
from math import ceil
from time import monotonic

from fastapi import HTTPException

from app.config import get_settings

_requests: deque[float] = deque()


async def check_ai_limit() -> None:
    now = monotonic()
    while _requests and _requests[0] <= now - 60:
        _requests.popleft()
    if len(_requests) >= get_settings().ai_requests_per_minute:
        raise HTTPException(
            status_code=429,
            detail="Слишком много запросов к советнику. Повторите через минуту.",
            headers={"Retry-After": str(max(1, ceil(60 - (now - _requests[0]))))},
        )
    _requests.append(now)
