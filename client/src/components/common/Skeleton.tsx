import React from 'react';
import { cn } from '../../lib/utils.js';

export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('animate-pulse rounded bg-slate-200/80', className)} {...props} />
);
