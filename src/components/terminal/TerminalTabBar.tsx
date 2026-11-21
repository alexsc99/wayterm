import React, { useEffect, useRef } from 'react';
import { Laptop, Server, Cable, X, Plus, ChevronDown, Pencil, RefreshCw } from 'lucide-react';
import type { SSHSession } from '../../types';
import { describeReconnect, type PaneSessions, type SessionReconnectState } from './model';

interface TerminalTabBarProps {
  sessions: SSHSession[];
  activeSessionId: string | null;
  /** Sessions shown in the two split panes; null when the view is not split. */
  splitPanes: PaneSessions | null;
  bellSessionIds: Set<string>;
  activitySessionIds: Set<string>;
  reconnectStates: Record<string, SessionReconnectState>;
  renamingId: string | null;
  renameValue: string;
  renameError: boolean;
  renameInputRef: React.RefObject<HTMLInputElement>;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onBeginRename: (session: SSHSession) => void;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  isMenuOpen: boolean;
  onMenuButtonClick: (anchor: HTMLElement) => void;
}

/** Session tabs with status dot, split-pane badge, inline rename and the "new session" menu button. */
export const TerminalTabBar: React.FC<TerminalTabBarProps> = ({
  sessions,
  activeSessionId,
  splitPanes,
  bellSessionIds,
  activitySessionIds,
  reconnectStates,
  renamingId,
  renameValue,
  renameError,
  renameInputRef,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onBeginRename,
  onSelectSession,
  onCloseSession,
  isMenuOpen,
  onMenuButtonClick,
}) => {
  const activeTabRef = useRef<HTMLDivElement | null>(null);

  // Keep the active tab reachable when the tab strip overflows.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeSessionId]);

  return (
    <div className="h-11 shrink-0 min-w-0 bg-zinc-900 border-b border-zinc-800 flex items-center px-2 gap-2">
      <div role="tablist" aria-label="Terminal-Sitzungen" className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const hasBell = !isActive && bellSessionIds.has(session.id);
          const hasActivity = !isActive && activitySessionIds.has(session.id);
          const reconnect = reconnectStates[session.id];
          const paneIndex = splitPanes ? splitPanes.indexOf(session.id) : -1;
          const tabTone = isActive
            ? 'bg-zinc-950 border-zinc-700 text-blue-400 shadow-[inset_0_-2px_0_0_rgb(var(--c-blue-500))]'
            : `${paneIndex >= 0 ? 'border-zinc-700' : 'border-transparent'} text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60`;
          return (
            <div
              key={session.id}
              ref={isActive ? activeTabRef : undefined}
              className={`group shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors ${tabTone}`}
              onMouseDown={(event) => {
                // Suppress the middle-button autoscroll so the click can close the tab.
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onCloseSession(session.id);
              }}
            >
              {session.type === 'local' ? <Laptop className="w-3.5 h-3.5" /> : session.type === 'serial' ? <Cable className="w-3.5 h-3.5 text-amber-400" /> : <Server className="w-3.5 h-3.5" />}
              {reconnect ? (
                <span title={`Verbinde neu … ${describeReconnect(reconnect)}`} aria-label="Verbinde neu" className="flex">
                  <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                </span>
              ) : (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    !session.connected
                      ? 'bg-red-500'
                      : hasBell
                        ? 'bg-amber-400 animate-ping'
                        : hasActivity
                          ? 'bg-sky-400 animate-pulse'
                          : 'bg-emerald-500'
                  }`}
                  title={hasBell ? 'Signalton (Bell)' : hasActivity ? 'Neue Ausgabe' : session.connected ? 'Verbunden' : 'Getrennt'}
                />
              )}
              {renamingId === session.id ? (
                <input
                  ref={renameInputRef}
                  aria-label="Sitzung umbenennen"
                  aria-invalid={renameError}
                  title={renameError ? 'Bitte einen nicht leeren Namen eingeben' : 'Enter: Speichern · Escape: Abbrechen'}
                  className={`w-40 text-xs text-zinc-100 bg-zinc-950 rounded border px-1 py-0.5 outline-none ${renameError ? 'border-red-500' : 'border-blue-500'}`}
                  value={renameValue}
                  onChange={(event) => onRenameValueChange(event.target.value)}
                  onBlur={onCancelRename}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') { event.preventDefault(); onCommitRename(); }
                    if (event.key === 'Escape') { event.preventDefault(); onCancelRename(); }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Sitzung ${session.title}`}
                  title={`${session.title} · Doppelklick zum Umbenennen`}
                  onClick={() => onSelectSession(session.id)}
                  onDoubleClick={() => onBeginRename(session)}
                  className="max-w-[160px] truncate text-xs py-1 text-left cursor-pointer"
                >{session.title}</button>
              )}
              {paneIndex >= 0 && (
                <span
                  title={`In Bereich ${paneIndex + 1} sichtbar`}
                  className="shrink-0 text-[10px] leading-4 font-medium px-1 rounded bg-blue-600/20 text-blue-300"
                >{paneIndex + 1}</span>
              )}
              <button
                type="button"
                aria-label={`Sitzung ${session.title} umbenennen`}
                title="Sitzung umbenennen"
                onClick={() => onBeginRename(session)}
                className={`p-1 rounded hover:bg-zinc-700 transition-opacity cursor-pointer ${
                  isActive ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                }`}
              ><Pencil className="w-3 h-3" /></button>
              <button
                type="button"
                aria-label={`Sitzung ${session.title} schließen`}
                title="Tab schließen (⌘W)"
                onClick={() => onCloseSession(session.id)}
                className="p-1 rounded hover:bg-zinc-700 cursor-pointer"
              ><X className="w-3 h-3" /></button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="Neue Sitzung"
        title="Neue Sitzung öffnen"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        onClick={(event) => onMenuButtonClick(event.currentTarget)}
        className="shrink-0 flex items-center gap-1 p-2 rounded text-zinc-200 hover:bg-zinc-800 cursor-pointer"
      ><Plus className="w-4 h-4" /><ChevronDown className="w-3 h-3" /></button>
    </div>
  );
};
