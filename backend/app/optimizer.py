"""Полный перебор с кешированием локальных результатов районов, без новых зависимостей."""

from collections import Counter
from functools import lru_cache
from itertools import combinations, product
from threading import Lock

from pydantic import Field

from app import sim


class Optimum(sim.FrozenModel):
    decisions: tuple[sim.Decision, ...] = Field(min_length=5, max_length=5)
    result: sim.Scenario
    exact: bool
    evaluated: int = Field(gt=0)


def search(dataset: sim.Dataset) -> Optimum:
    """Перебирает наборы и все назначения районов. Победитель проверяется основным движком."""
    best_score = float("-inf")
    best_cost = dataset.budget + 1
    best: tuple[sim.Decision, ...] = ()
    evaluated = 0
    district_count = len(dataset.districts)
    codes = [item.code for item in dataset.indicators]
    weights = [item.weight for item in dataset.indicators]
    shares = [item.population_share for item in dataset.districts]
    formula = dataset.score_formula

    for measures in combinations(dataset.measures, dataset.decisions_required):
        cost = sum(item.cost for item in measures)
        if cost > dataset.budget:
            continue
        if max(Counter(item.direction for item in measures).values()) > dataset.max_per_direction:
            continue
        ids = {item.id for item in measures}
        conflicts = [item for item in dataset.incompatibilities if set(item.pair) <= ids]
        if any(not item.same_district_only for item in conflicts):
            continue
        local = [item for item in measures if item.scope == "district"]
        city = [item for item in measures if item.scope == "city"]
        positions = {item.id: i for i, item in enumerate(local)}
        conflict_positions = [(positions[a], positions[b]) for a, b in (item.pair for item in conflicts)]
        # Для каждого района результат зависит лишь от поднабора назначенных ему мер.
        tables: list[list[tuple[float, int]]] = []
        for district in dataset.districts:
            table = []
            for mask in range(1 << len(local)):
                active = city + [item for i, item in enumerate(local) if mask & (1 << i)]
                active_ids = {item.id for item in active}
                values = dict(district.indicators)
                for measure in active:
                    for code, effect in sim.measure_preview(measure, dataset).effects.items():
                        values[code] += effect
                for synergy in dataset.synergies:
                    if set(synergy.pair) <= active_ids:
                        for code, bonus in synergy.bonus.items():
                            values[code] += bonus
                clipped = [min(100.0, max(0.0, values[code])) for code in codes]
                table.append(
                    (
                        sum(value * weight for value, weight in zip(clipped, weights)),
                        sum(value < dataset.critical_threshold for value in clipped),
                    )
                )
            tables.append(table)

        for assignment in product(range(district_count), repeat=len(local)):
            if any(assignment[a] == assignment[b] for a, b in conflict_positions):
                continue
            masks = [0] * district_count
            for i, district_index in enumerate(assignment):
                masks[district_index] |= 1 << i
            stats = [table[mask] for table, mask in zip(tables, masks)]
            score = (
                formula.avg_weight * sum(share * value for share, (value, _) in zip(shares, stats))
                + formula.min_weight * min(value for value, _ in stats)
                - formula.critical_penalty * sum(critical for _, critical in stats)
            )
            evaluated += 1
            if score > best_score or (score == best_score and cost < best_cost):
                best_score, best_cost = score, cost
                best = tuple(
                    sim.Decision(
                        measure_id=item.id,
                        district_id=dataset.districts[assignment[positions[item.id]]].id
                        if item.scope == "district"
                        else None,
                    )
                    for item in measures
                )
    if not best:
        raise ValueError("Допустимый план не найден")
    # get_dataset() неизменяем; synthetic dataset используется только в тестах.
    result = sim._calculate(best, dataset)
    if abs(result.score - best_score) > 1e-9:
        raise ValueError("Результат поиска не совпал с основным расчётом")
    return Optimum(decisions=best, result=result, exact=True, evaluated=evaluated)


_lock = Lock()


@lru_cache(maxsize=1)
def _cached() -> Optimum:
    optimum = search(sim.get_dataset())
    evaluation = sim.evaluate(optimum.decisions)
    if not evaluation.valid or evaluation.result != optimum.result:
        raise ValueError("Оптимальный план не прошёл проверку")
    return optimum


def optimize() -> Optimum:
    # Одновременные запросы разделяют один перебор. Вызывается через asyncio.to_thread.
    with _lock:
        return _cached()
