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
    <div className="min-h-screen bg-neutral-950 pb-20">
      <header className="bg-neutral-900 border-b border-neutral-800 sticky top-0 z-40">
        <div className="px-4 py-6">
          <h1 className="text-2xl font-semibold text-rose-50 mb-1">Alerts & Anomalies</h1>
          <p className="text-neutral-400 text-sm">Actionable signals from your territory</p>
        </div>
      </header>

      <main className="p-4 pt-6 space-y-4">
        {loading ? (
          [1, 2, 3].map(i => <div key={i} className="h-24 bg-neutral-900/50 rounded-2xl animate-pulse" />)
        ) : anomalies.length === 0 ? (
          <div className="text-center text-neutral-500 py-10">No alerts today.</div>
        ) : (
          anomalies.map((anom, idx) => {
            const isHigh = anom.severity === "high";
            const isSpike = anom.anomaly_type === "demand_spike";
            const isDrop = anom.anomaly_type === "demand_drop";
            
            const Icon = isSpike ? TrendingUp : isDrop ? TrendingDown : AlertCircle;
            const colorClass = isHigh ? "text-rose-400 bg-rose-400/10 border-rose-400/20" : "text-amber-400 bg-amber-400/10 border-amber-400/20";
            
            return (
              <Link key={idx} href={`/plan`} className="block">
                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 hover:border-neutral-700 transition-all hover:bg-neutral-800/80 relative overflow-hidden group">
                  {isHigh && <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />}
                  
                  <div className="flex items-start gap-4">
                    <div className={clsx("p-2.5 rounded-xl border flex-shrink-0", colorClass)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                          {anom.district} • {anom.sku_id}
                        </span>
                        <div className="flex items-center gap-2">
                          {isHigh && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 uppercase">Critical</span>}
                          <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-colors" />
                        </div>
                      </div>
                      <p className="text-sm text-neutral-200 font-medium leading-snug pr-4">
                        {anom.description}
                      </p>
                      <div className="flex items-center gap-1.5 mt-3 text-xs text-neutral-500">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{new Date(anom.detected_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </main>
    </div>
  );
}
