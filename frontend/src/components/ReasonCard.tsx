"use client";

import { motion } from "framer-motion";
import { ReasonFact } from "@/lib/api";
import { TrendingUp, TrendingDown, Info, Package, Sprout, Calendar, Clock } from "lucide-react";
import clsx from "clsx";

interface ReasonCardProps {
  reasons: ReasonFact[];
}

export function ReasonCard({ reasons }: ReasonCardProps) {
  const getIcon = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes("stock") || l.includes("inventory")) return Package;
    if (l.includes("stage") || l.includes("crop")) return Sprout;
    if (l.includes("velocity") || l.includes("trend")) return TrendingUp;
    if (l.includes("visit") || l.includes("recency")) return Calendar;
    return Info;
  };

  const getDirectionColor = (direction: string) => {
    switch (direction) {
      case "positive": return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
      case "negative": return "text-rose-400 bg-rose-400/10 border-rose-400/20";
      default: return "text-blue-400 bg-blue-400/10 border-blue-400/20";
    }
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const item = {
    hidden: { opacity: 0, x: -10 },
    show: { opacity: 1, x: 0 }
  };

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-3"
    >
      <h3 className="text-sm font-semibold tracking-wider text-neutral-400 uppercase mb-4">Why This matters</h3>
      
      {reasons.map((reason, idx) => {
        const Icon = getIcon(reason.label);
        const colorClass = getDirectionColor(reason.direction);
        
        return (
          <motion.div 
            key={idx}
            variants={item}
            className="group relative overflow-hidden rounded-xl bg-neutral-800/50 border border-neutral-700/50 p-4 transition-all hover:bg-neutral-800"
          >
            <div className="flex items-start gap-4">
              <div className={clsx("p-2 rounded-lg border", colorClass)}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between items-start">
                  <h4 className="font-medium text-neutral-200">{reason.label}</h4>
                  <span className={clsx("text-xs font-mono px-2 py-0.5 rounded-full", colorClass)}>
                    {reason.contribution > 0 ? "+" : ""}{reason.contribution.toFixed(3)}
                  </span>
                </div>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  {reason.value}
                </p>
              </div>
            </div>
            
            {/* Subtle gradient overlay on hover */}
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/0 to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          </motion.div>
        );
      })}
    </motion.div>
  );
}
