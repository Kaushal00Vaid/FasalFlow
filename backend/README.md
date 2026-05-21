# Syngenta IITM Hackathon 2026 — AI Field Force Intelligence

A backend + ML pipeline that turns the Rabi 2025-26 dataset into a daily visit plan, next-best-action recommendation, and anomaly feed for every Syngenta field representative.

---

## What this delivers

| PS requirement | Implementation |
|---|---|
| Dynamic prioritization | `/plan/today` ranks each rep's retailers by a transparent 5-component score, recomputed daily |
| Next best action at point of visit | `/visit/{id}/detail` returns recommended SKU + reason facts + crop-stage signal |
| Anomaly and opportunity detection | `/anomalies` returns demand spikes/drops (z-score) and stockout-risk clusters |
| Outcome learning | `/outcome` POST + Bayesian beta posterior per retailer (`outcome_learning.py`) |
| Explainability | Every score carries structured `reasons` with labeled contributions |
| Offline operation | All scoring is deterministic + cached; outcome POST accepts `offline_queued_at` |
| Daily planning, weekly recalibration | Feature pipeline runs weekly; scoring runs on-demand |

---

## Architecture

```
   Raw CSVs (8 files, 600k+ rows)
              │
              ▼
   ┌──────────────────────────┐
   │ src.pipeline.build_features │   builds retailer × week × SKU feature table
   └──────────────────────────┘
              │
              ▼   features_master.parquet  (310k rows × 28 cols)
              │
   ┌──────────┴───────────┬──────────────────┐
   ▼                      ▼                  ▼
 PriorityScorer        ConversionModel    AnomalyDetector
 (rule-based,          (XGBoost,          (z-score +
  weighted)             time-split)        IsolationForest)
   │                      │                  │
   └──────────────────────┴──────────────────┘
                          │
                          ▼
                    FastAPI service
                          │
              (REST contract for any UI)
                          │
                          ▼
            ◇  Outcomes logged → outcomes.db
            ◇  Bayesian posterior updates per retailer
```

---

## Setup

```bash
# 1. Install deps (Python 3.10+)
pip install -r requirements.txt

# 2. Drop the 8 raw CSVs into data/raw/
#    (digital_funnel_weekly.csv, growers.csv, reps_territory.csv,
#     retailer_inventory_weekly.csv, retailer_pos.csv,
#     retailer_visit_log.csv, retailers.csv, whatsapp_campaign.csv)

# 3. Build the feature table (once, ~3 seconds)
python -m src.pipeline.build_features

# 4. Train the conversion model (~5 seconds)
python -m src.models.conversion

# 5. Run anomaly detection (~3 seconds)
python -m src.models.anomaly

# 6. Boot the API
uvicorn src.api.main:app --host 0.0.0.0 --port 8080
```

Visit `http://localhost:8080/docs` for interactive OpenAPI / Swagger documentation.

---

## Endpoints (the contract)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + model availability |
| GET | `/reps?limit=&offset=` | List reps with territory + retailer count |
| GET | `/reps/{rep_id}` | Single rep details |
| GET | `/plan/today?rep_id=&date=&top_n=&use_ml=` | Ranked visit plan for the day |
| GET | `/visit/{retailer_id}/detail?date=` | Full reason card + inventory snapshot |
| GET | `/anomalies?rep_id=&district=&kind=&limit=` | Filtered anomaly feed |
| GET | `/retailers/{retailer_id}/history` | POS history time series |
| POST | `/outcome` | Log a visit outcome (offline-aware) |
| GET | `/outcomes/sync?rep_id=` | Pull logged outcomes for sync |

---

## Sample call

```bash
curl 'http://localhost:8080/plan/today?rep_id=REP_0001&date=2026-02-15&top_n=3'
```

returns:

```json
{
  "rep_id": "REP_0001",
  "as_of_date": "2026-02-15",
  "week_end_date": "2026-02-15",
  "weights_used": {
    "inventory_urgency": 0.30,
    "crop_stage_urgency": 0.25,
    "velocity_trend": 0.15,
    "visit_recency": 0.15,
    "conversion_probability": 0.15
  },
  "visits": [
    {
      "retailer_id": "RTL_00002",
      "tehsil": "Patna_T004",
      "district": "Patna",
      "score": 0.7731,
      "recommended_sku": "Axial 50 EC",
      "recommended_sku_id": "SY_AXI_50EC",
      "recommended_action": "Restock pitch for Axial 50 EC - critical inventory ahead of upcoming demand on wheat.",
      "one_line_why": "Low stock: Axial 50 EC at 1.4 weeks (vs 4-week velocity).",
      "reasons": [
        {"label": "Low stock", "value": "Axial 50 EC at 1.4 weeks...", "direction": "positive", "contribution": 0.249},
        {"label": "Crop stage", "value": "67% of growers at tillering stage", "direction": "positive", "contribution": 0.158}
      ]
    }
  ]
}
```

---

## Running tests

```bash
python -m pytest tests/ -v
```

10 tests cover: health, rep lookup, plan structure, explainability (every visit has reasons), ML on/off parity, visit detail, anomaly filtering, outcome round-trip, and Pydantic validation.

---

## Model performance (honest)

The synthetic dataset gives a learnable but noisy visit→conversion signal:

| Metric | Value |
|---|---|
| Conversion model AUC (time-ordered test split) | 0.577 |
| Brier score | 0.241 |
| Training rows | 3,192 |
| Test rows | 798 |

Top features: `sku_low_stock`, `sku_weeks_of_stock`, SKU identity, `month_of_season`, `sku_velocity`. All make domain sense.

**Note:** AUC 0.577 is what the synthetic data actually supports — claiming higher would be overfit on a test held out of the wrong split. In production with real-world POS feedback the same architecture should improve materially. We optimize for calibration and feature-importance integrity, not headline AUC.

---

## What we deliberately did NOT do (and why)

- **No LLM in the critical path.** A field rep in low-connectivity tehsils cannot rely on Gemini for ranking. The LLM, when added, sits on top of structured outputs to generate local-language narration only.
- **No deep neural net for visit ranking.** With ~30k visit logs and 12 SKUs, gradient boosting beats anything fancier and is explainable via feature importance / SHAP.
- **No route-optimization with road distances.** The dataset has no retailer geolocation. Sequence within the ranked plan is left to the frontend (nearest-neighbor by tehsil-centroid if it has coordinates, else by score).
- **No fake pest/weather signals.** Those are external data sources the PS calls out as "public domain." The architecture has slots for them; the implementation here uses crop-stage urgency (derivable from data) as the closest available proxy.

---

## Project layout

```
syngenta_ffi/
├── data/
│   ├── raw/               # input CSVs (gitignored in real deployment)
│   ├── processed/         # built feature tables
│   └── artifacts/         # trained models, anomalies.json, outcomes.db
├── src/
│   ├── pipeline/
│   │   └── build_features.py
│   ├── models/
│   │   ├── conversion.py
│   │   └── anomaly.py
│   ├── scoring/
│   │   ├── priority.py
│   │   └── outcome_learning.py
│   └── api/
│       └── main.py
├── tests/
│   └── test_api.py
├── docs/
│   ├── DATA_DICTIONARY.md
│   ├── SUBMISSION.md           # 10-page submission writeup
│   └── DEMO_WALKTHROUGH.md     # engineered demo script
└── requirements.txt
```
