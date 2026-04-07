import React from "react";
import { clsx } from "clsx";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  asChild?: boolean;
}

export const Button = ({ children, variant = "primary", size = "md", className, ...props }: ButtonProps) => {
  const variants = {
    primary: "bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/10 active:scale-95",
    secondary: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 shadow-xl active:scale-95",
    outline: "bg-transparent border border-zinc-700 text-zinc-300 hover:bg-zinc-800 active:scale-95",
    ghost: "bg-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 active:scale-95",
    danger: "bg-red-600/90 hover:bg-red-600 text-white shadow-lg shadow-red-950/20 active:scale-95"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-[10px] uppercase tracking-widest font-black rounded-lg",
    md: "px-5 py-2.5 text-xs uppercase tracking-widest font-black rounded-xl",
    lg: "px-8 py-4 text-sm uppercase tracking-[0.15em] font-black rounded-2xl",
    icon: "p-2 rounded-xl"
  };

  return (
    <button className={clsx("flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed", variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
};
