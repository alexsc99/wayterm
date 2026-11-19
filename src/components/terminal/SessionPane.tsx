import React from 'react';
import { X, RefreshCw, CopyPlus } from 'lucide-react';
import type { SSHSession } from '../../types';
import { quoteShellPath } from '../../utils/snippets';
import { describeReconnect, type SessionReconnectState } from './model';

interface SessionPaneProps {
  session: SSHSession;
  visible: boolean;
  pane: number;
  highlightBroadcast: boolean;
  style: React.CSSProperties;
  chooser: React.ReactNode;
  reconnectState?: SessionReconnectState;
  /** Element xterm opens into; must stay mounted for the session's lifetime. */
  surfaceRef: (element: HTMLDivElement | null) => void;
  onSurfacePointerDown: () => void;
  onTerminalFocus: () => void;
  onReconnect?: () => void;
  onCancelAutoReconnect?: () => void;
  onDuplicate?: () => void;
  /** Shell-quoted paths of files dropped onto the terminal. */
  onDropPaths: (paths: string[]) => void;
}

/** One session's terminal surface with its disconnect/auto-reconnect banner. */
export const SessionPane: React.FC<SessionPaneProps> = ({
  session,
  visible,
  pane,
  highlightBroadcast,
  style,
  chooser,
  reconnectState,
  surfaceRef,
  onSurfacePointerDown,
  onTerminalFocus,
  onReconnect,
  onCancelAutoReconnect,
  onDuplicate,
  onDropPaths,
}) => (
  <div
    data-session-id={session.id}
    data-pane={visible ? pane + 1 : undefined}
    aria-label={`Terminal ${session.title}`}
    className={`absolute min-w-0 min-h-0 flex flex-col overflow-hidden ${
      highlightBroadcast ? 'ring-1 ring-inset ring-amber-500/50' : ''
    }`}
    style={style}
    onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('[data-terminal-surface]')) onSurfacePointerDown();
    }}
    onFocusCapture={(event) => {
      if ((event.target as HTMLElement).closest('.xterm')) onTerminalFocus();
    }}
  >
    {chooser && <div key="chooser" className="shrink-0">{chooser}</div>}
    {!session.connected && visible && reconnectState && (
      <div className="shrink-0 px-3 py-1.5 bg-amber-950/80 border-b border-amber-800/60 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-amber-200 truncate">
          <RefreshCw className="w-3 h-3 shrink-0 animate-spin" />
          <span className="truncate">
            Verbindung getrennt ({session.title}) – {describeReconnect(reconnectState)}
          </span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {onReconnect && (
            <button
              type="button"
              disabled={reconnectState.phase === 'connecting'}
              onClick={onReconnect}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Jetzt verbinden</span>
            </button>
          )}
          {onCancelAutoReconnect && (
            <button
              type="button"
              onClick={onCancelAutoReconnect}
              className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Abbrechen</span>
            </button>
          )}
        </div>
      </div>
    )}
    {!session.connected && visible && !reconnectState && (
      <div className="shrink-0 px-3 py-1.5 bg-red-950/80 border-b border-red-800/60 flex items-center justify-between gap-2 text-xs">
        <span className="text-red-200 truncate">
          Verbindung getrennt ({session.title})
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Neu verbinden</span>
            </button>
          )}
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors cursor-pointer"
            >
              <CopyPlus className="w-3 h-3" />
              <span>Duplizieren</span>
            </button>
          )}
        </div>
      </div>
    )}
    <div
      key="terminal"
      data-terminal-surface
      ref={surfaceRef}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        const paths = Array.from(files)
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => Boolean(p))
          .map((p) => quoteShellPath(p));
        if (paths.length > 0) {
          onDropPaths(paths);
        }
      }}
      className="flex-1 min-w-0 min-h-0 p-2 overflow-hidden"
    />
  </div>
);
