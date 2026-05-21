"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { logOutcome } from "@/lib/api";
import { CheckCircle2, XCircle, Clock, Loader2, Send } from "lucide-react";
import clsx from "clsx";

interface OutcomeLoggerProps {
  repId: string;
  retailerId: string;
  date: string;
  recommendedSku: string;
}

export function OutcomeLogger({ repId, retailerId, date, recommendedSku }: OutcomeLoggerProps) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const outcomes = [
    { id: "order_placed", label: "Order Placed", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30 hover:bg-emerald-400/20" },
    { id: "follow_up", label: "Follow Up", icon: Clock, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30 hover:bg-amber-400/20" },
    { id: "no_interest", label: "No Interest", icon: XCircle, color: "text-rose-400", bg: "bg-rose-400/10 border-rose-400/30 hover:bg-rose-400/20" },
  ];

  const handleSubmit = async () => {
    if (!outcome) return;
    
    setIsSubmitting(true);
    try {
      await logOutcome({
        rep_id: repId,
        retailer_id: retailerId,
        visit_date: date,
        sku_discussed: recommendedSku,
        outcome: outcome,
        notes: notes,
      });
      setIsSuccess(true);
    } catch (error) {
      console.error("Failed to log outcome:", error);
      // Fallback: save to localStorage for offline sync
      const queue = JSON.parse(localStorage.getItem('offlineOutcomes') || '[]');
      queue.push({
        rep_id: repId, retailer_id: retailerId, visit_date: date, sku_discussed: recommendedSku, outcome, notes,
        offline_queued_at: new Date().toISOString()
      });
      localStorage.setItem('offlineOutcomes', JSON.stringify(queue));
      setIsSuccess(true); // Still show success as it's queued
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-6 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", damping: 12, delay: 0.1 }}
          className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4"
        >
          <CheckCircle2 className="w-8 h-8" />
        </motion.div>
        <h3 className="text-xl font-medium text-emerald-50 mb-2">Visit Logged</h3>
        <p className="text-emerald-200/70 text-sm">Learning models will update overnight.</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold tracking-wider text-neutral-400 uppercase">Log Visit Outcome</h3>
      
      <div className="grid grid-cols-3 gap-3">
        {outcomes.map((opt) => {
          const Icon = opt.icon;
          const isSelected = outcome === opt.id;
          
          return (
            <button
              key={opt.id}
              onClick={() => setOutcome(opt.id)}
              className={clsx(
                "flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200",
                isSelected 
                  ? `${opt.bg} shadow-lg ring-1 ring-inset ring-${opt.color.split('-')[1]}-500/50 scale-95` 
                  : "bg-neutral-800/50 border-neutral-700/50 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
              )}
            >
              <Icon className={clsx("w-6 h-6", isSelected ? opt.color : "")} />
              <span className={clsx("text-[10px] sm:text-xs font-medium uppercase tracking-wider", isSelected ? "text-white" : "")}>
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {outcome && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -10 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -10 }}
            className="space-y-4 overflow-hidden"
          >
            <div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any context for the model? (e.g. 'Farmer bought competitor product')"
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none min-h-[100px]"
              />
            </div>
            
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full relative overflow-hidden bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold py-4 rounded-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Syncing...</span>
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  <span>Submit Outcome</span>
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
