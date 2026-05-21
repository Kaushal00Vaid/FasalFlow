"use client";

import { useEffect, useState, use } from "react";
import { fetchVisitDetail, fetchVisitPitch, fetchWeeks, PitchResponse } from "@/lib/api";
import { ReasonCard } from "@/components/ReasonCard";
import { OutcomeLogger } from "@/components/OutcomeLogger";
import { 
  ArrowLeft, 
  MapPin, 
  Store, 
  Sprout, 
  Package, 
  Calendar, 
  AlertCircle, 
  Copy, 
  Check, 
  Sparkles, 
  Database,
  TrendingUp,
  AlertTriangle,
  Info
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

const LANGUAGES = [
  { code: "English", label: "English", flag: "🇬🇧" },
  { code: "Hindi", label: "हिन्दी (Hindi)", flag: "🇮🇳" },
  { code: "Tamil", label: "தமிழ் (Tamil)", flag: "🇮🇳" },
  { code: "Telugu", label: "తెలుగు (Telugu)", flag: "🇮🇳" },
  { code: "Marathi", label: "मराठी (Marathi)", flag: "🇮🇳" },
];

export default function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  
  const [visit, setVisit] = useState<any | null>(null);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // AI Pitch state
  const [selectedLang, setSelectedLang] = useState("English");
  const [pitch, setPitch] = useState<PitchResponse | null>(null);
  const [loadingPitch, setLoadingPitch] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const weeksData = await fetchWeeks();
        setWeeks(weeksData);
        const activeDate = weeksData.length > 0 ? weeksData[weeksData.length - 1] : new Date().toISOString().split("T")[0];
        setSelectedDate(activeDate);
        
        const data = await fetchVisitDetail(resolvedParams.id, activeDate);
        setVisit(data);
      } catch (err) {
        console.error("Failed to fetch visit detail:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [resolvedParams.id]);

  useEffect(() => {
    if (!visit || !selectedDate) return;
    
    async function loadPitch() {
      setLoadingPitch(false); // reset loading but make it fast
      setLoadingPitch(true);
      try {
        const res = await fetchVisitPitch(visit.retailer_id, selectedDate, selectedLang);
        setPitch(res);
      } catch (err) {
        console.error("Failed to fetch pitch:", err);
      } finally {
        setLoadingPitch(false);
      }
    }
    loadPitch();
  }, [visit, selectedDate, selectedLang]);

  const handleCopy = () => {
    if (!pitch) return;
    navigator.clipboard.writeText(pitch.pitch);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  // Calculated variables for crop signal
  const pctFlowering = visit.stage_signal?.pct_flowering || 0;
  const pctTillering = visit.stage_signal?.pct_tillering || 0;
  const pctOther = Math.max(0, 1 - pctFlowering - pctTillering);

  const daysSinceVisit = visit.visit_history?.days_since_last_visit ?? 999;
  const isOverdue = daysSinceVisit > 30;
  const isDue = daysSinceVisit > 14 && daysSinceVisit <= 30;

  // Filter out low stock products
  const lowStockItems = visit.inventory?.filter((item: any) => item.low_stock) || [];

  return (
    <div className="min-h-screen bg-neutral-950 pb-24 md:pb-8">
      {/* Header section */}
      <div className="relative overflow-hidden bg-neutral-900 border-b border-neutral-800">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Store className="w-32 h-32" />
        </div>
        
        <div className="px-6 md:px-8 py-8 max-w-7xl mx-auto relative z-10">
          <Link href="/plan" className="inline-flex items-center text-neutral-400 hover:text-emerald-400 mb-6 transition-colors">
            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center mr-3 border border-neutral-700">
              <ArrowLeft className="w-4 h-4" />
            </div>
            <span className="text-sm font-medium">Back to Plan</span>
          </Link>
          
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">{visit.retailer_id}</h1>
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-2 text-neutral-400 text-sm bg-neutral-800/50 w-fit px-3 py-1.5 rounded-lg border border-neutral-700/50">
                  <MapPin className="w-4 h-4 text-emerald-500" />
                  {visit.tehsil} • {visit.district} • {visit.state}
                </div>
                
                {/* Dynamic Visit Recency Badge */}
                <div className={clsx(
                  "flex items-center gap-2 text-sm w-fit px-3 py-1.5 rounded-lg border",
                  isOverdue ? "bg-rose-500/10 border-rose-500/20 text-rose-400" :
                  isDue ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                  "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                )}>
                  <Calendar className="w-4 h-4" />
                  {daysSinceVisit === 999 ? "No recent visits" : `${daysSinceVisit} days since last visit`}
                </div>
              </div>
            </div>
            
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center">
              <span className="text-xs text-emerald-500/70 font-medium mb-0.5">SCORE</span>
              <span className="text-lg font-bold text-emerald-400 leading-none">{(visit.score * 100).toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      <main className="p-6 md:p-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
          {/* Left/Main Column - Span 2 */}
          <div className="lg:col-span-2 space-y-6 md:space-y-8">
            
            {/* Top Recommendation Banner */}
            <motion.section
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="bg-gradient-to-br from-emerald-950/80 to-neutral-900 border border-emerald-500/20 rounded-2xl p-6 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500" />
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-emerald-400 text-xs font-bold tracking-widest uppercase">AI Co-Pilot Recommendation</h3>
                  {visit.recommended_sku && (
                    <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded">
                      SKU: {visit.recommended_sku}
                    </span>
                  )}
                </div>
                <p className="text-xl font-bold text-white mb-2">{visit.recommended_action}</p>
                <p className="text-neutral-400 text-sm leading-relaxed">{visit.one_line_why}</p>
              </div>
            </motion.section>

            {/* AI Pitch Generator Card */}
            <motion.section
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-neutral-200 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    Vernacular Pitch Advisor
                  </h2>
                  <p className="text-xs text-neutral-400 mt-0.5">Generate localized sales scripts in the retailer's preferred tongue</p>
                </div>
                
                {/* Language pills */}
                <div className="flex flex-wrap gap-1.5 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLang(lang.code)}
                      className={clsx(
                        "text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all duration-200 flex items-center gap-1",
                        selectedLang === lang.code 
                          ? "bg-emerald-500 text-neutral-950 shadow" 
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
                      )}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.label.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pitch Display Screen */}
              <div className="relative rounded-xl border border-neutral-800 bg-neutral-950/60 p-5 min-h-[140px] flex flex-col justify-between">
                
                {/* Loading state overlay */}
                <AnimatePresence>
                  {loadingPitch && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-neutral-950/80 rounded-xl flex items-center justify-center space-x-2.5 z-20"
                    >
                      <LoaderIcon />
                      <span className="text-sm font-medium text-emerald-500 animate-pulse">Drafting script...</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {pitch ? (
                  <div className="space-y-4">
                    {/* Source Indicator Pill */}
                    <div className="flex justify-between items-center">
                      <span className={clsx(
                        "text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md border flex items-center gap-1",
                        pitch.source === "gemini" 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 animate-pulse" 
                          : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                      )}>
                        {pitch.source === "gemini" ? (
                          <>
                            <Sparkles className="w-3 h-3 text-emerald-400" />
                            Live Gemini AI
                          </>
                        ) : (
                          <>
                            <Database className="w-3 h-3 text-blue-400" />
                            Offline Cache
                          </>
                        )}
                      </span>
                      
                      <button 
                        onClick={handleCopy}
                        className="text-neutral-500 hover:text-neutral-200 transition-colors p-1"
                        title="Copy script"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Script Body */}
                    <div>
                      <p className="text-md font-medium text-neutral-100 leading-relaxed font-outfit">
                        "{pitch.pitch}"
                      </p>
                    </div>

                    {/* English Coaching Translation */}
                    {pitch.translation && (
                      <div className="border-t border-neutral-900 pt-3 mt-3">
                        <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block mb-1">Rep Translation & Coaching</span>
                        <p className="text-xs text-neutral-400 leading-relaxed italic">
                          "{pitch.translation}"
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-6 text-neutral-600">
                    <Info className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm">Could not generate script preview.</p>
                  </div>
                )}
              </div>
            </motion.section>

            {/* Explainability Reasons */}
            <motion.section
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <ReasonCard reasons={visit.reasons} />
            </motion.section>
            
            {/* Inventory Table Card */}
            <motion.section
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-neutral-200 flex items-center gap-2">
                    <Package className="w-5 h-5 text-emerald-400" />
                    SKU Stockout Risk Explorer
                  </h2>
                  <p className="text-xs text-neutral-400 mt-0.5">Real-time dealer inventory records and 4-week sales velocities</p>
                </div>
                
                {lowStockItems.length > 0 && (
                  <span className="text-[11px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {lowStockItems.length} SKUs facing stockouts
                  </span>
                )}
              </div>

              {/* Table wrapper */}
              <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950/20">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-800 bg-neutral-900/50">
                      <th className="py-3 px-4 text-xs font-bold text-neutral-400 uppercase">Product SKU</th>
                      <th className="py-3 px-4 text-xs font-bold text-neutral-400 uppercase text-right">Stock (Units)</th>
                      <th className="py-3 px-4 text-xs font-bold text-neutral-400 uppercase text-center">Velocity (4W)</th>
                      <th className="py-3 px-4 text-xs font-bold text-neutral-400 uppercase text-center">Weeks of Stock</th>
                      <th className="py-3 px-4 text-xs font-bold text-neutral-400 uppercase text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visit.inventory?.map((sku: any, idx: number) => {
                      const isLowStock = sku.low_stock;
                      
                      return (
                        <tr 
                          key={sku.sku_id}
                          className={clsx(
                            "border-b border-neutral-900 transition-colors hover:bg-neutral-900/40",
                            isLowStock ? "bg-rose-500/[0.02]" : ""
                          )}
                        >
                          <td className="py-3.5 px-4">
                            <span className="font-medium text-neutral-200 block text-sm">{sku.sku_name}</span>
                            <span className="text-[10px] text-neutral-500 font-mono">{sku.sku_id}</span>
                          </td>
                          
                          <td className="py-3.5 px-4 text-right">
                            <span className={clsx(
                              "font-mono font-semibold text-sm",
                              isLowStock ? "text-rose-400" : "text-neutral-300"
                            )}>
                              {sku.on_hand}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            <span className="font-mono text-neutral-400 text-sm">
                              {sku.velocity_4w} / wk
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            <div className="inline-flex items-center gap-2">
                              {/* Stock gauge slider */}
                              <div className="w-16 h-1.5 rounded-full bg-neutral-800 overflow-hidden hidden sm:block">
                                <div 
                                  className={clsx(
                                    "h-full rounded-full",
                                    sku.weeks_of_stock <= 1 ? "bg-rose-500" : 
                                    sku.weeks_of_stock <= 2 ? "bg-amber-500" : "bg-emerald-500"
                                  )}
                                  style={{ width: `${Math.min(100, (sku.weeks_of_stock / 6) * 100)}%` }}
                                />
                              </div>
                              <span className={clsx(
                                "font-mono font-semibold text-xs",
                                sku.weeks_of_stock <= 1.5 ? "text-rose-400" : "text-neutral-300"
                              )}>
                                {sku.weeks_of_stock} wks
                              </span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <span className={clsx(
                              "inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded",
                              isLowStock 
                                ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
                                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            )}>
                              {isLowStock ? "Risk" : "Healthy"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.section>

          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-6 md:space-y-8">
            
            {/* Crop Growth Stage Card */}
            {visit.stage_signal && (
              <motion.section
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6"
              >
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
                    <Sprout className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-neutral-200">Crop Health & Stages</h3>
                    <p className="text-[10px] text-neutral-400">Regional crop indices from satellite & POS</p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest block mb-0.5">Primary Local Crop</span>
                    <span className="text-lg font-bold text-white flex items-center gap-1.5">
                      {visit.stage_signal.dominant_crop}
                    </span>
                  </div>

                  {/* Multi-stage Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-neutral-400">Growth Stage Distribution</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {((pctFlowering + pctTillering) * 100).toFixed(0)}% Actionable
                      </span>
                    </div>

                    <div className="h-3 rounded-full bg-neutral-800 flex overflow-hidden">
                      {/* Flowering */}
                      {pctFlowering > 0 && (
                        <div 
                          className="h-full bg-amber-500 transition-all hover:opacity-80" 
                          style={{ width: `${pctFlowering * 100}%` }}
                          title={`Flowering: ${(pctFlowering * 100).toFixed(0)}%`}
                        />
                      )}
                      {/* Tillering */}
                      {pctTillering > 0 && (
                        <div 
                          className="h-full bg-emerald-500 transition-all hover:opacity-80" 
                          style={{ width: `${pctTillering * 100}%` }}
                          title={`Tillering: ${(pctTillering * 100).toFixed(0)}%`}
                        />
                      )}
                      {/* Other */}
                      {pctOther > 0 && (
                        <div 
                          className="h-full bg-neutral-700 transition-all hover:opacity-80" 
                          style={{ width: `${pctOther * 100}%` }}
                          title={`Other stages: ${(pctOther * 100).toFixed(0)}%`}
                        />
                      )}
                    </div>

                    {/* Progress Bar Labels */}
                    <div className="grid grid-cols-3 gap-2 pt-1.5 text-[10px]">
                      <div className="flex items-center gap-1 text-amber-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Flowering ({(pctFlowering * 100).toFixed(0)}%)
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Tillering ({(pctTillering * 100).toFixed(0)}%)
                      </div>
                      <div className="flex items-center gap-1 text-neutral-500 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-700" />
                        Other ({(pctOther * 100).toFixed(0)}%)
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-neutral-800/80 pt-4">
                    <div>
                      <span className="text-[10px] text-neutral-500 block">Stage Urgency Index</span>
                      <span className="text-md font-bold text-neutral-200 font-mono">
                        {visit.stage_signal.stage_urgency_mean.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-500 block">Growers in Tehsil</span>
                      <span className="text-md font-bold text-neutral-200 font-mono">
                        {visit.stage_signal.grower_count_in_tehsil}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.section>
            )}

            {/* Action Log / Logger Section */}
            <motion.section
              initial={{ opacity: 0, x: 15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35 }}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6"
            >
              <OutcomeLogger 
                repId="REP_0001" 
                retailerId={visit.retailer_id} 
                date={selectedDate} 
                recommendedSku={visit.recommended_sku_id} 
              />
            </motion.section>

          </div>
        </div>
      </main>
    </div>
  );
}

function LoaderIcon() {
  return (
    <svg className="animate-spin h-5 w-5 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}

