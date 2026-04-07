import React from "react";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  className?: string;
  options: { value: string; label: string }[] | string[];
  name?: string;
  value?: string;
}

export const Select = ({ label, error, className, options, name, value, ...props }: SelectProps) => {
  return (
    <div className="space-y-2 relative">
      {label && <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{label}</label>}
      <div className="relative">
        <select 
          className={clsx(
            "w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-3.5 text-sm font-bold text-white outline-none focus:border-zinc-700 transition-colors appearance-none cursor-pointer shadow-xl shadow-zinc-950/20",
            error && "border-red-600/50 focus:border-red-600",
            className
          )}
          {...props}
        >
          {options.map((opt) => {
            const val = typeof opt === "string" ? opt : opt.value;
            const lbl = typeof opt === "string" ? opt : opt.label;
            return (
              <option key={val} value={val} className="bg-zinc-950 text-white">
                {lbl}
              </option>
            );
          })}
        </select>
        <ChevronDown size={16} className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
      </div>
      {error && <p className="text-[10px] text-red-500 font-bold ml-1">{error}</p>}
    </div>
  );
};
