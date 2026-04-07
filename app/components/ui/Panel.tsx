import React from "react";
import { clsx } from "clsx";

interface PanelProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
  footer?: React.ReactNode;
}

export const Panel = ({ children, title, description, className, footer }: PanelProps) => {
  return (
    <div className={clsx("bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden", className)}>
      {(title || description) && (
        <div className="p-4 border-b border-zinc-800/50">
          {title && <h3 className="text-sm font-bold text-white">{title}</h3>}
          {description && <p className="text-[10px] text-zinc-500 font-medium mt-0.5">{description}</p>}
        </div>
      )}
      <div className="p-4">{children}</div>
      {footer && <div className="p-4 bg-zinc-950 border-t border-zinc-800/50">{footer}</div>}
    </div>
  );
};
