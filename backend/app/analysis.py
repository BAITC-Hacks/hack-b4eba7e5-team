"""Проверенные факты и качественное объяснение: числа в ответ подставляет сервер."""

import json
from collections.abc import AsyncIterator, Sequence
from typing import Literal

from pydantic import Field, ValidationError

from app import llm, sim
from app.config import get_settings
from app.optimizer import Optimum

SYSTEM_PROMPT = """Ты аналитик учебного симулятора «Аким на 5 часов».
Выбери наиболее полезные проверенные факты для разделов: итог, сильные стороны, риски,
компромиссы, рекомендации. Если есть предложение оптимизатора, сравни наборы и выдели замены.
Возвращай только title и fact_ids. Не пиши собственный текст и числа, не изменяй факты:
сервер сам покажет их содержание. Используй только fact_ids из разрешённого для раздела списка allowed.
Факты включают дельты районов, вклад каждой меры по Шепли, бюджет, критические показатели и сравнение.
Точный максимум касается только фиксированной учебной модели, не обещай реальные результаты.
"""


class Paragraph(sim.FrozenModel):
    title: Literal["Итог", "Сильные стороны", "Риски", "Компромиссы", "Рекомендации"]
    fact_ids: tuple[str, ...] = Field(min_length=1, max_length=5)


class Narrative(sim.FrozenModel):
    paragraphs: tuple[Paragraph, ...] = Field(min_length=1, max_length=5)


def build_facts(decisions: Sequence[sim.Decision], result: sim.Scenario, proposal: Optimum | None = None):
    dataset = sim.get_dataset()
    initial = sim.baseline()
    before = {item.id: item for item in initial.districts}
    measure_names = {item.id: item.name for item in dataset.measures}
    indicator_names = {item.code: item.name for item in dataset.indicators}
    district_names = {item.id: item.name for item in dataset.districts}
    facts = {
        "summary": (
            f"Score: {initial.score:.2f} → {result.score:.2f}, изменение {result.score - initial.score:+.2f}. "
            f"Стоимость {result.cost} из {dataset.budget}, остаток {result.remaining}. "
            f"Критических показателей: {initial.n_crit} → {result.n_crit}."
        ),
        "balance": f"Средняя оценка {result.d_avg:.2f}; минимальная оценка района {result.min_d:.2f}.",
        "horizon": f"Горизонт {dataset.horizon_quarters} кварталов. Остаток бюджета не добавляет баллов.",
    }
    deltas = []
    for district in result.districts:
        delta = district.score - before[district.id].score
        facts[f"district:{district.id}"] = (
            f"{district.name}: {before[district.id].score:.2f} → {district.score:.2f}, {delta:+.2f}."
        )
        changes = {}
        for code, value in district.indicators.items():
            old = before[district.id].indicators[code]
            changes[code] = value - old
            facts[f"indicator:{district.id}:{code}"] = (
                f"{district.name} · {indicator_names[code]}: {old:.2f} → {value:.2f}, {value - old:+.2f}."
                + (
                    f" Ниже порога {dataset.critical_threshold:g}."
                    if value < dataset.critical_threshold
                    else ""
                )
            )
        deltas.append({"district_id": district.id, "score_delta": delta, "indicators": changes})
    contributions = sim.contributions(decisions) if decisions else ()
    for contribution in contributions:
        facts[f"measure:{contribution.measure_id}"] = (
            f"{measure_names[contribution.measure_id]} · "
            f"{district_names.get(contribution.district_id, 'весь город')}: "
            f"вклад в Score {contribution.score_delta:+.2f} (Шепли)."
        )
    gains: list[str] = []
    losses: list[str] = []
    proposal_contributions = ()
    if proposal is not None:
        suggested = proposal.result
        proposal_contributions = sim.contributions(proposal.decisions)
        current_districts = {item.id: item for item in result.districts}
        for district in suggested.districts:
            for code, value in district.indicators.items():
                previous = current_districts[district.id].indicators[code]
                if value == previous:
                    continue
                key = f"comparison:{district.id}:{code}"
                facts[key] = (
                    f"{district.name} · {indicator_names[code]}: текущий план {previous:.2f}, "
                    f"предложение {value:.2f}, изменение {value - previous:+.2f}."
                )
                (gains if value > previous else losses).append(key)
        facts["comparison"] = (
            f"Текущий план → лучший: Score {result.score:.2f} → {suggested.score:.2f} "
            f"({suggested.score - result.score:+.2f}); стоимость {result.cost} → {suggested.cost}; "
            f"критических показателей {result.n_crit} → {suggested.n_crit}. "
            f"Проверено допустимых сценариев: {proposal.evaluated}."
        )

        def describe(items):
            return (
                "; ".join(
                    f"{measure_names[item.measure_id]} — {district_names.get(item.district_id, 'весь город')}"
                    for item in items
                )
                or "нет"
            )

        facts["replacement"] = (
            f"Убрать: {describe([item for item in decisions if item not in proposal.decisions])}. "
            f"Добавить: {describe([item for item in proposal.decisions if item not in decisions])}."
        )
        facts["proposal"] = "Предлагаемый план: " + describe(proposal.decisions) + "."
    positive = [f"district:{item['district_id']}" for item in deltas if item["score_delta"] > 0]
    positive += [f"measure:{item.measure_id}" for item in contributions if item.score_delta > 0]
    risks = [
        f"indicator:{district.id}:{code}"
        for district in result.districts
        for code, value in district.indicators.items()
        if value < dataset.critical_threshold
    ]
    risks += [f"measure:{item.measure_id}" for item in contributions if item.score_delta < 0]
    facts["risks"] = "Остаются критические показатели." if result.n_crit else "Критических показателей нет."
    facts["recommendation"] = (
        "Предложение повышает Score. Рассмотрите указанные замены и примените план, если подходит цель максимизации."
        if proposal and proposal.result.score > result.score + 1e-9
        else "Текущий Score уже максимален в модели. Замена плана не обязательна."
        if proposal
        else "Сравните результат с лучшим планом: советник проверит все допустимые сочетания мер и районов."
    )
    return {
        "facts": facts,
        "allowed": {
            "Итог": ["summary"] + (["comparison"] if proposal else []),
            "Сильные стороны": positive or ["balance"],
            "Риски": risks or ["risks"],
            "Компромиссы": ["balance", "horizon"] + losses,
            "Рекомендации": ["recommendation"]
            + (["comparison", "replacement", "proposal"] + gains if proposal else []),
        },
        "decisions": [item.model_dump(mode="json") for item in decisions],
        "baseline": initial.model_dump(mode="json"),
        "result": result.model_dump(mode="json"),
        "district_deltas": deltas,
        "contributions": [item.model_dump(mode="json") for item in contributions],
        "proposal_contributions": [item.model_dump(mode="json") for item in proposal_contributions],
        "proposal": proposal.model_dump(mode="json") if proposal else None,
    }


def _valid(narrative: Narrative, allowed: dict[str, list[str]]) -> bool:
    return all(
        all(key in allowed[paragraph.title] for key in paragraph.fact_ids)
        for paragraph in narrative.paragraphs
    )


async def explain(
    decisions: Sequence[sim.Decision], result: sim.Scenario, proposal: Optimum | None = None
) -> AsyncIterator[str]:
    payload = build_facts(decisions, result, proposal)
    facts = payload["facts"]
    yield facts["summary"] + "\n\n"
    if proposal:
        yield facts["comparison"] + "\n\n" + facts["replacement"] + "\n\n"
    if not get_settings().mock_mode:
        messages: list[llm.Message] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        for _ in range(2):
            try:
                narrative = await llm.complete_json(messages, Narrative)
            except ValidationError:
                narrative = None
            if narrative is not None and _valid(narrative, payload["allowed"]):
                for paragraph in narrative.paragraphs:
                    yield (
                        f"{paragraph.title}: "
                        + " ".join(facts[key] for key in dict.fromkeys(paragraph.fact_ids))
                        + "\n\n"
                    )
                yield "Рекомендация по расчёту: " + facts["recommendation"]
                return
            messages.append(
                {
                    "role": "user",
                    "content": "Ответ не прошёл проверку. Возвращай только title и разрешённые для раздела fact_ids, без текста.",
                }
            )
        yield "Ответ ИИ не прошёл проверку фактов. Ниже — шаблонный анализ.\n\n"
    else:
        yield "Шаблонный анализ · без вызова модели\n\n"
    strongest = max(payload["district_deltas"], key=lambda item: item["score_delta"])
    yield "Сильные стороны: " + facts[f"district:{strongest['district_id']}"] + "\n\n"
    critical = [
        facts[f"indicator:{district.id}:{code}"]
        for district in result.districts
        for code, value in district.indicators.items()
        if value < sim.get_dataset().critical_threshold
    ]
    yield "Риски: " + (" ".join(critical) if critical else "Критических показателей нет.") + "\n\n"
    yield "Компромиссы: " + facts["balance"] + " " + facts["horizon"] + "\n\n"
    for key in payload["allowed"]["Компромиссы"]:
        if key.startswith("comparison:"):
            yield facts[key] + "\n"
    yield "\n".join(value for key, value in facts.items() if key.startswith("measure:")) + "\n\n"
    yield "Рекомендации: " + facts["recommendation"]
