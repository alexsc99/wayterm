import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X, Copy, Check } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, toast.duration ?? 4500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(toast.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />,
    error: <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />,
    info: <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />,
  };

  const borders = {
    success: 'border-emerald-500/30 bg-zinc-900/95 text-emerald-200',
    error: 'border-red-500/30 bg-zinc-900/95 text-red-200',
    warning: 'border-amber-500/30 bg-zinc-900/95 text-amber-200',
    info: 'border-blue-500/30 bg-zinc-900/95 text-blue-200',
  };

  const labels = {
    success: 'Erfolg',
    error: 'Fehler',
    warning: 'Warnung',
    info: 'Hinweis',
  };

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto border rounded-xl p-3 shadow-xl backdrop-blur-md flex items-start justify-between gap-2.5 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200 ${borders[toast.type]}`}
    >
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        {icons[toast.type]}
        <div className="text-xs text-zinc-200 break-words font-sans select-text">
          <span className="font-semibold">{labels[toast.type]}: </span>{toast.message}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-1">
        {toast.type === 'error' && (
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label={copied ? 'Fehlertext kopiert' : 'Fehlertext kopieren'}
            title="Fehlertext kopieren"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Meldung schließen"
          title="Schließen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-8 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
};
