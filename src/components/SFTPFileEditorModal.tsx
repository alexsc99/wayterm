import React, { useState, useEffect, useRef } from 'react';
import { FileText, Save, X, Check, AlertCircle, RefreshCw, Copy } from 'lucide-react';

interface SFTPFileEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  filePath: string;
  initialContent: string;
  onSave: (newContent: string) => Promise<void>;
  isSaving?: boolean;
  readOnly?: boolean;
}

export const SFTPFileEditorModal: React.FC<SFTPFileEditorModalProps> = ({
  isOpen,
  onClose,
  fileName,
  filePath,
  initialContent,
  onSave,
  isSaving = false,
  readOnly = false,
}) => {
  const [content, setContent] = useState(initialContent);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setContent(initialContent);
    setHasChanges(false);
    setError(null);
  }, [initialContent, isOpen]);

  // Handle Tab and Cmd+S
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.metaKey && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;

      const newContent = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newContent);
      setHasChanges(true);

      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  const handleSave = async () => {
    if (readOnly || isSaving) return;
    setError(null);
    try {
      await onSave(content);
      setHasChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Speichern fehlgeschlagen: ${msg}`);
    }
  };

  if (!isOpen) return null;

  const lines = content.split('\n');
  const lineCount = lines.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl h-[85vh] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs text-zinc-100 truncate">{fileName}</span>
                {hasChanges && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Geändert
                  </span>
                )}
                {saveSuccess && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Gespeichert
                  </span>
                )}
              </div>
              <div className="text-[11px] font-mono text-zinc-500 truncate max-w-lg">{filePath}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSave}
              disabled={isSaving || readOnly || !hasChanges}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                hasChanges
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
              title="Speichern (⌘S)"
            >
              {isSaving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Speichern</span>
              <span className="text-[10px] opacity-70 font-mono ml-0.5">⌘S</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Schließen (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-4 py-2 bg-red-950/50 border-b border-red-500/30 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Editor Body */}
        <div className="flex-1 flex overflow-hidden bg-zinc-950 relative font-mono text-xs">
          {/* Line Numbers Gutter */}
          <div className="w-12 py-3 px-2 bg-zinc-950 border-r border-zinc-800/80 text-zinc-600 select-none text-right font-mono overflow-hidden">
            {lines.slice(0, 5000).map((_, i) => (
              <div key={i} className="leading-5 h-5 text-[11px]">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Text Area */}
          <textarea
            ref={textareaRef}
            value={content}
            readOnly={readOnly}
            onChange={(e) => {
              setContent(e.target.value);
              setHasChanges(true);
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="flex-1 p-3 bg-transparent text-zinc-200 outline-none resize-none leading-5 font-mono overflow-y-auto whitespace-pre tab-2"
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-zinc-950 border-t border-zinc-800 text-[11px] font-mono text-zinc-500 flex items-center justify-between select-none">
          <div className="flex items-center gap-3">
            <span>{lineCount} Zeilen</span>
            <span>&bull;</span>
            <span>{content.length} Zeichen</span>
            <span>&bull;</span>
            <span>UTF-8</span>
          </div>

          <div className="flex items-center gap-2 text-zinc-400">
            <span>Tab = 2 Leerzeichen</span>
            <span>&bull;</span>
            <span>⌘S zum Speichern</span>
          </div>
        </div>
      </div>
    </div>
  );
};
