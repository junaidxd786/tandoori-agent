import React from "react";
import { clsx } from "clsx";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: "glass" | "solid" | "outline";
}

export const Card = ({ children, className, variant = "glass" }: CardProps) => {
  const variants = {
    glass: "bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 shadow-2xl",
    solid: "bg-zinc-900 border border-zinc-800 shadow-xl",
    outline: "bg-transparent border border-zinc-800/50"
  };

  return (
    <div className={clsx("rounded-3xl p-6 transition-all duration-300", variants[variant], className)}>
      {children}
    </div>
  );
};
