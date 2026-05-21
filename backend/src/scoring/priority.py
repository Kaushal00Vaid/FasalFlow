"""
Priority scoring engine.

Given (rep_id, as_of_date), returns a ranked list of retailers in the rep's
territory with priority scores AND human-readable reason traces.

Design choice: rule-based weighted score, NOT an ML model. Three reasons:
  1. Explainability is a hard requirement from the PS - reps must understand why.
  2. Weights are tunable per-territory / per-season without retraining.
  3. Works offline with zero dependencies beyond pandas.

The ML conversion model (separate file) plugs in as ONE of these components,
not the whole thing.

Score components (each normalized to [0, 1] before weighting):
  - inventory_urgency     : low stock × high velocity → stockout risk
  - crop_stage_urgency    : flowering/tillering windows for nearby growers
  - velocity_trend        : POS accelerating signals demand
  - visit_recency         : days since last visit (longer → more urgent)
  - conversion_probability: ML-model output (optional, defaults to neutral 0.5)

Reason traces are emitted as structured facts AND a one-line summary, so the
frontend can show them as bullets OR feed them to an LLM for local-language
narration.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd

PROC = Path(__file__).resolve().parents[2] / "data" / "processed"

# Tunable component weights (sum to 1.0). Calibrated on EDA, exposed via API.
DEFAULT_WEIGHTS = {
    "inventory_urgency": 0.30,
    "crop_stage_urgency": 0.25,
    "velocity_trend": 0.15,
    "visit_recency": 0.15,
    "conversion_probability": 0.15,
}


@dataclass
class ReasonFact:
    """One atomic, verifiable fact that contributed to the score."""

    label: str       # short human-readable label
    value: str       # the actual value as a formatted string
    direction: str   # 'positive' (raises priority) | 'negative' (lowers) | 'neutral'
    contribution: float  # signed contribution to the final score, for sorting


@dataclass
class VisitRecommendation:
    retailer_id: str
    tehsil: str
    district: str
    score: float
    recommended_sku: str
    recommended_sku_id: str
    recommended_action: str
    reasons: list[ReasonFact]
    one_line_why: str

    def to_dict(self) -> dict:
        d = asdict(self)
        d["reasons"] = [asdict(r) for r in self.reasons]
        return d


# ---------------------------------------------------------------------------
# Normalizers
# ---------------------------------------------------------------------------
def _norm_inventory_urgency(weeks_of_stock: float, velocity_4w: float) -> float:
    """Low stock + high velocity → urgent. 0 stock with sales = 1.0."""
    if velocity_4w <= 0:
        return 0.0  # no demand, not urgent regardless of stock
    if weeks_of_stock <= 0:
        return 1.0
    if weeks_of_stock >= 8:
        return 0.0
    return float(np.clip(1.0 - (weeks_of_stock / 8.0), 0, 1))


def _norm_visit_recency(days_since: float) -> float:
    """0 days → 0, 30+ days → 1, plateau after."""
    if days_since >= 999:
        return 0.8  # never visited - moderately urgent
    return float(np.clip(days_since / 30.0, 0, 1))


def _norm_velocity_trend(velocity_trend: float, velocity_4w: float) -> float:
    """Positive = accelerating demand. Normalize against the 4w baseline."""
    if velocity_4w <= 0:
        return 0.5
    rel = velocity_trend / max(velocity_4w, 1)
    return float(np.clip((rel + 1) / 2, 0, 1))  # rel of +1 → 1.0, -1 → 0.0


# ---------------------------------------------------------------------------
# SKU recommender (which product to push at this retailer this week)
# ---------------------------------------------------------------------------
SKU_CROP_MAP = {
    # Wheat
    "SY_TILT_250EC": ["wheat"],
    "SY_TOP_15WP": ["wheat"],
    "SY_AXI_50EC": ["wheat"],
    # Multi-crop fungicide
    "SY_SCO_250EC": ["mustard", "chickpea", "wheat"],
    "SY_KAV_75WP": ["potato", "mustard"],
    "SY_AMI_250SC": ["chickpea", "wheat", "potato"],
    "SY_ALT_5SC": ["mustard", "chickpea"],
    # Insecticide / multi
    "SY_ACT_25WG": ["chickpea", "mustard", "potato"],
    "SY_CRU_350FS": ["wheat", "chickpea", "mustard"],
    "SY_VER_18EC": ["potato", "chickpea"],
    "SY_KRA_05EC": ["potato", "chickpea"],
    "SY_PEG_50EC": ["wheat", "mustard"],
}


def pick_recommended_sku(retailer_skus: pd.DataFrame, dominant_crop: str) -> tuple[str, str, float]:
    """Pick the SKU for this retailer that scores highest on (inventory urgency
    × crop match). retailer_skus is the slice for ONE retailer at ONE week."""
    if retailer_skus.empty:
        return ("", "", 0.0)

    def crop_match_score(row):
        sku_id = row.get("sku_id", "")
        crops = SKU_CROP_MAP.get(sku_id, [])
        return 1.0 if dominant_crop in crops else 0.3

    rs = retailer_skus.copy()
    rs["_crop_match"] = rs.apply(crop_match_score, axis=1)
    rs["_inv_urgency"] = rs.apply(
        lambda r: _norm_inventory_urgency(r["weeks_of_stock"], r["velocity_4w"]), axis=1
    )
    rs["_pick_score"] = rs["_crop_match"] * (0.5 + rs["_inv_urgency"])
    top = rs.sort_values("_pick_score", ascending=False).iloc[0]
    return (top["sku_id"], top["sku_name"], float(top["_pick_score"]))


# ---------------------------------------------------------------------------
# Main scoring entry point
# ---------------------------------------------------------------------------
class PriorityScorer:
    def __init__(
        self,
        weights: dict[str, float] | None = None,
        conversion_model=None,
        master: pd.DataFrame | None = None,
        dim_retailers: pd.DataFrame | None = None,
    ):
        self.weights = weights or DEFAULT_WEIGHTS
        assert abs(sum(self.weights.values()) - 1.0) < 1e-6, "Weights must sum to 1.0"
        # Accept shared frames from the caller to avoid duplicate copies in memory.
        # Falls back to loading from disk for standalone / CLI use.
        self.master = master if master is not None else pd.read_parquet(PROC / "features_master.parquet")
        self.dim_retailers = (
            dim_retailers if dim_retailers is not None else pd.read_parquet(PROC / "dim_retailers.parquet")
        )
        self.conversion_model = conversion_model  # optional, sklearn-style .predict_proba

    def score_retailer(self, retailer_slice: pd.DataFrame) -> tuple[float, list[ReasonFact], dict]:
        """Score ONE retailer at ONE week (slice = its 12 SKU rows for that week).

        Returns (final_score, reasons, top_sku_pick).
        """
        if retailer_slice.empty:
            return 0.0, [], {}

        # Aggregate retailer-level features (max over SKUs for urgency components)
        inv_urgency = max(
            _norm_inventory_urgency(r.weeks_of_stock, r.velocity_4w) for r in retailer_slice.itertuples()
        )
        stage_urgency = float(retailer_slice["stage_urgency_mean"].iloc[0])  # same across SKUs
        days_since = float(retailer_slice["days_since_last_visit"].iloc[0])
        visit_recency = _norm_visit_recency(days_since)

        # Velocity trend across all SKUs (max abs)
        vt_signal = float(
            retailer_slice.apply(
                lambda r: _norm_velocity_trend(r["velocity_trend"], r["velocity_4w"]), axis=1
            ).max()
        )

        # Conversion prob - call ML model if present, else neutral
        if self.conversion_model is not None:
            conv = float(self.conversion_model.predict_one(retailer_slice))
        else:
            conv = 0.5

        components = {
            "inventory_urgency": inv_urgency,
            "crop_stage_urgency": stage_urgency,
            "velocity_trend": vt_signal,
            "visit_recency": visit_recency,
            "conversion_probability": conv,
        }
        final = sum(self.weights[k] * components[k] for k in self.weights)

        # Build reason facts (sorted by contribution)
        reasons: list[ReasonFact] = []

        # Inventory
        critical_skus = retailer_slice[retailer_slice["weeks_of_stock"] < 2]
        if not critical_skus.empty:
            top = critical_skus.iloc[0]
            reasons.append(
                ReasonFact(
                    label="Low stock",
                    value=f"{top['sku_name']} at {top['weeks_of_stock']:.1f} weeks (vs 4-week velocity)",
                    direction="positive",
                    contribution=self.weights["inventory_urgency"] * inv_urgency,
                )
            )

        # Crop stage
        pct_flow = float(retailer_slice["pct_flowering"].iloc[0])
        if pct_flow > 0.1:
            reasons.append(
                ReasonFact(
                    label="Crop stage",
                    value=f"{pct_flow*100:.0f}% of growers in tehsil are at flowering - peak intervention window",
                    direction="positive",
                    contribution=self.weights["crop_stage_urgency"] * stage_urgency,
                )
            )
        elif retailer_slice["pct_tillering"].iloc[0] > 0.2:
            pct_till = float(retailer_slice["pct_tillering"].iloc[0])
            reasons.append(
                ReasonFact(
                    label="Crop stage",
                    value=f"{pct_till*100:.0f}% of growers at tillering stage",
                    direction="positive",
                    contribution=self.weights["crop_stage_urgency"] * stage_urgency,
                )
            )

        # Visit recency
        if days_since >= 30:
            label_val = "Never visited" if days_since >= 999 else f"{int(days_since)} days since last visit"
            reasons.append(
                ReasonFact(
                    label="Visit gap",
                    value=label_val,
                    direction="positive",
                    contribution=self.weights["visit_recency"] * visit_recency,
                )
            )
        elif days_since <= 7:
            reasons.append(
                ReasonFact(
                    label="Recently visited",
                    value=f"Visited {int(days_since)} days ago",
                    direction="negative",
                    contribution=-self.weights["visit_recency"] * (1 - visit_recency),
                )
            )

        # Velocity trend
        if vt_signal > 0.65:
            top_growing = retailer_slice.sort_values("velocity_trend", ascending=False).iloc[0]
            reasons.append(
                ReasonFact(
                    label="Demand rising",
                    value=f"{top_growing['sku_name']} sales above recent average",
                    direction="positive",
                    contribution=self.weights["velocity_trend"] * vt_signal,
                )
            )

        # Conversion prob (only mention if we have an actual model)
        if self.conversion_model is not None:
            reasons.append(
                ReasonFact(
                    label="Conversion probability",
                    value=f"{conv*100:.0f}% (model)",
                    direction="positive" if conv > 0.5 else "negative",
                    contribution=self.weights["conversion_probability"] * conv,
                )
            )

        reasons.sort(key=lambda r: abs(r.contribution), reverse=True)

        # Pick the SKU
        dom_crop = str(retailer_slice["dominant_crop"].iloc[0]) if pd.notna(
            retailer_slice["dominant_crop"].iloc[0]
        ) else "wheat"
        sku_id, sku_name, _ = pick_recommended_sku(retailer_slice, dom_crop)

        return final, reasons, {"sku_id": sku_id, "sku_name": sku_name, "crop": dom_crop}

    def plan_day(self, rep_id: str, as_of_date: str | pd.Timestamp, top_n: int = 8) -> list[VisitRecommendation]:
        """Return ranked visit recommendations for a rep on a given date."""
        as_of = pd.Timestamp(as_of_date)
        # Snap to nearest week_end_date <= as_of
        weeks = sorted(self.master["week_end_date"].unique())
        eligible_weeks = [w for w in weeks if pd.Timestamp(w) <= as_of]
        if not eligible_weeks:
            raise ValueError(f"No data available on or before {as_of}")
        week_end = pd.Timestamp(max(eligible_weeks))

        # Slice to this rep's retailers, this week
        rep_retailers = self.dim_retailers[self.dim_retailers["rep_id"] == rep_id]["retailer_id"].tolist()
        if not rep_retailers:
            raise ValueError(f"Rep {rep_id} has no retailers")

        slice_df = self.master[
            (self.master["retailer_id"].isin(rep_retailers))
            & (self.master["week_end_date"] == week_end)
        ]

        recs: list[VisitRecommendation] = []
        for rid, group in slice_df.groupby("retailer_id"):
            score, reasons, sku_pick = self.score_retailer(group)
            row0 = group.iloc[0]
            one_line = self._one_line_summary(reasons, sku_pick)
            recs.append(
                VisitRecommendation(
                    retailer_id=rid,
                    tehsil=row0["tehsil"],
                    district=row0["district"],
                    score=round(score, 4),
                    recommended_sku=sku_pick.get("sku_name", ""),
                    recommended_sku_id=sku_pick.get("sku_id", ""),
                    recommended_action=self._action_text(sku_pick, reasons),
                    reasons=reasons,
                    one_line_why=one_line,
                )
            )

        recs.sort(key=lambda r: r.score, reverse=True)
        return recs[:top_n]

    @staticmethod
    def _one_line_summary(reasons: list[ReasonFact], sku_pick: dict) -> str:
        if not reasons:
            return f"Routine check-in. Discuss {sku_pick.get('sku_name', 'core SKUs')}."
        top = reasons[0]
        return f"{top.label}: {top.value}."

    @staticmethod
    def _action_text(sku_pick: dict, reasons: list[ReasonFact]) -> str:
        sku = sku_pick.get("sku_name", "core portfolio")
        crop = sku_pick.get("crop", "the local crop")
        # If low-stock is top reason → restock pitch; else → advisory pitch
        if reasons and reasons[0].label == "Low stock":
            return f"Restock pitch for {sku} - critical inventory ahead of upcoming demand on {crop}."
        if reasons and reasons[0].label == "Crop stage":
            return f"Advisory + pull-through for {sku} during {crop} intervention window."
        return f"Discuss {sku} positioning for {crop} growers in this tehsil."


# ---------------------------------------------------------------------------
# Quick CLI test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import json

    scorer = PriorityScorer()
    recs = scorer.plan_day(rep_id="REP_0001", as_of_date="2026-02-15", top_n=5)
    print(f"\n=== Top 5 visits for REP_0001 on 2026-02-15 ===\n")
    for i, r in enumerate(recs, 1):
        print(f"{i}. {r.retailer_id} ({r.tehsil}, {r.district})  score={r.score:.3f}")
        print(f"   WHY: {r.one_line_why}")
        print(f"   ACTION: {r.recommended_action}")
        for fact in r.reasons[:3]:
            sign = "+" if fact.direction == "positive" else "-" if fact.direction == "negative" else "·"
            print(f"     {sign} {fact.label}: {fact.value}  (contrib={fact.contribution:+.3f})")
        print()
