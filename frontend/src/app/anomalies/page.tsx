"use client";

import { useEffect, useState } from "react";
import { fetchAnomalies, Anomaly } from "@/lib/api";
import { TrendingUp, TrendingDown, AlertCircle, Clock, ChevronRight } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";

export default function AnomaliesPage() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAnomalies("REP_0001");
        setAnomalies(data);
      } catch (err) {
        console.error("Failed to fetch anomalies:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 pb-20 md:pb-8">
      <header className="bg-neutral-900 border-b border-neutral-800 sticky top-0 z-40">
        <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
          <h1 className="text-2xl font-semibold text-emerald-50 mb-2">Anomalies Feed</h1>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <p className="text-amber-200/80 text-xs leading-relaxed">
              <strong>What is this?</strong> This feed shows macro-level alerts (like sudden district-wide stockouts or demand spikes) automatically detected by the data pipeline. Review these regional trends for context before starting your individual retailer visits.
            </p>
          </div>
        </div>
      </header>

      <main className="p-4 md:p-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-32 bg-neutral-900 border border-neutral-800 rounded-2xl animate-pulse" />)
          ) : anomalies.length === 0 ? (
            <div className="text-center text-neutral-500 py-10">No alerts today.</div>
          ) : (
            anomalies.map((anom, idx) => {
              const isHigh = anom.severity >= 0.6;
              const isSpike = anom.kind === "demand_spike";
              const isDrop = anom.kind === "demand_drop";

              const Icon = isSpike ? TrendingUp : isDrop ? TrendingDown : AlertCircle;
              const colorClass = isHigh ? "text-rose-400 bg-rose-400/10 border-rose-400/20" : "text-amber-400 bg-amber-400/10 border-amber-400/20";

              return (
                <div key={idx} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 relative overflow-hidden group">
                  {isHigh && <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />}

                  <div className="flex items-start gap-4">
                    <div className={clsx("p-2.5 rounded-xl border flex-shrink-0", colorClass)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                          {anom.district} • {anom.sku_name || anom.sku_id}
                        </span>
                        <div className="flex items-center gap-2">
                          {isHigh && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 uppercase">Critical</span>}
                        </div>
                      </div>
                      <p className="text-sm text-neutral-200 font-medium leading-snug pr-4">
                        {anom.explanation}
                      </p>
                      <div className="flex items-center gap-1.5 mt-3 text-xs text-neutral-500">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Week ending {new Date(anom.week_end_date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
