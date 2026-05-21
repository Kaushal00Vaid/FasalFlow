# Demo Walkthrough — Engineered Story

This script walks the judges through one rep, one day, where every feature in the system lights up cleanly. It's designed to be **5–7 minutes** of screen time.

## The setup

- **Rep:** `REP_0001` (Ramesh — Patna North, Bihar)
- **Date:** `2026-02-15`
- **Why this rep+date:** wheat is at tillering stage across his 12 tehsils, 9 retailers under him show a mix of low-stock urgency, recent visits, and never-visited accounts, and there's a real stockout-risk anomaly cluster active in Patna district at the end-of-season week we use for the live anomaly demo.

## The story arc

### Act 1 — The Morning Brief (30 sec)

Hit `GET /reps/REP_0001`:
- Ramesh covers patna_north_001, 9 retailers across 12 tehsils.
- Pull his plan: `GET /plan/today?rep_id=REP_0001&date=2026-02-15&top_n=8`.

Show on screen: **"8 visits suggested for today. Top 3 are urgent."**

### Act 2 — Why this list, in this order (90 sec)

Walk through the top 3 visits:

**#1 RTL_00002 (score 0.77)**
> "Restock pitch for Axial 50 EC. Stock is at 1.4 weeks against the 4-week velocity. 67% of growers in this tehsil are at tillering — peak window for the wheat herbicide. We've never visited this retailer."

Open the visit detail card. Show the contribution breakdown:
- +0.249 from low stock
- +0.158 from crop stage
- +0.150 from demand rising
- +0.120 from visit gap

**This is the explainability moment.** No black box. The judges can read the math.

**#2 RTL_00001 (score 0.74)** — advisory pitch, not restock. Tell the judges: "Notice the system doesn't just optimize for inventory. This retailer's stock is fine. But 100% of growers in their tehsil are at tillering. The recommended action shifts to **advisory + pull-through** rather than restock. The system reasons about *kind* of visit, not just whether to visit."

**#3 RTL_00008 (score 0.73)** — Cruiser 350 FS at 0.7 weeks of stock, maize. Different SKU, different crop, same logic.

### Act 3 — The ML toggle (30 sec)

Hit the plan endpoint again with `use_ml=false`. Show that the system still produces a coherent plan with reasons. Toggle back to `use_ml=true` — show that the conversion-probability component nudges the rankings.

> **The point**: the ML model enhances the score; it doesn't *create* it. The system is not a Gemini wrapper. If the model is unavailable, the rule-based engine still works.

### Act 4 — Anomalies (60 sec)

Hit `GET /anomalies?rep_id=REP_0001`. Top anomaly: "6 retailers in Patna are at <2 weeks of stock on Score 250 EC with active demand." Click into one — it's a stockout-risk cluster, not a one-retailer issue.

> "This is the manager-eye view. Ramesh doesn't have to discover this himself by visiting one retailer at a time. The anomaly feed is district-wide pattern detection on top of the same data."

Filter by `kind=demand_spike` — show the rolling-z-score anomalies that catch true spikes the moment they happen.

### Act 5 — Outcome learning + offline (90 sec)

Mark an outcome:
```bash
POST /outcome
{
  "rep_id": "REP_0001", "retailer_id": "RTL_00002",
  "visit_date": "2026-02-15", "outcome": "order_placed",
  "sku_discussed": "Axial 50 EC",
  "offline_queued_at": "2026-02-15T11:14:00"
}
```

Show that the `offline_queued_at` is preserved in the response, with a separate `synced_at`. That's the audit trail.

Run the outcome-learning script:
```bash
python -m src.scoring.outcome_learning
```

> "RTL_00002 now has a belief of 0.83. The next plan considers that. This is per-retailer learning that doesn't require retraining the XGBoost model."

### Act 6 — Honest close (30 sec)

> "The model is at AUC 0.577 on the synthetic dataset's time-ordered test. We're not hiding that. The feature-importance ranking — low stock, weeks of stock, SKU identity, season month — is exactly what domain experts would predict. On production data with real outcomes, the same architecture should lift materially. What we delivered today is the *engine*. The UI is a one-week port from here."

---

## Pre-flight checklist

```bash
# 1. Confirm pipeline is built
ls data/processed/features_master.parquet data/artifacts/conversion_model.pkl data/artifacts/anomalies.json

# 2. Boot the API
uvicorn src.api.main:app --port 8080 &
sleep 2 && curl -s http://localhost:8080/health
# expect: {"status":"ok","feature_rows":310544,"anomalies":690,"has_ml":true}

# 3. Sanity-check the demo path
curl -s 'http://localhost:8080/plan/today?rep_id=REP_0001&date=2026-02-15&top_n=3' | python -m json.tool | head -50

# 4. Reset outcomes db for clean demo
rm -f data/artifacts/outcomes.db
```

## Backup demo paths (in case the primary breaks)

- `REP_0070` on `2026-02-15` — Bharatpur, Rajasthan, mustard-dominant. Different crop, different SKUs, same story.
- `REP_0027` on `2026-03-15` — Karnal, Haryana, end-of-season stockout cluster on Alto 5 SC.
- `REP_0052` on `2026-02-22` — Kalaburagi, Karnataka, Kannada-speaking growers, useful for the local-language angle.
