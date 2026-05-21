"use client";

import { useEffect, useState } from "react";
import { fetchDailyPlan, fetchWeeks, DailyPlanResponse } from "@/lib/api";
import { PlanList } from "@/components/PlanList";
import { Calendar as CalendarIcon, MapPin, Search } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";

export default function PlanPage() {
  const [plan, setPlan] = useState<DailyPlanResponse | null>(null);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const weeksData = await fetchWeeks();
        setWeeks(weeksData);
        const defaultDate = weeksData.length > 0 ? weeksData[weeksData.length - 1] : new Date().toISOString().split("T")[0];
        setSelectedDate(defaultDate);
      } catch (err) {
        console.error("Failed to fetch weeks:", err);
        setSelectedDate(new Date().toISOString().split("T")[0]);
      }
    }
    init();
  }, []);

  useEffect(() => {
    async function load() {
      if (!selectedDate) return;
      setLoading(true);
      try {
        // Fetch top_n = 100 to get the entire list of retailers in territory for searching
        const data = await fetchDailyPlan("REP_0001", selectedDate, 100);
        setPlan(data);
      } catch (err) {
        console.error("Failed to fetch plan:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedDate]);

  // Filtering and splitting logic for "Recommended" vs "De-prioritized / Why Not"
  const allVisits = plan ? plan.visits : [];
  
  const filteredVisits = allVisits.filter(v =>
    v.retailer_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.tehsil.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.district.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.recommended_sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Top 8 overall, or matching filtered top 8
  const recommendedVisits = searchQuery
    ? filteredVisits.filter((_, idx) => allVisits.indexOf(filteredVisits[idx]) < 8)
    : allVisits.slice(0, 8);

  const deprioritizedVisits = searchQuery
    ? filteredVisits.filter((_, idx) => allVisits.indexOf(filteredVisits[idx]) >= 8)
    : allVisits.slice(8);

  return (
    <div className="min-h-screen bg-neutral-950 pb-20 md:pb-8">
      <header className="bg-neutral-900 border-b border-neutral-800 sticky top-0 z-40">
        <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-emerald-50 mb-1">Morning Brief</h1>
              <div className="flex items-center gap-2 mt-2">
                <CalendarIcon className="w-4 h-4 text-emerald-500" />
                <select
                  className="bg-neutral-800 text-emerald-50 text-sm border border-neutral-700 rounded-md px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                >
                  {weeks.map(w => (
                    <option key={w} value={w}>{format(new Date(w), "EEEE, MMM do yyyy")}</option>
                  ))}
                  {weeks.length === 0 && (
                    <option value={selectedDate}>{format(new Date(selectedDate), "EEEE, MMM do yyyy")}</option>
                  )}
                </select>
              </div>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-semibold border border-emerald-500/30">
              R1
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search retailers, SKUs, or tehsils..."
              className="w-full bg-neutral-800/50 border border-neutral-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      <main className="p-4 pt-6 max-w-7xl mx-auto">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-neutral-900/50 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : plan ? (
          <div className="space-y-10">
            {/* Top Recommendations */}
            <section>
              <div className="flex justify-between items-end mb-6">
                <div>
                  <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2 font-outfit">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    Recommended Visits
                  </h2>
                  <p className="text-xs text-neutral-400 mt-1">High-priority targets optimized for today's biological & market conditions</p>
                </div>
                <span className="text-xs text-emerald-400 font-mono font-bold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                  {recommendedVisits.length} targets
                </span>
              </div>
              <PlanList visits={recommendedVisits} />
            </section>

            {/* De-prioritized / "Why Not?" Explorer */}
            {deprioritizedVisits.length > 0 && (
              <section className="border-t border-neutral-900 pt-10">
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-neutral-400 font-outfit">
                      De-prioritized ("Why Not?" Explorer)
                    </h2>
                    <p className="text-xs text-neutral-500 mt-1">Accounts with lower urgency scores — click to explore negative priority triggers</p>
                  </div>
                  <span className="text-xs text-neutral-500 font-mono font-bold bg-neutral-900 px-2.5 py-1 rounded-full border border-neutral-800">
                    {deprioritizedVisits.length} accounts
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {deprioritizedVisits.map((visit) => (
                    <Link key={visit.retailer_id} href={`/visit/${visit.retailer_id}`}>
                      <div className="group relative bg-neutral-900/40 border border-neutral-800/50 rounded-2xl p-5 hover:border-neutral-700 hover:bg-neutral-900/60 transition-all opacity-70 hover:opacity-100 cursor-pointer">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h3 className="text-md font-semibold text-neutral-400 group-hover:text-neutral-200 transition-colors">
                              {visit.retailer_id}
                            </h3>
                            <span className="text-[10px] text-neutral-500">{visit.district} • {visit.tehsil.split('_')[1]}</span>
                          </div>
                          <span className="text-xs font-mono font-bold text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700/50">
                            {(visit.score * 100).toFixed(0)}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 line-clamp-2 italic bg-neutral-950/30 p-2.5 rounded-lg border border-neutral-800/30">
                          {visit.one_line_why}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="text-center text-neutral-500 py-10">
            Failed to load your plan.
          </div>
        )}
      </main>
    </div>
  );
}
