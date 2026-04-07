"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Bell, Search, Command, User, 
  ChevronRight, Sparkles, Activity,
  Settings, LogOut
} from "lucide-react";
import { clsx } from "clsx";

const LOGO_URL = process.env.NEXT_PUBLIC_LOGO_URL ?? "";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Restaurant";

export function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Get current page name from pathname
  const getPageTitle = () => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length <= 1) return "Overview";
    const lastPart = parts[parts.length - 1];
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  };

  return (
    <header className={clsx(
      "h-16 flex items-center justify-between px-8 w-full z-40 sticky top-0 transition-all duration-300",
      scrolled ? "bg-black/60 backdrop-blur-xl border-b border-zinc-800/50" : "bg-transparent"
    )}>
      
      {/* Left: Logo + Breadcrumbs */}
      <div className="flex items-center gap-4">
        {/* Restaurant Logo */}
        {LOGO_URL ? (
          <div className="w-9 h-9 rounded-xl overflow-hidden border border-zinc-800 shadow-[0_0_12px_rgba(0,0,0,0.4)] flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOGO_URL}
              alt={`${APP_NAME} logo`}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-9 h-9 rounded-xl bg-brand/10 border border-brand/30 flex items-center justify-center flex-shrink-0">
            <span className="text-brand font-black text-sm">
              {APP_NAME.charAt(0)}
            </span>
          </div>
        )}

        {/* Divider */}
        <div className="w-px h-5 bg-zinc-800" />

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <span>Dashboard</span>
            <ChevronRight size={10} className="text-zinc-700" />
            <span className="text-brand">{getPageTitle()}</span>
        </div>
      </div>

      {/* Right: Global Actions */}
      <div className="flex items-center gap-6">
        
        {/* Search Bar - Aesthetic Only */}
        <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-zinc-900/50 border border-zinc-800/50 rounded-xl group transition-all hover:border-zinc-700">
            <Search size={14} className="text-zinc-500 group-hover:text-zinc-400" />
            <span className="text-xs font-bold text-zinc-600 group-hover:text-zinc-400">Search commands...</span>
            <div className="flex items-center gap-1 ml-4 px-1.5 py-0.5 bg-zinc-800 rounded text-[9px] font-black text-zinc-500">
                <Command size={10} />
                <span>K</span>
            </div>
        </div>

        {/* System Status Pill */}
        <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-default">
            <div className="relative flex items-center justify-center">
                <span className="absolute w-2 h-2 rounded-full bg-brand/40 animate-ping" />
                <span className="w-1.5 h-1.5 rounded-full bg-brand relative z-10 shadow-[0_0_8px_var(--color-brand)]" />
            </div>
            <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest">
                AI Agent Active
            </span>
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-3 pl-4 border-l border-zinc-800">
            <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                <User size={16} />
            </div>
        </div>

      </div>
    </header>
  );
}
