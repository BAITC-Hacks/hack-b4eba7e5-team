"""Тесты не зависят от backend/.env: живой ключ и модели оттуда не подхватываются, по умолчанию — mock-режим."""

import os

from app.config import Settings, get_settings

Settings.model_config["env_file"] = None
for name in ("OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_FALLBACK_MODEL", "OPENAI_BASE_URL", "LLM_CACHE"):
    os.environ.pop(name, None)
os.environ["LLM_MOCK"] = "true"
get_settings.cache_clear()
