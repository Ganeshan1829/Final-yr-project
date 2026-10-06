import React from 'react';
import { cn } from '../../lib/utils.js';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, icon, children, disabled, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none select-none';

    const sizeStyles = {
      sm: 'text-xs px-2.5 py-1.5 gap-1.5 min-h-[30px]',
      md: 'text-sm px-3.5 py-2 gap-2 min-h-[36px]',
      lg: 'text-sm px-4 py-2.5 gap-2 min-h-[42px]',
    };

    const variantStyles = {
      primary: 'bg-navy text-white hover:bg-navy-light active:bg-navy-dark shadow-sm border border-transparent',
      secondary: 'bg-white text-text-primary border border-border hover:bg-slate-50 active:bg-slate-100 shadow-sm',
      outline: 'bg-transparent text-text-primary border border-border hover:bg-slate-50',
      danger: 'bg-status-error text-white hover:bg-red-700 active:bg-red-800 shadow-sm border border-transparent',
      ghost: 'bg-transparent text-text-muted hover:text-text-primary hover:bg-slate-100',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
