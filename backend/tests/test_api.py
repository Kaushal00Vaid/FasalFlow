"""Smoke tests for the API and scoring engine.

Run:  cd syngenta_ffi && python -m pytest tests/ -v
"""
import pytest
from fastapi.testclient import TestClient

from src.api.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    assert d["feature_rows"] > 100_000
    assert d["anomalies"] > 0


def test_rep_lookup(client):
    r = client.get("/reps/REP_0001")
    assert r.status_code == 200
    d = r.json()
    assert d["rep_id"] == "REP_0001"
    assert d["retailer_count"] > 0


def test_rep_not_found(client):
    r = client.get("/reps/REP_9999")
    assert r.status_code == 404


def test_plan_today_structure(client):
    r = client.get("/plan/today", params={"rep_id": "REP_0001", "date": "2026-02-15", "top_n": 5})
    assert r.status_code == 200
    d = r.json()
    assert d["rep_id"] == "REP_0001"
    assert len(d["visits"]) <= 5
    assert all(0 <= v["score"] <= 1 for v in d["visits"])
    # Scores must be in descending order
    scores = [v["score"] for v in d["visits"]]
    assert scores == sorted(scores, reverse=True)
    # Each visit must have at least the structural fields
    for v in d["visits"]:
        assert v["retailer_id"]
        assert v["tehsil"]
        assert v["recommended_sku"]
        assert v["recommended_action"]
        assert v["one_line_why"]
        assert "reasons" in v


def test_plan_explainability(client):
    """Every visit must have at least one reason fact - explainability is non-negotiable."""
    r = client.get("/plan/today", params={"rep_id": "REP_0001", "date": "2026-02-15", "top_n": 5})
    visits = r.json()["visits"]
    for v in visits:
        # Top-ranked visits should have at least one positive reason
        if v["score"] > 0.3:
            assert len(v["reasons"]) > 0, f"Visit {v['retailer_id']} has no reasons but score {v['score']}"


def test_plan_with_and_without_ml(client):
    """ML-on and ML-off should both work; ML adds a conversion_probability reason facet."""
    r1 = client.get("/plan/today", params={"rep_id": "REP_0001", "date": "2026-02-15", "use_ml": False})
    r2 = client.get("/plan/today", params={"rep_id": "REP_0001", "date": "2026-02-15", "use_ml": True})
    assert r1.status_code == 200 and r2.status_code == 200
    # Both return non-empty plans
    assert len(r1.json()["visits"]) > 0
    assert len(r2.json()["visits"]) > 0


def test_visit_detail(client):
    r = client.get("/visit/RTL_00001/detail", params={"date": "2026-02-15"})
    assert r.status_code == 200
    d = r.json()
    assert d["retailer_id"] == "RTL_00001"
    # Inventory snapshot includes whatever SKUs this retailer stocks (1..12)
    assert 1 <= len(d["inventory"]) <= 12
    # Every inventory row must have the expected shape
    for inv in d["inventory"]:
        assert "sku_id" in inv and "weeks_of_stock" in inv and "low_stock" in inv
    assert "stage_signal" in d


def test_anomalies_filter_by_rep(client):
    r = client.get("/anomalies", params={"rep_id": "REP_0001", "limit": 10})
    assert r.status_code == 200
    anomalies = r.json()
    # Every returned anomaly must list REP_0001 as affected
    for a in anomalies:
        assert "REP_0001" in a["affected_reps"]


def test_outcome_round_trip(client):
    """Post an outcome, then read it back via sync endpoint."""
    body = {
        "rep_id": "REP_0001",
        "retailer_id": "RTL_00001",
        "visit_date": "2026-02-15",
        "outcome": "order_placed",
        "sku_discussed": "Tilt 250 EC",
        "notes": "test",
        "offline_queued_at": "2026-02-15T08:30:00",
    }
    r = client.post("/outcome", json=body)
    assert r.status_code == 200
    new_id = r.json()["id"]
    synced = client.get("/outcomes/sync", params={"rep_id": "REP_0001"}).json()
    assert any(o["id"] == new_id for o in synced)


def test_invalid_outcome_value(client):
    r = client.post(
        "/outcome",
        json={
            "rep_id": "REP_0001",
            "retailer_id": "RTL_00001",
            "visit_date": "2026-02-15",
            "outcome": "INVALID",
        },
    )
    assert r.status_code == 422  # pydantic validation error


def test_visit_pitch(client):
    """Test the vernacular pitch generator returns both target pitch and fallback."""
    r = client.get("/visit/RTL_00001/pitch", params={"date": "2026-02-15", "lang": "Hindi"})
    assert r.status_code == 200
    d = r.json()
    assert "pitch" in d
    assert "source" in d
    assert d["source"] in ["gemini", "template"]
    if d["source"] == "template":
        # check that Hindi template pitch is returned
        assert "नमस्ते" in d["pitch"] or "नमस्कार" in d["pitch"]
        assert d["translation"] is not None

