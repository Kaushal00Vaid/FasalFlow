"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, AlertTriangle, CheckSquare, Sprout } from "lucide-react";
import { motion } from "framer-motion";

export function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: "/plan", icon: Home, label: "Morning Brief" },
    { href: "/anomalies", icon: AlertTriangle, label: "Alerts" },
    { href: "/sync", icon: CheckSquare, label: "Data Sync" },
  ];

  return (
    <>
      {/* Mobile Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-neutral-900/90 backdrop-blur-md border-t border-neutral-800 pb-safe">
        <div className="flex justify-around items-center h-16 px-4">
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
                    layoutId="mobile-nav-indicator"
                    className="absolute top-0 w-8 h-1 bg-emerald-400 rounded-b-full"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon className="w-6 h-6 mb-1" />
                <span className="text-[10px] font-medium tracking-wide uppercase truncate w-full text-center">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop Sidebar */}
      <nav className="hidden md:flex flex-col fixed top-0 left-0 bottom-0 w-64 z-50 bg-neutral-900 border-r border-neutral-800">
        <div className="p-6 mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/20 p-2 rounded-lg border border-emerald-500/30">
              <Sprout className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold text-emerald-50 tracking-tight font-outfit">FasalFlow</h1>
          </div>
        </div>

        <div className="flex-1 px-4 space-y-2">
          {links.map((link) => {
            const isActive = pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive ? "bg-emerald-500/10 text-emerald-400 font-medium" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-emerald-400" : "text-neutral-500"}`} />
                <span className="text-sm tracking-wide">{link.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="desktop-nav-indicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-emerald-400 rounded-r-full"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        <div className="p-6 border-t border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-semibold border border-emerald-500/30 flex-shrink-0">
              R1
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-neutral-200 truncate">REP_0001</p>
              <p className="text-xs text-neutral-500 truncate">Syngenta Field Force</p>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
