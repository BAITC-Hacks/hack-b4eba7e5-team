"""Официальные контрольные числа, правила сценария и API без сети."""

import json
from itertools import permutations
from pathlib import Path
from types import MappingProxyType

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import llm, sim
from app.config import get_settings
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def decisions(*items: tuple[str, str | None]) -> list[sim.Decision]:
    return [sim.Decision(measure_id=measure, district_id=district) for measure, district in items]


def payload(items: list[sim.Decision] | None = None) -> dict:
    selected = sim.example_decisions() if items is None else items
    return {"decisions": [item.model_dump() for item in selected]}


def district(result: sim.Scenario, district_id: str):
    return next(item for item in result.districts if item.id == district_id)


def sse_events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def test_runtime_dataset_matches_official_source():
    root = Path(__file__).resolve().parents[2]
    official = json.loads((root / "docs/dataset.json").read_text())
    runtime = json.loads((root / "backend/app/data/dataset.json").read_text())
    assert runtime == official
    assert sim.get_dataset().model_dump(mode="json") == official


def test_dataset_is_deeply_immutable():
    dataset = sim.get_dataset()
    for field in ("directions", "indicators", "districts", "measures", "synergies", "incompatibilities"):
        assert isinstance(getattr(dataset, field), tuple)
    with pytest.raises(ValidationError):
        dataset.budget = 1
    with pytest.raises(ValidationError):
        dataset.districts[0].name = "Изменённый район"
    with pytest.raises(ValidationError):
        dataset.measures[0].cost = 1
    with pytest.raises(TypeError):
        dataset.districts[0].indicators["T1"] = 0
    with pytest.raises(TypeError):
        dataset.measures[0].effects["T1"] = 999
    with pytest.raises(TypeError):
        dataset.synergies[0].bonus["T1"] = 999
    assert isinstance(dataset.synergies[0].pair, tuple)
    assert isinstance(dataset.incompatibilities[0].pair, tuple)


def test_baseline_matches_official_values():
    result = sim.baseline()
    assert result.cost == 0
    assert result.remaining == 100
    assert result.d_avg == pytest.approx(56.8624)
    assert result.min_d == pytest.approx(49.18)
    assert result.n_crit == 2
    assert result.score == pytest.approx(52.55768)
    assert {item.id: item.score for item in result.districts} == pytest.approx(
        {"yesil": 62.99, "almaty": 57.06, "saryarka": 54.65, "baikonur": 56.63, "nura": 49.18}
    )


def test_official_example_matches_independent_calculation():
    chosen = sim.example_decisions()
    assert {(item.measure_id, item.district_id) for item in chosen} == {
        ("M7", "nura"),
        ("M8", "nura"),
        ("M10", "nura"),
        ("M12", None),
        ("M5", "saryarka"),
    }
    assert not sim.validate(chosen)
    evaluation = sim.evaluate(chosen)
    assert evaluation.valid
    assert not evaluation.violations
    result = evaluation.result
    assert result is not None
    assert result.cost == 95
    assert result.remaining == 5
    assert result.d_avg == pytest.approx(58.0776)
    assert result.min_d == pytest.approx(52.9625)
    assert result.n_crit == 0
    assert result.score == pytest.approx(56.54307)
    nura = district(result, "nura")
    assert nura.indicators["S1"] == 48
    assert nura.indicators["S2"] == 43.75
    assert nura.indicators["B1"] == 67.5
    assert nura.indicators["B2"] == 51.75
    assert nura.indicators["C2"] == 54.375
    assert district(result, "saryarka").indicators["E2"] == 48.75


@pytest.mark.parametrize("count", [0, 1, 4, 6])
def test_exactly_five_decisions_required(count):
    chosen = (sim.example_decisions() + decisions(("M11", "yesil")))[:count]
    evaluation = sim.evaluate(chosen)
    assert not evaluation.valid
    assert evaluation.result is None
    assert evaluation.violations


@pytest.mark.parametrize(
    "chosen",
    [
        decisions(("M3", "yesil"), ("M5", "saryarka"), ("M7", "nura"), ("M8", "nura"), ("M12", None)),
        decisions(("M7", "nura"), ("M7", "yesil"), ("M10", "nura"), ("M12", None), ("M5", "saryarka")),
        decisions(("M7", "nura"), ("M8", "nura"), ("M9", "yesil"), ("M10", "nura"), ("M12", None)),
    ],
    ids=["over-budget", "duplicate-in-another-district", "three-in-one-direction"],
)
def test_invalid_scenarios_never_receive_score(chosen):
    violations = sim.validate(chosen)
    assert violations
    assert all(item.code and item.message for item in violations)
    result = sim.evaluate(chosen)
    assert not result.valid
    assert result.result is None
    assert result.violations


@pytest.mark.parametrize(
    ("measure_id", "district_id"),
    [("M7", None), ("M7", "missing"), ("M12", "nura"), ("M99", None)],
    ids=["missing-district", "unknown-district", "city-with-district", "unknown-measure"],
)
def test_scope_and_unknown_ids_are_rejected(measure_id, district_id):
    chosen = sim.example_decisions()
    index = 3 if measure_id == "M12" else 0
    chosen[index] = sim.Decision(measure_id=measure_id, district_id=district_id)
    evaluation = sim.evaluate(chosen)
    assert not evaluation.valid
    assert evaluation.result is None
    assert evaluation.violations


def test_exact_budget_is_allowed_and_five_directions_are_not_required():
    chosen = decisions(("M3", "yesil"), ("M4", "yesil"), ("M8", "nura"), ("M9", "nura"), ("M5", "saryarka"))
    evaluation = sim.evaluate(chosen)
    assert evaluation.valid
    assert evaluation.result is not None
    assert evaluation.result.cost == 100
    assert evaluation.result.remaining == 0


def test_unused_budget_does_not_add_score_bonus():
    chosen = decisions(("M9", "nura"), ("M11", "nura"), ("M10", "nura"), ("M12", None), ("M4", "yesil"))
    result = sim.evaluate(chosen).result
    assert result is not None
    assert result.cost == 61
    assert result.remaining == 39
    assert result.score == pytest.approx(0.7 * result.d_avg + 0.3 * result.min_d - result.n_crit)


@pytest.mark.parametrize(
    ("first", "second", "second_district", "allowed"),
    [
        ("M1", "M3", "yesil", False),
        ("M1", "M3", "almaty", False),
        ("M4", "M7", "yesil", False),
        ("M4", "M7", "almaty", True),
        ("M5", "M13", "yesil", False),
        ("M5", "M13", "almaty", True),
    ],
)
def test_all_incompatibilities_respect_district_scope(first, second, second_district, allowed):
    chosen = decisions(
        (first, "yesil"), (second, second_district), ("M9", "nura"), ("M10", "nura"), ("M12", None)
    )
    evaluation = sim.evaluate(chosen)
    assert evaluation.valid is allowed
    assert (evaluation.result is not None) is allowed
    assert bool(evaluation.violations) is not allowed


@pytest.mark.parametrize(
    ("chosen", "pair", "indicator", "target_value", "other_value"),
    [
        (
            decisions(("M1", "nura"), ("M2", None), ("M9", "almaty"), ("M10", "almaty"), ("M14", None)),
            ("M1", "M2"),
            "T1",
            64.5,
            48,
        ),
        (
            decisions(("M10", "nura"), ("M12", None), ("M4", "almaty"), ("M8", "nura"), ("M14", None)),
            ("M10", "M12"),
            "B1",
            67.5,
            78,
        ),
        (
            decisions(("M5", "nura"), ("M6", None), ("M9", "almaty"), ("M10", "almaty"), ("M14", None)),
            ("M5", "M6"),
            "E2",
            77.25,
            73.5,
        ),
    ],
)
def test_synergy_is_fixed_and_only_applies_in_the_first_measures_district(
    chosen, pair, indicator, target_value, other_value
):
    result = sim.evaluate(chosen).result
    assert result is not None
    assert district(result, "nura").indicators[indicator] == pytest.approx(target_value)
    assert district(result, "yesil").indicators[indicator] == pytest.approx(other_value)
    assert len(result.synergies) == 1
    bonus = result.synergies[0]
    assert tuple(bonus.pair) == pair
    assert bonus.district_id == "nura"
    assert bonus.indicator == indicator
    assert bonus.bonus == 2


def test_negative_m11_effect_is_kept_and_scaled_by_lag():
    chosen = decisions(("M9", "nura"), ("M11", "nura"), ("M10", "nura"), ("M12", None), ("M4", "yesil"))
    result = sim.evaluate(chosen).result
    assert result is not None
    assert district(result, "nura").indicators["T1"] == 53.25
    effect = next(item for item in result.effects if item.measure_id == "M11" and item.indicator == "T1")
    assert effect.district_id == "nura"
    assert effect.value == -1.75


@pytest.mark.parametrize(("value", "expected_count"), [(39.999, 1), (40, 0), (40.001, 0)])
def test_critical_threshold_is_strictly_less_than_40(value, expected_count):
    dataset = sim.get_dataset()
    districts = tuple(
        item.model_copy(update={"indicators": MappingProxyType({**item.indicators, "S1": value, "S2": 40})})
        if item.id == "nura"
        else item
        for item in dataset.districts
    )
    result = sim._calculate([], dataset.model_copy(update={"districts": districts}))
    assert result.n_crit == expected_count


@pytest.mark.parametrize(("initial", "expected"), [(99, 98.75), (1, 0.75)])
def test_clip_is_applied_after_summing_positive_and_negative_effects(initial, expected):
    dataset = sim.get_dataset()
    districts = tuple(
        item.model_copy(update={"indicators": MappingProxyType({**item.indicators, "T1": initial})})
        if item.id == "yesil"
        else item
        for item in dataset.districts
    )
    measures = tuple(
        item.model_copy(update={"effects": MappingProxyType({"T1": 2})}) if item.id == "M1" else item
        for item in dataset.measures
    )
    synthetic = dataset.model_copy(update={"districts": districts, "measures": measures})
    for chosen in permutations(decisions(("M1", "yesil"), ("M11", "yesil"))):
        result = sim._calculate(list(chosen), synthetic)
        assert district(result, "yesil").indicators["T1"] == expected


@pytest.mark.parametrize(("initial", "measure_id", "expected"), [(99, "M1", 100), (1, "M11", 0)])
def test_final_indicators_are_clipped_to_zero_and_100(initial, measure_id, expected):
    dataset = sim.get_dataset()
    districts = tuple(
        item.model_copy(update={"indicators": MappingProxyType({**item.indicators, "T1": initial})})
        if item.id == "yesil"
        else item
        for item in dataset.districts
    )
    result = sim._calculate(
        decisions((measure_id, "yesil")), dataset.model_copy(update={"districts": districts})
    )
    assert district(result, "yesil").indicators["T1"] == expected


def test_decision_order_does_not_change_the_result_or_mutate_inputs():
    chosen = sim.example_decisions()
    original_decisions = [item.model_dump() for item in chosen]
    dataset_before = sim.get_dataset().model_dump(mode="json")
    expected = sim.evaluate(chosen)
    for reordered in permutations(chosen):
        assert sim.evaluate(list(reordered)) == expected
    assert [item.model_dump() for item in chosen] == original_decisions
    assert sim.get_dataset().model_dump(mode="json") == dataset_before
    assert sim.baseline().score == pytest.approx(52.55768)


def test_config_api_exposes_official_dataset_and_baseline():
    response = client.get("/api/sim/config")
    assert response.status_code == 200
    config = response.json()
    assert config["dataset"] == sim.get_dataset().model_dump(mode="json")
    assert config["baseline"]["score"] == pytest.approx(52.55768)
    assert config["example"] == payload()["decisions"]
    assert config["llm_mode"] == "mock"


def test_evaluate_api_returns_server_calculated_example():
    response = client.post("/api/sim/evaluate", json=payload())
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is True
    assert not result["violations"]
    assert result["result"]["cost"] == 95
    assert result["result"]["score"] == pytest.approx(56.54307)


@pytest.mark.parametrize("chosen", [[], decisions(("M99", None)) + sim.example_decisions()[1:]])
def test_evaluate_api_returns_violations_without_result(chosen):
    response = client.post("/api/sim/evaluate", json=payload(chosen))
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is False
    assert result["result"] is None
    assert result["violations"]


def test_evaluate_api_does_not_accept_client_calculated_values():
    response = client.post("/api/sim/evaluate", json={**payload(), "score": 100, "cost": 0})
    assert response.status_code == 422


def test_analyze_api_mock_stream_explains_the_actual_scenario(monkeypatch):
    def unexpected_call(*args, **kwargs):
        pytest.fail("Mock-анализ не должен обращаться к провайдеру")

    monkeypatch.setattr(llm, "client", unexpected_call)
    response = client.post("/api/sim/analyze", json=payload())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = sse_events(response)
    assert events[-1] == {"done": True}
    assert not any("error" in item for item in events)
    text = "".join(item.get("delta", "") for item in events)
    assert "95" in text
    assert "56.54" in text.replace(",", ".")
    assert "Нура" in text
    assert "Вы написали" not in text


def test_analyze_api_rejects_invalid_scenarios_before_calling_llm(monkeypatch):
    def unexpected_call(*args, **kwargs):
        pytest.fail("Невалидный набор нельзя передавать модели")

    monkeypatch.setattr(llm, "stream", unexpected_call)
    response = client.post("/api/sim/analyze", json=payload([]))
    assert response.status_code == 422
    assert response.json()["detail"]


def test_analyze_api_passes_calculated_facts_to_llm(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    get_settings.cache_clear()
    calls = []

    async def fake_stream(messages, **kwargs):
        calls.append(messages)
        yield "Объяснение рассчитанного сценария"

    monkeypatch.setattr(llm, "stream", fake_stream)
    response = client.post("/api/sim/analyze", json=payload())
    assert response.status_code == 200
    assert sse_events(response)[-1] == {"done": True}
    assert len(calls) == 1
    assert calls[0][0]["role"] == "system"
    content = "\n".join(message["content"] for message in calls[0])
    assert "56.54307" in content
    assert "95" in content
    assert "M7" in content


def test_analyze_provider_error_uses_existing_sse_error_format(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    get_settings.cache_clear()

    async def failed_stream(*args, **kwargs):
        yield "Начало ответа"
        raise llm.LLMError("Провайдер временно недоступен")

    monkeypatch.setattr(llm, "stream", failed_stream)
    response = client.post("/api/sim/analyze", json=payload())
    assert response.status_code == 200
    events = sse_events(response)
    assert events[0] == {"delta": "Начало ответа"}
    assert events[-1]["error"] == "Провайдер временно недоступен"
    assert events[-1]["request_id"] == response.headers["X-Request-ID"]
    assert not any(item.get("done") for item in events)
