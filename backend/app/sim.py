"""Правила и расчёт симулятора по неизменным данным организаторов."""

from collections import Counter
from collections.abc import Mapping, Sequence
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PlainSerializer

IndicatorCode = Literal["T1", "T2", "E1", "E2", "S1", "S2", "B1", "B2", "C1", "C2"]
DirectionId = Literal["transport", "ecology", "social", "safety", "services"]
Identifier = Annotated[str, Field(min_length=1, max_length=32)]
Name = Annotated[str, Field(min_length=1, max_length=300)]
IndicatorValue = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
EffectValue = Annotated[float, Field(ge=-100, le=100, allow_inf_nan=False)]
Indicators = Annotated[
    Mapping[IndicatorCode, IndicatorValue],
    AfterValidator(lambda values: MappingProxyType(dict(values))),
    PlainSerializer(dict, return_type=dict[IndicatorCode, IndicatorValue]),
]
Effects = Annotated[
    Mapping[IndicatorCode, EffectValue],
    AfterValidator(lambda values: MappingProxyType(dict(values))),
    PlainSerializer(dict, return_type=dict[IndicatorCode, EffectValue]),
]


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Direction(FrozenModel):
    id: DirectionId
    name: Name


class Indicator(FrozenModel):
    code: IndicatorCode
    direction: DirectionId
    name: Name
    weight: float = Field(ge=0, le=1, allow_inf_nan=False)
    meaning: str = Field(min_length=1, max_length=500)


class District(FrozenModel):
    id: Identifier
    name: Name
    population_share: float = Field(gt=0, le=1, allow_inf_nan=False)
    profile: str = Field(min_length=1, max_length=500)
    indicators: Indicators = Field(min_length=10, max_length=10)


class Measure(FrozenModel):
    id: Identifier
    direction: DirectionId
    name: Name
    scope: Literal["district", "city"]
    cost: int = Field(gt=0, le=100)
    lag: int = Field(ge=0, le=8)
    effects: Effects = Field(min_length=1, max_length=10)


class MeasurePreview(FrozenModel):
    measure_id: Identifier
    effect_share: float = Field(ge=0, le=1, allow_inf_nan=False)
    effects: Effects = Field(min_length=1, max_length=10)


class Synergy(FrozenModel):
    pair: tuple[Identifier, Identifier]
    bonus: Effects = Field(min_length=1, max_length=10)


class Incompatibility(FrozenModel):
    pair: tuple[Identifier, Identifier]
    same_district_only: bool
    reason: str = Field(min_length=1, max_length=300)


class ScoreFormula(FrozenModel):
    avg_weight: float = Field(ge=0, le=1, allow_inf_nan=False)
    min_weight: float = Field(ge=0, le=1, allow_inf_nan=False)
    critical_penalty: float = Field(ge=0, le=100, allow_inf_nan=False)


class Dataset(FrozenModel):
    budget: int = Field(gt=0, le=100)
    decisions_required: int = Field(gt=0, le=14)
    max_per_direction: int = Field(gt=0, le=5)
    horizon_quarters: int = Field(gt=0, le=8)
    critical_threshold: IndicatorValue
    score_formula: ScoreFormula
    directions: tuple[Direction, ...] = Field(min_length=5, max_length=5)
    indicators: tuple[Indicator, ...] = Field(min_length=10, max_length=10)
    districts: tuple[District, ...] = Field(min_length=5, max_length=5)
    measures: tuple[Measure, ...] = Field(min_length=14, max_length=14)
    synergies: tuple[Synergy, ...] = Field(min_length=3, max_length=3)
    incompatibilities: tuple[Incompatibility, ...] = Field(min_length=3, max_length=3)


class Decision(FrozenModel):
    measure_id: Identifier
    district_id: Identifier | None = None


class ScenarioRequest(FrozenModel):
    decisions: tuple[Decision, ...] = Field(max_length=50)


class Violation(FrozenModel):
    code: Identifier
    message: str = Field(min_length=1, max_length=500)


class DistrictResult(FrozenModel):
    id: Identifier
    name: Name
    score: IndicatorValue
    indicators: Indicators = Field(min_length=10, max_length=10)


class MeasureEffect(FrozenModel):
    measure_id: Identifier
    district_id: Identifier
    indicator: IndicatorCode
    value: EffectValue


class AppliedSynergy(FrozenModel):
    pair: tuple[Identifier, Identifier]
    district_id: Identifier
    indicator: IndicatorCode
    bonus: EffectValue


class Scenario(FrozenModel):
    cost: int = Field(ge=0)
    remaining: int = Field(ge=0)
    score: float = Field(ge=-50, le=100, allow_inf_nan=False)
    d_avg: IndicatorValue
    min_d: IndicatorValue
    n_crit: int = Field(ge=0, le=50)
    districts: tuple[DistrictResult, ...] = Field(min_length=5, max_length=5)
    effects: tuple[MeasureEffect, ...] = Field(max_length=250)
    synergies: tuple[AppliedSynergy, ...] = Field(max_length=30)


class Evaluation(FrozenModel):
    valid: bool
    violations: tuple[Violation, ...] = Field(max_length=200)
    result: Scenario | None


class SimulationConfig(FrozenModel):
    dataset: Dataset
    measure_previews: tuple[MeasurePreview, ...] = Field(min_length=14, max_length=14)
    baseline: Scenario
    example: tuple[Decision, ...] = Field(min_length=5, max_length=5)
    llm_mode: Literal["mock", "live"]


@lru_cache
def get_dataset() -> Dataset:
    return Dataset.model_validate_json(
        Path(__file__).with_name("data").joinpath("dataset.json").read_text(encoding="utf-8")
    )


# Чтение локальных данных происходит при импорте, до обработки async-запросов.
get_dataset()


def measure_preview(measure: Measure, dataset: Dataset) -> MeasurePreview:
    """Прямые эффекты за горизонт симуляции, до синергий и ограничения 0–100."""
    share = (dataset.horizon_quarters - measure.lag) / dataset.horizon_quarters
    return MeasurePreview(
        measure_id=measure.id,
        effect_share=share,
        effects={indicator: full_effect * share for indicator, full_effect in measure.effects.items()},
    )


def example_decisions() -> list[Decision]:
    return [
        Decision(measure_id="M7", district_id="nura"),
        Decision(measure_id="M8", district_id="nura"),
        Decision(measure_id="M10", district_id="nura"),
        Decision(measure_id="M12"),
        Decision(measure_id="M5", district_id="saryarka"),
    ]


def validate(decisions: Sequence[Decision]) -> list[Violation]:
    dataset = get_dataset()
    measures = {measure.id: measure for measure in dataset.measures}
    districts = {district.id for district in dataset.districts}
    direction_counts: Counter[str] = Counter()
    selected: dict[str, Decision] = {}
    violations: list[Violation] = []
    cost = 0

    def add(code: str, message: str) -> None:
        violations.append(Violation(code=code, message=message))

    if len(decisions) != dataset.decisions_required:
        add("count", f"Выберите ровно {dataset.decisions_required} мероприятий. Сейчас: {len(decisions)}.")

    for decision in decisions:
        if decision.measure_id in selected:
            add("duplicate", f"Мероприятие {decision.measure_id} можно выбрать только один раз.")
        selected[decision.measure_id] = decision
        measure = measures.get(decision.measure_id)
        if decision.district_id is not None and decision.district_id not in districts:
            add("unknown_district", f"Неизвестный район: {decision.district_id}.")
        if measure is None:
            add("unknown_measure", f"Неизвестное мероприятие: {decision.measure_id}.")
            continue
        cost += measure.cost
        direction_counts[measure.direction] += 1
        if measure.scope == "district" and decision.district_id is None:
            add("district_required", f"Для мероприятия «{measure.name}» выберите район.")
        if measure.scope == "city" and decision.district_id is not None:
            add(
                "district_forbidden", f"Мероприятие «{measure.name}» действует на весь город: район не нужен."
            )

    for direction in dataset.directions:
        if direction_counts[direction.id] > dataset.max_per_direction:
            add(
                "direction_limit",
                f"В направлении «{direction.name}» можно выбрать не более {dataset.max_per_direction} мер.",
            )
    for conflict in dataset.incompatibilities:
        first, second = (selected.get(measure_id) for measure_id in conflict.pair)
        if first is None or second is None:
            continue
        if not conflict.same_district_only or (
            first.district_id in districts and first.district_id == second.district_id
        ):
            add("incompatible", f"{first.measure_id} и {second.measure_id}: {conflict.reason}.")
    if cost > dataset.budget:
        add(
            "budget",
            f"Бюджет превышен на {cost - dataset.budget}: стоимость {cost}, доступно {dataset.budget}.",
        )
    return violations


def _calculate(decisions: Sequence[Decision], dataset: Dataset) -> Scenario:
    """Внутренний расчёт только для проверенного набора или исходной базы."""
    values = {district.id: dict(district.indicators) for district in dataset.districts}
    selected = {decision.measure_id: decision for decision in decisions}
    effects: list[MeasureEffect] = []
    synergies: list[AppliedSynergy] = []
    cost = 0
    # Порядок каталога стабилен: перестановка решений не меняет даже порядок эффектов.
    for measure in dataset.measures:
        decision = selected.get(measure.id)
        if decision is None:
            continue
        cost += measure.cost
        targets = tuple(values) if measure.scope == "city" else (decision.district_id,)
        preview = measure_preview(measure, dataset)
        for district_id in targets:
            for indicator, effect in preview.effects.items():
                values[district_id][indicator] += effect
                effects.append(
                    MeasureEffect(
                        measure_id=measure.id,
                        district_id=district_id,
                        indicator=indicator,
                        value=effect,
                    )
                )
    for synergy in dataset.synergies:
        if not all(measure_id in selected for measure_id in synergy.pair):
            continue
        district_id = selected[synergy.pair[0]].district_id
        for indicator, bonus in synergy.bonus.items():
            values[district_id][indicator] += bonus
            synergies.append(
                AppliedSynergy(pair=synergy.pair, district_id=district_id, indicator=indicator, bonus=bonus)
            )

    results: list[DistrictResult] = []
    n_crit = 0
    d_avg = 0.0
    for district in dataset.districts:
        # Ограничиваем значения один раз, после всех эффектов и синергий.
        indicators = {code: min(100.0, max(0.0, value)) for code, value in values[district.id].items()}
        score = sum(indicators[indicator.code] * indicator.weight for indicator in dataset.indicators)
        n_crit += sum(value < dataset.critical_threshold for value in indicators.values())
        d_avg += district.population_share * score
        results.append(DistrictResult(id=district.id, name=district.name, score=score, indicators=indicators))
    min_d = min(district.score for district in results)
    formula = dataset.score_formula
    score = formula.avg_weight * d_avg + formula.min_weight * min_d - formula.critical_penalty * n_crit
    return Scenario(
        cost=cost,
        remaining=dataset.budget - cost,
        score=score,
        d_avg=d_avg,
        min_d=min_d,
        n_crit=n_crit,
        districts=tuple(results),
        effects=tuple(effects),
        synergies=tuple(synergies),
    )


def baseline() -> Scenario:
    return _calculate((), get_dataset())


def evaluate(decisions: Sequence[Decision]) -> Evaluation:
    violations = validate(decisions)
    if violations:
        return Evaluation(valid=False, violations=tuple(violations), result=None)
    return Evaluation(valid=True, violations=(), result=_calculate(decisions, get_dataset()))
