"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { VisitPlanItem } from "@/lib/api";
import { ChevronRight, Target, Navigation2 } from "lucide-react";
import clsx from "clsx";

interface PlanListProps {
  visits: VisitPlanItem[];
}

export function PlanList({ visits }: PlanListProps) {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  if (visits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
        <Target className="w-12 h-12 mb-4 opacity-20" />
        <p>No high-priority visits today.</p>
      </div>
    );
  }

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-4 pb-24"
    >
      {visits.map((visit, index) => {
        // Map score 0-1 to a color urgency
        const isUrgent = visit.score > 0.8;
        const isHigh = visit.score > 0.6 && !isUrgent;
        
        return (
          <motion.div key={visit.retailer_id} variants={item}>
            <Link href={`/visit/${visit.retailer_id}`}>
              <div className="group relative bg-neutral-900 border border-neutral-800 rounded-2xl p-5 hover:border-emerald-500/30 transition-all overflow-hidden">
                
                {/* Number indicator */}
                <div className="absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b from-emerald-400 to-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-neutral-100 group-hover:text-emerald-50 transition-colors">
                      {visit.retailer_id}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Navigation2 className="w-3 h-3 text-neutral-500" />
                      <span className="text-xs text-neutral-500">{visit.district} • {visit.tehsil.split('_')[1]}</span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end">
                    <div className={clsx(
                      "px-2.5 py-1 rounded-full text-xs font-bold font-mono border",
                      isUrgent ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                      isHigh ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                      "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    )}>
                      {(visit.score * 100).toFixed(1)}
                    </div>
                  </div>
                </div>

                <div className="bg-neutral-800/50 rounded-xl p-3 flex items-start gap-3 mt-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-emerald-400 tracking-wide uppercase mb-0.5">
                      Pitch: {visit.recommended_sku}
                    </p>
                    <p className="text-sm text-neutral-300 line-clamp-2">
                      {visit.one_line_why}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-neutral-600 mt-1" />
                </div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
