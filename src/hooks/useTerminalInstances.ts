import React, { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { SSHSession, TerminalSettings } from '../types';
import { SyntaxHighlighterSession } from '../utils/terminalColors';
import type { TerminalBridge, TerminalInstance, TerminalNoticeTone } from '../components/terminal/model';
import { createTerminalKeyHandler, type TerminalKeyActions } from './useTerminalShortcuts';

const NOTICE_COLORS: Record<TerminalNoticeTone, string> = {
  info: '36',
  warning: '33',
  error: '31',
  success: '32',
};

type SessionIdSetter = React.Dispatch<React.SetStateAction<Set<string>>>;

interface TerminalInstancesOptions extends TerminalKeyActions {
  sessions: SSHSession[];
  activeSessionId: string | null;
  isVisible: boolean;
  /** Ids of the sessions currently shown: one in single view, up to two in split view (stable while unchanged). */
  visibleIds: string[];
  settings: TerminalSettings;
  /** Resolved xterm colour theme (new identity only when colours change). */
  terminalTheme: ITheme;
  /** Focus guards for the refocus effect (values of the triggering render). */
  renamingId: string | null;
  menuAnchor: HTMLElement | null;
  terminalBridgeRef?: React.MutableRefObject<TerminalBridge | null>;
  containerRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  terminalInstances: React.MutableRefObject<Map<string, TerminalInstance>>;
  searchAddonsRef: React.MutableRefObject<Map<string, SearchAddon>>;
  settingsRef: React.MutableRefObject<TerminalSettings>;
  /** Live syntax highlighting toggle, read for every output chunk. */
  syntaxHighlightingRef: React.MutableRefObject<boolean>;
  activeSessionIdRef: React.MutableRefObject<string | null>;
  sessionsRef: React.MutableRefObject<SSHSession[]>;
  searchInputRef: React.RefObject<HTMLInputElement>;
  scheduleFit: () => void;
  sendInputWithBroadcast: (originSession: SSHSession, data: string) => void;
  setContextMenu: (menu: { x: number; y: number; sessionId: string }) => void;
  setBellSessionIds: SessionIdSetter;
  setActivitySessionIds: SessionIdSetter;
}

/**
 * xterm instance lifecycle per session: creation, addons, input/output wiring with flow-control acks,
 * disposal of closed sessions, one WebGL renderer per visible pane and live settings/colour theme updates.
 */
export function useTerminalInstances(options: TerminalInstancesOptions) {
  const {
    sessions,
    activeSessionId,
    isVisible,
    visibleIds,
    settings,
    terminalTheme,
    renamingId,
    menuAnchor,
    terminalBridgeRef,
    containerRefs,
    terminalInstances,
    searchAddonsRef,
    settingsRef,
    syntaxHighlightingRef,
    activeSessionIdRef,
    sessionsRef,
    isSearchOpenRef,
    searchInputRef,
    scheduleFit,
    sendInputWithBroadcast,
    copyTextToClipboard,
    readTextFromClipboard,
    pasteWithGuard,
    setContextMenu,
    setBellSessionIds,
    setActivitySessionIds,
  } = options;
  // One WebGL renderer per visible pane, keyed by session id.
  const webglAddonsRef = useRef<Map<string, WebglAddon>>(new Map());
  // Latest theme for terminals created after a theme change.
  const terminalThemeRef = useRef<ITheme>(terminalTheme);
  terminalThemeRef.current = terminalTheme;
  const dataListenersRef = useRef<Map<string, () => void>>(new Map());
  // Output received but not yet parsed by xterm, per session (flow control units: bytes for SSH, chars otherwise).
  const unackedOutputRef = useRef<Map<string, number>>(new Map());
  const highlightersRef = useRef<Map<string, SyntaxHighlighterSession>>(new Map());
  const uiCleanupsRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    if (!terminalBridgeRef) return;
    terminalBridgeRef.current = {
      writeNotice: (sessionId, text, tone = 'info') => {
        terminalInstances.current
          .get(sessionId)
          ?.term.write(`\r\n\x1b[${NOTICE_COLORS[tone]}m[${text}]\x1b[0m\r\n`);
      },
      getSize: (sessionId) => {
        const term = terminalInstances.current.get(sessionId)?.term;
        return term ? { cols: term.cols, rows: term.rows } : null;
      },
    };
    return () => {
      terminalBridgeRef.current = null;
    };
  }, [terminalBridgeRef, terminalInstances]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      webglAddonsRef.current.forEach((addon) => {
        try {
          addon.dispose();
        } catch {
          // Ignore
        }
      });
      webglAddonsRef.current.clear();

      dataListenersRef.current.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch {
          // Ignore
        }
      });
      dataListenersRef.current.clear();
      // Pending write callbacks die with the terminals; release them so the backend does not stay paused.
      unackedOutputRef.current.forEach((amount, id) => window.electronAPI?.ackTerminalData(id, amount));
      unackedOutputRef.current.clear();
      terminalInstances.current.forEach((instance) => {
        try {
          instance.term.dispose();
        } catch {
          // Ignore
        }
      });
      terminalInstances.current.clear();
      searchAddonsRef.current.forEach((addon) => {
        try {
          addon.dispose();
        } catch {
          // Ignore
        }
      });
      searchAddonsRef.current.clear();
      highlightersRef.current.clear();
      uiCleanupsRef.current.forEach((cleanup) => {
        try {
          cleanup();
        } catch {
          // Ignore
        }
      });
      uiCleanupsRef.current.clear();
    };
  }, [searchAddonsRef, terminalInstances]);

  // Setup terminal instance per session
  useEffect(() => {
    sessions.forEach((session) => {
      if (terminalInstances.current.has(session.id)) return;

      const domElement = containerRefs.current.get(session.id);
      if (!domElement) return;

      const highlighter = new SyntaxHighlighterSession();
      highlightersRef.current.set(session.id, highlighter);

      const currentSettings = settingsRef.current;
      const term = new Terminal({
        fontFamily: currentSettings.fontFamily,
        fontSize: currentSettings.fontSize,
        lineHeight: currentSettings.lineHeight,
        cursorBlink: currentSettings.cursorBlink,
        cursorStyle: currentSettings.cursorStyle,
        scrollback: currentSettings.scrollback,
        smoothScrollDuration: 0,
        fastScrollModifier: 'alt',
        allowProposedApi: true,
        theme: { ...terminalThemeRef.current },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);
      searchAddonsRef.current.set(session.id, searchAddon);

      const webLinksAddon = new WebLinksAddon((event, uri) => {
        if (settingsRef.current.openLinksWithCmdClick && !event.metaKey) return;
        if (window.electronAPI?.openExternalUrl) {
          void window.electronAPI.openExternalUrl(uri);
        } else {
          window.open(uri, '_blank', 'noopener,noreferrer');
        }
      });
      term.loadAddon(webLinksAddon);

      term.open(domElement);

      // Fitting is shared by both visible panes, including the backend resize.
      scheduleFit();

      // Terminal bell indicator for background tabs
      const bellDisposable = term.onBell(() => {
        if (activeSessionIdRef.current !== session.id) {
          setBellSessionIds((prev) => {
            if (prev.has(session.id)) return prev;
            const next = new Set(prev);
            next.add(session.id);
            return next;
          });
        }
      });

      // Terminal user input -> send to backend (with optional Split Broadcast)
      term.onData((data) => {
        const liveSession = sessionsRef.current.find((s) => s.id === session.id) || session;
        sendInputWithBroadcast(liveSession, data);
      });

      // PuTTY-style Copy-on-Select & Configurable Right-Click
      let selectionDebounce: ReturnType<typeof setTimeout> | null = null;
      const selectionDisposable = term.onSelectionChange(() => {
        if (selectionDebounce) {
          clearTimeout(selectionDebounce);
          selectionDebounce = null;
        }
        if (!settingsRef.current.copyOnSelect) return;
        // Avoid overwriting clipboard while typing inside ⌘F search box
        if (isSearchOpenRef.current && document.activeElement === searchInputRef.current) {
          return;
        }
        if (!term.hasSelection()) return;

        selectionDebounce = setTimeout(() => {
          selectionDebounce = null;
          if (term.hasSelection()) {
            const selected = term.getSelection();
            if (selected) {
              void copyTextToClipboard(selected, true);
            }
          }
        }, 60);
      });

      const handleContextMenu = async (e: MouseEvent) => {
        e.preventDefault();
        if (settingsRef.current.rightClickMode === 'menu') {
          setContextMenu({ x: e.clientX, y: e.clientY, sessionId: session.id });
          return;
        }
        if (selectionDebounce) {
          clearTimeout(selectionDebounce);
          selectionDebounce = null;
          if (term.hasSelection() && settingsRef.current.copyOnSelect) {
            const pendingSelected = term.getSelection();
            if (pendingSelected) {
              await copyTextToClipboard(pendingSelected, false);
            }
          }
        }
        const text = await readTextFromClipboard();
        term.clearSelection();
        term.focus();
        if (text) {
          pasteWithGuard(session.id, text);
        }
      };
      domElement.addEventListener('contextmenu', handleContextMenu);

      uiCleanupsRef.current.set(session.id, () => {
        if (selectionDebounce) {
          clearTimeout(selectionDebounce);
          selectionDebounce = null;
        }
        bellDisposable.dispose();
        selectionDisposable.dispose();
        domElement.removeEventListener('contextmenu', handleContextMenu);
      });

      term.attachCustomKeyEventHandler(createTerminalKeyHandler(term, session.id, options));

      // Subscribe to incoming stream
      if (window.electronAPI) {
        // Clean up previous listener for this session id if any
        const existingUnsub = dataListenersRef.current.get(session.id);
        if (existingUnsub) {
          try {
            existingUnsub();
          } catch {
            // Ignore
          }
          dataListenersRef.current.delete(session.id);
        }

        const writeStreamChunk = (chunk: string | Uint8Array) => {
          const size = typeof chunk === 'string' ? chunk.length : chunk.byteLength;
          const unacked = unackedOutputRef.current;
          unacked.set(session.id, (unacked.get(session.id) ?? 0) + size);
          const acknowledge = () => {
            const remaining = (unacked.get(session.id) ?? 0) - size;
            if (remaining > 0) unacked.set(session.id, remaining);
            else unacked.delete(session.id);
            window.electronAPI?.ackTerminalData(session.id, size);
          };
          const formatted = highlighter.process(chunk, syntaxHighlightingRef.current);
          if (!formatted) {
            acknowledge();
            return;
          }
          term.write(formatted, acknowledge);
          if (activeSessionIdRef.current !== session.id) {
            setActivitySessionIds((prev) => {
              if (prev.has(session.id)) return prev;
              const next = new Set(prev);
              next.add(session.id);
              return next;
            });
          }
        };

        let unsubscribe: (() => void) | undefined;
        if (session.type === 'local') {
          unsubscribe = window.electronAPI.onLocalTermData(session.id, (chunk) => {
            writeStreamChunk(chunk);
          });
        } else if (session.type === 'serial') {
          unsubscribe = window.electronAPI.onSerialData(session.id, (chunk) => {
            writeStreamChunk(chunk);
          });
        } else {
          unsubscribe = window.electronAPI.onSSHData(session.id, (chunk) => {
            writeStreamChunk(chunk);
          });
        }
        if (typeof unsubscribe === 'function') {
          dataListenersRef.current.set(session.id, unsubscribe);
        }
      }

      terminalInstances.current.set(session.id, { term, fit: fitAddon });
    });

    // Cleanup closed sessions
    const activeIds = new Set(sessions.map((s) => s.id));
    terminalInstances.current.forEach((instance, id) => {
      if (!activeIds.has(id)) {
        const webglAddon = webglAddonsRef.current.get(id);
        if (webglAddon) {
          try {
            webglAddon.dispose();
          } catch {
            // Ignore
          }
          webglAddonsRef.current.delete(id);
        }
        const searchAddon = searchAddonsRef.current.get(id);
        if (searchAddon) {
          try {
            searchAddon.dispose();
          } catch {
            // Ignore
          }
          searchAddonsRef.current.delete(id);
        }
        highlightersRef.current.delete(id);
        unackedOutputRef.current.delete(id);
        const uiCleanup = uiCleanupsRef.current.get(id);
        if (uiCleanup) {
          try {
            uiCleanup();
          } catch {
            // Ignore
          }
          uiCleanupsRef.current.delete(id);
        }
        const unsubscribe = dataListenersRef.current.get(id);
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // Ignore
          }
          dataListenersRef.current.delete(id);
        }
        try {
          instance.term.dispose();
        } catch {
          // Ignore
        }
        terminalInstances.current.delete(id);
      }
    });

    dataListenersRef.current.forEach((unsubscribe, id) => {
      if (!activeIds.has(id)) {
        try {
          unsubscribe();
        } catch {
          // Ignore
        }
        dataListenersRef.current.delete(id);
      }
    });
  }, [sessions]);

  // One WebglAddon per visible pane: switching focus between split panes neither disposes nor recreates a renderer.
  useEffect(() => {
    const addons = webglAddonsRef.current;
    const visible = new Set(isVisible ? visibleIds : []);

    addons.forEach((addon, id) => {
      const instance = terminalInstances.current.get(id);
      if (instance && visible.has(id)) return;
      try {
        addon.dispose();
      } catch {
        // Ignore
      }
      addons.delete(id);
      if (instance) {
        try {
          instance.term.refresh(0, instance.term.rows - 1);
        } catch {
          // Ignore
        }
      }
    });

    if (!isVisible) return;

    visible.forEach((id) => {
      if (addons.has(id)) return;
      const instance = terminalInstances.current.get(id);
      if (!instance) return;
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          try {
            webgl.dispose();
          } catch {
            // Ignore
          }
          if (addons.get(id) === webgl) {
            addons.delete(id);
          }
          try {
            instance.term.refresh(0, instance.term.rows - 1);
          } catch {
            // Ignore
          }
        });
        instance.term.loadAddon(webgl);
        addons.set(id, webgl);
      } catch {
        // Fallback to standard renderer
      }
    });

    scheduleFit();
  }, [visibleIds, isVisible, sessions.length]);

  // Re-fit, repaint and refocus the active terminal on session switch or tab visibility change
  useEffect(() => {
    if (!isVisible || !activeSessionId) return;

    const instance = terminalInstances.current.get(activeSessionId);
    if (!instance) return;

    scheduleFit();
    try {
      instance.term.refresh(0, instance.term.rows - 1);
      const focused = document.activeElement;
      if (!renamingId && !menuAnchor && (!focused || focused === document.body || focused.closest('.xterm'))) {
        instance.term.focus();
      }
    } catch {
      // Ignore
    }
  }, [activeSessionId, isVisible, sessions.length]);

  // Apply persistent Terminal Settings live to all terminal instances
  useEffect(() => {
    terminalInstances.current.forEach(({ term }) => {
      try {
        term.options.fontSize = settings.fontSize;
        term.options.fontFamily = settings.fontFamily;
        term.options.lineHeight = settings.lineHeight;
        term.options.cursorStyle = settings.cursorStyle;
        term.options.cursorBlink = settings.cursorBlink;
        term.options.scrollback = settings.scrollback;
      } catch {
        // Ignore
      }
    });
    webglAddonsRef.current.forEach((addon) => {
      try {
        addon.clearTextureAtlas();
      } catch {
        // Ignore
      }
    });
    scheduleFit();
  }, [settings]);

  // Apply the colour theme live to all terminal instances
  useEffect(() => {
    terminalInstances.current.forEach(({ term }) => {
      try {
        term.options.theme = { ...terminalTheme };
      } catch {
        // Ignore
      }
    });

    webglAddonsRef.current.forEach((addon) => {
      try {
        addon.clearTextureAtlas();
      } catch {
        // Ignore
      }
    });

    terminalInstances.current.forEach(({ term }) => {
      try {
        if (term.rows > 0) {
          term.refresh(0, term.rows - 1);
        }
      } catch {
        // Ignore
      }
    });
  }, [terminalTheme]);
}
