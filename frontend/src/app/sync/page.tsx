"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, CloudOff, RefreshCw, Server } from "lucide-react";
import { api } from "@/lib/api";

interface Outcome {
  id?: number;
  retailer_id: string;
  visit_date: string;
  outcome: string;
  sku_discussed: string;
  notes: string;
  offline_queued_at?: string;
  synced_at?: string;
  rep_id: string;
}

export default function SyncPage() {
  const [syncedOutcomes, setSyncedOutcomes] = useState<Outcome[]>([]);
  const [offlineOutcomes, setOfflineOutcomes] = useState<Outcome[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    // Load offline queue from local storage
    const queue = JSON.parse(localStorage.getItem('offlineOutcomes') || '[]');
    setOfflineOutcomes(queue);

    // Fetch synced outcomes from server
    try {
      const { data } = await api.get('/outcomes/sync?rep_id=REP_0001');
      setSyncedOutcomes(data);
    } catch (err) {
      console.error("Failed to fetch synced outcomes:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (offlineOutcomes.length === 0) return;

    // Simulate syncing offline queue
    for (const outcome of offlineOutcomes) {
      try {
        // Map old property names to new property names just in case they are from old cache
        const payload = {
          rep_id: outcome.rep_id,
          retailer_id: outcome.retailer_id,
          visit_date: outcome.visit_date || (outcome as any).date,
          sku_discussed: outcome.sku_discussed || (outcome as any).recommended_sku,
          outcome: outcome.outcome === 'needs_followup' ? 'follow_up' : outcome.outcome,
          notes: outcome.notes,
          offline_queued_at: outcome.offline_queued_at
        };
        await api.post('/outcome', payload);
      } catch (err) {
        console.error("Failed to sync outcome", outcome);
      }
    }

    // Clear queue and reload
    localStorage.setItem('offlineOutcomes', '[]');
    await loadData();
  };

  return (
    <div className="min-h-screen bg-neutral-950 pb-20">
      <header className="bg-neutral-900 border-b border-neutral-800 sticky top-0 z-40">
        <div className="px-4 py-6">
          <h1 className="text-2xl font-semibold text-emerald-50 mb-1">Data Sync</h1>
          <p className="text-neutral-400 text-sm">Manage offline visits and server synchronization</p>
        </div>
      </header>

      <main className="p-4 pt-6 space-y-8">
        {/* Offline Queue Section */}
        <section>
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-lg font-medium text-neutral-200 flex items-center gap-2">
              <CloudOff className="w-5 h-5 text-amber-400" />
              Offline Queue
            </h2>
            {offlineOutcomes.length > 0 && (
              <button onClick={handleSync} className="text-sm bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 flex items-center gap-2 hover:bg-emerald-500/20 transition-colors">
                <RefreshCw className="w-4 h-4" /> Sync Now
              </button>
            )}
          </div>

          {offlineOutcomes.length === 0 ? (
            <div className="bg-neutral-900/50 border border-neutral-800 border-dashed rounded-2xl p-6 text-center text-neutral-500">
              No pending offline visits.
            </div>
          ) : (
            <div className="space-y-3">
              {offlineOutcomes.map((o, i) => (
                <div key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <h3 className="text-neutral-200 font-medium">{o.retailer_id}</h3>
                    <p className="text-xs text-neutral-500 uppercase tracking-wider">{o.outcome.replace('_', ' ')} • {o.sku_discussed}</p>
                  </div>
                  <Clock className="w-5 h-5 text-amber-500/50" />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Synced History Section */}
        <section>
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-lg font-medium text-neutral-200 flex items-center gap-2">
              <Server className="w-5 h-5 text-emerald-400" />
              Synced to Server
            </h2>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="h-20 bg-neutral-900/50 rounded-xl animate-pulse" />)}
            </div>
          ) : syncedOutcomes.length === 0 ? (
            <div className="bg-neutral-900/50 border border-neutral-800 border-dashed rounded-2xl p-6 text-center text-neutral-500">
              No synced visits found.
            </div>
          ) : (
            <div className="space-y-3">
              {syncedOutcomes.map((o, i) => (
                <div key={i} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <h3 className="text-neutral-200 font-medium">{o.retailer_id}</h3>
                    <p className="text-xs text-emerald-500/70 uppercase tracking-wider mb-1">{o.outcome.replace('_', ' ')}</p>
                    {o.notes && <p className="text-sm text-neutral-400 line-clamp-1">"{o.notes}"</p>}
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
