"""Каталог, проверка сценария и объяснение рассчитанного результата."""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app import llm, sim, sse
from app.config import get_settings

router = APIRouter(prefix="/api/sim", tags=["sim"])

SYSTEM_PROMPT = """Ты аналитик учебного симулятора «Аким на 5 часов». Отвечай кратко по-русски.
В сообщении находятся проверенные сервером решения, исходная база и точный результат расчёта.
Напиши 4 коротких абзаца: итог, сильные стороны, риски, последствия и компромиссы.
Используй только переданные факты. Score, бюджет и эффекты уже посчитаны: не вычисляй и не придумывай числа.
Для итоговых чисел используй готовый текст summary. Объясняй выбор мер и изменение показателей районов.
effects — прямые изменения показателей с учётом лага до ограничения 0–100; synergies — отдельные бонусы.
Это не аддитивные вклады в Score. Число критических показателей — пары «район × показатель» строго ниже 40.
Горизонт — 8 кварталов; учитывается доля эффекта (8 − лаг)/8. Остаток бюджета не даёт бонуса.
Нельзя обещать реальные результаты строительства или медицинские, экологические и социальные последствия,
которых нет в модели. Не предлагай вымышленные меры или изменение бюджета, данных и правил.
Не называй сценарий оптимальным: поиск оптимума не выполнялся. Не показывай JSON или служебные поля.
"""


def _summary(result: sim.Scenario, initial: sim.Scenario) -> str:
    return (
        f"Score: {initial.score:.2f} → {result.score:.2f}, изменение {result.score - initial.score:+.2f}. "
        f"Потрачено {result.cost} из {sim.get_dataset().budget}, остаток {result.remaining}. "
        f"Критических показателей: {initial.n_crit} → {result.n_crit}."
    )


async def _mock_analysis(result: sim.Scenario) -> AsyncIterator[str]:
    dataset = sim.get_dataset()
    initial = sim.baseline()
    before = {district.id: district for district in initial.districts}
    names = {indicator.code: indicator.name for indicator in dataset.indicators}
    strongest = max(result.districts, key=lambda district: district.score - before[district.id].score)
    weakest = min(result.districts, key=lambda district: district.score)
    critical = [
        f"{district.name}: {names[code]} ({value:.2f})"
        for district in result.districts
        for code, value in district.indicators.items()
        if value < dataset.critical_threshold
    ]
    lowest_district, lowest_code, lowest_value = min(
        (
            (district, code, value)
            for district in result.districts
            for code, value in district.indicators.items()
        ),
        key=lambda item: item[2],
    )

    yield f"Шаблонный анализ · без вызова модели\n\n{_summary(result, initial)}\n\n"
    yield (
        f"Сильная сторона: наибольший рост оценки у района {strongest.name} "
        f"({strongest.score - before[strongest.id].score:+.2f}). "
        f"Сработавших синергий: {len(result.synergies)}.\n\n"
    )
    if critical:
        yield "Риски: остаются показатели ниже 40 — " + "; ".join(critical) + ".\n\n"
    else:
        yield (
            f"Риски: показателей ниже 40 нет, но самым слабым остаётся «{names[lowest_code]}» "
            f"в районе {lowest_district.name} ({lowest_value:.2f}).\n\n"
        )
    yield (
        f"Компромисс: минимальная оценка района — {weakest.name}, {weakest.score:.2f}; "
        "она участвует в общем Score, поэтому важен баланс между районами. "
    )
    negative = [effect for effect in result.effects if effect.value < 0]
    if negative:
        district_names = {district.id: district.name for district in result.districts}
        yield (
            "Отрицательный эффект: "
            + "; ".join(
                f"{effect.measure_id}, {district_names[effect.district_id]} — "
                f"{names[effect.indicator]} {effect.value:+.2f}"
                for effect in negative
            )
            + ". "
        )
    yield (
        f"Последствия показаны на горизонте {dataset.horizon_quarters} кварталов с учётом срока начала "
        "действия мер. Остаток бюджета не добавляет баллов."
    )


@router.get("/config")
async def config() -> sim.SimulationConfig:
    return sim.SimulationConfig(
        dataset=sim.get_dataset(),
        baseline=sim.baseline(),
        example=tuple(sim.example_decisions()),
        llm_mode="mock" if get_settings().mock_mode else "live",
    )


@router.post("/evaluate")
async def evaluate(req: sim.ScenarioRequest) -> sim.Evaluation:
    return sim.evaluate(req.decisions)


@router.post("/analyze")
async def analyze(req: sim.ScenarioRequest) -> StreamingResponse:
    evaluation = sim.evaluate(req.decisions)
    if evaluation.result is None:
        raise HTTPException(status_code=422, detail=" ".join(item.message for item in evaluation.violations))
    result = evaluation.result
    if get_settings().mock_mode:
        return sse.stream_text(_mock_analysis(result))

    dataset = sim.get_dataset()
    initial = sim.baseline()
    selected_ids = {decision.measure_id for decision in req.decisions}
    facts = {
        "summary": _summary(result, initial),
        "decisions": [decision.model_dump(mode="json") for decision in req.decisions],
        "measures": [
            measure.model_dump(mode="json") for measure in dataset.measures if measure.id in selected_ids
        ],
        "indicators": [indicator.model_dump(mode="json") for indicator in dataset.indicators],
        "baseline": initial.model_dump(mode="json"),
        "result": result.model_dump(mode="json"),
    }
    messages: list[llm.Message] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
    ]
    return sse.stream_text(llm.stream(messages))
