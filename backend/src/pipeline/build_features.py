"""
Feature pipeline for Syngenta IITM Hackathon 2026 - AI Field Force Intelligence.

Reads the 8 raw CSVs and produces a unified feature table at:
    retailer_id x sku_id x week_end_date

This is the foundation for the priority scoring, conversion model, and anomaly
detection. Build once, query many times.

Key joins / notes:
  * retailers <-> reps_territory : via territory_id (clean)
  * inventory + pos              : via retailer_id + sku_id + week (clean)
  * visit_log -> retailers       : ONLY via tehsil (no retailer_id in visit log!)
                                   So visit features are at tehsil-week grain
                                   and broadcast to all retailers in that tehsil.
  * growers -> retailers         : ONLY via tehsil (no direct link)
                                   So crop-stage signal is computed per tehsil
                                   from growers in that tehsil.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger(__name__)

RAW = Path(__file__).resolve().parents[2] / "data" / "raw"
OUT = Path(__file__).resolve().parents[2] / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

# Week grid for the season (Rabi 2025-26 - inventory weeks end on Sundays)
SEASON_START = pd.Timestamp("2025-10-05")
SEASON_END = pd.Timestamp("2026-03-29")


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------
def load_raw() -> dict[str, pd.DataFrame]:
    """Load all 8 source CSVs with proper dtypes."""
    log.info("Loading raw CSVs...")
    files = {
        "reps": "reps_territory.csv",
        "retailers": "retailers.csv",
        "visits": "retailer_visit_log.csv",
        "inventory": "retailer_inventory_weekly.csv",
        "pos": "retailer_pos.csv",
        "growers": "growers.csv",
        "funnel": "digital_funnel_weekly.csv",
        "whatsapp": "whatsapp_campaign.csv",
    }
    dfs = {k: pd.read_csv(RAW / v) for k, v in files.items()}

    # Parse dates
    dfs["visits"]["visit_date"] = pd.to_datetime(dfs["visits"]["visit_date"])
    dfs["inventory"]["week_end_date"] = pd.to_datetime(dfs["inventory"]["week_end_date"])
    dfs["pos"]["transaction_date"] = pd.to_datetime(dfs["pos"]["transaction_date"])
    dfs["funnel"]["week_start_date"] = pd.to_datetime(dfs["funnel"]["week_start_date"])
    dfs["whatsapp"]["message_sent_date"] = pd.to_datetime(dfs["whatsapp"]["message_sent_date"])

    # Parse tehsil_list JSON in reps
    dfs["reps"]["tehsil_list"] = dfs["reps"]["tehsil_list"].apply(json.loads)

    for name, df in dfs.items():
        log.info(f"  {name}: {len(df):,} rows, {df.shape[1]} cols")
    return dfs


# ---------------------------------------------------------------------------
# Crop calendar parsing
# ---------------------------------------------------------------------------
def parse_crop_calendar(s: str | float) -> dict | None:
    if pd.isna(s):
        return None
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return None


def crop_stage_on_date(calendar: dict | None, on_date: pd.Timestamp) -> str:
    """Return the crop stage label active on `on_date` for a grower."""
    if calendar is None:
        return "unknown"

    sowing = calendar.get("sowing", {})
    harvest = calendar.get("harvest", {})
    stages = calendar.get("stages", [])

    sow_start = pd.to_datetime(sowing.get("start")) if sowing.get("start") else None
    sow_end = pd.to_datetime(sowing.get("end")) if sowing.get("end") else None
    har_start = pd.to_datetime(harvest.get("start")) if harvest.get("start") else None
    har_end = pd.to_datetime(harvest.get("end")) if harvest.get("end") else None

    if sow_start is not None and on_date < sow_start:
        return "pre_sowing"
    if sow_end is not None and on_date <= sow_end:
        return "sowing"
    if har_end is not None and on_date > har_end:
        return "post_harvest"
    if har_start is not None and on_date >= har_start:
        return "harvest"

    # Inside vegetative window - pick nearest stage milestone
    if stages:
        stage_dates = [(s.get("stage"), pd.to_datetime(s.get("approx"))) for s in stages]
        stage_dates = [(n, d) for n, d in stage_dates if d is not None]
        if stage_dates:
            # Pick the stage whose approx date is most recent but not in the future
            past = [(n, d) for n, d in stage_dates if d <= on_date]
            if past:
                return max(past, key=lambda x: x[1])[0]
            return stage_dates[0][0]  # earliest upcoming
    return "vegetative"


# Severity weights for the "urgency" component of priority score.
# Higher = more time-sensitive intervention window for crop protection products.
STAGE_URGENCY = {
    "pre_sowing": 0.2,
    "sowing": 0.6,
    "tillering": 0.8,
    "vegetative": 0.7,
    "flowering": 1.0,  # peak intervention window for fungicides
    "grain_filling": 0.7,
    "harvest": 0.2,
    "post_harvest": 0.0,
    "unknown": 0.3,
}


def build_grower_features(growers: pd.DataFrame, as_of_dates: list[pd.Timestamp]) -> pd.DataFrame:
    """Compute crop-stage distribution per tehsil for a set of as-of dates.

    Output: tehsil x as_of_date with stage counts and weighted urgency.
    """
    log.info("Parsing grower crop calendars...")
    growers = growers.copy()
    growers["cal"] = growers["grower_crop_calendar"].apply(parse_crop_calendar)
    growers["crop"] = growers["cal"].apply(lambda c: c.get("crop") if c else None)

    rows = []
    for d in as_of_dates:
        growers[f"_stage_{d.date()}"] = growers["cal"].apply(lambda c: crop_stage_on_date(c, d))

    long = growers.melt(
        id_vars=["grower_id", "tehsil", "district", "state", "crop"],
        value_vars=[c for c in growers.columns if c.startswith("_stage_")],
        var_name="as_of_date",
        value_name="stage",
    )
    long["as_of_date"] = pd.to_datetime(long["as_of_date"].str.replace("_stage_", "", regex=False))
    long["stage_urgency"] = long["stage"].map(STAGE_URGENCY).fillna(0.3)

    agg = long.groupby(["tehsil", "as_of_date"], as_index=False).agg(
        grower_count=("grower_id", "count"),
        stage_urgency_mean=("stage_urgency", "mean"),
        pct_flowering=("stage", lambda s: (s == "flowering").mean()),
        pct_tillering=("stage", lambda s: (s == "tillering").mean()),
        dominant_crop=("crop", lambda s: s.mode().iloc[0] if not s.mode().empty else None),
    )
    log.info(f"  Grower-tehsil-week features: {len(agg):,} rows")
    return agg


# ---------------------------------------------------------------------------
# POS aggregation
# ---------------------------------------------------------------------------
def aggregate_pos_weekly(pos: pd.DataFrame) -> pd.DataFrame:
    """Roll up POS to retailer x sku x week_end_date (Sunday).
    Compute rolling 4-week velocity (units/week) for stockout horizon math."""
    log.info("Aggregating POS to weekly grain...")
    pos = pos.copy()
    # Align to inventory week end (Sunday)
    pos["week_end_date"] = pos["transaction_date"] + pd.to_timedelta(
        (6 - pos["transaction_date"].dt.weekday) % 7, unit="d"
    )
    pos["revenue"] = pos["sku_qty"] * pos["sku_price"]

    weekly = (
        pos.groupby(["retailer_id", "sku_id", "sku_name", "week_end_date"], as_index=False)
        .agg(units_sold=("sku_qty", "sum"), revenue=("revenue", "sum"), txn_count=("transaction_id", "count"))
    )

    # 4-week rolling velocity per retailer-sku
    weekly = weekly.sort_values(["retailer_id", "sku_id", "week_end_date"])
    weekly["velocity_4w"] = (
        weekly.groupby(["retailer_id", "sku_id"])["units_sold"]
        .transform(lambda s: s.rolling(window=4, min_periods=1).mean())
    )
    log.info(f"  Weekly POS rows: {len(weekly):,}")
    return weekly


# ---------------------------------------------------------------------------
# Visit features (tehsil x week, then broadcast to retailers)
# ---------------------------------------------------------------------------
def build_visit_features(visits: pd.DataFrame, retailers: pd.DataFrame) -> pd.DataFrame:
    """Visits are recorded at tehsil-level (no retailer_id). Aggregate to
    tehsil x week and then broadcast to retailers in that tehsil."""
    log.info("Building tehsil-week visit features...")
    visits = visits.copy()
    visits["week_end_date"] = visits["visit_date"] + pd.to_timedelta(
        (6 - visits["visit_date"].dt.weekday) % 7, unit="d"
    )

    tw = (
        visits.groupby(["visit_tehsil", "week_end_date"], as_index=False)
        .agg(
            visits_this_week=("visit_date", "count"),
            retailer_meetings=("visit_type", lambda s: (s == "retailer meeting").sum()),
            grower_meetings=("visit_type", lambda s: (s == "grower meeting").sum()),
            campaigns=("visit_type", lambda s: (s == "campaign_conducted").sum()),
        )
        .rename(columns={"visit_tehsil": "tehsil"})
    )

    # Broadcast to all retailers in that tehsil
    rt = retailers[["retailer_id", "tehsil"]].merge(tw, on="tehsil", how="left")
    rt = rt.fillna({"visits_this_week": 0, "retailer_meetings": 0, "grower_meetings": 0, "campaigns": 0})

    # Days since last visit to this tehsil, as of each week
    last_visit = visits.groupby("visit_tehsil")["visit_date"].apply(lambda s: sorted(s.unique())).to_dict()

    def days_since(tehsil, week_end):
        dates = last_visit.get(tehsil, [])
        past = [d for d in dates if pd.Timestamp(d) <= week_end]
        if not past:
            return 999
        return (week_end - pd.Timestamp(max(past))).days

    rt["days_since_last_visit"] = rt.apply(
        lambda r: days_since(r["tehsil"], r["week_end_date"]) if pd.notna(r["week_end_date"]) else 999, axis=1
    )
    log.info(f"  Visit features broadcast to {len(rt):,} retailer-weeks")
    return rt


# ---------------------------------------------------------------------------
# Master feature table builder
# ---------------------------------------------------------------------------
def build_master(dfs: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Combine everything into a single retailer x sku x week table."""
    inv = dfs["inventory"].copy()
    log.info(f"Starting from inventory: {len(inv):,} rows")

    # 1. Add POS velocity & revenue
    pos_weekly = aggregate_pos_weekly(dfs["pos"])
    master = inv.merge(
        pos_weekly[["retailer_id", "sku_id", "week_end_date", "units_sold", "revenue", "velocity_4w"]],
        on=["retailer_id", "sku_id", "week_end_date"],
        how="left",
    )
    master[["units_sold", "revenue", "velocity_4w"]] = master[
        ["units_sold", "revenue", "velocity_4w"]
    ].fillna(0)

    # 2. Weeks of stock = inventory / velocity (capped at 99 for no-velocity case)
    master["weeks_of_stock"] = np.where(
        master["velocity_4w"] > 0, master["sku_qty"] / master["velocity_4w"], 99.0
    )
    master["is_stockout"] = (master["sku_qty"] == 0).astype(int)
    master["low_stock_flag"] = (master["weeks_of_stock"] < 2).astype(int)

    # 3. Attach retailer geography + territory + rep
    rep_terr = (
        dfs["reps"][["rep_id", "territory_id", "state", "district"]]
        .rename(columns={"state": "_s", "district": "_d"})
    )
    master = master.merge(dfs["retailers"], on="retailer_id", how="left")
    master = master.merge(rep_terr[["rep_id", "territory_id"]], on="territory_id", how="left")

    # 4. Visit features
    visit_feat = build_visit_features(dfs["visits"], dfs["retailers"])
    master = master.merge(
        visit_feat[
            [
                "retailer_id",
                "week_end_date",
                "visits_this_week",
                "retailer_meetings",
                "grower_meetings",
                "campaigns",
                "days_since_last_visit",
            ]
        ],
        on=["retailer_id", "week_end_date"],
        how="left",
    )
    master[["visits_this_week", "retailer_meetings", "grower_meetings", "campaigns"]] = master[
        ["visits_this_week", "retailer_meetings", "grower_meetings", "campaigns"]
    ].fillna(0)
    master["days_since_last_visit"] = master["days_since_last_visit"].fillna(999)

    # 5. Grower / crop-stage features per tehsil-week
    week_ends = sorted(master["week_end_date"].unique())
    grower_feat = build_grower_features(dfs["growers"], [pd.Timestamp(w) for w in week_ends])
    grower_feat = grower_feat.rename(columns={"as_of_date": "week_end_date"})
    master = master.merge(grower_feat, on=["tehsil", "week_end_date"], how="left")
    master[["grower_count", "stage_urgency_mean", "pct_flowering", "pct_tillering"]] = master[
        ["grower_count", "stage_urgency_mean", "pct_flowering", "pct_tillering"]
    ].fillna({"grower_count": 0, "stage_urgency_mean": 0.3, "pct_flowering": 0, "pct_tillering": 0})

    # 6. POS velocity trend (current vs 4-week avg)
    master = master.sort_values(["retailer_id", "sku_id", "week_end_date"])
    master["units_sold_lag1"] = master.groupby(["retailer_id", "sku_id"])["units_sold"].shift(1)
    master["velocity_trend"] = master["units_sold"] - master["velocity_4w"]

    log.info(f"Master feature table: {len(master):,} rows, {master.shape[1]} cols")
    return master


def main():
    dfs = load_raw()
    master = build_master(dfs)
    out_path = OUT / "features_master.parquet"
    master.to_parquet(out_path, index=False)
    log.info(f"Wrote {out_path}  ({out_path.stat().st_size / 1e6:.1f} MB)")

    # Also write a small dimension table for the API to query reps/retailers fast
    dim_path = OUT / "dim_retailers.parquet"
    dim = dfs["retailers"].merge(
        dfs["reps"][["rep_id", "territory_id", "territory_name"]], on="territory_id", how="left"
    )
    dim.to_parquet(dim_path, index=False)
    log.info(f"Wrote {dim_path}")

    rep_path = OUT / "dim_reps.parquet"
    dfs["reps"].to_parquet(rep_path, index=False)
    log.info(f"Wrote {rep_path}")

    # Quick sanity print
    print("\n=== SAMPLE ROWS ===")
    print(master.head(3).to_string())
    print("\n=== COLUMN SUMMARY ===")
    print(master.dtypes)
    print(f"\nDate range: {master['week_end_date'].min()} to {master['week_end_date'].max()}")
    print(f"Stockout rate: {master['is_stockout'].mean()*100:.2f}%")
    print(f"Low stock rate: {master['low_stock_flag'].mean()*100:.2f}%")


if __name__ == "__main__":
    main()
