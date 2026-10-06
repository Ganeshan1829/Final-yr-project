import React from 'react';
import { cn } from '../../lib/utils.js';

export interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  helperText?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required,
  error,
  helperText,
  className,
  children,
}) => (
  <div className={cn('space-y-1.5', className)}>
    <div className="flex items-center justify-between">
      <label className="text-xs font-semibold text-text-primary flex items-center gap-1">
        {label}
        {required && <span className="text-status-error">*</span>}
      </label>
    </div>
    {children}
    {error ? (
      <p className="text-[11px] text-status-error font-medium">{error}</p>
    ) : helperText ? (
      <p className="text-[11px] text-text-muted">{helperText}</p>
    ) : null}
  </div>
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, hasError, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full px-3 py-1.5 text-xs bg-white border rounded text-text-primary placeholder:text-text-muted/60 transition-colors',
        'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
        hasError ? 'border-status-error focus:ring-status-error focus:border-status-error' : 'border-border hover:border-slate-400',
        'disabled:bg-slate-50 disabled:text-text-muted disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, hasError, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full px-3 py-1.5 text-xs bg-white border rounded text-text-primary transition-colors',
        'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
        hasError ? 'border-status-error focus:ring-status-error focus:border-status-error' : 'border-border hover:border-slate-400',
        'disabled:bg-slate-50 disabled:text-text-muted disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';
