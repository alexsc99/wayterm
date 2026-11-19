import React from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';

interface TerminalSearchOverlayProps {
  inputRef: React.RefObject<HTMLInputElement>;
  query: string;
  caseSensitive: boolean;
  matchWholeWord: boolean;
  onQueryChange: (query: string) => void;
  onClearQuery: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onClose: () => void;
}

/** In-Terminal Search Overlay (⌘F). */
export const TerminalSearchOverlay: React.FC<TerminalSearchOverlayProps> = ({
  inputRef,
  query,
  caseSensitive,
  matchWholeWord,
  onQueryChange,
  onClearQuery,
  onFindNext,
  onFindPrevious,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onClose,
}) => (
  <div className="absolute top-3 right-2 z-40 max-w-full overflow-x-auto bg-zinc-900/95 border border-zinc-700 rounded-xl p-2 shadow-2xl flex items-center gap-1.5 text-xs backdrop-blur-sm">
    {/* Input field with clear button */}
    <div className="relative flex items-center">
      <input
        ref={inputRef}
        type="text"
        aria-label="Im aktiven Terminal suchen"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
              onFindPrevious();
            } else {
              onFindNext();
            }
          }
        }}
        placeholder="Im Terminal suchen..."
        className="bg-zinc-950 border border-zinc-700 focus:border-blue-500 rounded-lg px-2.5 py-1 pr-6 text-zinc-100 placeholder-zinc-500 outline-none w-48 text-xs font-mono"
      />
      {query && (
        <button
          type="button"
          onClick={onClearQuery}
          className="absolute right-1.5 text-zinc-500 hover:text-zinc-300 p-0.5 rounded cursor-pointer"
          title="Löschen"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>

    {/* Prev (ArrowUp / ChevronUp) */}
    <button
      type="button"
      onClick={() => onFindPrevious()}
      className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
      title="Vorheriges Ergebnis (Shift+Enter)"
    >
      <ChevronUp className="w-4 h-4" />
    </button>

    {/* Next (ArrowDown / ChevronDown) */}
    <button
      type="button"
      onClick={() => onFindNext()}
      className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
      title="Nächstes Ergebnis (Enter)"
    >
      <ChevronDown className="w-4 h-4" />
    </button>

    {/* Case toggle Aa */}
    <button
      type="button"
      onClick={onToggleCaseSensitive}
      className={`px-1.5 py-0.5 rounded font-mono font-medium text-[11px] transition-colors border cursor-pointer ${
        caseSensitive
          ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800'
      }`}
      title="Groß-/Kleinschreibung beachten (Aa)"
    >
      Aa
    </button>

    {/* Whole-word toggle \b */}
    <button
      type="button"
      onClick={onToggleWholeWord}
      className={`px-1.5 py-0.5 rounded font-mono font-medium text-[11px] transition-colors border cursor-pointer ${
        matchWholeWord
          ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800'
      }`}
      title="Nur ganzes Wort beachten (\b)"
    >
      \b
    </button>

    <div className="w-px h-4 bg-zinc-800 mx-0.5" />

    {/* Close X */}
    <button
      type="button"
      onClick={onClose}
      className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
      title="Schließen (Escape)"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
);
