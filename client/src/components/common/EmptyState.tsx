import React from 'react';
import { cn } from '../../lib/utils.js';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => (
  <div
    className={cn(
      'py-12 px-6 flex flex-col items-center justify-center text-center bg-white border border-dashed border-border rounded-lg',
      className
    )}
  >
    {icon && (
      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-text-muted mb-3">
        {icon}
      </div>
    )}
    <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
    <p className="text-xs text-text-muted mt-1 max-w-sm leading-relaxed">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);
