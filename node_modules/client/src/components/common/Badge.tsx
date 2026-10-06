import React from 'react';
import { cn } from '../../lib/utils.js';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'error' | 'neutral' | 'accent' | 'outline';
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'neutral',
  dot = false,
  children,
  ...props
}) => {
  const variantStyles = {
    success: 'bg-status-success-bg text-status-success border-status-success-border',
    warning: 'bg-status-warning-bg text-status-warning border-status-warning-border',
    error: 'bg-status-error-bg text-status-error border-status-error-border',
    neutral: 'bg-slate-100 text-text-muted border-border',
    accent: 'bg-accent-subtle text-accent border-blue-200',
    outline: 'bg-white text-text-muted border-border',
  };

  const dotColors = {
    success: 'bg-status-success',
    warning: 'bg-status-warning',
    error: 'bg-status-error',
    neutral: 'bg-slate-400',
    accent: 'bg-accent',
    outline: 'bg-slate-400',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border tracking-tight shrink-0',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />}
      {children}
    </span>
  );
};
