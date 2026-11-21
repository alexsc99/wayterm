import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, RefObject } from 'react';
import type { SSHSession } from '../types';
import type { Pane, SplitLayout, TerminalInstance, Workspace } from '../components/terminal/model';
import * as transitions from '../components/terminal/workspace';

interface SplitWorkspaceOptions {
  sessions: SSHSession[];
  activeSessionId: string | null;
  isVisible: boolean;
  activeSessionIdRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<SSHSession[]>;
  onSelectSessionRef: MutableRefObject<(id: string) => void>;
  isVisibleRef: MutableRefObject<boolean>;
  terminalInstances: MutableRefObject<Map<string, TerminalInstance>>;
  containerRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  rootContainerRef: RefObject<HTMLDivElement>;
}

interface PendingResize {
  timer: number;
  size: string;
}

const DIVIDER_SIZE = 6;
/** Trailing delay before a changed terminal size is reported to the backend. */
const BACKEND_RESIZE_DELAY_MS = 80;

/** Split-pane workspace: pane assignment, divider ratio and fitting of visible terminals. */
export function useSplitWorkspace({
  sessions,
  activeSessionId,
  isVisible,
  activeSessionIdRef,
  sessionsRef,
  onSelectSessionRef,
  isVisibleRef,
  terminalInstances,
  containerRefs,
  rootContainerRef,
}: SplitWorkspaceOptions) {
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    transitions.reconcileWorkspace(
      transitions.INITIAL_WORKSPACE,
      { ids: new Set<string>(), active: null },
      sessions.map((session) => session.id),
      activeSessionId,
    ),
  );
  // Source of truth for event handlers; `workspace` state mirrors it for rendering.
  const workspaceRef = useRef(workspace);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousIdsRef = useRef<ReadonlySet<string>>(new Set(sessions.map((session) => session.id)));
  const previousActiveRef = useRef(activeSessionId);
  const previousConnectedRef = useRef<Map<string, boolean>>(new Map());
  const rafRef = useRef<number | null>(null);
  const surfaceObserverRef = useRef<ResizeObserver | null>(null);
  const surfaceCallbacksRef = useRef<Map<string, (element: HTMLDivElement | null) => void>>(new Map());
  /** Last size reported to each session's backend, as `"cols x rows"`. */
  const lastSentSizeRef = useRef<Map<string, string>>(new Map());
  const pendingResizesRef = useRef<Map<string, PendingResize>>(new Map());

  const commit = useCallback((next: Workspace) => {
    if (next !== workspaceRef.current) {
      workspaceRef.current = next;
      setWorkspace(next);
    }
    const focusedId = next.panes[next.focused];
    if (focusedId !== null && focusedId !== activeSessionIdRef.current) {
      activeSessionIdRef.current = focusedId;
      onSelectSessionRef.current(focusedId);
    }
  }, [activeSessionIdRef, onSelectSessionRef]);

  // Layout effect: a closed or added session is re-assigned before the stale panes are painted.
  useLayoutEffect(() => {
    const ids = sessions.map((session) => session.id);
    const previous = { ids: previousIdsRef.current, active: previousActiveRef.current };
    previousIdsRef.current = new Set(ids);
    previousActiveRef.current = activeSessionId;
    commit(transitions.reconcileWorkspace(workspaceRef.current, previous, ids, activeSessionId));
  }, [sessions, activeSessionId, commit]);

  const changeLayout = useCallback((layout: SplitLayout) => {
    commit(transitions.changeLayout(workspaceRef.current, layout, sessionsRef.current.map((session) => session.id)));
  }, [commit, sessionsRef]);
  const selectSession = useCallback((id: string) => commit(transitions.selectSession(workspaceRef.current, id)), [commit]);
  const assignSessionToPane = useCallback((pane: Pane, id: string) => commit(transitions.assignSessionToPane(workspaceRef.current, pane, id)), [commit]);
  const focusPane = useCallback((pane: Pane) => commit(transitions.focusPane(workspaceRef.current, pane)), [commit]);
  const swapPanes = useCallback(() => commit(transitions.swapPanes(workspaceRef.current)), [commit]);

  /** Reports a changed terminal size to the backend once it has settled. */
  const queueBackendResize = useCallback((id: string) => {
    const instance = terminalInstances.current.get(id);
    const type = sessionsRef.current.find((session) => session.id === id)?.type;
    if (!instance || (type !== 'local' && type !== 'ssh')) return;
    const size = `${instance.term.cols}x${instance.term.rows}`;
    const pending = pendingResizesRef.current.get(id);
    if (pending?.size === size) return;
    if (pending) {
      window.clearTimeout(pending.timer);
      pendingResizesRef.current.delete(id);
    }
    if (lastSentSizeRef.current.get(id) === size) return;
    const timer = window.setTimeout(() => {
      pendingResizesRef.current.delete(id);
      const term = terminalInstances.current.get(id)?.term;
      if (!term) return;
      // The size at fire time counts, not the one that started the timer.
      const current = `${term.cols}x${term.rows}`;
      if (lastSentSizeRef.current.get(id) === current) return;
      if (type === 'local') window.electronAPI?.resizeLocalTerm(id, term.cols, term.rows);
      else window.electronAPI?.resizeSSH(id, term.cols, term.rows);
      lastSentSizeRef.current.set(id, current);
    }, BACKEND_RESIZE_DELAY_MS);
    pendingResizesRef.current.set(id, { timer, size });
  }, [sessionsRef, terminalInstances]);

  const fitVisibleTerminals = useCallback(() => {
    if (!isVisibleRef.current) return;
    for (const id of transitions.visibleSessionIds(workspaceRef.current)) {
      const instance = terminalInstances.current.get(id);
      const element = containerRefs.current.get(id);
      if (!instance || !element || element.clientWidth <= 0 || element.clientHeight <= 0) continue;
      const { term } = instance;
      const { cols, rows } = term;
      try {
        instance.fit.fit();
        if (term.cols !== cols || term.rows !== rows) term.refresh(0, term.rows - 1);
      } catch {
        // A pane can become hidden between the layout notification and this frame.
        continue;
      }
      queueBackendResize(id);
    }
  }, [containerRefs, isVisibleRef, queueBackendResize, terminalInstances]);

  /** Fits the visible terminals once in the next animation frame. */
  const scheduleFit = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      fitVisibleTerminals();
    });
  }, [fitVisibleTerminals]);

  const surfaceRef = useCallback((sessionId: string) => {
    const cached = surfaceCallbacksRef.current.get(sessionId);
    if (cached) return cached;
    const callback = (element: HTMLDivElement | null) => {
      const previous = containerRefs.current.get(sessionId);
      if (previous === element) return;
      if (previous) surfaceObserverRef.current?.unobserve(previous);
      if (element) {
        containerRefs.current.set(sessionId, element);
        surfaceObserverRef.current?.observe(element);
      } else {
        containerRefs.current.delete(sessionId);
      }
    };
    surfaceCallbacksRef.current.set(sessionId, callback);
    return callback;
  }, [containerRefs]);

  // Per-session bookkeeping: forget closed sessions, re-announce the size to (re)connected backends.
  useEffect(() => {
    const connected = new Map<string, boolean>();
    let hasNewConnection = false;
    for (const session of sessions) {
      connected.set(session.id, session.connected);
      if (!session.connected || previousConnectedRef.current.get(session.id) === true) continue;
      lastSentSizeRef.current.delete(session.id);
      hasNewConnection = true;
    }
    previousConnectedRef.current = connected;
    for (const id of surfaceCallbacksRef.current.keys()) {
      if (!connected.has(id)) surfaceCallbacksRef.current.delete(id);
    }
    for (const id of lastSentSizeRef.current.keys()) {
      if (!connected.has(id)) lastSentSizeRef.current.delete(id);
    }
    for (const [id, pending] of pendingResizesRef.current) {
      if (connected.has(id)) continue;
      window.clearTimeout(pending.timer);
      pendingResizesRef.current.delete(id);
    }
    if (hasNewConnection) scheduleFit();
  }, [sessions, scheduleFit]);

  const ratioBounds = useCallback(() => {
    const element = viewportRef.current;
    const current = workspaceRef.current;
    const size = current.layout === 'columns' ? element?.clientWidth : element?.clientHeight;
    const available = Math.max(0, (size || 0) - DIVIDER_SIZE);
    const minimum = Math.min(current.layout === 'columns' ? 160 : 100, available / 2);
    const low = available > 0 ? minimum / available : 0.5;
    return { low, high: 1 - low, available };
  }, []);
  const clampRatio = useCallback((ratio: number) => {
    const { low, high } = ratioBounds();
    return Math.max(low, Math.min(high, ratio));
  }, [ratioBounds]);

  /** Divider drag: viewport coordinates to a clamped split ratio. */
  const dragDividerTo = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const { available } = ratioBounds();
    if (!rect || available <= 0) return;
    const offset = workspaceRef.current.layout === 'columns' ? clientX - rect.left : clientY - rect.top;
    setSplitRatio(clampRatio((offset - DIVIDER_SIZE / 2) / available));
  }, [clampRatio, ratioBounds]);

  /** Divider keyboard step: Home/End jump to the bounds, arrows nudge (larger with Shift). */
  const stepDivider = useCallback((key: string, forward: string, shiftKey: boolean) => {
    const { low, high } = ratioBounds();
    setSplitRatio((ratio) => key === 'Home' ? low : key === 'End' ? high : clampRatio(ratio + (key === forward ? 1 : -1) * (shiftKey ? 0.1 : 0.025)));
  }, [clampRatio, ratioBounds]);

  const resetDivider = useCallback(() => setSplitRatio(clampRatio(0.5)), [clampRatio]);

  useLayoutEffect(() => {
    setSplitRatio((ratio) => clampRatio(ratio));
    scheduleFit();
  }, [workspace, splitRatio, isVisible, clampRatio, scheduleFit]);

  // Observers and listeners that trigger a fit; created and torn down as one unit.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) scheduleFit();
    };
    window.addEventListener('resize', scheduleFit);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const root = rootContainerRef.current;
    let viewportObserver: ResizeObserver | null = null;
    let surfaceObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      if (root) {
        viewportObserver = new ResizeObserver((entries) => {
          if (!entries.some((entry) => entry.contentRect.width > 0 && entry.contentRect.height > 0)) return;
          setSplitRatio((ratio) => clampRatio(ratio));
          scheduleFit();
        });
        viewportObserver.observe(root);
        if (viewportRef.current) viewportObserver.observe(viewportRef.current);
      }
      // A pane's own surface changes size when its header or the reconnect banner (dis)appears.
      const observer = new ResizeObserver(scheduleFit);
      containerRefs.current.forEach((element) => observer.observe(element));
      surfaceObserver = observer;
      surfaceObserverRef.current = observer;
    }

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && root) {
      intersectionObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) scheduleFit();
      });
      intersectionObserver.observe(root);
    }

    scheduleFit();

    const pendingResizes = pendingResizesRef.current;
    return () => {
      window.removeEventListener('resize', scheduleFit);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      viewportObserver?.disconnect();
      surfaceObserver?.disconnect();
      if (surfaceObserverRef.current === surfaceObserver) surfaceObserverRef.current = null;
      intersectionObserver?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingResizes.forEach((pending) => window.clearTimeout(pending.timer));
      pendingResizes.clear();
    };
  }, [clampRatio, containerRefs, rootContainerRef, scheduleFit]);

  const isSplit = workspace.layout !== 'single';
  const visibleKey = transitions.visibleSessionIds(workspace).join('\n');
  const visibleIds = useMemo(() => (visibleKey ? visibleKey.split('\n') : []), [visibleKey]);

  const paneStyle = (pane: Pane): CSSProperties => {
    if (!isSplit) return { inset: 0 };
    const firstSize = `calc(${splitRatio * 100}% - ${splitRatio * DIVIDER_SIZE}px)`;
    const secondStart = `calc(${splitRatio * 100}% + ${(1 - splitRatio) * DIVIDER_SIZE}px)`;
    return workspace.layout === 'columns'
      ? { top: 0, bottom: 0, left: pane === 0 ? 0 : secondStart, width: pane === 0 ? firstSize : undefined, right: pane === 1 ? 0 : undefined }
      : { left: 0, right: 0, top: pane === 0 ? 0 : secondStart, height: pane === 0 ? firstSize : undefined, bottom: pane === 1 ? 0 : undefined };
  };

  return {
    workspace,
    workspaceRef,
    isSplit,
    splitRatio,
    viewportRef,
    visibleIds,
    changeLayout,
    selectSession,
    assignSessionToPane,
    focusPane,
    swapPanes,
    scheduleFit,
    surfaceRef,
    ratioBounds,
    dragDividerTo,
    stepDivider,
    resetDivider,
    paneStyle,
  };
}
