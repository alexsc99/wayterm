import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { version as appVersion } from '../package.json';
import { SSHHost, SSHKeyFile, SSHSession, SerialConfig, TerminalSessionType } from './types';
import { Navigation, ActiveTab } from './components/Navigation';
import { HostManager } from './components/HostManager';
import { KeyManager } from './components/KeyManager';
import { TerminalView, TerminalBridge, SessionReconnectState } from './components/TerminalView';
import { SFTPExplorer } from './components/SFTPExplorer';
import { SCPBuilder } from './components/SCPBuilder';
import { SerialConnectModal } from './components/SerialConnectModal';
import { CommandPalette } from './components/CommandPalette';
import { ToastContainer, ToastItem } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Lock, AlertCircle, X, Server, Search, Activity, Wifi, Terminal, Cable, Laptop, PanelLeft } from 'lucide-react';
import { loadTerminalSettings } from './utils/terminalSettings';

const OPEN_SESSIONS_STORAGE_KEY = 'putty_plus_open_sessions';
const AUTO_RECONNECT_DELAYS_S = [2, 4, 8, 16, 30];
const AUTO_RECONNECT_MAX_ATTEMPTS = 10;
// Retrying cannot fix these: rejected credentials/passphrase, or an unconfirmed/broken host key.
const AUTH_ERROR_PATTERN =
  /Authentifizierung fehlgeschlagen|authentication|Passphrase|passphrase|Encrypted private key|Cannot parse privateKey|decryption failed/i;
const HOST_KEY_ERROR_PATTERN = /Host-Schlüssel|Host-Key/;

/** Tab list entry in localStorage: references only (never host objects or secrets). */
interface PersistedSession {
  type: TerminalSessionType;
  hostId?: string;
  serialConfig?: SerialConfig;
  title: string;
}

interface PersistedSessionList {
  sessions: PersistedSession[];
  activeIndex: number;
}

const newSessionId = (prefix: 'local' | 'serial' | 'term') =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/** Password hosts without a stored password can only connect after the interactive prompt. */
const needsInteractiveAuth = (host: SSHHost) => host.authType === 'password' && !host.password;

const persistOpenSessions = (sessions: SSHSession[], activeSessionId: string | null) => {
  try {
    if (!loadTerminalSettings().restoreSessions) {
      localStorage.removeItem(OPEN_SESSIONS_STORAGE_KEY);
      return;
    }
    const list: PersistedSessionList = {
      sessions: sessions.map((session) => ({
        type: session.type,
        title: session.title,
        hostId: session.type === 'ssh' ? session.host?.id : undefined,
        serialConfig: session.type === 'serial' ? session.serialConfig : undefined,
      })),
      activeIndex: sessions.findIndex((session) => session.id === activeSessionId),
    };
    localStorage.setItem(OPEN_SESSIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota errors
  }
};

/** Invalid entries become null so indices stay aligned with activeIndex. */
const readPersistedSessions = (): { sessions: (PersistedSession | null)[]; activeIndex: number } | null => {
  try {
    const raw = localStorage.getItem(OPEN_SESSIONS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSessionList>;
    if (!Array.isArray(parsed.sessions)) return null;
    const sessions = parsed.sessions.map((entry: Partial<PersistedSession> | null) => {
      if (!entry || typeof entry.title !== 'string') return null;
      if (entry.type === 'local') return { type: entry.type, title: entry.title };
      if (entry.type === 'ssh' && typeof entry.hostId === 'string') {
        return { type: entry.type, title: entry.title, hostId: entry.hostId };
      }
      if (
        entry.type === 'serial' &&
        typeof entry.serialConfig?.path === 'string' &&
        typeof entry.serialConfig.baudRate === 'number'
      ) {
        return { type: entry.type, title: entry.title, serialConfig: entry.serialConfig };
      }
      return null;
    });
    return { sessions, activeIndex: typeof parsed.activeIndex === 'number' ? parsed.activeIndex : -1 };
  } catch {
    return null;
  }
};

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<ActiveTab>('hosts');
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [keys, setKeys] = useState<SSHKeyFile[]>([]);
  const [sessions, setSessions] = useState<SSHSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Mirrors for listeners/timers registered once; handleCloseTerminal also prunes sessionsRef eagerly.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const terminalBridgeRef = useRef<TerminalBridge | null>(null);
  const [reconnectStates, setReconnectStates] = useState<Record<string, SessionReconnectState>>({});
  const reconnectJobsRef = useRef(
    new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null; inFlight: boolean }>()
  );
  // Port-forward toasts already shown per session connection (`forwardId:state`).
  const forwardToastsRef = useRef(new Map<string, Set<string>>());
  const restoreStateRef = useRef<'pending' | 'running' | 'done'>('pending');

  // Modal & Selection state
  const [isAddHostModalOpen, setIsAddHostModalOpen] = useState(false);
  const [createAndConnectHost, setCreateAndConnectHost] = useState(false);
  const [newHostRequestId, setNewHostRequestId] = useState(0);
  const hostModalRequestRef = useRef(0);
  const [isSerialModalOpen, setIsSerialModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sftpSelectedHost, setSftpSelectedHost] = useState<SSHHost | null>(null);
  const [scpPreselectedHost, setScpPreselectedHost] = useState<SSHHost | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'warning' | 'info' = 'info',
    duration = 4500
  ) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };
  // Interactive Auth / Password Prompt State
  const [authPrompt, setAuthPrompt] = useState<{
    host: SSHHost;
    error?: string;
    onSuccess: (password: string, save: boolean) => void;
  } | null>(null);
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [savePasswordCheck, setSavePasswordCheck] = useState(true);

  // Load hosts from the secure store, migrating any legacy browser cache first.
  useEffect(() => {
    if (window.electronAPI) {
      loadData();

      // Listen for closed SSH and Local Terminal connections
      const unsubscribeSSHClosed = window.electronAPI.onSSHClosed?.(({ sessionId }) => {
        handleSSHClosed(sessionId);
      });
      const unsubscribeLocalClosed = window.electronAPI.onLocalTermClosed?.(({ sessionId }) => {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, connected: false } : s))
        );
      });

      return () => {
        if (typeof unsubscribeSSHClosed === 'function') {
          unsubscribeSSHClosed();
        }
        if (typeof unsubscribeLocalClosed === 'function') {
          unsubscribeLocalClosed();
        }
      };
    }
  }, []);

  const loadData = async () => {
    if (!window.electronAPI) return;
    try {
      const legacy = localStorage.getItem('terminus_hosts');
      let loadedHosts: SSHHost[];
      if (legacy !== null) {
        const parsed: unknown = JSON.parse(legacy);
        if (!Array.isArray(parsed)) throw new Error('Die alten Hostdaten haben ein ungültiges Format.');
        loadedHosts = await window.electronAPI.migrateHosts(parsed);
        localStorage.removeItem('terminus_hosts');
      } else {
        loadedHosts = await window.electronAPI.getHosts();
      }
      setHosts(loadedHosts);
      void restoreOpenSessions(loadedHosts);
      const loadedKeys = await window.electronAPI.listKeys();
      if (Array.isArray(loadedKeys)) setKeys(loadedKeys);
    } catch (err) {
      console.error('Fehler beim Laden der Daten:', err);
      showToast('Hostdaten konnten nicht sicher geladen oder migriert werden. Vorhandene Daten bleiben erhalten.', 'error', 10000);
    }
  };

  const refreshKeys = async () => {
    if (window.electronAPI) {
      try {
        const loadedKeys = await window.electronAPI.listKeys();
        setKeys(loadedKeys || []);
      } catch (err) {
        console.error('Fehler beim Aktualisieren der Keys:', err);
      }
    }
  };

  // Host Management
  const handleSaveHost = async (host: SSHHost): Promise<boolean> => {
    try {
      if (!window.electronAPI) throw new Error('Hostspeicher nicht verfügbar.');
      if (localStorage.getItem('terminus_hosts') !== null) throw new Error('Die Migration der alten Hostdaten ist noch nicht abgeschlossen.');
      const updated = await window.electronAPI.saveHost(host);
      setHosts(updated);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Host konnte nicht gespeichert werden: ${message}`, 'error', 10000);
      return false;
    }
  };

  const openNewHostModal = (connectAfterSave: boolean) => {
    hostModalRequestRef.current += 1;
    setNewHostRequestId(hostModalRequestRef.current);
    setCreateAndConnectHost(connectAfterSave);
    setIsAddHostModalOpen(true);
  };

  const handleHostModalOpenChange = (open: boolean) => {
    if (!open) {
      hostModalRequestRef.current += 1;
      setCreateAndConnectHost(false);
    }
    setIsAddHostModalOpen(open);
  };

  const handleSaveHostFromModal = async (host: SSHHost): Promise<boolean> => {
    const requestId = hostModalRequestRef.current;
    const connectAfterSave = createAndConnectHost;
    const saved = await handleSaveHost(host);
    if (saved && connectAfterSave && hostModalRequestRef.current === requestId) {
      setCreateAndConnectHost(false);
      void handleConnectTerminal(host);
    }
    return saved;
  };

  const handleDeleteHost = async (id: string) => {
    if (!confirm('Diesen Host wirklich löschen?')) return;
    try {
      if (!window.electronAPI) throw new Error('Hostspeicher nicht verfügbar.');
      if (localStorage.getItem('terminus_hosts') !== null) throw new Error('Die Migration der alten Hostdaten ist noch nicht abgeschlossen.');
      const updated = await window.electronAPI.deleteHost(id);
      setHosts(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Host konnte nicht gelöscht werden: ${message}`, 'error', 10000);
    }
  };

  const handleImportSshConfig = async () => {
    if (!window.electronAPI) return;
    try {
      if (localStorage.getItem('terminus_hosts') !== null) throw new Error('Die Migration der alten Hostdaten ist noch nicht abgeschlossen.');
      const configHosts = await window.electronAPI.getSSHConfigHosts();
      if (!configHosts || configHosts.length === 0) {
        alert('Keine Einträge in ~/.ssh/config gefunden.');
        return;
      }

      let imported = 0;
      let currentHosts = [...hosts];

      // First pass: map every import id to the id it will have once saved (existing or new),
      // so ProxyJump references resolve regardless of entry order.
      const savedIdByImportId = new Map<string, string>();
      const newEntries: { entry: Partial<SSHHost>; targetHost: string; id: string }[] = [];
      for (const entry of configHosts) {
        if (!entry.hostname && !entry.label) continue;
        const targetHost = entry.hostname || entry.label!;
        const existing =
          currentHosts.find((h) => h.hostname === targetHost || h.label === entry.label) ??
          newEntries.find((n) => n.targetHost === targetHost || n.entry.label === entry.label);
        const id = existing?.id ?? entry.id ?? `host_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        if (entry.id) savedIdByImportId.set(entry.id, id);
        if (!existing) newEntries.push({ entry, targetHost, id });
      }

      for (const { entry, targetHost, id } of newEntries) {
        const jumpHostId = entry.jumpHostId ? savedIdByImportId.get(entry.jumpHostId) : undefined;
        const newHost: SSHHost = {
          id,
          label: entry.label || targetHost,
          hostname: targetHost,
          port: entry.port || 22,
          username: entry.username || 'root',
          authType: entry.keyPath ? 'key' : 'password',
          keyPath: entry.keyPath,
          createdAt: Date.now(),
          ...(jumpHostId && jumpHostId !== id ? { jumpHostId } : {}),
          ...(entry.agentForwarding ? { agentForwarding: true } : {}),
          ...(entry.portForwards?.length ? { portForwards: entry.portForwards } : {}),
        };
        currentHosts = await window.electronAPI.saveHost(newHost);
        setHosts(currentHosts);
        imported++;
      }

      setHosts(currentHosts);

      alert(
        imported > 0
          ? `${imported} neue Hosts aus ~/.ssh/config erfolgreich importiert!`
          : 'Alle Hosts aus ~/.ssh/config sind bereits vorhanden.'
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Fehler beim Einlesen von ~/.ssh/config: ${message}`);
    }
  };

  // Terminal Sessions
  const removeTerminalSession = (sessionId: string) => {
    forwardToastsRef.current.delete(sessionId);
    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== sessionId);
      setActiveSessionId((current) =>
        next.some((session) => session.id === current)
          ? current
          : next.length > 0 ? next[next.length - 1].id : null
      );
      return next;
    });
  };

  const handleRenameSession = (id: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setSessions((prev) =>
      prev.map((session) => session.id === id ? { ...session, title: trimmedTitle } : session)
    );
  };

  // Opens the password/passphrase prompt; `then` receives the host carrying the entered secret.
  const requestCredentials = (
    host: SSHHost,
    error: string | undefined,
    then: (updatedHost: SSHHost) => void
  ) => {
    const isKeyAuth = host.authType === 'key';
    setAuthPasswordInput('');
    setSavePasswordCheck(true);
    setAuthPrompt({
      host,
      error:
        error === undefined
          ? undefined
          : isKeyAuth
            ? error.includes('Passphrase') || error.includes('passphrase')
              ? error
              : 'Passphrase für den privaten SSH-Schlüssel erforderlich oder Authentifizierung fehlgeschlagen.'
            : 'Authentifizierung fehlgeschlagen. Bitte überprüfe dein Passwort.',
      onSuccess: async (enteredValue, save) => {
        const updatedHost: SSHHost = isKeyAuth
          ? { ...host, passphrase: enteredValue }
          : { ...host, password: enteredValue };
        if (save) {
          await handleSaveHost(updatedHost);
        }
        then(updatedHost);
      },
    });
  };

  const handleConnectTerminal = async (host: SSHHost) => {
    // If password auth and no password saved, ask first
    if (needsInteractiveAuth(host)) {
      requestCredentials(host, undefined, executeTerminalConnect);
      return;
    }

    executeTerminalConnect(host);
  };

  const handleConnectLocalTerminal = async () => {
    const sessionId = newSessionId('local');
    const newSession: SSHSession = {
      id: sessionId,
      type: 'local',
      connected: false,
      title: 'MacBook (zsh)',
    };

    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(sessionId);
    setCurrentTab('terminal');

    if (window.electronAPI) {
      try {
        await window.electronAPI.connectLocalTerm(sessionId, 80, 24);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, connected: true } : s))
        );
      } catch (err: unknown) {
        removeTerminalSession(sessionId);
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Lokales Terminal konnte nicht gestartet werden: ${message}`, 'error');
      }
    }
  };

  const handleConnectSerial = async (config: SerialConfig, label?: string) => {
    const sessionId = newSessionId('serial');
    const portName = label || config.path.split('/').pop() || 'Serial';
    const newSession: SSHSession = {
      id: sessionId,
      type: 'serial',
      serialConfig: config,
      connected: false,
      title: `${portName} (${config.baudRate})`,
    };

    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(sessionId);
    setCurrentTab('terminal');

    if (window.electronAPI) {
      try {
        await window.electronAPI.connectSerial(sessionId, config);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, connected: true } : s))
        );
      } catch (err: unknown) {
        removeTerminalSession(sessionId);
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Serielle Verbindung fehlgeschlagen: ${message}`, 'error');
      }
    }
  };

  const executeTerminalConnect = async (host: SSHHost) => {
    const sessionId = newSessionId('term');
    const newSession: SSHSession = {
      id: sessionId,
      type: 'ssh',
      host,
      connected: false,
      title: host.label || host.hostname,
    };

    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(sessionId);
    setCurrentTab('terminal');
    if (window.electronAPI) {
      try {
        await window.electronAPI.connectSSH(sessionId, host, 80, 24);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, connected: true } : s))
        );
      } catch (err: unknown) {
        removeTerminalSession(sessionId);
        const msg = err instanceof Error ? err.message : String(err || '');

        if (AUTH_ERROR_PATTERN.test(msg)) {
          requestCredentials(host, msg, executeTerminalConnect);
        } else {
          showToast(`SSH-Verbindung fehlgeschlagen: ${msg}`, 'error');
        }
      }
    }
  };

  const disconnectSessionBackend = (session: SSHSession) => {
    if (!window.electronAPI) return;
    if (session.type === 'local') {
      void window.electronAPI.disconnectLocalTerm(session.id);
    } else if (session.type === 'serial') {
      void window.electronAPI.disconnectSerial(session.id);
    } else {
      void window.electronAPI.disconnectSSH(session.id);
    }
  };

  const handleCloseTerminal = (sessionId: string) => {
    const target = sessionsRef.current.find((s) => s.id === sessionId);
    stopAutoReconnect(sessionId);
    // Prune eagerly: the ssh:closed caused by this disconnect must never look like a drop.
    sessionsRef.current = sessionsRef.current.filter((s) => s.id !== sessionId);
    if (target) disconnectSessionBackend(target);
    removeTerminalSession(sessionId);
  };

  const handleReconnectSession = async (sessionId: string, cols = 80, rows = 24) => {
    const target = sessionsRef.current.find((s) => s.id === sessionId);
    if (!target || !window.electronAPI) return;
    // Manual reconnect replaces auto-reconnect; the backend cancels any handshake still pending for this id.
    stopAutoReconnect(sessionId);
    if (target.type === 'ssh') {
      if (target.host) await reconnectSSHSession(target, target.host, cols, rows);
      return;
    }
    try {
      if (target.type === 'local') {
        await window.electronAPI.connectLocalTerm(sessionId, cols, rows);
      } else if (target.serialConfig) {
        await window.electronAPI.connectSerial(sessionId, target.serialConfig);
      } else {
        return;
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, connected: true } : s))
      );
      showToast(`Sitzung "${target.title}" neu verbunden.`, 'success', 2500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Neuverbindung fehlgeschlagen: ${message}`, 'error');
    }
  };

  // Reconnects an existing SSH tab in place, prompting for credentials when needed.
  const reconnectSSHSession = async (target: SSHSession, host: SSHHost, cols: number, rows: number) => {
    const api = window.electronAPI;
    if (!api || !sessionsRef.current.some((s) => s.id === target.id)) return;
    const retry = (updatedHost: SSHHost) => void reconnectSSHSession(target, updatedHost, cols, rows);
    if (needsInteractiveAuth(host)) {
      requestCredentials(host, undefined, retry);
      return;
    }
    try {
      await api.connectSSH(target.id, host, cols, rows);
      if (!sessionsRef.current.some((s) => s.id === target.id)) {
        void api.disconnectSSH(target.id);
        return;
      }
      // Keep entered credentials in memory so later (auto-)reconnects do not prompt again.
      setSessions((prev) =>
        prev.map((s) => (s.id === target.id ? { ...s, host, connected: true } : s))
      );
      showToast(`Sitzung "${target.title}" neu verbunden.`, 'success', 2500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (AUTH_ERROR_PATTERN.test(message)) {
        requestCredentials(host, message, retry);
        return;
      }
      showToast(`Neuverbindung fehlgeschlagen: ${message}`, 'error');
    }
  };

  const handleDuplicateSession = (sessionId: string) => {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    if (target.type === 'local') {
      void handleConnectLocalTerminal();
    } else if (target.type === 'serial' && target.serialConfig) {
      void handleConnectSerial(target.serialConfig, target.title);
    } else if (target.type === 'ssh' && target.host) {
      void handleConnectTerminal(target.host);
    }
  };

  // ── Auto-reconnect (SSH) ──────────────────────────────────────────────
  // Job present = loop active. Timer pending = waiting; inFlight = connectSSH running.
  // Ends on success, tab close, manual reconnect/cancel, auth/host-key error, or after the last attempt.
  const setReconnectState = (sessionId: string, state: SessionReconnectState | null) => {
    setReconnectStates((prev) => {
      if (state) return { ...prev, [sessionId]: state };
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  };

  const stopAutoReconnect = (sessionId: string) => {
    const job = reconnectJobsRef.current.get(sessionId);
    if (!job) return;
    clearTimeout(job.timer ?? undefined);
    reconnectJobsRef.current.delete(sessionId);
    setReconnectState(sessionId, null);
  };

  const scheduleReconnectAttempt = (sessionId: string, reason: string) => {
    const job = reconnectJobsRef.current.get(sessionId);
    if (!job) return;
    const bridge = terminalBridgeRef.current;
    if (!loadTerminalSettings().autoReconnect) {
      stopAutoReconnect(sessionId);
      bridge?.writeNotice(sessionId, `${reason} – automatische Neuverbindung ist deaktiviert.`, 'warning');
      return;
    }
    if (job.attempt >= AUTO_RECONNECT_MAX_ATTEMPTS) {
      stopAutoReconnect(sessionId);
      bridge?.writeNotice(
        sessionId,
        `${reason} – automatische Neuverbindung nach ${AUTO_RECONNECT_MAX_ATTEMPTS} Versuchen beendet. „Neu verbinden“ für einen weiteren Versuch.`,
        'error'
      );
      return;
    }
    const delay = AUTO_RECONNECT_DELAYS_S[Math.min(job.attempt, AUTO_RECONNECT_DELAYS_S.length - 1)];
    const attempt = job.attempt + 1;
    bridge?.writeNotice(
      sessionId,
      `${reason} – neuer Versuch in ${delay} s (${attempt}/${AUTO_RECONNECT_MAX_ATTEMPTS}) …`,
      'warning'
    );
    setReconnectState(sessionId, {
      attempt,
      maxAttempts: AUTO_RECONNECT_MAX_ATTEMPTS,
      phase: 'waiting',
      delaySeconds: delay,
    });
    job.timer = setTimeout(() => {
      job.timer = null;
      void runReconnectAttempt(sessionId);
    }, delay * 1000);
  };

  const runReconnectAttempt = async (sessionId: string) => {
    const job = reconnectJobsRef.current.get(sessionId);
    if (!job || job.inFlight) return;
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    const api = window.electronAPI;
    if (!session?.host || !api) {
      stopAutoReconnect(sessionId);
      return;
    }
    if (!navigator.onLine) {
      // Waiting for the network does not consume an attempt; the `online` event resumes the loop.
      setReconnectState(sessionId, {
        attempt: job.attempt + 1,
        maxAttempts: AUTO_RECONNECT_MAX_ATTEMPTS,
        phase: 'offline',
      });
      return;
    }
    job.attempt += 1;
    job.inFlight = true;
    setReconnectState(sessionId, {
      attempt: job.attempt,
      maxAttempts: AUTO_RECONNECT_MAX_ATTEMPTS,
      phase: 'connecting',
    });
    const size = terminalBridgeRef.current?.getSize(sessionId);
    try {
      await api.connectSSH(sessionId, session.host, size?.cols ?? 80, size?.rows ?? 24);
      // Superseded by tab close/cancel (backend handshake aborted) or a manual reconnect that owns the id now.
      if (reconnectJobsRef.current.get(sessionId) !== job) return;
      stopAutoReconnect(sessionId);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, connected: true } : s))
      );
      terminalBridgeRef.current?.writeNotice(sessionId, 'Verbindung wiederhergestellt.', 'success');
    } catch (err: unknown) {
      if (reconnectJobsRef.current.get(sessionId) !== job) return;
      job.inFlight = false;
      const message = err instanceof Error ? err.message : String(err);
      if (AUTH_ERROR_PATTERN.test(message) || HOST_KEY_ERROR_PATTERN.test(message)) {
        stopAutoReconnect(sessionId);
        terminalBridgeRef.current?.writeNotice(
          sessionId,
          `${message} – automatische Neuverbindung beendet. „Neu verbinden“ für einen weiteren Versuch.`,
          'error'
        );
        showToast(`Automatische Neuverbindung für "${session.title}" beendet: ${message}`, 'error', 8000);
        return;
      }
      scheduleReconnectAttempt(sessionId, `Neuverbindung fehlgeschlagen: ${message}`);
    }
  };

  const handleCancelAutoReconnect = (sessionId: string) => {
    const job = reconnectJobsRef.current.get(sessionId);
    if (!job) return;
    // Abort a running handshake so a late success cannot silently revive the session.
    if (job.inFlight) void window.electronAPI?.disconnectSSH(sessionId);
    stopAutoReconnect(sessionId);
    terminalBridgeRef.current?.writeNotice(sessionId, 'Automatische Neuverbindung abgebrochen.', 'warning');
  };

  const handleSSHClosed = (sessionId: string) => {
    forwardToastsRef.current.delete(sessionId);
    // Tab already gone: closed by the user (Cmd+W, close button), not a drop.
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (!session) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, connected: false } : s))
    );
    // Only drops of an established connection qualify; failed connects reject connectSSH without ssh:closed.
    if (!session.connected || !session.host || reconnectJobsRef.current.has(sessionId)) return;
    if (!loadTerminalSettings().autoReconnect || needsInteractiveAuth(session.host)) return;
    reconnectJobsRef.current.set(sessionId, { attempt: 0, timer: null, inFlight: false });
    scheduleReconnectAttempt(sessionId, 'Verbindung getrennt');
  };

  // ── Restore tabs of the last run ───────────────────────────────────────
  const restoreOpenSessions = async (loadedHosts: SSHHost[]) => {
    if (restoreStateRef.current !== 'pending') return;
    restoreStateRef.current = 'running';
    const saved = loadTerminalSettings().restoreSessions ? readPersistedSessions() : null;
    const restored: SSHSession[] = [];
    let activeId: string | null = null;
    if (saved) {
      for (const [index, entry] of saved.sessions.entries()) {
        if (!entry) continue;
        let session: SSHSession | null = null;
        if (entry.type === 'local') {
          session = { id: newSessionId('local'), type: 'local', connected: false, title: entry.title };
        } else if (entry.type === 'serial' && entry.serialConfig) {
          session = {
            id: newSessionId('serial'),
            type: 'serial',
            serialConfig: entry.serialConfig,
            connected: false,
            title: entry.title,
          };
        } else {
          // Deleted hosts are skipped.
          const host = loadedHosts.find((h) => h.id === entry.hostId);
          if (host) session = { id: newSessionId('term'), type: 'ssh', host, connected: false, title: entry.title };
        }
        if (!session) continue;
        restored.push(session);
        if (index === saved.activeIndex) activeId = session.id;
      }
    }
    restoreStateRef.current = 'done';
    const api = window.electronAPI;
    if (restored.length === 0 || !api) return;

    // Commit synchronously so TerminalView creates terminals and data listeners before backends emit output.
    flushSync(() => {
      setSessions((prev) => [...restored, ...prev]);
      setActiveSessionId(activeId ?? restored[restored.length - 1].id);
      setCurrentTab('terminal');
    });

    let failed = 0;
    await Promise.all(
      restored.map(async (session) => {
        const size = terminalBridgeRef.current?.getSize(session.id);
        const cols = size?.cols ?? 80;
        const rows = size?.rows ?? 24;
        try {
          if (session.type === 'local') {
            await api.connectLocalTerm(session.id, cols, rows);
          } else if (session.type === 'serial' && session.serialConfig) {
            await api.connectSerial(session.id, session.serialConfig);
          } else if (session.host) {
            if (needsInteractiveAuth(session.host)) {
              terminalBridgeRef.current?.writeNotice(
                session.id,
                'Passwort erforderlich – „Neu verbinden“ klicken, um die Sitzung zu öffnen.',
                'warning'
              );
              return;
            }
            await api.connectSSH(session.id, session.host, cols, rows);
          }
          if (!sessionsRef.current.some((s) => s.id === session.id)) {
            disconnectSessionBackend(session);
            return;
          }
          setSessions((prev) =>
            prev.map((s) => (s.id === session.id ? { ...s, connected: true } : s))
          );
        } catch (err: unknown) {
          if (!sessionsRef.current.some((s) => s.id === session.id)) return;
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          terminalBridgeRef.current?.writeNotice(
            session.id,
            `Wiederherstellung fehlgeschlagen: ${message} – „Neu verbinden“ für einen weiteren Versuch.`,
            'error'
          );
        }
      })
    );
    if (failed > 0) {
      showToast(
        failed === 1
          ? '1 wiederhergestellte Sitzung konnte nicht verbunden werden.'
          : `${failed} wiederhergestellte Sitzungen konnten nicht verbunden werden.`,
        'warning'
      );
    }
  };

  // Listen for serial port disconnection events (e.g. cable unplugged)
  useEffect(() => {
    if (!window.electronAPI?.onSerialClosed) return;
    const unsubscribe = window.electronAPI.onSerialClosed(({ sessionId, error }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, connected: false } : s))
      );
      if (error) {
        console.warn(`Serial port ${sessionId} disconnected:`, error);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Auto-reconnect: retry at once when the network returns; drop timers on unmount.
  useEffect(() => {
    const jobs = reconnectJobsRef.current;
    const handleOnline = () => {
      for (const [sessionId, job] of Array.from(jobs)) {
        if (!job.inFlight) void runReconnectAttempt(sessionId);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      jobs.forEach((job) => clearTimeout(job.timer ?? undefined));
      jobs.clear();
    };
  }, []);

  // Persist the open tab list once restoring is settled (never before, or the saved list would be wiped).
  useEffect(() => {
    if (restoreStateRef.current === 'done') persistOpenSessions(sessions, activeSessionId);
  }, [sessions, activeSessionId]);

  // Also on quit, so toggling the setting with tabs open takes effect.
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (restoreStateRef.current === 'done') {
        persistOpenSessions(sessionsRef.current, activeSessionIdRef.current);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Port-forward status toasts: at most one per forward and state per connection.
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSSHForwardStatus?.((event) => {
      const session = sessionsRef.current.find((s) => s.id === event.sessionId);
      if (!session) return;
      const shown = forwardToastsRef.current.get(event.sessionId) ?? new Set<string>();
      const key = `${event.forwardId}:${event.state}`;
      if (shown.has(key)) return;
      shown.add(key);
      forwardToastsRef.current.set(event.sessionId, shown);
      const forward = session.host?.portForwards?.find((f) => f.id === event.forwardId);
      let label = 'Portweiterleitung';
      if (forward) {
        const bind =
          forward.bindAddress && forward.bindAddress !== '127.0.0.1'
            ? `${forward.bindAddress}:${forward.bindPort}`
            : String(forward.bindPort);
        label =
          forward.type === 'dynamic'
            ? `-D ${bind} (SOCKS5)`
            : `${forward.type === 'local' ? '-L' : '-R'} ${bind} → ${forward.targetHost ?? '?'}:${forward.targetPort ?? '?'}`;
      }
      if (event.state === 'error') {
        showToast(
          `Weiterleitung fehlgeschlagen (${label})${event.message ? `: ${event.message}` : ''}`,
          'error',
          8000
        );
      } else {
        showToast(`Weiterleitung aktiv: ${label}`, 'info', 3000);
      }
    });
    return () => unsubscribe?.();
  }, []);
  // Global Mac shortcuts: Cmd+T for new terminal tab, Cmd+W to close active terminal tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (e.metaKey && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (e.metaKey && e.code === 'KeyB') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      } else if (e.metaKey && e.code === 'KeyT') {
        e.preventDefault();
        handleConnectLocalTerminal();
      } else if (e.metaKey && e.code === 'KeyW' && currentTab === 'terminal' && activeSessionId) {
        e.preventDefault();
        handleCloseTerminal(activeSessionId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTab, activeSessionId, sessions]);

  // SFTP & SCP
  const handleOpenSFTP = (host: SSHHost) => {
    setSftpSelectedHost(host);
    setCurrentTab('sftp');
  };

  const handleOpenSCP = (host: SSHHost) => {
    setScpPreselectedHost(host);
    setCurrentTab('scp');
  };

  const handleExecuteSCP = (
    host: SSHHost,
    _localPath: string,
    _remotePath: string,
    _direction: 'upload' | 'download'
  ) => {
    setScpPreselectedHost(host);
    setCurrentTab('scp');
  };

  // Keys
  const handleGenerateKey = async (options: {
    name: string;
    type: 'ed25519' | 'rsa';
    comment?: string;
    passphrase?: string;
  }) => {
    if (window.electronAPI) {
      await window.electronAPI.generateKey(options);
      await refreshKeys();
    }
  };

  const handleDeleteKey = async (keyPath: string) => {
    if (!confirm('Diesen Schlüssel wirklich aus ~/.ssh löschen?')) return;
    if (window.electronAPI) {
      try {
        await window.electronAPI.deleteKey(keyPath);
        await refreshKeys();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        alert(`Fehler beim Löschen: ${message}`);
      }
    }
  };

  const handleOpenFinder = (filePath?: string) => {
    if (window.electronAPI) {
      window.electronAPI.openInFinder(filePath);
    }
  };

  const tabTitles: Record<ActiveTab, string> = {
    hosts: 'SSH-Hosts & Server',
    terminal: 'Terminal',
    sftp: 'SFTP Dateimanager',
    scp: 'SCP Befehlsgenerator',
    keys: 'SSH-Schlüsselverwaltung (~/.ssh)',
  };

  return (
    <div className="h-screen w-screen flex flex-row bg-zinc-950 overflow-hidden select-none">
      {/* Sidebar Navigation */}
      <Navigation
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        activeSessionCount={sessions.length}
        onNewHost={() => {
          setCurrentTab('hosts');
          openNewHostModal(false);
        }}
        onOpenSerialModal={() => setIsSerialModalOpen(true)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 bg-zinc-950">
        {/* Top window drag bar & breadcrumbs */}
        <header className="h-10 shrink-0 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between px-5 titlebar-drag-region select-none">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors no-drag cursor-pointer mr-1"
              title={isSidebarCollapsed ? 'Seitenleiste ausklappen (⌘B)' : 'Seitenleiste einklappen (⌘B)'}
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-zinc-500 font-medium">PuTTY+</span>
            <span className="text-zinc-700">/</span>
            <span className="text-zinc-200 font-medium">{tabTitles[currentTab]}</span>
          </div>
          <div className="flex items-center gap-3 no-drag">
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              title="Befehlspalette öffnen (⌘K)"
            >
              <Search className="w-3.5 h-3.5 text-zinc-400" />
              <span>Befehl oder Host suchen...</span>
              <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 font-mono text-[10px] text-zinc-400">
                ⌘K
              </span>
            </button>

            <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
              {currentTab === 'terminal' && sessions.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px]">
                  {sessions.length} {sessions.length === 1 ? 'Sitzung' : 'Sitzungen'}
                </span>
              )}
              {currentTab === 'hosts' && (
                <span>{hosts.length} {hosts.length === 1 ? 'Host' : 'Hosts'}</span>
              )}
            </div>
          </div>
        </header>
        {/* Viewport */}
        <main className="flex-1 min-h-0 relative overflow-hidden">
          <div className={currentTab === 'hosts' ? 'h-full w-full overflow-y-auto' : 'hidden'}>
            <ErrorBoundary area="Host-Verwaltung">
              <HostManager
                hosts={hosts}
                keys={keys}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                isAddModalOpen={isAddHostModalOpen}
                setIsAddModalOpen={handleHostModalOpenChange}
                newHostRequestId={newHostRequestId}
                createAndConnect={createAndConnectHost}
                onSaveHost={handleSaveHostFromModal}
                onDeleteHost={handleDeleteHost}
                onConnectTerminal={handleConnectTerminal}
                onOpenSFTP={handleOpenSFTP}
                onOpenSCP={handleOpenSCP}
                onImportSshConfig={handleImportSshConfig}
                onOpenSerialModal={() => setIsSerialModalOpen(true)}
              />
            </ErrorBoundary>
          </div>

          <div className={currentTab === 'terminal' ? 'h-full w-full' : 'hidden'}>
            <ErrorBoundary area="Terminal">
              <TerminalView
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={setActiveSessionId}
                onCloseSession={handleCloseTerminal}
                onRenameSession={handleRenameSession}
                onReconnectSession={handleReconnectSession}
                onDuplicateSession={handleDuplicateSession}
                onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
                onShowToast={showToast}
                hosts={hosts}
                onNewSessionFromHost={handleConnectTerminal}
                onNewLocalSession={handleConnectLocalTerminal}
                onOpenNewHostModal={() => openNewHostModal(true)}
                onOpenSerialConnectModal={() => setIsSerialModalOpen(true)}
                onOpenSFTPForHost={handleOpenSFTP}
                reconnectStates={reconnectStates}
                onCancelAutoReconnect={handleCancelAutoReconnect}
                terminalBridgeRef={terminalBridgeRef}
                isVisible={currentTab === 'terminal'}
              />
            </ErrorBoundary>
          </div>

          <div className={currentTab === 'sftp' ? 'h-full w-full' : 'hidden'}>
            <ErrorBoundary area="SFTP-Explorer">
              <SFTPExplorer
                hosts={hosts}
                isActive={currentTab === 'sftp'}
                selectedHost={sftpSelectedHost || (hosts[0] || null)}
                onSelectHost={setSftpSelectedHost}
                onSaveHost={handleSaveHost}
                onOpenTerminal={(host) => {
                  handleConnectTerminal(host);
                  setCurrentTab('terminal');
                }}
                onOpenSCP={(host) => {
                  setScpPreselectedHost(host);
                  setCurrentTab('scp');
                }}
              />
            </ErrorBoundary>
          </div>

          <div className={currentTab === 'scp' ? 'h-full w-full overflow-y-auto' : 'hidden'}>
            <ErrorBoundary area="SCP-Übertragung">
              <SCPBuilder
                hosts={hosts}
                preselectedHost={scpPreselectedHost || (hosts[0] || null)}
                onExecuteSCP={handleExecuteSCP}
              />
            </ErrorBoundary>
          </div>

          <div className={currentTab === 'keys' ? 'h-full w-full overflow-y-auto' : 'hidden'}>
            <ErrorBoundary area="SSH-Schlüsselverwaltung">
              <KeyManager
                keys={keys}
                onRefresh={refreshKeys}
                onGenerateKey={handleGenerateKey}
                onDeleteKey={handleDeleteKey}
                onOpenFinder={handleOpenFinder}
              />
            </ErrorBoundary>
          </div>
        </main>

        {/* Bottom Telemetry & Status Bar */}
        {(() => {
          const activeSession = sessions.find((s) => s.id === activeSessionId);
          return (
            <footer className="h-6 shrink-0 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between px-3 text-[11px] font-mono text-zinc-400 select-none z-10">
              <div className="flex items-center gap-2.5 truncate max-w-[65%]">
                {activeSession ? (
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        activeSession.connected ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                    />
                    <span className="font-semibold text-zinc-200 shrink-0">
                      {activeSession.type === 'ssh' ? (
                        'SSH-2.0'
                      ) : activeSession.type === 'serial' ? (
                        'Serial'
                      ) : (
                        'Local Shell'
                      )}
                    </span>
                    <span className="text-zinc-600">&bull;</span>
                    <span className="text-zinc-300 truncate">{activeSession.title}</span>
                    {activeSession.host && (
                      <>
                        <span className="text-zinc-600">&bull;</span>
                        <span className="text-zinc-400 truncate">
                          {activeSession.host.username}@{activeSession.host.hostname}:{activeSession.host.port}
                        </span>
                        <span className="text-zinc-600">&bull;</span>
                        <span className="text-blue-400 shrink-0">
                          {activeSession.host.authType === 'key' ? 'Key-Auth' : 'Passwort'}
                        </span>
                      </>
                    )}
                    {activeSession.serialConfig && (
                      <>
                        <span className="text-zinc-600">&bull;</span>
                        <span className="text-amber-400 shrink-0">
                          {activeSession.serialConfig.baudRate} bps 8N1
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-zinc-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
                    <span>Bereit</span>
                    <span className="text-zinc-700">&bull;</span>
                    <span>Keine aktive Sitzung</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 text-zinc-500 text-[10px] shrink-0">
                {currentTab === 'terminal' && activeSession && (
                  <>
                    <span className="text-zinc-400">UTF-8</span>
                    <span className="text-zinc-700">|</span>
                    <span className="text-zinc-400">LF</span>
                    <span className="text-zinc-700">|</span>
                  </>
                )}
                <span className="text-zinc-400">PuTTY+ v{appVersion}</span>
                <span className="text-zinc-700">|</span>
                <span>macOS arm64</span>
              </div>
            </footer>
          );
        })()}
      </div>

      {/* Interactive Auth Prompt Modal */}
      {authPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-zinc-100 flex items-center gap-2">
                <Lock className="w-4 h-4 text-blue-400" />
                {authPrompt.host.authType === 'key'
                  ? 'Schlüssel-Passphrase'
                  : 'SSH-Passwort erforderlich'}
              </h3>
              <button
                onClick={() => setAuthPrompt(null)}
                className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!authPasswordInput) {
                  alert(
                    authPrompt.host.authType === 'key'
                      ? 'Bitte gib die Schlüssel-Passphrase ein.'
                      : 'Bitte gib das Passwort ein.'
                  );
                  return;
                }
                const promptAction = authPrompt.onSuccess;
                setAuthPrompt(null);
                promptAction(authPasswordInput, savePasswordCheck);
              }}
              className="p-5 space-y-4"
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <Server className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-mono text-zinc-200 truncate">
                    {authPrompt.host.username}@{authPrompt.host.hostname}:{authPrompt.host.port}
                  </span>
                </div>

                {authPrompt.error && (
                  <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2 text-xs text-red-300">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{authPrompt.error}</span>
                  </div>
                )}

                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {authPrompt.host.authType === 'key'
                    ? 'Passphrase für den privaten SSH-Schlüssel eingeben'
                    : 'Passwort'}
                </label>
                <input
                  type="password"
                  autoFocus
                  required
                  placeholder={
                    authPrompt.host.authType === 'key'
                      ? 'Passphrase für den privaten SSH-Schlüssel eingeben...'
                      : 'Passwort eingeben...'
                  }
                  value={authPasswordInput}
                  onChange={(e) => setAuthPasswordInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={savePasswordCheck}
                  onChange={(e) => setSavePasswordCheck(e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-700 text-blue-600 focus:ring-0"
                />
                <span>
                  {authPrompt.host.authType === 'key'
                    ? 'Passphrase für diesen Host speichern'
                    : 'Passwort für diesen Host speichern'}
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setAuthPrompt(null)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                >
                  Verbinden
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Serial Connection Configuration Modal */}
      <ErrorBoundary area="Serielle Verbindung" variant="overlay">
        <SerialConnectModal
          isOpen={isSerialModalOpen}
          onClose={() => setIsSerialModalOpen(false)}
          onConnect={handleConnectSerial}
        />
      </ErrorBoundary>

      {/* Command Palette (⌘K) */}
      <ErrorBoundary area="Befehlspalette" variant="overlay">
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          hosts={hosts}
          onConnectSSH={handleConnectTerminal}
          onConnectLocal={handleConnectLocalTerminal}
          onOpenSerialModal={() => setIsSerialModalOpen(true)}
          onSelectTab={setCurrentTab}
          activeSessions={sessions}
          onSelectSession={setActiveSessionId}
        />
      </ErrorBoundary>

      {/* Toast Notification Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
