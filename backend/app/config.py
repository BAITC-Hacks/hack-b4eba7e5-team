"""Настройки из окружения. Локально — backend/.env, на сервере — /etc/hackalem/app.env."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "dev"  # dev | prod
    app_name: str = "HackAlem"
    # единственное место, куда приложение пишет файлы (SQLite, загрузки)
    data_dir: str = "./data"

    # OpenAI-совместимый провайдер. NVIDIA NIM тоже годится:
    # OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1 + их ключ и модель.
    openai_api_key: str = ""
    openai_base_url: str | None = None
    openai_model: str = "gpt-5.5"
    # запасная модель: один повтор на ней при таймауте, 429 (кроме кончившегося баланса) и 5xx
    openai_fallback_model: str | None = None
    llm_timeout_s: float = 60.0
    llm_max_retries: int = 2
    # Без ключа или при LLM_MOCK=true отвечаем заглушкой: фронт и тесты работают без сети.
    llm_mock: bool = False
    # Кеш ответов в SQLite (DATA_DIR): одинаковый запрос → тот же ответ мгновенно, без вызова модели.
    llm_cache: bool = False
    ai_requests_per_minute: int = Field(default=10, ge=1, le=120)

    @property
    def mock_mode(self) -> bool:
        return self.llm_mock or not self.openai_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
