import React, { useEffect } from 'react';
import { Button } from './Button.js';
import { AlertTriangle, X } from 'lucide-react';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
  isLoading = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isLoading]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-200"
        onClick={() => !isLoading && onClose()}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl border border-border p-6 z-10 animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-3.5">
          {isDestructive && (
            <div className="w-9 h-9 rounded-full bg-status-error-bg border border-status-error-border flex items-center justify-center shrink-0 text-status-error">
              <AlertTriangle className="w-5 h-5" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-text-primary">{title}</h3>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            variant={isDestructive ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};
