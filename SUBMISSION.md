# AI-Guided Field Force Intelligence
## Syngenta IITM Hackathon 2026 — Track 2 Submission

---

## Page 1 — Problem Interpretation

Syngenta's field force currently plans visits by territory rotation and rep judgment. The agricultural reality moves faster than rotation schedules — a flowering window, a stockout, a localized demand spike each compress the window in which a sales call drives value. We treat the rep's day as a **constrained ranking problem**: given a finite working day and a known territory, surface the highest-impact 7–8 accounts and the single SKU that should anchor each conversation, with reasons the rep can defend to the retailer.

We deliberately rejected three popular but wrong framings:
- A farmer chatbot (the PS explicitly asks for field-force tooling, not consumer agronomy).
- An LLM wrapper that asks Gemini to "decide" — fails the explainability and offline-operation requirements head-on.
- A pure data dashboard — useful for managers, not for a rep standing in a market who needs the **next action**, not a chart.

Our north-star metric mirrors Syngenta's own success metrics: **revenue per field day**, **coverage efficiency** (% of high-priority accounts visited per week), and **recommendation acceptance rate** (% of suggested SKUs that get logged as `order_placed`).

---

## Page 2 — User Personas

**Primary: Field Rep "Ramesh"** — 5 years on the road, smartphone but inconsistent connectivity in rural tehsils, manages ~9 retailers in 12 tehsils, currently runs a paper plan. Cares about: which 7 accounts move the needle today, what to say when he gets there, syncing notes once back in signal.

**Secondary: Retailer Manager** — owns inventory decisions for 1–4 outlets, signals demand to Syngenta indirectly via stock turn. Doesn't use the app, but every recommendation is justified to her by the rep.

**Tertiary: Regional Sales Manager** — supervises 8–12 reps. Cares about coverage, anomaly response time, and whether the system caught the stockout before it cost a week of sales. Uses the same anomaly feed reps see, aggregated.

**Quaternary: Grower** — indirect beneficiary. Recommendations are time-aligned to her crop stage, so the advisory she gets from the retailer is correct for her week.

---

## Page 3 — Data Signals (Honest Inventory)

The hackathon dataset (Rabi 2025-26) was inspected end-to-end before any modeling. Here is the un-glossed picture:

**Strong, in the data:**
- 235k POS line items across 4,000 retailers — ground truth for "did money change hands."
- 310k weekly inventory snapshots — derives weeks-of-stock per retailer-SKU at any week.
- Grower crop calendars (JSON) per 6,000 growers — derives crop stage on any date by tehsil.
- 30k visit logs at tehsil grain — derives days-since-visit and recommendation history.

**Critical limitation we surfaced early:**
- **Visit log carries no `retailer_id`.** Visits are recorded at tehsil level, with 1.4 retailers per tehsil on average and up to 5. Our pipeline therefore models visit signal at **tehsil-week grain** and broadcasts to retailers in that tehsil. Pretending otherwise would create a phantom precision the data doesn't support.
- **No grower↔retailer link.** Only tehsil-level overlap (68% of grower tehsils have a retailer).

**Promised by the PS, not in the dataset:**
- Weather, satellite NDVI, pest surveillance, competitor activity. These are explicit "public domain" feeds. Our architecture has named integration slots for them and ships with `stage_urgency_mean` (derived from grower calendars) as the closest available proxy. We do not silently fake these — they appear in the docs as "future signals."

This page exists because dishonest framing of synthetic data is the failure mode that loses judges' trust faster than a weak model.

---

## Page 4 — System Architecture

Four layers, deliberately decoupled so any one can be replaced without breaking the others:

```
1. Feature Pipeline (build_features.py)
   - Reads 8 CSVs, emits features_master.parquet
   - Retailer × SKU × week grain (310k rows)
   - 28 derived features: weeks_of_stock, velocity_4w, velocity_trend,
     pct_flowering, pct_tillering, stage_urgency_mean, days_since_last_visit,
     visit counts, dominant_crop per tehsil
   - Runs in ~3 seconds. Refresh: weekly.

2. Model Layer
   a. PriorityScorer (rule-based, transparent weighted sum)
   b. ConversionModel (XGBoost, time-split trained)
   c. AnomalyDetector (rolling z-score + Isolation Forest)
   d. OutcomeLearning (Bayesian beta posterior per retailer)

3. API Layer (FastAPI)
   - 8 endpoints serving the contract for any frontend
   - In-memory feature table for sub-100ms responses
   - SQLite for outcome logging (offline-aware)

4. Integration Layer
   - REST + JSON only (works for React, Flutter, Streamlit, anything)
   - LLM narration step (optional, on top of structured reasons)
```

The brain — what to recommend and why — lives in layers 1 and 2. The LLM, when added, is a translation layer for local-language pitch generation, never the decider.

---

## Page 5 — ML Models

### Conversion Probability Model

**Target:** P(visit to tehsil T promoting SKU S at week W triggers a POS lift in T for S over the next 2 weeks > 10%).

**Why this target:** It's grounded in observable POS data — no human-rated labels, no LLM opinions. The 2-week window matches the agronomic lag between rep contact and farmer purchase. The 10% lift threshold filters baseline noise.

**Features (22 total):** Tehsil-level (crop stage, % flowering, % tillering, avg weeks-of-stock, avg velocity, days-since-visit) + SKU-level at that tehsil-week (weeks-of-stock for that SKU, velocity, trend, low-stock flag) + SKU one-hot (12 SKUs) + month-of-season.

**Algorithm:** XGBoost classifier (200 trees, depth 4, lr 0.05). Trained on time-ordered 80/20 split to respect that we predict the future, not interpolate the past.

**Performance:** Test AUC 0.577, Brier 0.241. Below typical industrial AUC but **honest for synthetic data with weak signal-to-noise**; the feature importance ranking — `sku_low_stock`, `sku_weeks_of_stock`, SKU identity, `month_of_season`, `sku_velocity` — makes complete domain sense and would be robust in production.

### Anomaly Detector

Two-pass hybrid:
1. **Rolling z-score** on district-SKU-week POS (8-week baseline, shifted by 1 to exclude current). Flags |z| > 2.5 as `demand_spike` or `demand_drop`. 690 anomalies surfaced from 26 weeks of data.
2. **Stockout-risk clustering**: flags districts where ≥2 retailers carry <2 weeks of stock on a SKU with active velocity. These are the high-severity restock alerts that drive same-day action.
3. **Isolation Forest** (5% contamination) on multivariate district-week features — catches odd combinations the univariate detector misses.

### Outcome Learning

A Bayesian beta-posterior per retailer, updated each time a rep logs an outcome. `order_placed → α += 1`, `no_interest → β += 1`, with smaller deltas for intermediate outcomes. The posterior mean enters the next day's score as a retailer-specific conversion belief — distinct from and complementary to the XGBoost cross-retailer pattern.

Why not just retrain XGBoost online? The synthetic dataset has too few outcomes per retailer to do that meaningfully, and Bayesian updates are visibly explainable to the rep ("we've seen 4 successes and 1 miss at this retailer; that moves the belief from 0.5 to 0.8").

---

## Page 6 — Recommendation Logic (The Priority Score)

The headline number a rep sees is a single score in [0, 1]. Built from five normalized components with transparent weights:

```
Priority = 0.30 × inventory_urgency
         + 0.25 × crop_stage_urgency
         + 0.15 × velocity_trend
         + 0.15 × visit_recency
         + 0.15 × conversion_probability
```

**Inventory urgency**: ramps from 0 at 8 weeks of stock to 1 at stockout, but only if there's active velocity (no demand → no urgency).

**Crop-stage urgency**: weighted average of stage labels across growers in the retailer's tehsil. Flowering = 1.0 (peak fungicide window), tillering/vegetative = 0.7–0.8, sowing = 0.6, harvest = 0.2.

**Velocity trend**: max across the retailer's SKUs of `(units_this_week − 4w_avg) / 4w_avg`, normalized.

**Visit recency**: linear ramp from 0 (visited today) to 1 (30+ days). "Never visited" gets 0.8.

**Conversion probability**: the XGBoost output for the most-urgent SKU at this retailer-week. Optional — set `use_ml=false` and the system falls back to rule-only scoring with no degradation in explainability.

**SKU selection** (separate from priority): pick the SKU that maximizes `crop_match × (0.5 + inventory_urgency)`. SKU↔crop affinity comes from a curated map of the 12 SKUs (Topik/Axial for wheat, Score for mustard-chickpea-wheat, Kavach for potato, etc.).

The frontend never sees this formula opaque — every score is accompanied by a list of structured `ReasonFact` objects with labels, values, and signed contributions. This is what makes the system honest.

---

## Page 7 — Offline-First Design

The PS calls out offline operation as a hard constraint. Our design respects this at three layers:

1. **All scoring is deterministic and cacheable.** Given today's feature table, the priority score and reasoning are reproducible without any network call. A rep's morning plan can be computed once at 06:00 IST when the device has signal, cached locally, and served from memory all day.

2. **The API accepts offline-queued outcomes.** `POST /outcome` takes an optional `offline_queued_at` timestamp. The frontend logs outcomes to local storage when offline; on reconnection, it replays them to the server, which records both timestamps (queued and synced) for audit.

3. **The LLM narration step is opt-out.** If Gemini is unreachable, the frontend falls back to template-rendered reason text built directly from the structured `ReasonFact` list. The talking-point pitch degrades from "fluent local-language paragraph" to "structured bullets" — still complete, still actionable.

The 5-MB feature table for one rep's territory compresses to ~200 KB and fits comfortably in a mobile app's local cache.

---

## Page 8 — Explainability

Every recommendation surfaces three layers of "why":

1. **One-line summary** (`one_line_why`) — the dominant reason in 80 characters, for the ranked list.
2. **Structured reason facts** — labeled, signed contributions for the visit detail card. The rep can see exactly how the 0.77 score broke down: "+0.249 from low stock on Axial 50 EC, +0.158 from 67% of tehsil growers at tillering, +0.150 from velocity trend, +0.120 from never-visited."
3. **Inventory + crop signal panels** — the raw underlying numbers (weeks of stock per SKU, % flowering, days since visit) so the rep can verify the reasoning end-to-end.

A rep who disagrees with the system can point to a specific fact and either correct it (via outcome logging) or override it (visit anyway). The system doesn't hide its math.

For the ML component, we expose feature importance globally in the model card and provide per-prediction SHAP values for the conversion probability when requested. We deliberately do **not** show SHAP for the rule-based components — they have closed-form contributions that are simpler and more honest than a SHAP approximation would be.

A "why not?" mode is supported by the same primitives — for any retailer the rep manually queries, the visit detail endpoint returns the same reason facts, including ones with **negative direction**, so the rep can see why a low-ranked retailer is deprioritized.

---

## Page 9 — Impact Metrics, Pilot, and Limitations

### Impact metrics we instrumented

- **Revenue per field day** — POS revenue in tehsils with a visit on day D, divided by visiting reps. We can compute this from the dataset and report it weekly per region.
- **Coverage efficiency** — % of high-priority accounts (score > 0.6) actually visited in the following week. Measured by joining recommendations to visit log forward.
- **Recommendation acceptance rate** — outcomes table: `order_placed` / total outcomes. Computed live from `/outcomes/sync`.
- **Anomaly response time** — time from anomaly detection to rep visit in the affected district. Computed by joining anomaly timestamps to visit log.

### Pilot plan

- **Week 0**: shadow mode. System produces recommendations; reps follow current plans. Measure baseline.
- **Week 1–2**: A/B by territory. Half the reps follow system recommendations; half continue legacy. Measure revenue-per-field-day gap.
- **Week 3+**: Full rollout in winning regions, weekly weight recalibration based on accepted outcomes.

### Limitations we will not paper over

- The synthetic dataset's AUC of 0.577 for the conversion model is real and we don't claim better. Production data with richer ground-truth outcomes should improve this materially.
- The visit log's tehsil-only grain limits attribution precision. We need retailer-ID on visits to do clean causal lift analysis.
- Weather/pest/competitor signals are integration points, not implementations. The pilot must connect at least one external weather/pest feed before "agro-context" claims hold up.
- No geocoding for retailers means our route sequencing is score-based, not geographically optimal. Real deployment needs lat/lng.

---

## Page 10 — What's In This Repo and How to Verify

**Working code, tested:**
- `src/pipeline/build_features.py` — runs in ~3 sec, produces 310k-row feature table
- `src/scoring/priority.py` — runs in ~50 ms per rep-day
- `src/models/conversion.py` — trains in ~5 sec, persists to `data/artifacts/`
- `src/models/anomaly.py` — produces `anomalies.json` with 690 flagged events
- `src/scoring/outcome_learning.py` — beta-posterior updates per logged outcome
- `src/api/main.py` — FastAPI service exposing 9 endpoints
- `tests/test_api.py` — 10 tests, all passing

**Reproducibility check:**
```bash
pip install -r requirements.txt
python -m src.pipeline.build_features    # ~3s
python -m src.models.conversion          # ~5s
python -m src.models.anomaly             # ~3s
python -m pytest tests/ -v               # ~2.5s, 10/10 pass
uvicorn src.api.main:app --port 8080     # boots in <1s after warmup
```

**Honest scope statement:**

This submission delivers the backend, ML pipeline, and integration contract. The frontend is intentionally not in scope — the API is designed so any team (or any client: React, Streamlit, mobile, voice) can build a UI on top in a day. We chose backend depth over frontend gloss because the judging criteria reward dynamic prioritization, next-best-action, anomaly detection, and outcome learning — all of which are backend concerns. The reason-fact contract surfaces the data the UI needs; presentation is a thin layer.

If selected for the next round, the natural next deliverables are: (1) a React mobile-first frontend wired to this API, (2) a Gemini integration for local-language narration on top of the existing structured reasons, (3) a free public weather/pest feed integration for one pilot district to demonstrate the agro-context slot working end-to-end.
