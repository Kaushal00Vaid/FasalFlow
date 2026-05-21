"""
Anomaly Detector.

Two complementary methods:

1. Rolling z-score (interpretable, runs in milliseconds, default):
   For each (district, sku, week), compute z = (units - mean_prev_8w) / std_prev_8w.
   |z| > 2.5 → flag. Direction (+ spike / - drop) is preserved.

2. Isolation Forest (multivariate, optional second pass):
   Trains on (units_sold, weeks_of_stock, velocity_trend, pct_flowering)
   per district-week. Catches odd combinations the univariate z-score misses.

For each anomaly, we emit:
  - kind: 'demand_spike' | 'demand_drop' | 'stockout_risk' | 'unusual_pattern'
  - district, sku, week
  - severity score
  - a human-readable explanation
  - suggested action (which rep / which retailers to alert)
"""
from __future__ import annotations

import json
import logging
import pickle
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger(__name__)

PROC = Path(__file__).resolve().parents[2] / "data" / "processed"
ART = Path(__file__).resolve().parents[2] / "data" / "artifacts"
ART.mkdir(parents=True, exist_ok=True)


@dataclass
class Anomaly:
    week_end_date: str
    district: str
    sku_id: str
    sku_name: str
    kind: str
    severity: float
    z_score: float | None
    current_value: float
    baseline_value: float
    explanation: str
    affected_retailers: list[str]
    affected_reps: list[str]

    def to_dict(self):
        return asdict(self)


# ---------------------------------------------------------------------------
# Rolling z-score
# ---------------------------------------------------------------------------
def detect_pos_anomalies(z_threshold: float = 2.5) -> list[Anomaly]:
    """Flag district-sku-week combinations where weekly POS deviates strongly
    from the prior 8-week baseline."""
    master = pd.read_parquet(PROC / "features_master.parquet")
    dim = pd.read_parquet(PROC / "dim_retailers.parquet")

    # Aggregate to district-sku-week
    dsw = (
        master.groupby(["district", "sku_id", "sku_name", "week_end_date"], as_index=False)
        .agg(units_sold=("units_sold", "sum"), revenue=("revenue", "sum"))
        .sort_values(["district", "sku_id", "week_end_date"])
    )

    # Rolling stats over prior 8 weeks (shifted by 1 to exclude current week)
    grp = dsw.groupby(["district", "sku_id"])["units_sold"]
    dsw["roll_mean"] = grp.transform(lambda s: s.shift(1).rolling(8, min_periods=4).mean())
    dsw["roll_std"] = grp.transform(lambda s: s.shift(1).rolling(8, min_periods=4).std())
    dsw["z_score"] = (dsw["units_sold"] - dsw["roll_mean"]) / dsw["roll_std"].replace(0, np.nan)

    flagged = dsw[dsw["z_score"].abs() > z_threshold].copy()
    log.info(f"Found {len(flagged):,} district-sku-week anomalies at |z|>{z_threshold}")

    anomalies: list[Anomaly] = []
    for _, row in flagged.iterrows():
        kind = "demand_spike" if row["z_score"] > 0 else "demand_drop"
        # Find affected retailers in that district at that week
        affected = master[
            (master["district"] == row["district"])
            & (master["sku_id"] == row["sku_id"])
            & (master["week_end_date"] == row["week_end_date"])
            & (master["units_sold"] > 0)
        ]
        affected = affected.sort_values("units_sold", ascending=False).head(5)
        affected_retailers = affected["retailer_id"].tolist()
        affected_reps = dim[dim["retailer_id"].isin(affected_retailers)]["rep_id"].dropna().unique().tolist()

        pct_change = (
            ((row["units_sold"] - row["roll_mean"]) / row["roll_mean"] * 100)
            if row["roll_mean"] > 0
            else 0.0
        )
        explanation = (
            f"{row['sku_name']} {'spiked' if kind == 'demand_spike' else 'dropped'} "
            f"{abs(pct_change):.0f}% in {row['district']} this week "
            f"({row['units_sold']:.0f} units vs 8-week avg {row['roll_mean']:.0f})."
        )
        anomalies.append(
            Anomaly(
                week_end_date=str(pd.Timestamp(row["week_end_date"]).date()),
                district=row["district"],
                sku_id=row["sku_id"],
                sku_name=row["sku_name"],
                kind=kind,
                severity=float(min(abs(row["z_score"]) / 5.0, 1.0)),
                z_score=float(row["z_score"]),
                current_value=float(row["units_sold"]),
                baseline_value=float(row["roll_mean"]),
                explanation=explanation,
                affected_retailers=affected_retailers,
                affected_reps=affected_reps,
            )
        )
    return anomalies


# ---------------------------------------------------------------------------
# Stockout-risk anomalies (rule-based)
# ---------------------------------------------------------------------------
def detect_stockout_risks() -> list[Anomaly]:
    """Identify retailers with <2 weeks of stock AND positive velocity trend."""
    master = pd.read_parquet(PROC / "features_master.parquet")
    dim = pd.read_parquet(PROC / "dim_retailers.parquet")

    latest_week = master["week_end_date"].max()
    recent = master[master["week_end_date"] == latest_week]

    at_risk = recent[
        (recent["weeks_of_stock"] < 2)
        & (recent["weeks_of_stock"] > 0)
        & (recent["velocity_4w"] > 0)
    ]
    log.info(f"Stockout risks at latest week: {len(at_risk):,}")

    # Group by district x sku for aggregated alerts
    grouped = (
        at_risk.groupby(["district", "sku_id", "sku_name"])
        .agg(retailer_count=("retailer_id", "count"), retailers=("retailer_id", list))
        .reset_index()
    )
    grouped = grouped[grouped["retailer_count"] >= 2]  # at least 2 retailers in district

    anomalies = []
    for _, row in grouped.iterrows():
        reps = dim[dim["retailer_id"].isin(row["retailers"])]["rep_id"].dropna().unique().tolist()
        anomalies.append(
            Anomaly(
                week_end_date=str(pd.Timestamp(latest_week).date()),
                district=row["district"],
                sku_id=row["sku_id"],
                sku_name=row["sku_name"],
                kind="stockout_risk",
                severity=min(row["retailer_count"] / 10.0, 1.0),
                z_score=None,
                current_value=float(row["retailer_count"]),
                baseline_value=0.0,
                explanation=(
                    f"{row['retailer_count']} retailers in {row['district']} are at <2 weeks of stock "
                    f"on {row['sku_name']} with active demand. Restock push needed."
                ),
                affected_retailers=row["retailers"][:5],
                affected_reps=reps,
            )
        )
    return anomalies


# ---------------------------------------------------------------------------
# Isolation Forest (multivariate)
# ---------------------------------------------------------------------------
def train_isolation_forest():
    from sklearn.ensemble import IsolationForest

    master = pd.read_parquet(PROC / "features_master.parquet")
    dw = (
        master.groupby(["district", "week_end_date"], as_index=False)
        .agg(
            total_units=("units_sold", "sum"),
            total_revenue=("revenue", "sum"),
            mean_weeks_stock=("weeks_of_stock", "mean"),
            mean_velocity_trend=("velocity_trend", "mean"),
            pct_flowering=("pct_flowering", "mean"),
            stockout_rate=("is_stockout", "mean"),
        )
    )
    feats = ["total_units", "total_revenue", "mean_weeks_stock", "mean_velocity_trend", "pct_flowering", "stockout_rate"]
    X = dw[feats].fillna(0)
    iso = IsolationForest(contamination=0.05, random_state=42, n_estimators=200)
    iso.fit(X)
    with open(ART / "iso_forest.pkl", "wb") as f:
        pickle.dump({"model": iso, "feature_cols": feats}, f)
    log.info(f"Trained Isolation Forest on {len(X):,} district-weeks")


def run_all():
    pos_anomalies = detect_pos_anomalies()
    stockout_anomalies = detect_stockout_risks()
    all_anomalies = pos_anomalies + stockout_anomalies
    # Sort by severity desc, latest first
    all_anomalies.sort(key=lambda a: (a.week_end_date, a.severity), reverse=True)

    out = ART / "anomalies.json"
    with open(out, "w") as f:
        json.dump([a.to_dict() for a in all_anomalies], f, indent=2, default=str)
    log.info(f"Wrote {len(all_anomalies):,} anomalies to {out}")

    print("\n=== TOP 5 ANOMALIES (by severity) ===\n")
    for a in sorted(all_anomalies, key=lambda x: x.severity, reverse=True)[:5]:
        print(f"[{a.kind.upper()}] {a.week_end_date} · {a.district} · {a.sku_name}")
        print(f"  Severity: {a.severity:.2f}")
        print(f"  {a.explanation}")
        print(f"  Affected reps: {a.affected_reps[:3]}")
        print()


if __name__ == "__main__":
    train_isolation_forest()
    run_all()
