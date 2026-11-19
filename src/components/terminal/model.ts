import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export type TerminalNoticeTone = 'info' | 'warning' | 'error' | 'success';

/** Imperative access to terminal instances for App-driven status lines (reconnect, restore). */
export interface TerminalBridge {
  writeNotice: (sessionId: string, text: string, tone?: TerminalNoticeTone) => void;
  getSize: (sessionId: string) => { cols: number; rows: number } | null;
}

export interface SessionReconnectState {
  /** 1-based number of the pending/running attempt. */
  attempt: number;
  maxAttempts: number;
  phase: 'waiting' | 'connecting' | 'offline';
  delaySeconds?: number;
}

export type SplitLayout = 'single' | 'columns' | 'rows';
export type Pane = 0 | 1;
export type PaneSessions = [string | null, string | null];

export interface Workspace {
  layout: SplitLayout;
  panes: PaneSessions;
  focused: Pane;
}

export interface TerminalInstance {
  term: Terminal;
  fit: FitAddon;
}

export const describeReconnect = (state: SessionReconnectState) =>
  state.phase === 'offline'
    ? 'Kein Netzwerk – warte auf Verbindung …'
    : state.phase === 'connecting'
      ? `Verbinde neu … (Versuch ${state.attempt}/${state.maxAttempts})`
      : `Neuer Versuch in ${state.delaySeconds ?? 0} s (Versuch ${state.attempt}/${state.maxAttempts})`;
