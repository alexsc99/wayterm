import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface MultilinePasteModalProps {
  text: string;
  onConfirm: (disableWarning: boolean) => void;
  onCancel: () => void;
}

export const MultilinePasteModal: React.FC<MultilinePasteModalProps> = ({
  text,
  onConfirm,
  onCancel,
}) => {
  const [disableWarning, setDisableWarning] = useState(false);
  const lines = text.split(/\r?\n/);
  const preview = lines.slice(0, 8).join('\n');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mehrzeiligen Text einfügen"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Mehrzeiligen Text einfügen?
              </h3>
              <p className="text-xs text-zinc-400">
                Die Zwischenablage enthält {lines.length} Zeilen. Zeilenumbrüche können Befehle sofort ausführen.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <pre className="max-h-44 overflow-auto bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all">
          {preview}
          {lines.length > 8 ? `\n… (+${lines.length - 8} weitere Zeilen)` : ''}
        </pre>

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={disableWarning}
              onChange={(e) => setDisableWarning(e.target.checked)}
              className="accent-blue-500"
            />
            Warnung künftig deaktivieren
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 border border-zinc-700"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => onConfirm(disableWarning)}
              autoFocus
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white"
            >
              Trotzdem einfügen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
