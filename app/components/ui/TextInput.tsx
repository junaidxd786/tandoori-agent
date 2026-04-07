import React from "react";
import { clsx } from "clsx";

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  className?: string;
  name?: string;
  value?: string;
}

export const TextInput = ({ label, error, className, name, value, ...props }: TextInputProps) => {
  return (
    <div className="space-y-2">
      {label && <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">{label}</label>}
      <input 
        className={clsx(
          "w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-3.5 text-sm font-bold text-white outline-none focus:border-zinc-700 transition-colors placeholder:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-zinc-950/20",
          error && "border-red-600/50 focus:border-red-600",
          className
        )}
        {...props}
      />
      {error && <p className="text-[10px] text-red-500 font-bold ml-1">{error}</p>}
    </div>
  );
};
