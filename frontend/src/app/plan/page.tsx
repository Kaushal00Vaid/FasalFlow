"use client";

import { useEffect, useState } from "react";
import { fetchDailyPlan, fetchWeeks, DailyPlanResponse } from "@/lib/api";
import { PlanList } from "@/components/PlanList";
import { Calendar as CalendarIcon, MapPin, Search } from "lucide-react";
import { format } from "date-fns";

export default function PlanPage() {
  const [plan, setPlan] = useState<DailyPlanResponse | null>(null);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );
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
        const data = await fetchDailyPlan("REP_0001", selectedDate);
        setPlan(data);
      } catch (err) {
        console.error("Failed to fetch plan:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedDate]);

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
              placeholder="Search retailers or tehsils..."
              className="w-full bg-neutral-800/50 border border-neutral-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
        </div>
      </header>

      <main className="p-4 pt-6">
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-lg font-medium text-neutral-200">Recommended Visits</h2>
          <span className="text-xs text-neutral-500">
            {plan ? `${plan.visits.length} accounts` : "Loading..."}
          </span>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-neutral-900/50 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : plan ? (
          <PlanList visits={plan.visits} />
        ) : (
          <div className="text-center text-neutral-500 py-10">
            Failed to load your plan.
          </div>
        )}
      </main>
    </div>
  );
}
