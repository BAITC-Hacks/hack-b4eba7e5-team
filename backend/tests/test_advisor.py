"""Оптимум, сверка с основным движком, проверка фактов и защита API без сети."""

import asyncio
import json
import subprocess
import sys
from itertools import combinations, product

import pytest
from fastapi.testclient import TestClient

from app import analysis, llm, optimizer, sim
from app.config import get_settings
from app.main import app
from app.rate_limit import check_ai_limit

client = TestClient(app)


def events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def payload():
    return {"decisions": [item.model_dump() for item in sim.example_decisions()]}


def test_exact_optimum_is_recomputed_and_cached():
    result = optimizer.optimize()
    assert result.exact
    assert result.evaluated == 694395
    assert result.result.score == pytest.approx(57.236735)
    assert result.result.cost == 98
    assert sim.evaluate(result.decisions).result == result.result
    assert {(item.measure_id, item.district_id) for item in result.decisions} == {
        ("M2", None),
        ("M14", None),
        ("M3", "nura"),
        ("M8", "nura"),
        ("M9", "nura"),
    }
    assert optimizer.optimize() is result


@pytest.mark.parametrize(
    "ids",
    [
        {"M1", "M2", "M4", "M7", "M9", "M12"},
        {"M5", "M6", "M8", "M10", "M11", "M12", "M13"},
    ],
)
def test_optimized_search_matches_independent_full_evaluation(monkeypatch, ids):
    dataset = sim.get_dataset()
    reduced = dataset.model_copy(
        update={"measures": tuple(item for item in dataset.measures if item.id in ids)}
    )
    monkeypatch.setattr(sim, "get_dataset", lambda: reduced)
    expected = float("-inf")
    count = 0
    for measures in combinations(reduced.measures, reduced.decisions_required):
        for targets in product(
            *[
                [None] if item.scope == "city" else [district.id for district in reduced.districts]
                for item in measures
            ]
        ):
            chosen = [
                sim.Decision(measure_id=item.id, district_id=target)
                for item, target in zip(measures, targets)
            ]
            evaluation = sim.evaluate(chosen)
            if evaluation.result:
                expected = max(expected, evaluation.result.score)
                count += 1
    optimum = optimizer.search(reduced)
    assert optimum.evaluated == count
    assert optimum.result.score == pytest.approx(expected, abs=1e-10)


@pytest.mark.parametrize(
    "chosen",
    [
        sim.example_decisions(),
        [
            sim.Decision(measure_id=measure, district_id=district)
            for measure, district in [
                ("M9", "nura"),
                ("M11", "nura"),
                ("M10", "nura"),
                ("M12", None),
                ("M4", "yesil"),
            ]
        ],
    ],
)
def test_shapley_sums_to_score_gain_and_is_order_independent(chosen):
    values = sim.contributions(chosen)
    result = sim.evaluate(chosen).result
    assert sum(item.score_delta for item in values) == pytest.approx(result.score - sim.baseline().score)
    reverse = {item.measure_id: item.score_delta for item in sim.contributions(list(reversed(chosen)))}
    assert reverse == pytest.approx({item.measure_id: item.score_delta for item in values})


def test_facts_include_actual_deltas_contributions_and_comparison():
    chosen = sim.example_decisions()
    result = sim.evaluate(chosen).result
    facts = analysis.build_facts(chosen, result, optimizer.optimize())
    nura = next(item for item in facts["district_deltas"] if item["district_id"] == "nura")
    assert nura["indicators"]["S1"] == 10
    assert len(facts["contributions"]) == 5
    assert "+0.69" in facts["facts"]["comparison"]
    assert "Добавить" in facts["facts"]["replacement"]


@pytest.mark.parametrize(
    "text,refs",
    [
        ("Score 99", ["summary"]),
        ("Score девяносто девять", ["summary"]),
        ("Score ²", ["summary"]),
        ("План улучшает город", ["nonexistent"]),
    ],
)
def test_untrusted_numbers_and_unknown_fact_ids_are_not_published(monkeypatch, text, refs):
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    get_settings.cache_clear()
    calls = []

    async def complete(messages, schema):
        calls.append(messages)
        return schema(paragraphs=[{"title": "Итог", "text": text, "fact_ids": refs}])

    monkeypatch.setattr(llm, "complete_json", complete)
    response = client.post("/api/sim/analyze", json=payload())
    stream = events(response)
    output = "".join(item.get("delta", "") for item in stream)
    assert stream[-1] == {"done": True}
    assert len(calls) == 2
    assert text not in output
    assert "не прошёл проверку" in output
    assert "56.54" in output


def test_model_can_only_select_facts_from_the_section(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    get_settings.cache_clear()

    async def complete(messages, schema):
        return schema(paragraphs=[analysis.Paragraph(title="Итог", fact_ids=["summary"])])

    monkeypatch.setattr(llm, "complete_json", complete)
    response = client.post("/api/sim/analyze", json=payload())
    assert "**" not in response.text
    assert "56.54" in response.text
    assert "Рекомендация по расчёту" in response.text
    assert not analysis._valid(
        analysis.Narrative(paragraphs=[analysis.Paragraph(title="Риски", fact_ids=["summary"])]),
        {"Риски": ["risks"]},
    )


def test_optimize_stream_compares_and_proposes_valid_plan():
    response = client.post("/api/sim/optimize", json=payload())
    assert response.status_code == 200
    stream = events(response)
    assert "status" in stream[0]
    assert stream[-1] == {"done": True}
    result = next(item["result"] for item in stream if "result" in item)
    proposal = optimizer.Optimum.model_validate(result)
    assert sim.evaluate(proposal.decisions).result == proposal.result
    text = "".join(item.get("delta", "") for item in stream)
    assert "56.54 → 57.24" in text
    assert "Рекомендации" in text


def test_optimize_empty_plan_and_reject_invalid_plan():
    assert client.post("/api/sim/optimize", json={"decisions": []}).status_code == 200
    assert client.post("/api/sim/optimize", json={"decisions": [{"measure_id": "M99"}]}).status_code == 422


def test_analysis_and_optimizer_share_rate_limit(monkeypatch):
    monkeypatch.setenv("AI_REQUESTS_PER_MINUTE", "1")
    get_settings.cache_clear()
    assert client.post("/api/sim/analyze", json=payload()).status_code == 200
    response = client.post("/api/sim/optimize", json=payload(), headers={"X-Forwarded-For": "198.51.100.4"})
    assert response.status_code == 429
    assert response.headers["Retry-After"]
    assert response.headers["X-Request-ID"]
    assert "минуту" in response.json()["detail"]
    assert client.post("/api/sim/evaluate", json=payload()).status_code == 200


async def test_rate_limit_recovers_after_window(monkeypatch):
    monkeypatch.setenv("AI_REQUESTS_PER_MINUTE", "1")
    get_settings.cache_clear()
    monkeypatch.setattr("app.rate_limit.monotonic", lambda: 100)
    await check_ai_limit()
    monkeypatch.setattr("app.rate_limit.monotonic", lambda: 161)
    await check_ai_limit()


async def test_concurrent_optimizer_requests_share_cached_result():
    first, second = await asyncio.gather(
        asyncio.to_thread(optimizer.optimize), asyncio.to_thread(optimizer.optimize)
    )
    assert first is second


def test_production_has_no_chat_routes():
    script = """
from app.config import Settings
Settings.model_config["env_file"] = None
import os
os.environ["APP_ENV"] = "prod"
os.environ["LLM_MOCK"] = "true"
from app.main import app
from fastapi.testclient import TestClient
with TestClient(app) as client:
    for path in ("/api/chat", "/api/chat/stream"):
        assert client.post(path, json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 404
"""
    subprocess.run([sys.executable, "-c", script], check=True, capture_output=True)


def test_invalid_plan_does_not_consume_ai_limit(monkeypatch):
    monkeypatch.setenv("AI_REQUESTS_PER_MINUTE", "1")
    get_settings.cache_clear()
    assert client.post("/api/sim/analyze", json={"decisions": []}).status_code == 422
    assert client.post("/api/sim/analyze", json=payload()).status_code == 200
