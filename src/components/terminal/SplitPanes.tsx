import React, { useRef, useState } from 'react';
import { Terminal as TermIcon, Plus, ArrowLeftRight, ArrowUpDown, Maximize2 } from 'lucide-react';
import type { SSHSession } from '../../types';
import type { Pane, SplitLayout } from './model';

const HEADER_BUTTON = 'shrink-0 rounded p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors cursor-pointer';

interface PaneHeaderProps {
  pane: Pane;
  layout: SplitLayout;
  sessionId: string | null;
  isFocused: boolean;
  sessions: SSHSession[];
  onFocusPane: (pane: Pane) => void;
  onChooseSession: (pane: Pane, sessionId: string) => void;
  onOpenSessionMenu: (anchor: HTMLElement, pane: Pane) => void;
  onSwapPanes: () => void;
  onMaximize: (pane: Pane) => void;
}

/** Compact per-pane bar of a split: focus cue, session selector and pane actions. */
export const PaneHeader: React.FC<PaneHeaderProps> = ({
  pane,
  layout,
  sessionId,
  isFocused,
  sessions,
  onFocusPane,
  onChooseSession,
  onOpenSessionMenu,
  onSwapPanes,
  onMaximize,
}) => {
  const SwapIcon = layout === 'rows' ? ArrowUpDown : ArrowLeftRight;
  return (
    <div
      data-pane-header
      className={`h-8 shrink-0 min-w-0 flex items-center gap-1 px-2 border-b ${isFocused ? 'border-blue-500 bg-blue-950/30' : 'border-zinc-800 bg-zinc-900'}`}
      onPointerDown={() => onFocusPane(pane)}
    >
      <span
        aria-hidden="true"
        className={`shrink-0 w-1.5 h-1.5 rounded-full ${isFocused ? 'bg-blue-500' : 'bg-zinc-600'}`}
      />
      <label className="sr-only" htmlFor={`terminal-pane-${pane}`}>Bereich {pane + 1}: Sitzung auswählen</label>
      <select
        id={`terminal-pane-${pane}`}
        aria-label={`Bereich ${pane + 1}: Sitzung auswählen`}
        className={`min-w-0 flex-1 h-6 bg-transparent text-xs rounded px-1 hover:bg-zinc-800 cursor-pointer ${isFocused ? 'text-zinc-100' : 'text-zinc-300'}`}
        value={sessionId || ''}
        onFocus={() => onFocusPane(pane)}
        onChange={(event) => onChooseSession(pane, event.target.value)}
      >
        <option value="" disabled>Sitzung auswählen …</option>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select>
      <button
        type="button"
        aria-label="Bereiche tauschen"
        title="Bereiche tauschen"
        onClick={onSwapPanes}
        className={HEADER_BUTTON}
      ><SwapIcon className="w-3.5 h-3.5" /></button>
      <button
        type="button"
        aria-label="Bereich maximieren (Teilung aufheben)"
        title="Bereich maximieren (Teilung aufheben)"
        onClick={() => onMaximize(pane)}
        className={HEADER_BUTTON}
      ><Maximize2 className="w-3.5 h-3.5" /></button>
      <button
        type="button"
        aria-label={`Neue Sitzung in Bereich ${pane + 1}`}
        title={`Neue Sitzung in Bereich ${pane + 1}`}
        aria-haspopup="menu"
        onClick={(event) => onOpenSessionMenu(event.currentTarget, pane)}
        className={HEADER_BUTTON}
      ><Plus className="w-3.5 h-3.5" /></button>
    </div>
  );
};

interface EmptyPaneProps {
  pane: Pane;
  style: React.CSSProperties;
  header: React.ReactNode;
  isFocused: boolean;
  hasSessions: boolean;
  onFocusPane: (pane: Pane) => void;
  onOpenSessionMenu: (anchor: HTMLElement, pane: Pane) => void;
  onNewLocalSession: () => void;
}

/** Placeholder for a pane without an assigned session. */
export const EmptyPane: React.FC<EmptyPaneProps> = ({
  pane,
  style,
  header,
  isFocused,
  hasSessions,
  onFocusPane,
  onOpenSessionMenu,
  onNewLocalSession,
}) => (
  <div
    className="absolute flex flex-col min-w-0 min-h-0 overflow-auto"
    style={style}
    onPointerDown={(event) => {
      // A PaneHeader reports its own pointer-down; do not focus twice.
      if (!(event.target as HTMLElement).closest('[data-pane-header]')) onFocusPane(pane);
    }}
  >
    {header}
    <div className={`flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-zinc-400 ${isFocused ? 'ring-1 ring-inset ring-blue-500/40' : ''}`}>
      <TermIcon className="w-7 h-7 shrink-0 text-blue-400" />
      <h3 className="text-sm text-zinc-200">{hasSessions ? 'Zweite Sitzung auswählen oder neu öffnen' : 'Keine aktive Terminal-Sitzung'}</h3>
      <button type="button" className="text-xs rounded bg-blue-600 hover:bg-blue-500 px-3 py-2 text-white transition-colors cursor-pointer" onClick={(event) => onOpenSessionMenu(event.currentTarget, pane)} aria-label={`Sitzung für Bereich ${pane + 1} öffnen`} aria-haspopup="menu">Neue Sitzung öffnen …</button>
      {!hasSessions && <button type="button" className="text-xs text-blue-400 underline cursor-pointer" onClick={onNewLocalSession}>Lokales Mac-Terminal starten</button>}
    </div>
  </div>
);

interface SplitDividerProps {
  layout: SplitLayout;
  splitRatio: number;
  bounds: { low: number; high: number };
  onDrag: (clientX: number, clientY: number) => void;
  onStep: (key: string, forward: string, shiftKey: boolean) => void;
  onReset: () => void;
  /** A pointer drag has ended (not called for keyboard adjustments). */
  onDragEnd?: () => void;
}

/** Draggable, keyboard-adjustable separator between the two split panes. */
export const SplitDivider: React.FC<SplitDividerProps> = ({ layout, splitRatio, bounds, onDrag, onStep, onReset, onDragEnd }) => {
  const [dragging, setDragging] = useState(false);
  /** True from a successful pointer capture until the first end event of that drag. */
  const pointerCapturedRef = useRef(false);
  const isColumns = layout === 'columns';

  // Pointer-up releases the capture, which fires lostpointercapture as well: report the drag end once.
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    if (!pointerCapturedRef.current) return;
    pointerCapturedRef.current = false;
    onDragEnd?.();
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Terminal-Bereiche aufteilen"
      aria-orientation={isColumns ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(bounds.low * 100)}
      aria-valuemax={Math.round(bounds.high * 100)}
      aria-valuenow={Math.round(splitRatio * 100)}
      title="Bereiche aufteilen: Ziehen, Pfeiltasten (Home/End) oder Doppelklick zum Zurücksetzen"
      className={`group absolute z-20 flex justify-center outline-none transition-colors hover:bg-blue-500/70 focus:bg-blue-500/70 ${isColumns ? 'flex-row' : 'flex-col'} ${dragging ? 'bg-blue-500/70' : ''}`}
      style={{
        touchAction: 'none',
        ...(isColumns
          ? { top: 0, bottom: 0, width: 6, left: `calc(${splitRatio * 100}% - ${splitRatio * 6}px)`, cursor: 'col-resize' }
          : { left: 0, right: 0, height: 6, top: `calc(${splitRatio * 100}% - ${splitRatio * 6}px)`, cursor: 'row-resize' }),
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerCapturedRef.current = true;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onDrag(event.clientX, event.clientY);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          onReset();
          return;
        }
        const backward = isColumns ? 'ArrowLeft' : 'ArrowUp';
        const forward = isColumns ? 'ArrowRight' : 'ArrowDown';
        if (![backward, forward, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onStep(event.key, forward, event.shiftKey);
      }}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none transition-colors ${isColumns ? 'w-px h-full' : 'h-px w-full'} ${
          dragging ? 'bg-transparent' : 'bg-zinc-700 group-hover:bg-transparent group-focus:bg-transparent'
        }`}
      />
    </div>
  );
};
