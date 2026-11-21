import React from 'react';
import {
  Search,
  Trash2,
  Palette,
  Settings,
  Zap,
  Download,
  CopyPlus,
  Radio,
  Highlighter,
  ArrowLeftRight,
  Square,
  Columns2,
  Rows2,
  type LucideIcon,
} from 'lucide-react';
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

const LAYOUT_OPTIONS: readonly { value: SplitLayout; label: string; Icon: LucideIcon }[] = [
  { value: 'single', label: 'Einzelansicht', Icon: Square },
  { value: 'columns', label: 'Nebeneinander teilen (⌘D)', Icon: Columns2 },
  { value: 'rows', label: 'Übereinander teilen (⌘⇧D)', Icon: Rows2 },
];

const NEUTRAL_BUTTON = 'p-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1 border border-transparent hover:border-zinc-700/60 cursor-pointer';
const TOGGLE_BUTTON = 'text-xs rounded-lg transition-colors flex items-center gap-1 border cursor-pointer';
const TOGGLE_OFF = 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-zinc-800';
const TOGGLE_ON_ACCENT = 'bg-blue-600/20 text-blue-400 border-blue-500/40';

interface TerminalToolbarProps {
  layout: SplitLayout;
  onChangeLayout: (layout: SplitLayout) => void;
  activeSession: SSHSession | null;
  onOpenSFTPForHost?: (host: SSHHost) => void;
  onSerialBreak: () => void;
  copiedBadgeVisible: boolean;
  syntaxHighlighting: boolean;
  onToggleSyntaxHighlighting: () => void;
  onClearScreen: () => void;
  fontSize: number;
  onFontSizeChange: (updater: number | ((prev: number) => number)) => void;
  isSearchOpen: boolean;
  onOpenSearch: () => void;
  isSplit: boolean;
  broadcastEnabled: boolean;
  onToggleBroadcast: () => void;
  onSwapPanes: () => void;
  onDuplicateSession?: (id: string) => void;
  isSnippetsOpen: boolean;
  onToggleSnippets: () => void;
  onSaveLog: (sessionId: string) => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  onOpenAppearance?: () => void;
}

/** Layout switcher, context actions for the active session and appearance/settings access. */
export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  layout,
  onChangeLayout,
  activeSession,
  onOpenSFTPForHost,
  onSerialBreak,
  copiedBadgeVisible,
  syntaxHighlighting,
  onToggleSyntaxHighlighting,
  onClearScreen,
  fontSize,
  onFontSizeChange,
  isSearchOpen,
  onOpenSearch,
  isSplit,
  broadcastEnabled,
  onToggleBroadcast,
  onSwapPanes,
  onDuplicateSession,
  isSnippetsOpen,
  onToggleSnippets,
  onSaveLog,
  isSettingsOpen,
  onToggleSettings,
  onOpenAppearance,
}) => {
  const syntaxTitle = syntaxHighlighting
    ? 'Live-Syntaxhervorhebung aktiv (Klicken zum Ausschalten)'
    : 'Live-Syntaxhervorhebung einschalten';

  return (
    <div className="shrink-0 min-w-0 flex items-center gap-2 px-2 py-1 bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
      {/* Left: layout switcher */}
      <div role="group" aria-label="Terminal-Layout" className="shrink-0 flex items-center gap-0.5 rounded-lg border border-zinc-800 p-0.5">
        {LAYOUT_OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={layout === value}
            aria-label={label}
            title={label}
            onClick={() => onChangeLayout(value)}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              layout === value ? 'bg-blue-600/20 text-blue-300' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>

      {/* Middle: context actions of the active session */}
      {activeSession && (
        <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-zinc-800">
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

          {/* PuTTY auto-copy feedback badge */}
          {copiedBadgeVisible && (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse">
              ✓ Kopiert
            </span>
          )}

          {/* Live syntax highlighting toggle */}
          <button
            type="button"
            onClick={onToggleSyntaxHighlighting}
            aria-pressed={syntaxHighlighting}
            aria-label={syntaxTitle}
            title={syntaxTitle}
            className={`px-2 py-1 font-medium ${TOGGLE_BUTTON} ${
              syntaxHighlighting ? 'bg-lime-500/15 text-lime-300 border-lime-500/40 hover:bg-lime-500/25' : TOGGLE_OFF
            }`}
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Hervorhebung</span>
          </button>

          {/* Clear screen */}
          <button
            type="button"
            onClick={onClearScreen}
            aria-label="Terminal leeren (⌘K)"
            title="Terminal leeren (⌘K)"
            className={NEUTRAL_BUTTON}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Clear</span>
          </button>

          {/* Font zoom controls */}
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

          {/* Search */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-pressed={isSearchOpen}
            aria-label="Im Terminal suchen (⌘F)"
            title="Im Terminal suchen (⌘F)"
            className={`p-1.5 ${TOGGLE_BUTTON} ${isSearchOpen ? TOGGLE_ON_ACCENT : TOGGLE_OFF}`}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px] text-zinc-400">⌘F</span>
          </button>

          {/* Split-only actions: broadcast input and pane swap */}
          {isSplit && (
            <>
              <button
                type="button"
                onClick={onToggleBroadcast}
                aria-pressed={broadcastEnabled}
                aria-label="Broadcast Input: Eingaben an alle sichtbaren Panes gleichzeitig senden"
                title="Broadcast Input: Eingaben an alle sichtbaren Panes gleichzeitig senden"
                className={`px-2 py-1 ${TOGGLE_BUTTON} ${
                  broadcastEnabled ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : TOGGLE_OFF
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span className="hidden lg:inline text-[11px]">Broadcast</span>
              </button>
              <button
                type="button"
                onClick={onSwapPanes}
                aria-label="Bereiche tauschen"
                title="Bereiche tauschen"
                className={NEUTRAL_BUTTON}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {/* Duplicate session */}
          {onDuplicateSession && (
            <button
              type="button"
              onClick={() => onDuplicateSession(activeSession.id)}
              aria-label="Aktive Sitzung duplizieren"
              title="Aktive Sitzung duplizieren"
              className={NEUTRAL_BUTTON}
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
            aria-pressed={isSnippetsOpen}
            aria-label="Schnellbefehle (Snippets)"
            title="Schnellbefehle (Snippets)"
            className={`p-1.5 ${TOGGLE_BUTTON} ${isSnippetsOpen ? TOGGLE_ON_ACCENT : TOGGLE_OFF}`}
          >
            <Zap className="w-3.5 h-3.5" />
          </button>

          {/* Save log */}
          <button
            type="button"
            onClick={() => onSaveLog(activeSession.id)}
            aria-label="Terminal-Verlauf als Log-Datei speichern"
            title="Terminal-Verlauf als Log-Datei speichern"
            className={NEUTRAL_BUTTON}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Right: appearance (always available) and session-bound terminal settings */}
      {(onOpenAppearance || activeSession) && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {onOpenAppearance && (
            <button
              type="button"
              onClick={onOpenAppearance}
              aria-label="Erscheinungsbild & Themes (⌘,)"
              title="Erscheinungsbild & Themes (⌘,)"
              className={NEUTRAL_BUTTON}
            >
              <Palette className="w-3.5 h-3.5" />
            </button>
          )}
          {activeSession && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSettings();
              }}
              aria-pressed={isSettingsOpen}
              aria-label="Terminal-Einstellungen"
              title="Terminal-Einstellungen"
              className={`p-1.5 ${TOGGLE_BUTTON} ${isSettingsOpen ? TOGGLE_ON_ACCENT : TOGGLE_OFF}`}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
