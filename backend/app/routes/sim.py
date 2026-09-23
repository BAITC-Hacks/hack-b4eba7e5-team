"""Каталог, проверка сценария, анализ и подбор лучшего плана."""

import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app import analysis, optimizer, sim, sse
from app.config import get_settings
from app.rate_limit import check_ai_limit

router = APIRouter(prefix="/api/sim", tags=["sim"])


def _require_result(req: sim.ScenarioRequest) -> sim.Scenario:
    evaluation = sim.evaluate(req.decisions)
    if evaluation.result is None:
        raise HTTPException(status_code=422, detail=" ".join(item.message for item in evaluation.violations))
    return evaluation.result


@router.get("/config")
async def config() -> sim.SimulationConfig:
    dataset = sim.get_dataset()
    return sim.SimulationConfig(
        dataset=dataset,
        measure_previews=tuple(sim.measure_preview(measure, dataset) for measure in dataset.measures),
        baseline=sim.baseline(),
        example=tuple(sim.example_decisions()),
        llm_mode="mock" if get_settings().mock_mode else "live",
    )


@router.post("/evaluate")
async def evaluate(req: sim.ScenarioRequest) -> sim.Evaluation:
    return sim.evaluate(req.decisions)


@router.post("/analyze")
async def analyze(req: sim.ScenarioRequest) -> StreamingResponse:
    result = _require_result(req)
    await check_ai_limit()
    return sse.stream_text(analysis.explain(req.decisions, result))


@router.post("/optimize")
async def optimize(req: sim.ScenarioRequest) -> StreamingResponse:
    current = _require_result(req) if req.decisions else sim.baseline()
    await check_ai_limit()

    async def events():
        yield {"status": "Перебираем допустимые планы и назначения районов…"}
        proposal = await asyncio.to_thread(optimizer.optimize)
        yield {"result": proposal.model_dump(mode="json")}
        yield {"status": "План найден. Готовим сравнение и рекомендации…"}
        async for text in analysis.explain(req.decisions, current, proposal):
            yield {"delta": text}

    return sse.stream_events(events())
