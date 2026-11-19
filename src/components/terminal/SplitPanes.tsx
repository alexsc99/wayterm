import React from 'react';
import { Terminal as TermIcon, Plus } from 'lucide-react';
import type { SSHSession } from '../../types';
import type { Pane, SplitLayout } from './model';

interface PaneChooserProps {
  pane: Pane;
  sessionId: string | null;
  isFocused: boolean;
  sessions: SSHSession[];
  onFocusChooser: (sessionId: string | null) => void;
  onChooseSession: (pane: Pane, sessionId: string) => void;
  onOpenSessionMenu: (anchor: HTMLElement, pane: Pane) => void;
}

/** Per-pane session selector shown above each split pane. */
export const PaneChooser: React.FC<PaneChooserProps> = ({
  pane,
  sessionId,
  isFocused,
  sessions,
  onFocusChooser,
  onChooseSession,
  onOpenSessionMenu,
}) => (
  <div className={`h-10 shrink-0 min-w-0 flex items-center gap-1 px-2 border-b ${isFocused ? 'border-blue-500 bg-blue-950/30' : 'border-zinc-800 bg-zinc-900'}`}>
    <label className="sr-only" htmlFor={`terminal-pane-${pane}`}>Bereich {pane + 1}: Sitzung auswählen</label>
    <select
      id={`terminal-pane-${pane}`}
      aria-label={`Bereich ${pane + 1}: Sitzung auswählen`}
      className="min-w-0 flex-1 bg-zinc-900 text-zinc-200 text-xs rounded px-1 py-1"
      value={sessionId || ''}
      onFocus={() => onFocusChooser(sessionId)}
      onChange={(event) => onChooseSession(pane, event.target.value)}
    >
      <option value="" disabled>Sitzung auswählen …</option>
      {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
    </select>
    <button
      type="button"
      aria-label={`Neue Sitzung in Bereich ${pane + 1}`}
      title={`Neue Sitzung in Bereich ${pane + 1}`}
      aria-haspopup="menu"
      onClick={(event) => onOpenSessionMenu(event.currentTarget, pane)}
      className="shrink-0 rounded p-1 text-zinc-300 hover:bg-zinc-700"
    ><Plus className="w-4 h-4" /></button>
  </div>
);

interface EmptyPaneProps {
  pane: Pane;
  style: React.CSSProperties;
  chooser: React.ReactNode;
  hasSessions: boolean;
  onOpenSessionMenu: (anchor: HTMLElement, pane: Pane) => void;
  onNewLocalSession: () => void;
}

/** Placeholder for a pane without an assigned session. */
export const EmptyPane: React.FC<EmptyPaneProps> = ({ pane, style, chooser, hasSessions, onOpenSessionMenu, onNewLocalSession }) => (
  <div className="absolute flex flex-col min-w-0 min-h-0 overflow-auto" style={style}>
    {chooser}
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-zinc-400">
      <TermIcon className="w-7 h-7 shrink-0 text-blue-400" />
      <h3 className="text-sm text-zinc-200">{hasSessions ? 'Zweite Sitzung auswählen oder neu öffnen' : 'Keine aktive Terminal-Sitzung'}</h3>
      <button type="button" className="text-xs rounded bg-blue-600 px-3 py-2 text-white" onClick={(event) => onOpenSessionMenu(event.currentTarget, pane)} aria-label={`Sitzung für Bereich ${pane + 1} öffnen`} aria-haspopup="menu">Neue Sitzung öffnen …</button>
      {!hasSessions && <button type="button" className="text-xs text-blue-400 underline" onClick={onNewLocalSession}>Lokales Mac-Terminal starten</button>}
    </div>
  </div>
);

interface SplitDividerProps {
  layout: SplitLayout;
  splitRatio: number;
  bounds: { low: number; high: number };
  onDrag: (clientX: number, clientY: number) => void;
  onStep: (key: string, forward: string, shiftKey: boolean) => void;
}

/** Draggable, keyboard-adjustable separator between the two split panes. */
export const SplitDivider: React.FC<SplitDividerProps> = ({ layout, splitRatio, bounds, onDrag, onStep }) => (
  <div
    role="separator"
    tabIndex={0}
    aria-label="Terminal-Bereiche aufteilen"
    aria-orientation={layout === 'columns' ? 'vertical' : 'horizontal'}
    aria-valuemin={Math.round(bounds.low * 100)}
    aria-valuemax={Math.round(bounds.high * 100)}
    aria-valuenow={Math.round(splitRatio * 100)}
    title="Bereiche aufteilen: Ziehen oder Pfeiltasten (Home/End)"
    className="absolute z-20 bg-zinc-700 hover:bg-blue-500 focus:bg-blue-500 outline-none"
    style={{
      touchAction: 'none',
      ...(layout === 'columns'
        ? { top: 0, bottom: 0, width: 6, left: `calc(${splitRatio * 100}% - ${splitRatio * 6}px)`, cursor: 'col-resize' }
        : { left: 0, right: 0, height: 6, top: `calc(${splitRatio * 100}% - ${splitRatio * 6}px)`, cursor: 'row-resize' }),
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      onDrag(event.clientX, event.clientY);
    }}
    onPointerUp={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onKeyDown={(event) => {
      const backward = layout === 'columns' ? 'ArrowLeft' : 'ArrowUp';
      const forward = layout === 'columns' ? 'ArrowRight' : 'ArrowDown';
      if (![backward, forward, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      onStep(event.key, forward, event.shiftKey);
    }}
  />
);
