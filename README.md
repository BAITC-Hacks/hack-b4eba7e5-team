# Аким на 5 часов

AI-симулятор управления городом — решение кейса Astana Innovations.

Пользователь получает общий для всех виртуальный бюджет и данные по пяти районам Астаны, принимает пять
управленческих решений из каталога мероприятий и получает Astana Quality of Life Score с объяснением
сильных сторон, рисков и компромиссов сценария.

- Задача, данные и формула Score — [docs/TZ.md](docs/TZ.md)
- Архитектура решения — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Правила разработки — [AGENTS.md](AGENTS.md)

## Статус

Готово:

- бэкенд на FastAPI с единой обёрткой над OpenAI: лимит времени, повторы, запасная модель, кеш ответов,
  понятные ошибки, работа без ключа (mock-режим);
- фронтенд на React со стримингом ответов модели;
- деплой с проверкой здоровья и автоматическим откатом.

В работе по плану из [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): движок симуляции и валидатор правил,
вклад каждой меры в Score, точный оптимизатор, ИИ-аналитик и ИИ-советник с вызовом инструментов.

## Запуск локально

Нужны `uv`, `pnpm` и Node 20+.

```bash
cp backend/.env.example backend/.env   # вписать OPENAI_API_KEY; без него ИИ отвечает заглушкой
./dev.sh                                # http://127.0.0.1:5173
```

Тесты и проверки:

```bash
cd backend && uv run pytest -q && uv run ruff check app tests
cd frontend && pnpm lint && pnpm build
```

## Стек

- **backend** — Python 3.13, FastAPI, pydantic, OpenAI SDK; REST и SSE-стриминг, JSON-логи с request_id.
- **frontend** — React 19, TypeScript, Vite, Tailwind CSS.
- **прод** — nginx (статика и прокси `/api`) → uvicorn под systemd; релизы с атомарным переключением и откатом.

## Деплой

```bash
deploy/deploy.sh      # выкатить текущее состояние
deploy/rollback.sh    # вернуть предыдущий релиз
deploy/logs.sh        # логи
```
