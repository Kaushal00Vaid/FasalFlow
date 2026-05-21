"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, AlertTriangle, CheckSquare } from "lucide-react";
import { motion } from "framer-motion";

export function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: "/plan", icon: Home, label: "Plan" },
    { href: "/anomalies", icon: AlertTriangle, label: "Alerts" },
    { href: "/sync", icon: CheckSquare, label: "Sync" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-neutral-900/90 backdrop-blur-md border-t border-neutral-800 pb-safe">
      <div className="flex justify-around items-center h-16 max-w-md mx-auto px-4">
        {links.map((link) => {
          const isActive = pathname.startsWith(link.href);
          const Icon = link.icon;
          
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex flex-col items-center justify-center w-16 h-full transition-colors ${
                isActive ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute top-0 w-8 h-1 bg-emerald-400 rounded-b-full"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <Icon className="w-6 h-6 mb-1" />
              <span className="text-[10px] font-medium tracking-wide uppercase">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
