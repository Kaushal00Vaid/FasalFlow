"use client";

import { useEffect, useState, use } from "react";
import { fetchVisitDetail, VisitPlanItem } from "@/lib/api";
import { ReasonCard } from "@/components/ReasonCard";
import { OutcomeLogger } from "@/components/OutcomeLogger";
import { ArrowLeft, MapPin, Store, Navigation2 } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [visit, setVisit] = useState<VisitPlanItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const today = new Date().toISOString().split("T")[0];
        const data = await fetchVisitDetail(resolvedParams.id, today);
        setVisit(data);
      } catch (err) {
        console.error("Failed to fetch visit detail:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [resolvedParams.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 p-6 flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
        <p className="text-neutral-500 font-medium tracking-wide">Loading Profile...</p>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="min-h-screen bg-neutral-950 p-6">
        <Link href="/plan" className="inline-flex items-center text-neutral-400 hover:text-white mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Link>
        <p className="text-neutral-400">Visit details not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 pb-24">
      {/* Header section */}
      <div className="relative overflow-hidden bg-neutral-900 border-b border-neutral-800">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Store className="w-32 h-32" />
        </div>
        
        <div className="px-6 pt-6 pb-8 relative z-10">
          <Link href="/plan" className="inline-flex items-center text-neutral-400 hover:text-emerald-400 mb-6 transition-colors">
            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center mr-3 border border-neutral-700">
              <ArrowLeft className="w-4 h-4" />
            </div>
            <span className="text-sm font-medium">Back to Plan</span>
          </Link>
          
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">{visit.retailer_id}</h1>
              <div className="flex items-center gap-2 text-neutral-400 text-sm bg-neutral-800/50 w-fit px-3 py-1.5 rounded-lg border border-neutral-700/50">
                <MapPin className="w-4 h-4 text-emerald-500" />
                {visit.tehsil} • {visit.district}
              </div>
            </div>
            
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center">
              <span className="text-xs text-emerald-500/70 font-medium mb-0.5">SCORE</span>
              <span className="text-lg font-bold text-emerald-400 leading-none">{(visit.score * 100).toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      <main className="p-6 space-y-8">
        {/* Recommendation Section */}
        <section>
          <div className="bg-gradient-to-br from-emerald-900/40 to-emerald-950/40 border border-emerald-500/30 rounded-2xl p-5 shadow-lg shadow-emerald-900/20 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
            <h3 className="text-emerald-400 text-xs font-bold tracking-widest uppercase mb-1">Recommended Action</h3>
            <p className="text-lg font-medium text-white mb-2">{visit.recommended_action}</p>
            <p className="text-emerald-200/70 text-sm leading-relaxed">{visit.one_line_why}</p>
          </div>
        </section>

        {/* Explainability Section */}
        <section>
          <ReasonCard reasons={visit.reasons} />
        </section>

        {/* Action Section */}
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
          <OutcomeLogger 
            repId="REP_0001" 
            retailerId={visit.retailer_id} 
            date={new Date().toISOString().split("T")[0]} 
            recommendedSku={visit.recommended_sku_id} 
          />
        </section>
      </main>
    </div>
  );
}
