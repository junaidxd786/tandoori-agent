import React from "react";
import { clsx } from "clsx";

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "warning";
}

export const Badge = ({ children, className, variant = "primary" }: BadgeProps) => {
  const variants = {
    primary: "bg-brand/10 text-brand border-brand/20",
    secondary: "bg-zinc-800 text-zinc-300 border-zinc-700/50",
    outline: "bg-transparent border border-zinc-800 text-zinc-400 font-black",
    ghost: "bg-transparent text-zinc-500 hover:text-zinc-300 transition-colors uppercase",
    danger: "bg-red-500/10 text-red-400 border-red-500/20 shadow-lg shadow-red-950/20 uppercase font-black",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-lg shadow-amber-950/20 font-black"
  };

  return (
    <span className={clsx("px-2.5 py-1 rounded-md text-[9px] font-black tracking-widest border transition-all", variants[variant], className)}>
      {children}
    </span>
  );
};
