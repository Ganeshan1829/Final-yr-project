import React from 'react';
import { cn } from '../../lib/utils.js';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  className,
}) => (
  <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border', className)}>
    <div>
      <h1 className="text-xl font-semibold text-text-primary tracking-tight">{title}</h1>
      {description && <p className="text-xs text-text-muted mt-1">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
  </div>
);
