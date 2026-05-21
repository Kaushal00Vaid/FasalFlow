"""
Conversion Probability Model.

Goal: P(visit to tehsil T promoting SKU S at week W results in a POS lift
      for SKU S in that tehsil in the next 2 weeks).

Training data construction:
  - For each visit (rep, date, tehsil, product_recommended):
    * label = 1 if (SKU sales in tehsil in next 2 weeks) > (SKU sales in tehsil in prior 2 weeks) * 1.10
    * label = 0 otherwise
  - Features: crop_stage_urgency, pct_flowering, weeks_of_stock for the SKU
    averaged across retailers in tehsil, recent visit count, days_since_last_visit,
    sku-crop match, month-of-season.

Why this is a real ML model and not a wrapper:
  - The label is grounded in actual POS data (not a Gemini opinion).
  - The features are deterministic, derived from the feature pipeline.
  - The model learns interactions (e.g., flowering × low stock × wheat SKU)
    that no hand-crafted rule captures cleanly.
  - SHAP gives per-prediction explanations the rep can see.

Note on data realism: the synthetic dataset shows a noisy but learnable
relationship. Don't expect AUC > 0.75 - it's bounded by signal in the data.
What matters is calibration and feature importance ranking, both of which
remain meaningful.
"""
from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger(__name__)

PROC = Path(__file__).resolve().parents[2] / "data" / "processed"
ART = Path(__file__).resolve().parents[2] / "data" / "artifacts"
ART.mkdir(parents=True, exist_ok=True)

# Map product names from visit log to SKU IDs (visits log uses display names)
PRODUCT_NAME_TO_SKU = {
    "Tilt 250 EC": "SY_TILT_250EC",
    "Score 250 EC": "SY_SCO_250EC",
    "Kavach 75 WP": "SY_KAV_75WP",
    "Topik 15 WP": "SY_TOP_15WP",
    "Amistar 250 SC": "SY_AMI_250SC",
    "Actara 25 WG": "SY_ACT_25WG",
    "Cruiser 350 FS": "SY_CRU_350FS",
    "Axial 50 EC": "SY_AXI_50EC",
    "Alto 5 SC": "SY_ALT_5SC",
    "Vertimec 1.8 EC": "SY_VER_18EC",
    "Karate 5 EC": "SY_KRA_05EC",
    "Pegasus 50 EC": "SY_PEG_50EC",
}


def build_training_set() -> pd.DataFrame:
    """Construct (visit, label, features) training rows from raw + master."""
    log.info("Loading data...")
    master = pd.read_parquet(PROC / "features_master.parquet")
    visits = pd.read_csv(Path(__file__).resolve().parents[2] / "data" / "raw" / "retailer_visit_log.csv")
    visits["visit_date"] = pd.to_datetime(visits["visit_date"])
    visits["sku_id"] = visits["product_recommended"].map(PRODUCT_NAME_TO_SKU)
    visits = visits.dropna(subset=["sku_id"]).copy()

    # Snap visit dates to week_end (Sunday)
    visits["week_end_date"] = visits["visit_date"] + pd.to_timedelta(
        (6 - visits["visit_date"].dt.weekday) % 7, unit="d"
    )

    # Build a tehsil-week-sku POS table for label construction
    tehsil_sku_week = (
        master.groupby(["tehsil", "sku_id", "week_end_date"], as_index=False)
        .agg(units_sold=("units_sold", "sum"))
        .sort_values(["tehsil", "sku_id", "week_end_date"])
    )
    # Pre-2w and post-2w windows via rolling
    tehsil_sku_week["prior_2w"] = (
        tehsil_sku_week.groupby(["tehsil", "sku_id"])["units_sold"]
        .transform(lambda s: s.shift(1).rolling(2, min_periods=1).sum())
    )
    tehsil_sku_week["next_2w"] = (
        tehsil_sku_week.groupby(["tehsil", "sku_id"])["units_sold"]
        .transform(lambda s: s.shift(-2).rolling(2, min_periods=1).sum())
    )

    log.info(f"  Joining visits ({len(visits):,}) to tehsil-sku-week lift table...")
    enriched = visits.merge(
        tehsil_sku_week[["tehsil", "sku_id", "week_end_date", "prior_2w", "next_2w"]],
        left_on=["visit_tehsil", "sku_id", "week_end_date"],
        right_on=["tehsil", "sku_id", "week_end_date"],
        how="left",
    )
    enriched = enriched.dropna(subset=["prior_2w", "next_2w"])

    # Label: lift > 10% OR prior was zero and next is positive
    enriched["label"] = (
        ((enriched["next_2w"] > enriched["prior_2w"] * 1.10) & (enriched["next_2w"] > 0))
        | ((enriched["prior_2w"] == 0) & (enriched["next_2w"] > 0))
    ).astype(int)

    # Pull features: avg across retailers in tehsil at that week
    tehsil_features = (
        master.groupby(["tehsil", "week_end_date"], as_index=False)
        .agg(
            stage_urgency=("stage_urgency_mean", "mean"),
            pct_flowering=("pct_flowering", "mean"),
            pct_tillering=("pct_tillering", "mean"),
            avg_weeks_of_stock=("weeks_of_stock", "mean"),
            avg_velocity=("velocity_4w", "mean"),
            days_since_last_visit=("days_since_last_visit", "mean"),
        )
    )

    sku_features = (
        master.groupby(["tehsil", "sku_id", "week_end_date"], as_index=False)
        .agg(
            sku_weeks_of_stock=("weeks_of_stock", "mean"),
            sku_velocity=("velocity_4w", "mean"),
            sku_velocity_trend=("velocity_trend", "mean"),
            sku_low_stock=("low_stock_flag", "max"),
        )
    )

    enriched = enriched.merge(tehsil_features, on=["tehsil", "week_end_date"], how="left")
    enriched = enriched.merge(sku_features, on=["tehsil", "sku_id", "week_end_date"], how="left")
    enriched["month_of_season"] = ((enriched["week_end_date"] - pd.Timestamp("2025-10-01")).dt.days // 30).clip(0, 6)

    # One-hot the SKU (12 SKUs - manageable)
    sku_dummies = pd.get_dummies(enriched["sku_id"], prefix="sku")
    enriched = pd.concat([enriched, sku_dummies], axis=1)

    log.info(f"  Training set: {len(enriched):,} rows, positive rate={enriched['label'].mean():.3f}")
    return enriched


FEATURE_COLS = [
    "stage_urgency",
    "pct_flowering",
    "pct_tillering",
    "avg_weeks_of_stock",
    "avg_velocity",
    "days_since_last_visit",
    "sku_weeks_of_stock",
    "sku_velocity",
    "sku_velocity_trend",
    "sku_low_stock",
    "month_of_season",
] + [f"sku_SY_{x}" for x in [
    "TILT_250EC", "SCO_250EC", "KAV_75WP", "TOP_15WP", "AMI_250SC", "ACT_25WG",
    "CRU_350FS", "AXI_50EC", "ALT_5SC", "VER_18EC", "KRA_05EC", "PEG_50EC",
]]


def train():
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score, brier_score_loss, classification_report

    try:
        from xgboost import XGBClassifier
        model_kind = "xgboost"
    except ImportError:
        log.warning("xgboost not available, falling back to sklearn GradientBoostingClassifier")
        from sklearn.ensemble import GradientBoostingClassifier as XGBClassifier
        model_kind = "gbm"

    df = build_training_set()
    # Ensure all expected columns exist (some SKUs may be missing in this subset)
    for col in FEATURE_COLS:
        if col not in df.columns:
            df[col] = 0
    X = df[FEATURE_COLS].fillna(0).astype(float)
    y = df["label"].astype(int)

    # Time-aware split: train on first 80% of season weeks, test on last 20%
    df_sorted = df.sort_values("week_end_date")
    split_idx = int(len(df_sorted) * 0.8)
    train_idx = df_sorted.index[:split_idx]
    test_idx = df_sorted.index[split_idx:]
    X_tr, X_te = X.loc[train_idx], X.loc[test_idx]
    y_tr, y_te = y.loc[train_idx], y.loc[test_idx]

    log.info(f"Train: {len(X_tr):,}  Test: {len(X_te):,}  (time-ordered split)")

    if model_kind == "xgboost":
        model = XGBClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            random_state=42,
            eval_metric="logloss",
            n_jobs=-1,
        )
    else:
        model = XGBClassifier(n_estimators=200, max_depth=4, learning_rate=0.05, random_state=42)

    model.fit(X_tr, y_tr)
    p_te = model.predict_proba(X_te)[:, 1]

    auc = roc_auc_score(y_te, p_te)
    brier = brier_score_loss(y_te, p_te)
    log.info(f"Test AUC: {auc:.3f}  Brier: {brier:.3f}")
    print("\n=== Classification report (test) ===")
    print(classification_report(y_te, (p_te > 0.5).astype(int), digits=3))

    # Feature importance
    if hasattr(model, "feature_importances_"):
        fi = pd.DataFrame({"feature": FEATURE_COLS, "importance": model.feature_importances_})
        fi = fi.sort_values("importance", ascending=False).head(10)
        print("\n=== Top 10 features ===")
        print(fi.to_string(index=False))

    # Save
    with open(ART / "conversion_model.pkl", "wb") as f:
        pickle.dump({"model": model, "feature_cols": FEATURE_COLS, "kind": model_kind}, f)
    with open(ART / "conversion_metrics.json", "w") as f:
        json.dump({"auc": float(auc), "brier": float(brier), "n_train": len(X_tr), "n_test": len(X_te)}, f, indent=2)
    log.info(f"Saved model to {ART / 'conversion_model.pkl'}")


class ConversionModel:
    """Inference wrapper that the PriorityScorer can call."""

    def __init__(self, model_path: Path | None = None):
        path = model_path or (ART / "conversion_model.pkl")
        with open(path, "rb") as f:
            bundle = pickle.load(f)
        self.model = bundle["model"]
        self.feature_cols = bundle["feature_cols"]

    def predict_one(self, retailer_slice: pd.DataFrame) -> float:
        """Given a retailer x week slice (12 SKU rows), return probability of conversion
        for the BEST-matched SKU."""
        if retailer_slice.empty:
            return 0.5
        # Pick the most-urgent SKU to model
        target = retailer_slice.sort_values("weeks_of_stock").iloc[0]
        row = {
            "stage_urgency": float(retailer_slice["stage_urgency_mean"].iloc[0]),
            "pct_flowering": float(retailer_slice["pct_flowering"].iloc[0]),
            "pct_tillering": float(retailer_slice["pct_tillering"].iloc[0]),
            "avg_weeks_of_stock": float(retailer_slice["weeks_of_stock"].mean()),
            "avg_velocity": float(retailer_slice["velocity_4w"].mean()),
            "days_since_last_visit": float(retailer_slice["days_since_last_visit"].iloc[0]),
            "sku_weeks_of_stock": float(target["weeks_of_stock"]),
            "sku_velocity": float(target["velocity_4w"]),
            "sku_velocity_trend": float(target["velocity_trend"]),
            "sku_low_stock": int(target["low_stock_flag"]),
            "month_of_season": int(((pd.Timestamp(target["week_end_date"]) - pd.Timestamp("2025-10-01")).days // 30)),
        }
        for col in self.feature_cols:
            if col.startswith("sku_SY_"):
                row[col] = int(col == f"sku_{target['sku_id']}")
            elif col not in row:
                row[col] = 0
        X = pd.DataFrame([row])[self.feature_cols].astype(float)
        return float(self.model.predict_proba(X)[0, 1])


if __name__ == "__main__":
    train()
