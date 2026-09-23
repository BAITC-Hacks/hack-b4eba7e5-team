from fastapi.testclient import TestClient
from pydantic import BaseModel

from app import llm
from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.headers["X-Request-ID"]


def test_chat_mock():
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "привет"}]})
    assert r.status_code == 200
    assert "привет" in r.json()["reply"]


def test_chat_validation():
    r = client.post("/api/chat", json={"messages": []})
    assert r.status_code == 422


def test_stream_mock():
    with client.stream(
        "POST", "/api/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}
    ) as r:
        body = "".join(r.iter_text())
    assert '"done": true' in body


async def test_complete_json_mock():
    class Out(BaseModel):
        title: str
        score: int
        tags: list[str]

    out = await llm.complete_json([{"role": "user", "content": "x"}], Out)
    assert out.title == "mock" and out.score == 0 and out.tags == []
