import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SSHSession } from '../types';
import type { Pane, PaneSessions, SplitLayout, TerminalInstance, Workspace } from '../components/terminal/model';

interface SplitWorkspaceOptions {
  sessions: SSHSession[];
  activeSessionId: string | null;
  isVisible: boolean;
  activeSessionIdRef: React.MutableRefObject<string | null>;
  sessionsRef: React.MutableRefObject<SSHSession[]>;
  onSelectSessionRef: React.MutableRefObject<(id: string) => void>;
  isVisibleRef: React.MutableRefObject<boolean>;
  terminalInstances: React.MutableRefObject<Map<string, TerminalInstance>>;
  containerRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  rootContainerRef: React.RefObject<HTMLDivElement>;
}

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
  const [workspace, setWorkspace] = useState<Workspace>({ layout: 'single', panes: [activeSessionId, null], focused: 0 });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [splitRatio, setSplitRatio] = useState(0.5);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousIdsRef = useRef(new Set(sessions.map((session) => session.id)));
  const previousActiveRef = useRef(activeSessionId);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const current = workspaceRef.current;
    const ids = new Set(sessions.map((session) => session.id));
    const active = activeSessionId && ids.has(activeSessionId) ? activeSessionId : null;
    const added = sessions.filter((session) => !previousIdsRef.current.has(session.id));
    const removedVisible = current.panes.some((id) => id !== null && !ids.has(id));
    const activeChanged = previousActiveRef.current !== activeSessionId;
    previousIdsRef.current = ids;
    previousActiveRef.current = activeSessionId;
    let next = current;
    if (current.layout !== 'single' && removedVisible) {
      const remaining = current.panes.find((id) => id && ids.has(id)) || active || sessions[0]?.id || null;
      next = { layout: 'single', panes: [remaining, null], focused: 0 };
      if (remaining && remaining !== activeSessionId) onSelectSessionRef.current(remaining);
    } else if (current.layout === 'single') {
      next = { ...current, panes: [active || sessions[0]?.id || null, null], focused: 0 };
    } else if (added.length || (activeChanged && active)) {
      const selected = added.find((session) => session.id === active)?.id || added[added.length - 1]?.id || active!;
      const existingPane = current.panes.indexOf(selected);
      const focused = existingPane >= 0 ? existingPane as Pane : current.focused;
      const panes: PaneSessions = [...current.panes];
      panes[focused] = selected;
      next = { ...current, panes, focused };
      if (selected !== activeSessionId) onSelectSessionRef.current(selected);
    }
    workspaceRef.current = next;
    setWorkspace(next);
  }, [sessions, activeSessionId, onSelectSessionRef]);

  const changeLayout = (layout: SplitLayout) => {
    const current = workspaceRef.current;
    if (layout === current.layout) return;
    const first = activeSessionIdRef.current || sessionsRef.current[0]?.id || null;
    const other = sessionsRef.current.find((session) => session.id !== first)?.id || null;
    const next = layout === 'single'
      ? { layout, panes: [first, null] as PaneSessions, focused: 0 as Pane }
      : current.layout === 'single'
        ? { layout, panes: [first, other] as PaneSessions, focused: (other ? 0 : 1) as Pane }
        : { ...current, layout };
    workspaceRef.current = next;
    setWorkspace(next);
  };

  const fitVisibleTerminals = () => {
    if (!isVisibleRef.current) return;
    const current = workspaceRef.current;
    const visibleIds = current.layout === 'single' ? current.panes.slice(0, 1) : current.panes;
    visibleIds.forEach((id) => {
      if (!id) return;
      const instance = terminalInstances.current.get(id);
      const element = containerRefs.current.get(id);
      if (!instance || !element || element.clientWidth <= 0 || element.clientHeight <= 0) return;
      try {
        instance.fit.fit();
        instance.term.refresh(0, instance.term.rows - 1);
        const session = sessionsRef.current.find((item) => item.id === id);
        if (session?.type === 'local') {
          window.electronAPI?.resizeLocalTerm(id, instance.term.cols, instance.term.rows);
        } else if (session?.type === 'ssh') {
          window.electronAPI?.resizeSSH(id, instance.term.cols, instance.term.rows);
        }
      } catch {
        // A pane can become hidden between the layout notification and this frame.
      }
    });
  };

  const scheduleFit = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      fitVisibleTerminals();
    });
  };

  const ratioBounds = () => {
    const element = viewportRef.current;
    const current = workspaceRef.current;
    const size = current.layout === 'columns' ? element?.clientWidth : element?.clientHeight;
    const available = Math.max(0, (size || 0) - 6);
    const minimum = Math.min(current.layout === 'columns' ? 160 : 100, available / 2);
    const low = available > 0 ? minimum / available : 0.5;
    return { low, high: 1 - low, available };
  };
  const clampRatio = (ratio: number) => {
    const { low, high } = ratioBounds();
    return Math.max(low, Math.min(high, ratio));
  };

  /** Divider drag: viewport coordinates to a clamped split ratio. */
  const dragDividerTo = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const { available } = ratioBounds();
    if (!rect || available <= 0) return;
    const offset = workspaceRef.current.layout === 'columns' ? clientX - rect.left : clientY - rect.top;
    setSplitRatio(clampRatio((offset - 3) / available));
  };

  /** Divider keyboard step: Home/End jump to the bounds, arrows nudge (larger with Shift). */
  const stepDivider = (key: string, forward: string, shiftKey: boolean) => {
    const { low, high } = ratioBounds();
    setSplitRatio((ratio) => key === 'Home' ? low : key === 'End' ? high : clampRatio(ratio + (key === forward ? 1 : -1) * (shiftKey ? 0.1 : 0.025)));
  };

  useLayoutEffect(() => {
    setSplitRatio((ratio) => clampRatio(ratio));
    scheduleFit();
  }, [workspace, splitRatio, isVisible]);

  // Register resize and visibility observers once on mount
  useEffect(() => {
    const handleResize = () => {
      scheduleFit();
    };

    window.addEventListener('resize', handleResize);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        scheduleFit();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && rootContainerRef.current) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            setSplitRatio((ratio) => clampRatio(ratio));
            scheduleFit();
          }
        }
      });
      resizeObserver.observe(rootContainerRef.current);
      if (viewportRef.current) resizeObserver.observe(viewportRef.current);
    }

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && rootContainerRef.current) {
      intersectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            scheduleFit();
          }
        }
      });
      intersectionObserver.observe(rootContainerRef.current);
    }

    scheduleFit();

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (intersectionObserver) {
        intersectionObserver.disconnect();
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const isSplit = workspace.layout !== 'single';
  const paneStyle = (pane: Pane): React.CSSProperties => {
    if (!isSplit) return { inset: 0 };
    const firstSize = `calc(${splitRatio * 100}% - ${splitRatio * 6}px)`;
    const secondStart = `calc(${splitRatio * 100}% + ${(1 - splitRatio) * 6}px)`;
    return workspace.layout === 'columns'
      ? { top: 0, bottom: 0, left: pane === 0 ? 0 : secondStart, width: pane === 0 ? firstSize : undefined, right: pane === 1 ? 0 : undefined }
      : { left: 0, right: 0, top: pane === 0 ? 0 : secondStart, height: pane === 0 ? firstSize : undefined, bottom: pane === 1 ? 0 : undefined };
  };

  return {
    workspace,
    workspaceRef,
    setWorkspace,
    isSplit,
    splitRatio,
    viewportRef,
    changeLayout,
    scheduleFit,
    ratioBounds,
    dragDividerTo,
    stepDivider,
    paneStyle,
  };
}
