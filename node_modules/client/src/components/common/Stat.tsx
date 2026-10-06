import React from 'react';
import { cn } from '../../lib/utils.js';

export interface StatProps {
  label: string;
  value: React.ReactNode;
  subtext?: string;
  icon?: React.ReactNode;
  trend?: {
    value: string;
    isPositive?: boolean;
  };
  className?: string;
}

export const Stat: React.FC<StatProps> = ({ label, value, subtext, icon, className }) => (
  <div className={cn('bg-white border border-border rounded-lg p-4 flex items-center justify-between', className)}>
    <div>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <div className="mt-1 text-2xl font-semibold text-text-primary tabular-nums tracking-tight">
        {value}
      </div>
      {subtext && <p className="text-[11px] text-text-muted mt-0.5">{subtext}</p>}
    </div>
    {icon && (
      <div className="w-10 h-10 rounded bg-slate-50 border border-border flex items-center justify-center text-text-muted shrink-0">
        {icon}
      </div>
    )}
  </div>
);
