import React, { useEffect } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { Pane, SplitLayout, Workspace } from '../components/terminal/model';

type FontSizeUpdate = (updater: number | ((prev: number) => number)) => void;

/** Actions the xterm key handler dispatches to; refs are read at key time. */
export interface TerminalKeyActions {
  switchSessionByKey: (event: KeyboardEvent) => boolean;
  onOpenCommandPaletteRef: React.MutableRefObject<(() => void) | undefined>;
  changeLayout: (layout: SplitLayout) => void;
  workspaceRef: React.MutableRefObject<Workspace>;
  focusPane: (pane: Pane) => void;
  copyTextToClipboard: (text: string, showBadge?: boolean) => Promise<void>;
  readTextFromClipboard: () => Promise<string>;
  pasteWithGuard: (sessionId: string, text: string) => void;
  onNewLocalSessionRef: React.MutableRefObject<() => void>;
  onCloseSessionRef: React.MutableRefObject<(id: string) => void>;
  openSearchOverlay: () => void;
  closeSearchOverlay: () => void;
  isSearchOpenRef: React.MutableRefObject<boolean>;
  setFontSize: FontSizeUpdate;
}

/** macOS native keybinding handling for one xterm instance (attachCustomKeyEventHandler). */
export function createTerminalKeyHandler(term: Terminal, sessionId: string, actions: TerminalKeyActions) {
  return (e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true;
    if (actions.switchSessionByKey(e)) return false;

    // Cmd+Shift+P: Open Command Palette
    if (e.metaKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      e.stopPropagation();
      actions.onOpenCommandPaletteRef.current?.();
      return false;
    }

    // Cmd+D / Cmd+Shift+D: Split terminal columns / rows
    if (e.metaKey && !e.altKey && e.code === 'KeyD') {
      e.preventDefault();
      e.stopPropagation();
      actions.changeLayout(e.shiftKey ? 'rows' : 'columns');
      return false;
    }

    // Cmd+Alt+Arrows: Switch focus between split panes
    if (
      e.metaKey &&
      e.altKey &&
      (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown')
    ) {
      if (actions.workspaceRef.current.layout !== 'single') {
        e.preventDefault();
        e.stopPropagation();
        const targetPane: Pane = e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? 0 : 1;
        actions.focusPane(targetPane);
        return false;
      }
    }

    // Cmd+C: Copy if selection exists, otherwise let it pass
    if (e.metaKey && e.code === 'KeyC') {
      if (term.hasSelection()) {
        void actions.copyTextToClipboard(term.getSelection(), true);
        return false;
      }
    }

    // Cmd+V: Paste from clipboard (with optional multiline guard)
    if (e.metaKey && e.code === 'KeyV') {
      void actions.readTextFromClipboard().then((text) => {
        if (text) {
          actions.pasteWithGuard(sessionId, text);
        }
      });
      return false;
    }

    // Cmd+K: Clear screen
    if (e.metaKey && e.code === 'KeyK') {
      e.preventDefault();
      e.stopPropagation();
      term.clear();
      return false;
    }

    // Cmd+T: New tab (Local Terminal)
    if (e.metaKey && e.code === 'KeyT') {
      e.preventDefault();
      e.stopPropagation();
      actions.onNewLocalSessionRef.current();
      return false;
    }

    // Cmd+W: Close current session tab
    if (e.metaKey && e.code === 'KeyW') {
      e.preventDefault();
      e.stopPropagation();
      actions.onCloseSessionRef.current(sessionId);
      return false;
    }

    // Cmd+F: Open in-terminal search overlay
    if (e.metaKey && e.code === 'KeyF') {
      e.preventDefault();
      actions.openSearchOverlay();
      return false;
    }

    // Escape: Close search overlay if open
    if (e.key === 'Escape' && actions.isSearchOpenRef.current) {
      e.preventDefault();
      actions.closeSearchOverlay();
      return false;
    }

    // Cmd+= or Cmd+Plus: Zoom In
    if (e.metaKey && (e.key === '=' || e.key === '+' || e.code === 'Equal')) {
      e.preventDefault();
      actions.setFontSize((prev) => Math.min(24, prev + 1));
      return false;
    }

    // Cmd+- or Cmd+Minus: Zoom Out
    if (e.metaKey && (e.key === '-' || e.code === 'Minus')) {
      e.preventDefault();
      actions.setFontSize((prev) => Math.max(10, prev - 1));
      return false;
    }

    // Cmd+0: Reset Zoom
    if (e.metaKey && (e.key === '0' || e.code === 'Digit0')) {
      e.preventDefault();
      actions.setFontSize(13);
      return false;
    }

    return true;
  };
}

interface GlobalShortcutActions {
  switchSessionByKey: (event: KeyboardEvent) => boolean;
  isSearchOpenRef: React.MutableRefObject<boolean>;
  closeSearchOverlay: () => void;
  closePopovers: () => void;
  changeLayout: (layout: SplitLayout) => void;
  openSearchOverlay: () => void;
  setFontSize: FontSizeUpdate;
}

/** Window-level shortcuts while the terminal view is visible and xterm did not consume the key. */
export function useTerminalShortcuts(isVisible: boolean, actions: GlobalShortcutActions) {
  useEffect(() => {
    if (!isVisible) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') && !target.closest('.xterm'))) return;
      if (actions.switchSessionByKey(e)) return;
      if (e.key === 'Escape') {
        if (actions.isSearchOpenRef.current) {
          e.preventDefault();
          actions.closeSearchOverlay();
          return;
        }
        actions.closePopovers();
      }
      if (e.metaKey && !e.altKey && e.code === 'KeyD') {
        e.preventDefault();
        actions.changeLayout(e.shiftKey ? 'rows' : 'columns');
        return;
      }
      if (e.metaKey && e.code === 'KeyF') {
        e.preventDefault();
        actions.openSearchOverlay();
        return;
      }
      const activeElem = document.activeElement;
      const isInsideTerm = activeElem?.closest('.xterm');
      if (!isInsideTerm) {
        if (e.metaKey && (e.key === '=' || e.key === '+' || e.code === 'Equal')) {
          e.preventDefault();
          actions.setFontSize((prev) => Math.min(24, prev + 1));
        } else if (e.metaKey && (e.key === '-' || e.code === 'Minus')) {
          e.preventDefault();
          actions.setFontSize((prev) => Math.max(10, prev - 1));
        } else if (e.metaKey && (e.key === '0' || e.code === 'Digit0')) {
          e.preventDefault();
          actions.setFontSize(13);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isVisible]);
}
