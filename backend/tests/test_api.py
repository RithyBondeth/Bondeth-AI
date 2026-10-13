from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health(client):  # the fixture client runs the full lifespan (DB + Redis)
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok"
    assert body["database"] == body["redis"] == "ok"
    assert body["clone_queue"] == 0


def test_normalize_endpoint():
    res = client.post("/api/v1/text/normalize", json={"text": "$25"})
    assert res.status_code == 200
    assert res.json()["normalized"] == "ម្ភៃប្រាំដុល្លារ"


def test_normalize_rejects_empty_text():
    res = client.post("/api/v1/text/normalize", json={"text": ""})
    assert res.status_code == 422
