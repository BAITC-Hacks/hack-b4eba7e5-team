import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import llm
from app.config import get_settings
from app.logs import log_event, request_id_var, setup_logging
from app.routes import chat

setup_logging()
log = logging.getLogger("app")
settings = get_settings()
if settings.app_env == "prod" and settings.mock_mode and not settings.llm_mock:
    # ключа нет — ответы идут заглушкой; это видно в /health ("llm": "mock") и в шапке фронта
    log.warning("OPENAI_API_KEY не задан: LLM отвечает заглушкой")

app = FastAPI(
    title=settings.app_name,
    # swagger только локально: на демо лишние ручки не светим
    docs_url="/api/docs" if settings.app_env == "dev" else None,
    openapi_url="/api/openapi.json" if settings.app_env == "dev" else None,
)


# --- инфраструктура -----------------------------------------------------------


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request_id_var.set(rid)
    t0 = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled")
        response = JSONResponse({"detail": "Внутренняя ошибка сервера", "request_id": rid}, status_code=500)
    response.headers["X-Request-ID"] = rid
    if request.url.path != "/health":
        log_event(
            log,
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            ms=int((time.monotonic() - t0) * 1000),
        )
    return response


@app.exception_handler(llm.LLMError)
async def llm_error_handler(request: Request, exc: llm.LLMError):
    return JSONResponse(
        {"detail": exc.user_message, "request_id": request_id_var.get()}, status_code=exc.status_code
    )


@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok", "env": settings.app_env, "llm": "mock" if settings.mock_mode else "live"}


# --- роутеры фич: по файлу в app/routes/ -------------------------------------

app.include_router(chat.router)
