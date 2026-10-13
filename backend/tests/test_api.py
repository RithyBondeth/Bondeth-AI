from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_normalize_endpoint():
    res = client.post("/api/v1/text/normalize", json={"text": "$25"})
    assert res.status_code == 200
    assert res.json()["normalized"] == "ម្ភៃប្រាំដុល្លារ"


def test_normalize_rejects_empty_text():
    res = client.post("/api/v1/text/normalize", json={"text": ""})
    assert res.status_code == 422
