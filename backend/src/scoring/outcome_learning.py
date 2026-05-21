"""
Outcome-learning loop.

PS requirement: 'use visit outcomes to continuously refine recommendations.'

Approach (deliberately simple, defensible, transparent):
  - Maintain a Bayesian-style per-retailer conversion belief, updated each time
    an outcome is logged.
  - belief = beta(alpha, beta) where:
      alpha starts at 1 (prior: 1 success)
      beta  starts at 1 (prior: 1 failure)
  - After each outcome:
      'order_placed'    -> alpha += 1
      'discussed_only'  -> alpha += 0.25, beta += 0.25  (mild positive)
      'no_interest'     -> beta  += 1
      'follow_up'       -> alpha += 0.1
  - Posterior mean (alpha / (alpha + beta)) is then exposed as a per-retailer
    conversion belief that PriorityScorer can blend into its score.

Why not just retrain XGBoost online? Two reasons:
  1. Synthetic dataset has too few outcomes per retailer to retrain meaningfully.
  2. Bayesian beta-update is fully explainable - the rep can see exactly how
     their feedback moved the belief.

The XGBoost conversion model captures cross-retailer patterns (crop, stock,
season), this beta posterior captures retailer-specific track record.
The final score blends both.
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from pathlib import Path

ART = Path(__file__).resolve().parents[2] / "data" / "artifacts"
DB_PATH = ART / "outcomes.db"

# Update weights per outcome type
DELTA = {
    "order_placed": (1.0, 0.0),
    "discussed_only": (0.25, 0.25),
    "no_interest": (0.0, 1.0),
    "follow_up": (0.1, 0.0),
}


def compute_retailer_beliefs(prior_alpha: float = 1.0, prior_beta: float = 1.0) -> dict[str, dict]:
    """Read all logged outcomes and return per-retailer beta(alpha, beta) posteriors."""
    counts: dict[str, list[float]] = defaultdict(lambda: [prior_alpha, prior_beta])
    if not DB_PATH.exists():
        return {}
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT retailer_id, outcome FROM outcomes").fetchall()
    conn.close()
    for retailer_id, outcome in rows:
        da, db = DELTA.get(outcome, (0.0, 0.0))
        counts[retailer_id][0] += da
        counts[retailer_id][1] += db
    return {
        rid: {
            "alpha": a,
            "beta": b,
            "posterior_mean": a / (a + b),
            "samples": int((a - prior_alpha) + (b - prior_beta)),
        }
        for rid, (a, b) in counts.items()
    }


def belief_for_retailer(retailer_id: str) -> float:
    """Returns the current posterior conversion rate for one retailer (default 0.5)."""
    beliefs = compute_retailer_beliefs()
    if retailer_id in beliefs:
        return beliefs[retailer_id]["posterior_mean"]
    return 0.5


if __name__ == "__main__":
    import json

    beliefs = compute_retailer_beliefs()
    print(f"Retailers with logged outcomes: {len(beliefs)}")
    if beliefs:
        top = sorted(beliefs.items(), key=lambda kv: -kv[1]["posterior_mean"])[:10]
        for rid, info in top:
            print(
                f"  {rid}: belief={info['posterior_mean']:.3f}  "
                f"(samples={info['samples']}, a={info['alpha']:.2f} b={info['beta']:.2f})"
            )
