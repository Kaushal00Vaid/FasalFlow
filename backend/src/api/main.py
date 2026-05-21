"""
FastAPI service for the AI Field Force Intelligence backend.

Endpoints:
  GET  /health                          : liveness
  GET  /reps                            : list reps (paginated)
  GET  /reps/{rep_id}                   : rep details (territory, retailer count)
  GET  /plan/today?rep_id=...&date=...  : ranked visit plan with reasons
  GET  /visit/{retailer_id}/detail      : full reason card for one retailer
  GET  /anomalies?rep_id=...            : anomalies relevant to a rep
  GET  /retailers/{retailer_id}/history : POS + visit history for a retailer
  POST /outcome                         : log visit outcome (for outcome-learning loop)
  GET  /outcomes/sync                   : pull queued outcomes (offline-sync demo)

Designed to be the contract for ANY frontend (React, Streamlit, mobile).
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import pandas as pd
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.models.conversion import ConversionModel
from src.scoring.priority import PriorityScorer

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger(__name__)

PROC = Path(__file__).resolve().parents[2] / "data" / "processed"
ART = Path(__file__).resolve().parents[2] / "data" / "artifacts"
DB_PATH = ART / "outcomes.db"


# ---------------------------------------------------------------------------
# State (loaded once at startup)
# ---------------------------------------------------------------------------
class _State:
    scorer: PriorityScorer | None = None
    scorer_with_ml: PriorityScorer | None = None
    anomalies: list[dict] = []
    master: pd.DataFrame | None = None
    dim_retailers: pd.DataFrame | None = None
    dim_reps: pd.DataFrame | None = None


state = _State()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Loading models and data into memory...")
    state.scorer = PriorityScorer()  # rule-based only
    try:
        conv = ConversionModel()
        state.scorer_with_ml = PriorityScorer(conversion_model=conv)
        log.info("Loaded conversion model - ML-enhanced scoring available.")
    except FileNotFoundError:
        log.warning("Conversion model not found, ML-enhanced scoring disabled.")
        state.scorer_with_ml = state.scorer
    with open(ART / "anomalies.json") as f:
        state.anomalies = json.load(f)
    state.master = pd.read_parquet(PROC / "features_master.parquet")
    state.dim_retailers = pd.read_parquet(PROC / "dim_retailers.parquet")
    state.dim_reps = pd.read_parquet(PROC / "dim_reps.parquet")
    _init_outcomes_db()
    log.info(f"Ready. {len(state.master):,} feature rows, {len(state.anomalies):,} anomalies.")
    yield
    log.info("API shutting down.")


app = FastAPI(
    title="Syngenta Field Force Intelligence API",
    version="1.0.0",
    description="Backend for the AI co-pilot used by Syngenta field representatives.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _init_outcomes_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rep_id TEXT NOT NULL,
            retailer_id TEXT NOT NULL,
            visit_date TEXT NOT NULL,
            outcome TEXT NOT NULL,
            sku_discussed TEXT,
            notes TEXT,
            offline_queued_at TEXT,
            synced_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class HealthResp(BaseModel):
    status: str
    feature_rows: int
    anomalies: int
    has_ml: bool


class RepSummary(BaseModel):
    rep_id: str
    territory_id: str
    territory_name: str
    state: str
    district: str
    retailer_count: int


class ReasonFact(BaseModel):
    label: str
    value: str
    direction: str
    contribution: float


class VisitReco(BaseModel):
    retailer_id: str
    tehsil: str
    district: str
    score: float
    recommended_sku: str
    recommended_sku_id: str
    recommended_action: str
    reasons: list[ReasonFact]
    one_line_why: str


class DayPlan(BaseModel):
    rep_id: str
    as_of_date: str
    week_end_date: str
    weights_used: dict
    visits: list[VisitReco]


class OutcomeIn(BaseModel):
    rep_id: str
    retailer_id: str
    visit_date: str
    outcome: Literal["order_placed", "discussed_only", "no_interest", "follow_up"]
    sku_discussed: str | None = None
    notes: str | None = None
    offline_queued_at: str | None = None  # client-side timestamp when offline


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResp)
def health():
    return HealthResp(
        status="ok",
        feature_rows=len(state.master),
        anomalies=len(state.anomalies),
        has_ml=state.scorer_with_ml is not None and state.scorer_with_ml.conversion_model is not None,
    )


@app.get("/reps", response_model=list[RepSummary])
def list_reps(limit: int = Query(50, ge=1, le=500), offset: int = 0):
    df = state.dim_reps.iloc[offset : offset + limit]
    counts = state.dim_retailers.groupby("rep_id").size().to_dict()
    return [
        RepSummary(
            rep_id=r["rep_id"],
            territory_id=r["territory_id"],
            territory_name=r["territory_name"],
            state=r["state"],
            district=r["district"],
            retailer_count=int(counts.get(r["rep_id"], 0)),
        )
        for _, r in df.iterrows()
    ]


@app.get("/reps/{rep_id}", response_model=RepSummary)
def get_rep(rep_id: str):
    r = state.dim_reps[state.dim_reps["rep_id"] == rep_id]
    if r.empty:
        raise HTTPException(404, f"Rep {rep_id} not found")
    r = r.iloc[0]
    n = int((state.dim_retailers["rep_id"] == rep_id).sum())
    return RepSummary(
        rep_id=r["rep_id"],
        territory_id=r["territory_id"],
        territory_name=r["territory_name"],
        state=r["state"],
        district=r["district"],
        retailer_count=n,
    )


@app.get("/plan/today", response_model=DayPlan)
def plan_today(
    rep_id: str,
    date: str = Query(..., description="ISO date, e.g. 2026-02-15"),
    top_n: int = Query(8, ge=1, le=25),
    use_ml: bool = Query(True, description="Use ML conversion model in scoring"),
):
    scorer = state.scorer_with_ml if use_ml else state.scorer
    try:
        recs = scorer.plan_day(rep_id=rep_id, as_of_date=date, top_n=top_n)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Resolve the snapped week_end_date the scorer used (for transparency)
    as_of = pd.Timestamp(date)
    weeks = sorted(state.master["week_end_date"].unique())
    week_end = max(w for w in weeks if pd.Timestamp(w) <= as_of)

    return DayPlan(
        rep_id=rep_id,
        as_of_date=date,
        week_end_date=str(pd.Timestamp(week_end).date()),
        weights_used=scorer.weights,
        visits=[
            VisitReco(
                retailer_id=r.retailer_id,
                tehsil=r.tehsil,
                district=r.district,
                score=r.score,
                recommended_sku=r.recommended_sku,
                recommended_sku_id=r.recommended_sku_id,
                recommended_action=r.recommended_action,
                reasons=[ReasonFact(**f.__dict__) for f in r.reasons],
                one_line_why=r.one_line_why,
            )
            for r in recs
        ],
    )


@app.get("/visit/{retailer_id}/detail")
def visit_detail(retailer_id: str, date: str = Query(...)):
    as_of = pd.Timestamp(date)
    weeks = sorted(state.master["week_end_date"].unique())
    eligible = [w for w in weeks if pd.Timestamp(w) <= as_of]
    if not eligible:
        raise HTTPException(400, f"No data on or before {as_of}")
    week_end = max(eligible)

    slice_df = state.master[
        (state.master["retailer_id"] == retailer_id) & (state.master["week_end_date"] == week_end)
    ]
    if slice_df.empty:
        raise HTTPException(404, f"No data for {retailer_id} on {week_end}")

    score, reasons, sku_pick = state.scorer_with_ml.score_retailer(slice_df)

    # Inventory snapshot for all 12 SKUs
    inventory = [
        {
            "sku_id": r["sku_id"],
            "sku_name": r["sku_name"],
            "on_hand": int(r["sku_qty"]),
            "weeks_of_stock": round(float(r["weeks_of_stock"]), 1),
            "velocity_4w": round(float(r["velocity_4w"]), 1),
            "low_stock": bool(r["low_stock_flag"]),
        }
        for _, r in slice_df.iterrows()
    ]
    row0 = slice_df.iloc[0]
    return {
        "retailer_id": retailer_id,
        "tehsil": row0["tehsil"],
        "district": row0["district"],
        "state": row0["state"],
        "score": round(score, 4),
        "reasons": [r.__dict__ for r in reasons],
        "recommended": sku_pick,
        "inventory": inventory,
        "stage_signal": {
            "dominant_crop": row0["dominant_crop"],
            "stage_urgency_mean": round(float(row0["stage_urgency_mean"]), 3),
            "pct_flowering": round(float(row0["pct_flowering"]), 3),
            "pct_tillering": round(float(row0["pct_tillering"]), 3),
            "grower_count_in_tehsil": int(row0["grower_count"]),
        },
        "visit_history": {"days_since_last_visit": int(row0["days_since_last_visit"])},
    }


@app.get("/anomalies")
def get_anomalies(
    rep_id: str | None = None,
    district: str | None = None,
    kind: str | None = None,
    limit: int = Query(20, ge=1, le=200),
):
    res = state.anomalies
    if rep_id:
        res = [a for a in res if rep_id in a.get("affected_reps", [])]
    if district:
        res = [a for a in res if a["district"] == district]
    if kind:
        res = [a for a in res if a["kind"] == kind]
    res = sorted(res, key=lambda a: (a["week_end_date"], a["severity"]), reverse=True)
    return res[:limit]


@app.get("/retailers/{retailer_id}/history")
def retailer_history(retailer_id: str):
    df = state.master[state.master["retailer_id"] == retailer_id].sort_values("week_end_date")
    if df.empty:
        raise HTTPException(404, f"No data for {retailer_id}")
    pos_history = (
        df.groupby("week_end_date")[["units_sold", "revenue"]].sum().reset_index()
    )
    pos_history["week_end_date"] = pos_history["week_end_date"].astype(str)
    return {
        "retailer_id": retailer_id,
        "weeks": pos_history.to_dict("records"),
    }


@app.post("/outcome")
def log_outcome(body: OutcomeIn):
    """Log a visit outcome. Supports offline-queued submissions:
    if `offline_queued_at` is set, the server records both the offline timestamp
    and the actual sync timestamp."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT INTO outcomes
           (rep_id, retailer_id, visit_date, outcome, sku_discussed, notes, offline_queued_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            body.rep_id,
            body.retailer_id,
            body.visit_date,
            body.outcome,
            body.sku_discussed,
            body.notes,
            body.offline_queued_at,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()
    rowid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return {"ok": True, "id": rowid, "synced_at": datetime.now(timezone.utc).isoformat()}


@app.get("/outcomes/sync")
def outcomes_for_rep(rep_id: str, limit: int = 100):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "SELECT id, rep_id, retailer_id, visit_date, outcome, sku_discussed, notes, "
        "offline_queued_at, synced_at FROM outcomes WHERE rep_id=? ORDER BY id DESC LIMIT ?",
        (rep_id, limit),
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    conn.close()
    return rows
