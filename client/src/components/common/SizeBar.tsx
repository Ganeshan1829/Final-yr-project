import React from 'react';
import { cn } from '../../lib/utils.js';

export interface SizeBarProps {
  size: number;
  /** soft target: teacher's preferred class size */
  preferred?: number | null;
  /** hard limit: min(teacher max, room capacity) */
  hardCap?: number | null;
  /** advisory ML recommendation */
  ml?: number | null;
  className?: string;
}

/**
 * Class size against its limits: bar colour = within preferred (green) / above preferred but within the hard
 * limit (amber) / above the hard limit (red). Ticks mark preferred (blue) and the ML recommendation (violet).
 */
export const SizeBar: React.FC<SizeBarProps> = ({ size, preferred, hardCap, ml, className }) => {
  const scale = Math.max(size, preferred ?? 0, hardCap ?? 0, ml ?? 0, 1) * 1.08;
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const tone =
    hardCap != null && size > hardCap
      ? 'bg-red-500'
      : preferred != null && size > preferred
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  const label = [
    `${size} students`,
    preferred != null ? `preferred ${preferred}` : null,
    hardCap != null ? `limit ${hardCap}` : null,
    ml != null ? `ML ${Math.round(ml)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={cn('min-w-[120px]', className)} title={label} aria-label={label}>
      <div className="relative h-2.5 rounded-full bg-slate-100 overflow-visible">
        {hardCap != null && <div className="absolute inset-y-0 left-0 rounded-full bg-slate-200" style={{ width: pct(hardCap) }} />}
        <div className={cn('absolute inset-y-0 left-0 rounded-full', tone)} style={{ width: pct(size) }} />
        {preferred != null && <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-blue-600" style={{ left: pct(preferred) }} />}
        {ml != null && <div className="absolute -top-1 w-1.5 h-1.5 rotate-45 bg-violet-600" style={{ left: pct(ml) }} />}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500 tabular-nums">
        <span className="font-semibold text-slate-700">{size}</span>
        <span>{[preferred != null ? `pref ${preferred}` : null, hardCap != null ? `max ${hardCap}` : null].filter(Boolean).join(' · ')}</span>
      </div>
    </div>
  );
};

export const SizeBarLegend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> within preferred</span>
    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> above preferred, within limit</span>
    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> above limit</span>
    <span className="flex items-center gap-1"><span className="w-0.5 h-3 bg-blue-600" /> preferred</span>
    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rotate-45 bg-violet-600" /> ML recommendation (advisory)</span>
  </div>
);
