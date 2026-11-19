import React, { useEffect, useRef, useState } from 'react';
import type { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { SSHSession, SSHHost, CommandSnippet } from '../types';
import { loadSnippets, saveSnippets } from '../utils/snippets';
import { TerminalSettingsPopover } from './TerminalSettingsPopover';
import { TerminalSnippetsPopover } from './TerminalSnippetsPopover';
import { TerminalContextMenu } from './TerminalContextMenu';
import { MultilinePasteModal } from './MultilinePasteModal';
import type { Pane, PaneSessions, SessionReconnectState, TerminalBridge, TerminalInstance } from './terminal/model';
import { TerminalTabBar } from './terminal/TerminalTabBar';
import { TerminalToolbar } from './terminal/TerminalToolbar';
import { NewSessionMenu } from './terminal/NewSessionMenu';
import { TerminalSearchOverlay } from './terminal/TerminalSearchOverlay';
import { SessionPane } from './terminal/SessionPane';
import { EmptyPane, PaneChooser, SplitDivider } from './terminal/SplitPanes';
import { useSplitWorkspace } from '../hooks/useSplitWorkspace';
import { useSessionRename } from '../hooks/useSessionRename';
import { useTerminalPreferences } from '../hooks/useTerminalPreferences';
import { useTerminalSearch } from '../hooks/useTerminalSearch';
import { useAnchoredMenu } from '../hooks/useAnchoredMenu';
import { useTerminalClipboard } from '../hooks/useTerminalClipboard';
import { useTerminalInstances } from '../hooks/useTerminalInstances';
import { useTerminalShortcuts } from '../hooks/useTerminalShortcuts';

export type { TerminalNoticeTone, TerminalBridge, SessionReconnectState } from './terminal/model';

interface TerminalViewProps {
  sessions: SSHSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onReconnectSession?: (id: string, cols?: number, rows?: number) => void;
  onDuplicateSession?: (id: string) => void;
  onOpenCommandPalette?: () => void;
  onShowToast?: (message: string, type?: 'success' | 'error' | 'warning' | 'info', duration?: number) => void;
  hosts: SSHHost[];
  onNewSessionFromHost: (host: SSHHost) => void;
  onNewLocalSession: () => void;
  onOpenNewHostModal?: () => void;
  onOpenSerialConnectModal?: () => void;
  onOpenSFTPForHost?: (host: SSHHost) => void;
  reconnectStates?: Record<string, SessionReconnectState>;
  onCancelAutoReconnect?: (id: string) => void;
  terminalBridgeRef?: React.MutableRefObject<TerminalBridge | null>;
  isVisible?: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onRenameSession,
  onReconnectSession,
  onDuplicateSession,
  onOpenCommandPalette,
  onShowToast,
  hosts,
  onNewSessionFromHost,
  onNewLocalSession,
  onOpenNewHostModal,
  onOpenSerialConnectModal,
  onOpenSFTPForHost,
  reconnectStates = {},
  onCancelAutoReconnect,
  terminalBridgeRef,
  isVisible = true,
}) => {
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const terminalInstances = useRef<Map<string, TerminalInstance>>(new Map());
  const searchAddonsRef = useRef<Map<string, SearchAddon>>(new Map());
  const rootContainerRef = useRef<HTMLDivElement>(null);

  // Latest props for callbacks that outlive the render they were created in.
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const sessionsRef = useRef<SSHSession[]>(sessions);
  const onSelectSessionRef = useRef(onSelectSession);
  const onNewLocalSessionRef = useRef(onNewLocalSession);
  const onCloseSessionRef = useRef(onCloseSession);
  const onOpenCommandPaletteRef = useRef(onOpenCommandPalette);
  const onShowToastRef = useRef(onShowToast);
  const isVisibleRef = useRef(isVisible);
  activeSessionIdRef.current = activeSessionId;
  sessionsRef.current = sessions;
  onSelectSessionRef.current = onSelectSession;
  onNewLocalSessionRef.current = onNewLocalSession;
  onCloseSessionRef.current = onCloseSession;
  onOpenCommandPaletteRef.current = onOpenCommandPalette;
  onShowToastRef.current = onShowToast;
  isVisibleRef.current = isVisible;

  const {
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
  } = useSplitWorkspace({
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
  });
  const {
    renamingId,
    renameValue,
    renameError,
    renameInputRef,
    startRename,
    changeRenameValue,
    commitRename,
    cancelRename,
  } = useSessionRename(sessions, onRenameSession);
  const {
    settings,
    settingsRef,
    fontSize,
    setFontSize,
    updateSettings,
    vividColorsEnabled,
    setVividColorsEnabled,
    vividColorsEnabledRef,
  } = useTerminalPreferences();
  const {
    isSearchOpen,
    searchQuery,
    caseSensitive,
    matchWholeWord,
    searchInputRef,
    isSearchOpenRef,
    findNext,
    findPrevious,
    openSearchOverlay,
    closeSearchOverlay,
    changeQuery,
    clearQuery,
    toggleCaseSensitive,
    toggleWholeWord,
  } = useTerminalSearch({ activeSessionIdRef, searchAddonsRef, terminalInstances });
  const { menuAnchor, setMenuAnchor, menuRef, menuPosition } = useAnchoredMenu(rootContainerRef);
  const { copiedBadgeVisible, copyTextToClipboard, readTextFromClipboard } = useTerminalClipboard();

  // Snippets, Broadcast, Settings Popover, Context Menu, Multiline Paste, Tab Activity
  const [snippets, setSnippets] = useState<CommandSnippet[]>(() => loadSnippets());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSnippetsOpen, setIsSnippetsOpen] = useState(false);
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);
  const broadcastEnabledRef = useRef(broadcastEnabled);
  broadcastEnabledRef.current = broadcastEnabled;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [pendingPaste, setPendingPaste] = useState<{ sessionId: string; text: string } | null>(null);
  const [activitySessionIds, setActivitySessionIds] = useState<Set<string>>(() => new Set());
  const [bellSessionIds, setBellSessionIds] = useState<Set<string>>(() => new Set());

  const selectSession = (id: string, focusTerminal = false) => {
    const current = workspaceRef.current;
    const visiblePane = current.panes.indexOf(id);
    const focused = current.layout === 'single' ? 0 : visiblePane >= 0 ? visiblePane as Pane : current.focused;
    const panes: PaneSessions = [...current.panes];
    panes[focused] = id;
    const next = { ...current, panes, focused };
    workspaceRef.current = next;
    setWorkspace(next);
    activeSessionIdRef.current = id;
    onSelectSessionRef.current(id);
    setActivitySessionIds((prev) => {
      if (!prev.has(id)) return prev;
      const nextSet = new Set(prev);
      nextSet.delete(id);
      return nextSet;
    });
    setBellSessionIds((prev) => {
      if (!prev.has(id)) return prev;
      const nextSet = new Set(prev);
      nextSet.delete(id);
      return nextSet;
    });
    if (focusTerminal) {
      requestAnimationFrame(() => {
        if (!renameInputRef.current && !menuRef.current && document.activeElement !== searchInputRef.current && activeSessionIdRef.current === id && isVisibleRef.current) terminalInstances.current.get(id)?.term.focus();
      });
    }
  };

  const openSessionMenu = (anchor: HTMLElement, pane = workspaceRef.current.focused) => {
    const next = { ...workspaceRef.current, focused: pane };
    workspaceRef.current = next;
    setWorkspace(next);
    const selected = next.panes[pane];
    if (selected && selected !== activeSessionIdRef.current) {
      activeSessionIdRef.current = selected;
      onSelectSessionRef.current(selected);
    }
    setMenuAnchor(anchor);
  };

  const beginRename = (session: SSHSession) => {
    setMenuAnchor(null);
    startRename(session);
  };

  const sendInputToSession = (session: SSHSession, data: string) => {
    if (!window.electronAPI || !session.connected) return;
    if (session.type === 'local') {
      window.electronAPI.writeLocalTerm(session.id, data);
    } else if (session.type === 'serial') {
      window.electronAPI.writeSerial(session.id, data);
    } else {
      window.electronAPI.writeSSH(session.id, data);
    }
  };

  const sendInputWithBroadcast = (originSession: SSHSession, data: string) => {
    if (broadcastEnabledRef.current && workspaceRef.current.layout !== 'single') {
      const visibleIds = new Set(workspaceRef.current.panes.filter((id): id is string => Boolean(id)));
      sessionsRef.current.forEach((s) => {
        if (visibleIds.has(s.id)) {
          sendInputToSession(s, data);
        }
      });
      return;
    }
    sendInputToSession(originSession, data);
  };

  const pasteWithGuard = (sessionId: string, text: string) => {
    if (!text) return;
    if (settingsRef.current.confirmMultilinePaste && /[\r\n]/.test(text)) {
      setPendingPaste({ sessionId, text });
      return;
    }
    const term = terminalInstances.current.get(sessionId)?.term;
    if (term) {
      term.paste(text);
    }
  };

  const exportSessionLog = async (sessionId: string) => {
    const instance = terminalInstances.current.get(sessionId);
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (!instance || !window.electronAPI?.saveTextFile) return;
    const buffer = instance.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 1) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    const safeName = (session?.title || 'terminal').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const res = await window.electronAPI.saveTextFile({
      defaultName: `${safeName}_${timestamp}.log`,
      content: lines.join('\n') + '\n',
      title: 'Terminal-Verlauf speichern',
    });
    if (res?.saved) {
      onShowToastRef.current?.('Terminal-Verlauf erfolgreich gespeichert.', 'success', 3000);
    }
  };

  const handleRunSnippet = (snippet: CommandSnippet) => {
    const targetId = activeSessionIdRef.current;
    const session = sessionsRef.current.find((s) => s.id === targetId);
    if (!session) return;
    const payload = snippet.sendEnter ? `${snippet.command}\r` : snippet.command;
    sendInputWithBroadcast(session, payload);
    setIsSnippetsOpen(false);
    terminalInstances.current.get(session.id)?.term.focus();
  };

  const handleAddSnippet = (input: Omit<CommandSnippet, 'id'>) => {
    const next = [
      ...snippets,
      { ...input, id: `snip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` },
    ];
    setSnippets(next);
    saveSnippets(next);
  };

  const handleDeleteSnippet = (id: string) => {
    const next = snippets.filter((s) => s.id !== id);
    setSnippets(next);
    saveSnippets(next);
  };

  const focusPane = (pane: Pane) => {
    const targetId = workspaceRef.current.panes[pane];
    if (targetId) {
      selectSession(targetId, true);
    }
  };

  const switchSessionByKey = (event: KeyboardEvent) => {
    const all = sessionsRef.current;
    const currentIndex = all.findIndex((session) => session.id === activeSessionIdRef.current);
    let index: number | null = null;
    if (event.ctrlKey && !event.metaKey && event.key === 'Tab') {
      index = (currentIndex + (event.shiftKey ? -1 : 1) + all.length) % all.length;
    } else if (event.metaKey && event.shiftKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
      index = (currentIndex + (event.code === 'BracketLeft' ? -1 : 1) + all.length) % all.length;
    } else if (event.metaKey && !event.shiftKey && !event.altKey && /^Digit[1-9]$/.test(event.code)) {
      index = Number(event.code.slice(-1)) === 9 ? all.length - 1 : Number(event.code.slice(-1)) - 1;
    }
    if (index === null) return false;
    event.preventDefault();
    event.stopPropagation();
    if (all[index]) selectSession(all[index].id, true);
    return true;
  };

  const handleClearScreen = () => {
    const currentActiveId = activeSessionIdRef.current;
    if (!currentActiveId) return;
    const instance = terminalInstances.current.get(currentActiveId);
    if (instance) {
      instance.term.clear();
    }
  };

  const handleSerialBreak = () => {
    const currentActiveId = activeSessionIdRef.current;
    if (!currentActiveId) return;
    const active = sessionsRef.current.find((s) => s.id === currentActiveId);
    if (active?.type === 'serial' && window.electronAPI?.writeSerial) {
      window.electronAPI.writeSerial(currentActiveId, '\x03');
    }
  };

  useEffect(() => {
    if (!isVisible) {
      setMenuAnchor(null);
      cancelRename();
    }
  }, [isVisible]);

  useTerminalInstances({
    sessions,
    activeSessionId,
    isVisible,
    settings,
    vividColorsEnabled,
    renamingId,
    menuAnchor,
    terminalBridgeRef,
    containerRefs,
    terminalInstances,
    searchAddonsRef,
    settingsRef,
    vividColorsEnabledRef,
    activeSessionIdRef,
    sessionsRef,
    searchInputRef,
    scheduleFit,
    sendInputWithBroadcast,
    setContextMenu,
    setBellSessionIds,
    setActivitySessionIds,
    switchSessionByKey,
    onOpenCommandPaletteRef,
    changeLayout,
    workspaceRef,
    focusPane,
    copyTextToClipboard,
    readTextFromClipboard,
    pasteWithGuard,
    onNewLocalSessionRef,
    onCloseSessionRef,
    openSearchOverlay,
    closeSearchOverlay,
    isSearchOpenRef,
    setFontSize,
  });

  useTerminalShortcuts(isVisible, {
    switchSessionByKey,
    isSearchOpenRef,
    closeSearchOverlay,
    closePopovers: () => {
      setIsSettingsOpen(false);
      setIsSnippetsOpen(false);
    },
    changeLayout,
    openSearchOverlay,
    setFontSize,
  });

  // Re-run search if active session changes while search overlay is open
  useEffect(() => {
    if (isSearchOpen && searchQuery && activeSessionId) {
      findNext(searchQuery, caseSensitive, matchWholeWord);
    }
  }, [activeSessionId]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) || null;
  const paneChooser = (pane: Pane, sessionId: string | null) => (
    <PaneChooser
      pane={pane}
      sessionId={sessionId}
      isFocused={workspace.focused === pane}
      sessions={sessions}
      onFocusChooser={(focusedId) => {
        if (focusedId && focusedId !== activeSessionIdRef.current) selectSession(focusedId);
      }}
      onChooseSession={(chooserPane, chosenId) => {
        const next = { ...workspaceRef.current, focused: chooserPane };
        workspaceRef.current = next;
        setWorkspace(next);
        if (chosenId) selectSession(chosenId);
      }}
      onOpenSessionMenu={openSessionMenu}
    />
  );

  return (
    <div
      ref={rootContainerRef}
      className="relative h-full min-h-0 min-w-0 flex flex-col bg-zinc-950"
      onClick={() => {
        if (isSettingsOpen) setIsSettingsOpen(false);
        if (isSnippetsOpen) setIsSnippetsOpen(false);
      }}
    >
      <TerminalTabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        bellSessionIds={bellSessionIds}
        activitySessionIds={activitySessionIds}
        reconnectStates={reconnectStates}
        renamingId={renamingId}
        renameValue={renameValue}
        renameError={renameError}
        renameInputRef={renameInputRef}
        onRenameValueChange={changeRenameValue}
        onCommitRename={commitRename}
        onCancelRename={cancelRename}
        onBeginRename={beginRename}
        onSelectSession={(id) => selectSession(id, true)}
        onCloseSession={onCloseSession}
        isMenuOpen={!!menuAnchor}
        onMenuButtonClick={(anchor) => menuAnchor ? setMenuAnchor(null) : openSessionMenu(anchor)}
      />
      <TerminalToolbar
        layout={workspace.layout}
        onChangeLayout={changeLayout}
        activeSession={activeSession}
        onOpenSFTPForHost={onOpenSFTPForHost}
        onSerialBreak={handleSerialBreak}
        copiedBadgeVisible={copiedBadgeVisible}
        vividColorsEnabled={vividColorsEnabled}
        onToggleVividColors={() => setVividColorsEnabled((prev) => !prev)}
        onClearScreen={handleClearScreen}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        isSearchOpen={isSearchOpen}
        onOpenSearch={openSearchOverlay}
        isSplit={isSplit}
        broadcastEnabled={broadcastEnabled}
        onToggleBroadcast={() => setBroadcastEnabled((prev) => !prev)}
        onDuplicateSession={onDuplicateSession}
        isSnippetsOpen={isSnippetsOpen}
        onToggleSnippets={() => {
          setIsSettingsOpen(false);
          setIsSnippetsOpen((prev) => !prev);
        }}
        onSaveLog={(sessionId) => void exportSessionLog(sessionId)}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => {
          setIsSnippetsOpen(false);
          setIsSettingsOpen((prev) => !prev);
        }}
      />
      {menuAnchor && isVisible && (
        <NewSessionMenu
          menuRef={menuRef}
          position={menuPosition}
          hosts={hosts}
          onClose={() => setMenuAnchor(null)}
          onNewLocalSession={onNewLocalSession}
          onOpenSerialConnectModal={onOpenSerialConnectModal}
          onOpenNewHostModal={onOpenNewHostModal}
          onNewSessionFromHost={onNewSessionFromHost}
        />
      )}

      {/* Terminal Containers (One per session to preserve buffer state) */}
      <div
        ref={viewportRef}
        className="flex-1 min-h-0 min-w-0 relative overflow-hidden"
        style={{
          backgroundColor: vividColorsEnabled ? '#0c0e14' : '#09090b',
        }}
      >
        {isSearchOpen && (
          <TerminalSearchOverlay
            inputRef={searchInputRef}
            query={searchQuery}
            caseSensitive={caseSensitive}
            matchWholeWord={matchWholeWord}
            onQueryChange={changeQuery}
            onClearQuery={clearQuery}
            onFindNext={findNext}
            onFindPrevious={findPrevious}
            onToggleCaseSensitive={toggleCaseSensitive}
            onToggleWholeWord={toggleWholeWord}
            onClose={closeSearchOverlay}
          />
        )}

        {sessions.map((session) => {
          const index = workspace.panes.indexOf(session.id);
          const visible = index >= 0 && (isSplit || index === 0);
          const pane = (index < 0 ? 0 : index) as Pane;
          return (
            <SessionPane
              key={session.id}
              session={session}
              visible={visible}
              pane={pane}
              highlightBroadcast={isSplit && broadcastEnabled && visible}
              style={{ ...paneStyle(pane), display: visible ? 'flex' : 'none' }}
              chooser={isSplit && visible && paneChooser(pane, session.id)}
              reconnectState={reconnectStates[session.id]}
              surfaceRef={(element) => {
                if (element) containerRefs.current.set(session.id, element);
                else containerRefs.current.delete(session.id);
              }}
              onSurfacePointerDown={() => selectSession(session.id)}
              onTerminalFocus={() => {
                if (activeSessionIdRef.current !== session.id || workspaceRef.current.focused !== pane) selectSession(session.id);
              }}
              onReconnect={onReconnectSession && (() => {
                const inst = terminalInstances.current.get(session.id);
                onReconnectSession(session.id, inst?.term.cols, inst?.term.rows);
              })}
              onCancelAutoReconnect={onCancelAutoReconnect && (() => onCancelAutoReconnect(session.id))}
              onDuplicate={onDuplicateSession && (() => onDuplicateSession(session.id))}
              onDropPaths={(paths) => {
                sendInputWithBroadcast(session, paths.join(' ') + ' ');
                terminalInstances.current.get(session.id)?.term.focus();
              }}
            />
          );
        })}
        {([0, 1] as Pane[]).filter((pane) => (isSplit || pane === 0) && !workspace.panes[pane]).map((pane) => (
          <EmptyPane
            key={`empty-${pane}`}
            pane={pane}
            style={paneStyle(pane)}
            chooser={isSplit && paneChooser(pane, null)}
            hasSessions={sessions.length > 0}
            onOpenSessionMenu={openSessionMenu}
            onNewLocalSession={onNewLocalSession}
          />
        ))}
        {isSplit && (
          <SplitDivider
            layout={workspace.layout}
            splitRatio={splitRatio}
            bounds={ratioBounds()}
            onDrag={dragDividerTo}
            onStep={stepDivider}
          />
        )}
      </div>

      {isSettingsOpen && (
        <TerminalSettingsPopover
          settings={settings}
          onChange={updateSettings}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {isSnippetsOpen && (
        <TerminalSnippetsPopover
          snippets={snippets}
          onRunSnippet={handleRunSnippet}
          onAddSnippet={handleAddSnippet}
          onDeleteSnippet={handleDeleteSnippet}
          onClose={() => setIsSnippetsOpen(false)}
        />
      )}

      {contextMenu && (() => {
        const inst = terminalInstances.current.get(contextMenu.sessionId);
        const targetSession = sessions.find((s) => s.id === contextMenu.sessionId);
        if (!inst || !targetSession) return null;
        return (
          <TerminalContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            hasSelection={inst.term.hasSelection()}
            isConnected={targetSession.connected}
            onCopy={() => {
              if (inst.term.hasSelection()) {
                void copyTextToClipboard(inst.term.getSelection(), true);
              }
            }}
            onPaste={() => {
              void readTextFromClipboard().then((text) => {
                if (text) pasteWithGuard(targetSession.id, text);
              });
            }}
            onSelectAll={() => inst.term.selectAll()}
            onSearch={openSearchOverlay}
            onClear={() => inst.term.clear()}
            onSaveLog={() => void exportSessionLog(targetSession.id)}
            onReconnect={() => onReconnectSession?.(targetSession.id, inst.term.cols, inst.term.rows)}
            onDuplicate={() => onDuplicateSession?.(targetSession.id)}
            onSplitColumns={() => changeLayout('columns')}
            onSplitRows={() => changeLayout('rows')}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}

      {pendingPaste && (
        <MultilinePasteModal
          text={pendingPaste.text}
          onConfirm={(disableWarning) => {
            if (disableWarning) {
              updateSettings({ ...settings, confirmMultilinePaste: false });
            }
            const term = terminalInstances.current.get(pendingPaste.sessionId)?.term;
            if (term) {
              term.paste(pendingPaste.text);
              term.focus();
            }
            setPendingPaste(null);
          }}
          onCancel={() => {
            terminalInstances.current.get(pendingPaste.sessionId)?.term.focus();
            setPendingPaste(null);
          }}
        />
      )}
    </div>
  );
};
