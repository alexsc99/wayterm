import React from 'react';
import { Search, Trash2, Palette, Settings, Zap, Download, CopyPlus, Radio } from 'lucide-react';
import type { SSHHost, SSHSession, SerialConfig } from '../../types';
import type { SplitLayout } from './model';

const getSerialBadgeText = (config?: SerialConfig) => {
  if (!config) return 'Serial';
  const baud = config.baudRate || 115200;
  const data = config.dataBits ?? 8;
  const parity = (config.parity ? config.parity[0].toUpperCase() : 'N');
  const stop = config.stopBits ?? 1;
  return `${baud} ${data}${parity}${stop}`;
};

interface TerminalToolbarProps {
  layout: SplitLayout;
  onChangeLayout: (layout: SplitLayout) => void;
  activeSession: SSHSession | null;
  onOpenSFTPForHost?: (host: SSHHost) => void;
  onSerialBreak: () => void;
  copiedBadgeVisible: boolean;
  vividColorsEnabled: boolean;
  onToggleVividColors: () => void;
  onClearScreen: () => void;
  fontSize: number;
  onFontSizeChange: (updater: number | ((prev: number) => number)) => void;
  isSearchOpen: boolean;
  onOpenSearch: () => void;
  isSplit: boolean;
  broadcastEnabled: boolean;
  onToggleBroadcast: () => void;
  onDuplicateSession?: (id: string) => void;
  isSnippetsOpen: boolean;
  onToggleSnippets: () => void;
  onSaveLog: (sessionId: string) => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
}

/** Layout selector and context actions for the active session. */
export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  layout,
  onChangeLayout,
  activeSession,
  onOpenSFTPForHost,
  onSerialBreak,
  copiedBadgeVisible,
  vividColorsEnabled,
  onToggleVividColors,
  onClearScreen,
  fontSize,
  onFontSizeChange,
  isSearchOpen,
  onOpenSearch,
  isSplit,
  broadcastEnabled,
  onToggleBroadcast,
  onDuplicateSession,
  isSnippetsOpen,
  onToggleSnippets,
  onSaveLog,
  isSettingsOpen,
  onToggleSettings,
}) => (
  <div className="shrink-0 min-w-0 flex items-center gap-2 px-2 py-1 bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
    <label htmlFor="terminal-layout" className="text-xs text-zinc-400 shrink-0">Layout</label>
    <select id="terminal-layout" aria-label="Terminal-Layout" value={layout} onChange={(event) => onChangeLayout(event.target.value as SplitLayout)} className="shrink-0 text-xs bg-zinc-800 text-zinc-200 rounded px-2 py-1">
      <option value="single">Einzelansicht</option>
      <option value="columns">Nebeneinander</option>
      <option value="rows">Übereinander</option>
    </select>
    {/* Right: Context Actions Toolbar */}
    {activeSession && (
      <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-zinc-800">
        {/* If active session is SSH and onOpenSFTPForHost */}
        {activeSession.type === 'ssh' && activeSession.host && onOpenSFTPForHost && (
          <button
            type="button"
            onClick={() => onOpenSFTPForHost(activeSession.host!)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg transition-colors cursor-pointer"
            title="SFTP Dateimanager für diesen Host öffnen"
          >
            <span>⇄ SFTP</span>
          </button>
        )}

        {/* If active session is Serial */}
        {activeSession.type === 'serial' && (
          <div className="flex items-center gap-1.5">
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30 select-text"
              title="Serielle Schnittstellenkonfiguration"
            >
              {getSerialBadgeText(activeSession.serialConfig)}
            </span>
            <button
              type="button"
              onClick={onSerialBreak}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
              title="Break-Signal an serielle Konsole senden (Ctrl+C / 0x03)"
            >
              <span>⚡ Break</span>
            </button>
          </div>
        )}

        {/* PuTTY Auto-Copy Feedback Badge */}
        {copiedBadgeVisible && (
          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse">
            ✓ Kopiert
          </span>
        )}

        {/* Colour theme & live syntax highlighting toggle */}
        <button
          type="button"
          onClick={onToggleVividColors}
          className={`px-2 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 border cursor-pointer ${
            vividColorsEnabled
              ? 'bg-lime-500/15 text-lime-300 border-lime-500/40 hover:bg-lime-500/25'
              : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800'
          }`}
          title={
            vividColorsEnabled
              ? 'Syntax-Farben & Live-Hervorhebung aktiv (Klicken zum Ausschalten)'
              : 'Syntax-Farben & Live-Hervorhebung einschalten'
          }
        >
          <Palette className="w-3.5 h-3.5" />
          <span className="hidden lg:inline text-[11px]">Syntax-Farben</span>
        </button>

        {/* Clear Screen */}
        <button
          type="button"
          onClick={onClearScreen}
          className="p-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1 border border-transparent hover:border-zinc-700/60 cursor-pointer"
          title="Terminal leeren (⌘K)"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden xl:inline text-[11px]">Clear</span>
        </button>

        {/* Font Zoom Controls */}
        <div className="flex items-center bg-zinc-800/60 rounded-lg p-0.5 border border-zinc-700/60 text-xs text-zinc-400">
          <button
            type="button"
            onClick={() => onFontSizeChange((prev) => Math.max(10, prev - 1))}
            disabled={fontSize <= 10}
            className="px-1.5 py-0.5 hover:text-zinc-100 hover:bg-zinc-700/60 rounded disabled:opacity-30 transition-colors cursor-pointer"
            title="Schrift verkleinern (⌘-)"
          >
            A-
          </button>
          <button
            type="button"
            onClick={() => onFontSizeChange(13)}
            className="px-1.5 py-0.5 font-mono text-[11px] hover:text-zinc-100 hover:bg-zinc-700/60 rounded transition-colors cursor-pointer"
            title="Schriftgröße zurücksetzen auf Standard (⌘0)"
          >
            {fontSize === 13 ? '100%' : `${Math.round((fontSize / 13) * 100)}%`}
          </button>
          <button
            type="button"
            onClick={() => onFontSizeChange((prev) => Math.min(24, prev + 1))}
            disabled={fontSize >= 24}
            className="px-1.5 py-0.5 hover:text-zinc-100 hover:bg-zinc-700/60 rounded disabled:opacity-30 transition-colors cursor-pointer"
            title="Schrift vergrößern (⌘+)"
          >
            A+
          </button>
        </div>

        {/* Search Button */}
        <button
          type="button"
          onClick={onOpenSearch}
          className={`p-1.5 text-xs rounded-lg transition-colors flex items-center gap-1 border cursor-pointer ${
            isSearchOpen
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
              : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800'
          }`}
          title="Im Terminal suchen (⌘F)"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden xl:inline text-[11px] text-zinc-400">⌘F</span>
        </button>

        {/* Broadcast Input Toggle (only in Split View) */}
        {isSplit && (
          <button
            type="button"
            onClick={onToggleBroadcast}
            className={`px-2 py-1 text-xs rounded-lg transition-colors flex items-center gap-1 border cursor-pointer ${
              broadcastEnabled
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800'
            }`}
            title="Broadcast Input: Eingaben an alle sichtbaren Panes gleichzeitig senden"
          >
            <Radio className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Broadcast</span>
          </button>
        )}

        {/* Duplicate Session */}
        {onDuplicateSession && (
          <button
            type="button"
            onClick={() => onDuplicateSession(activeSession.id)}
            className="p-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-zinc-700/60 cursor-pointer"
            title="Aktive Sitzung duplizieren"
          >
            <CopyPlus className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Snippets */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSnippets();
          }}
          className={`p-1.5 text-xs rounded-lg transition-colors flex items-center gap-1 border cursor-pointer ${
            isSnippetsOpen
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
              : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800'
          }`}
          title="Schnellbefehle (Snippets)"
        >
          <Zap className="w-3.5 h-3.5" />
        </button>

        {/* Save Log */}
        <button
          type="button"
          onClick={() => onSaveLog(activeSession.id)}
          className="p-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-zinc-700/60 cursor-pointer"
          title="Terminal-Verlauf als Log-Datei speichern"
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        {/* Terminal Settings */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSettings();
          }}
          className={`p-1.5 text-xs rounded-lg transition-colors flex items-center gap-1 border cursor-pointer ${
            isSettingsOpen
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
              : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800'
          }`}
          title="Terminal-Einstellungen"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    )}
  </div>
);
