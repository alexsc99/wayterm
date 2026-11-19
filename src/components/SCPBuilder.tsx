import React, { useState, useEffect, useRef } from 'react';
import { SSHHost, SCPJob, TransferProgressEvent } from '../types';
import {
  Send,
  Copy,
  Check,
  FolderOpen,
  File,
  Terminal,
  Play,
  AlertCircle,
  X,
  CheckCircle,
  RefreshCw,
  Lock,
} from 'lucide-react';

interface SCPBuilderProps {
  hosts: SSHHost[];
  preselectedHost?: SSHHost | null;
  onExecuteSCP?: (
    host: SSHHost,
    localPath: string,
    remotePath: string,
    direction: 'upload' | 'download'
  ) => void;
}

interface SCPJobItem extends SCPJob {
  filesTransferred?: number;
  durationMs?: number;
  hostLabel?: string;
}

interface ActiveSCPTransferState {
  transferId: string;
  direction: 'upload' | 'download';
  hostLabel: string;
  localPath: string;
  remotePath: string;
  percent: number;
  transferred: number;
  total: number;
  speedBytesPerSec: number;
  currentFile: string;
  protocol: 'scp' | 'sftp';
  startedAt: number;
}

function formatShellPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === '~') {
    return '~';
  }
  if (trimmed.startsWith('~/')) {
    const escapedRest = trimmed.slice(2).replace(/(["\\$`])/g, '\\$1');
    return `~/"${escapedRest}"`;
  }
  const escapedFull = trimmed.replace(/(["\\$`])/g, '\\$1');
  return `"${escapedFull}"`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const SCPBuilder: React.FC<SCPBuilderProps> = ({
  hosts,
  preselectedHost,
  onExecuteSCP,
}) => {
  const [selectedHostId, setSelectedHostId] = useState<string>(
    preselectedHost ? preselectedHost.id : hosts[0] ? hosts[0].id : ''
  );
  const [direction, setDirection] = useState<'upload' | 'download'>('upload');
  const [localPath, setLocalPath] = useState<string>('~/backup.zip');
  const [remotePath, setRemotePath] = useState<string>('/var/www/backup.zip');

  // Flags
  const [recursive, setRecursive] = useState<boolean>(false);
  const [preserveTimes, setPreserveTimes] = useState<boolean>(true);
  const [compression, setCompression] = useState<boolean>(true);
  const [includeKey, setIncludeKey] = useState<boolean>(true);
  const [legacyProtocol, setLegacyProtocol] = useState<boolean>(true);

  const [copied, setCopied] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<ActiveSCPTransferState | null>(null);
  const [jobs, setJobs] = useState<SCPJobItem[]>([]);

  const activeTransferIdRef = useRef<string | null>(null);
  const cancelledTransferIdsRef = useRef<Record<string, boolean>>({});

  // Sync selectedHostId when preselectedHost prop updates
  useEffect(() => {
    if (preselectedHost) {
      setSelectedHostId(preselectedHost.id);
    }
  }, [preselectedHost]);

  // Default selectedHostId when hosts load if currently empty or invalid
  useEffect(() => {
    if ((!selectedHostId || !hosts.some((h) => h.id === selectedHostId)) && hosts.length > 0) {
      setSelectedHostId(preselectedHost ? preselectedHost.id : hosts[0].id);
    }
  }, [hosts, selectedHostId, preselectedHost]);

  // Subscribe to real-time transfer progress events
  useEffect(() => {
    if (!window.electronAPI?.onTransferProgress) return;
    const unsubscribe = window.electronAPI.onTransferProgress((data: TransferProgressEvent) => {
      if (!data || !data.transferId) return;

      if (activeTransferIdRef.current === data.transferId) {
        setActiveTransfer((prev) => {
          if (!prev || prev.transferId !== data.transferId) return prev;
          return {
            ...prev,
            percent: Math.min(100, Math.max(0, Math.round(data.percent ?? 0))),
            transferred: data.transferred ?? prev.transferred,
            total: data.total ?? prev.total,
            speedBytesPerSec: data.speedBytesPerSec ?? prev.speedBytesPerSec,
            currentFile: data.currentFile || prev.currentFile,
            protocol: data.protocol || prev.protocol,
          };
        });
      }

      setJobs((prev) =>
        prev.map((job) =>
          job.id === data.transferId
            ? {
                ...job,
                progress: Math.min(100, Math.max(0, Math.round(data.percent ?? 0))),
                bytesTransferred: data.transferred ?? job.bytesTransferred,
                totalBytes: data.total ?? job.totalBytes,
                speedBytesPerSec: data.speedBytesPerSec ?? job.speedBytesPerSec,
                currentFile: data.currentFile || job.currentFile,
                protocol: data.protocol || job.protocol,
              }
            : job
        )
      );
    });

    return unsubscribe;
  }, []);

  const activeHost = hosts.find((h) => h.id === selectedHostId) || hosts[0];

  const handlePickLocalFile = async () => {
    if (!window.electronAPI?.showOpenFileDialog) return;
    const file = await window.electronAPI.showOpenFileDialog({
      title: 'Lokale Datei wählen',
    });
    if (file) {
      setLocalPath(file);
      setErrorBanner(null);
    }
  };

  const handlePickLocalDirectory = async () => {
    if (!window.electronAPI?.showOpenDirectoryDialog) return;
    const dir = await window.electronAPI.showOpenDirectoryDialog({
      title: 'Lokalen Ordner wählen',
    });
    if (dir) {
      setLocalPath(dir);
      setErrorBanner(null);
      if (direction === 'upload') {
        setRecursive(true);
      }
    }
  };

  // Build the exact OpenSSH SCP command line
  const buildCommand = (): string => {
    if (!activeHost) return 'scp [Wähle einen Host]';

    const parts: string[] = ['scp'];

    if (legacyProtocol) {
      parts.push('-O');
    }

    // Port flag (-P, capital P for scp)
    if (activeHost.port && activeHost.port !== 22) {
      parts.push(`-P ${activeHost.port}`);
    }

    // Identity file flag (-i)
    if (includeKey && activeHost.authType === 'key' && activeHost.keyPath) {
      parts.push(`-i ${formatShellPath(activeHost.keyPath)}`);
    }

    if (recursive) parts.push('-r');
    if (preserveTimes) parts.push('-p');
    if (compression) parts.push('-C');

    const cleanLocal = localPath.trim() || 'datei.txt';
    const cleanRemote = remotePath.trim() || 'zielverzeichnis/';

    const rawHost = activeHost.hostname.trim();
    const formattedHost =
      rawHost.includes(':') && !rawHost.startsWith('[') && !rawHost.endsWith(']')
        ? `[${rawHost}]`
        : rawHost;

    const formattedLocal = formatShellPath(cleanLocal);
    const formattedRemote = formatShellPath(cleanRemote);
    const remoteTarget = `${activeHost.username}@${formattedHost}:${formattedRemote}`;

    if (direction === 'upload') {
      parts.push(formattedLocal);
      parts.push(remoteTarget);
    } else {
      parts.push(remoteTarget);
      parts.push(formattedLocal);
    }

    return parts.join(' ');
  };

  const command = buildCommand();

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCancelTransfer = async (transferId: string) => {
    if (!transferId) return;
    cancelledTransferIdsRef.current[transferId] = true;
    if (window.electronAPI?.cancelTransfer) {
      await window.electronAPI.cancelTransfer(transferId);
    }
  };

  const handleRun = async () => {
    if (!activeHost) {
      setErrorBanner('Bitte wähle zuerst einen Ziel-Server / Host aus.');
      return;
    }

    const trimmedLocal = localPath.trim();
    const trimmedRemote = remotePath.trim();

    if (!trimmedLocal || !trimmedRemote) {
      setErrorBanner('Bitte gib sowohl einen lokalen Pfad als auch einen Remote-Pfad an.');
      return;
    }

    setErrorBanner(null);

    if (onExecuteSCP) {
      onExecuteSCP(activeHost, trimmedLocal, trimmedRemote, direction);
    }

    if (!window.electronAPI?.executeSCP) {
      if (!onExecuteSCP) {
        setErrorBanner('Direkte SCP-Ausführung ist in dieser Umgebung nicht verfügbar.');
      }
      return;
    }

    const transferId = 'scp-' + Date.now();
    const startedAt = Date.now();
    const hostLabel = activeHost.label || `${activeHost.username}@${activeHost.hostname}`;
    const initialProtocol: 'scp' | 'sftp' = legacyProtocol ? 'scp' : 'sftp';

    activeTransferIdRef.current = transferId;
    delete cancelledTransferIdsRef.current[transferId];
    setActiveTransfer({
      transferId,
      direction,
      hostLabel,
      localPath: trimmedLocal,
      remotePath: trimmedRemote,
      percent: 0,
      transferred: 0,
      total: 0,
      speedBytesPerSec: 0,
      currentFile: trimmedLocal.split(/[\\/]/).pop() || trimmedRemote.split('/').pop() || '',
      protocol: initialProtocol,
      startedAt,
    });

    const newJob: SCPJobItem = {
      id: transferId,
      direction,
      hostId: activeHost.id,
      hostLabel,
      localPath: trimmedLocal,
      remotePath: trimmedRemote,
      recursive,
      preserveTimes,
      compression,
      legacyProtocol,
      status: 'running',
      progress: 0,
      bytesTransferred: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      protocol: initialProtocol,
      startedAt,
    };

    setJobs((prev) => [newJob, ...prev]);

    try {
      const result = await window.electronAPI.executeSCP({
        host: activeHost,
        direction,
        localPath: trimmedLocal,
        remotePath: trimmedRemote,
        transferId,
        recursive,
        preserveTimes,
        forceSCPProtocol: legacyProtocol,
      });

      const completedAt = Date.now();
      setJobs((prev) =>
        prev.map((job) =>
          job.id === transferId
            ? {
                ...job,
                status: 'completed',
                progress: 100,
                protocol: result.protocol,
                bytesTransferred: result.bytesTransferred,
                totalBytes: result.bytesTransferred,
                filesTransferred: result.filesTransferred,
                durationMs: result.durationMs,
                completedAt,
              }
            : job
        )
      );
    } catch (err: unknown) {
      const completedAt = Date.now();
      const durationMs = Math.max(1, completedAt - startedAt);
      const rawMessage = err instanceof Error ? err.message : String(err);
      const isCancelled =
        Boolean(cancelledTransferIdsRef.current[transferId]) ||
        rawMessage.toLowerCase().includes('abgebrochen') ||
        rawMessage.toLowerCase().includes('cancelled') ||
        rawMessage.toLowerCase().includes('canceled');

      setJobs((prev) =>
        prev.map((job) =>
          job.id === transferId
            ? {
                ...job,
                status: isCancelled ? 'cancelled' : 'error',
                durationMs,
                completedAt,
                error: isCancelled ? 'Übertragung abgebrochen' : rawMessage,
              }
            : job
        )
      );

      if (!isCancelled) {
        setErrorBanner(rawMessage);
      }
    } finally {
      if (activeTransferIdRef.current === transferId) {
        activeTransferIdRef.current = null;
        setActiveTransfer(null);
      }
    }
  };
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="border-b border-zinc-800 pb-4">
        <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <Send className="w-5 h-5 text-purple-400" />
          SCP-Befehlsgenerator & Schnellübertragung
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Erstelle vollständige, syntaktisch korrekte OpenSSH-Befehle für Dateiübertragungen und führe
          sie direkt aus oder kopiere sie in dein Terminal.
        </p>
      </div>

      {/* Main Builder Form */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-5">
        {/* Host Selection & Direction */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Ziel-Server / Host
            </label>
            {hosts.length === 0 ? (
              <p className="text-xs text-amber-400">
                Keine Hosts vorhanden. Bitte erstelle zuerst einen Host.
              </p>
            ) : (
              <select
                value={selectedHostId}
                onChange={(e) => setSelectedHostId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-purple-500"
              >
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label || h.hostname} ({h.username}@{h.hostname}:{h.port})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Richtung der Übertragung
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('upload')}
                className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  direction === 'upload'
                    ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>Upload (Mac &rarr; Server)</span>
              </button>
              <button
                type="button"
                onClick={() => setDirection('download')}
                className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  direction === 'download'
                    ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>Download (Server &rarr; Mac)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Path Inputs */}
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Lokaler Pfad (auf deinem Mac)
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={localPath}
                onChange={(e) => {
                  setLocalPath(e.target.value);
                  if (errorBanner) setErrorBanner(null);
                }}
                placeholder="/Users/.../datei.tar.gz"
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-purple-500 font-mono"
              />
              <button
                type="button"
                onClick={handlePickLocalFile}
                className="px-2.5 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 font-medium flex items-center gap-1 transition-colors shrink-0"
                title="Lokale Datei im Finder auswählen"
              >
                <File className="w-3.5 h-3.5 text-purple-400" />
                <span>Datei wählen</span>
              </button>
              <button
                type="button"
                onClick={handlePickLocalDirectory}
                className="px-2.5 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 font-medium flex items-center gap-1 transition-colors shrink-0"
                title="Lokalen Ordner im Finder auswählen"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>Ordner wählen</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Remote-Pfad (auf dem Server)
            </label>
            <input
              type="text"
              value={remotePath}
              onChange={(e) => {
                setRemotePath(e.target.value);
                if (errorBanner) setErrorBanner(null);
              }}
              placeholder="/var/www/ oder /home/user/data/"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>
        </div>

        {/* SCP Option Flags */}
        <div className="pt-2 border-t border-zinc-800 space-y-2.5">
          <label className="block text-xs font-medium text-zinc-400">
            SCP Parameter & Flags
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-700 text-purple-600 focus:ring-0"
              />
              <span>
                <strong className="font-mono text-purple-400">-r</strong> Rekursiv (Ordner)
              </span>
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={preserveTimes}
                onChange={(e) => setPreserveTimes(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-700 text-purple-600 focus:ring-0"
              />
              <span>
                <strong className="font-mono text-purple-400">-p</strong> Rechte beibehalten
              </span>
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={compression}
                onChange={(e) => setCompression(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-700 text-purple-600 focus:ring-0"
              />
              <span>
                <strong className="font-mono text-purple-400">-C</strong> Kompression
              </span>
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeKey}
                onChange={(e) => setIncludeKey(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-700 text-purple-600 focus:ring-0"
              />
              <span>
                <strong className="font-mono text-purple-400">-i</strong> Keyfile einbinden
              </span>
            </label>
          </div>

          <div className="pt-1">
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={legacyProtocol}
                onChange={(e) => setLegacyProtocol(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-700 text-purple-600 focus:ring-0"
              />
              <span>
                <strong className="font-mono text-purple-400">-O</strong>{' '}
                (Legacy SCP-Protokoll, empfohlen für OpenSSH 9+ &amp; Server ohne SFTP)
              </span>
            </label>
          </div>
        </div>

        {/* Live Command Preview Box */}
        <div className="pt-3 border-t border-zinc-800">
          <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-purple-400" />
              Generierter OpenSSH-Befehl (Live-Vorschau)
            </span>
            <span className="text-[11px] text-zinc-500">
              Sofort ausführbar im Mac-Terminal oder direkt hier
            </span>
          </label>

          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 flex items-center justify-between gap-3 font-mono text-xs text-emerald-400 overflow-x-auto shadow-inner">
            <span className="select-all break-all">{command}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-sans font-medium rounded-lg transition-colors border border-zinc-700"
                title="Befehl in die Zwischenablage kopieren"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Kopiert!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Kopieren</span>
                  </>
                )}
              </button>

              <button
                onClick={handleRun}
                disabled={Boolean(activeTransfer)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-sans font-medium rounded-lg transition-colors shadow-sm"
                title="Direkt über SFTP/SCP ausführen"
              >
                {activeTransfer ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Läuft...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Direkt ausführen</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Password Auth Info Note */}
          {activeHost && activeHost.authType === 'password' && (
            <div className="mt-2.5 flex items-start gap-2 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>Passwort-Authentifizierung:</strong> Der kopierte CLI-Befehl fragt im
                Terminal interaktiv nach dem Passwort, während{' '}
                <strong>&bdquo;Direkt ausführen&ldquo;</strong> das gespeicherte Host-Passwort
                automatisch verwendet.
              </span>
            </div>
          )}

          {/* Inline Error Banner */}
          {errorBanner && (
            <div className="mt-3 flex items-start justify-between gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-3.5 py-2.5 text-xs">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="break-all">{errorBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="text-red-400 hover:text-red-200 shrink-0"
                title="Fehlermeldung schließen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Real-time Active Transfer Progress Panel */}
          {activeTransfer && (
            <div className="mt-4 bg-zinc-950/90 border border-purple-500/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <RefreshCw className="w-4 h-4 text-purple-400 animate-spin shrink-0" />
                  <span className="text-xs font-medium text-zinc-100 truncate">
                    {activeTransfer.direction === 'upload' ? 'Upload zu' : 'Download von'}{' '}
                    {activeTransfer.hostLabel}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                    {activeTransfer.protocol.toUpperCase()}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCancelTransfer(activeTransfer.transferId)}
                  className="px-2.5 py-1 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Abbrechen</span>
                </button>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-purple-500 h-2 rounded-full transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.max(0, activeTransfer.percent))}%` }}
                />
              </div>

              {/* Progress Metrics */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 font-mono">
                <div className="truncate max-w-md" title={activeTransfer.currentFile}>
                  Datei: <span className="text-zinc-200">{activeTransfer.currentFile || '—'}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span>
                    {formatBytes(activeTransfer.transferred)}
                    {activeTransfer.total > 0 ? ` / ${formatBytes(activeTransfer.total)}` : ''}
                  </span>
                  {activeTransfer.speedBytesPerSec > 0 && (
                    <span className="text-purple-300">
                      {formatBytes(activeTransfer.speedBytesPerSec)}/s
                    </span>
                  )}
                  <span className="text-zinc-200 font-semibold">{activeTransfer.percent}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Session Transfer History / Job Log */}
      {jobs.length > 0 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Übertragungsprotokoll ({jobs.length})
            </h3>
            {jobs.some((j) => j.status !== 'running') && (
              <button
                type="button"
                onClick={() => setJobs((prev) => prev.filter((j) => j.status === 'running'))}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Verlauf leeren
              </button>
            )}
          </div>

          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-zinc-950 border border-zinc-800/80 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                  {job.status === 'completed' && (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
                  )}
                  {job.status === 'running' && (
                    <RefreshCw className="w-4 h-4 text-purple-400 animate-spin shrink-0 mt-0.5 sm:mt-0" />
                  )}
                  {(job.status === 'error' || job.status === 'cancelled') && (
                    <AlertCircle
                      className={`w-4 h-4 shrink-0 mt-0.5 sm:mt-0 ${
                        job.status === 'cancelled' ? 'text-amber-400' : 'text-red-400'
                      }`}
                    />
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-zinc-200">
                        {job.direction === 'upload' ? 'Upload' : 'Download'}
                      </span>
                      <span className="text-zinc-500">&bull;</span>
                      <span className="text-zinc-300 font-mono truncate">
                        {job.hostLabel || job.hostId}
                      </span>
                      {job.protocol && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {job.protocol.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono truncate mt-0.5">
                      {job.direction === 'upload'
                        ? `${job.localPath} → ${job.remotePath}`
                        : `${job.remotePath} → ${job.localPath}`}
                    </div>
                    {job.error && (
                      <div
                        className={`text-[11px] mt-1 ${
                          job.status === 'cancelled' ? 'text-amber-400' : 'text-red-400'
                        }`}
                      >
                        {job.error}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400 shrink-0">
                  {typeof job.filesTransferred === 'number' && (
                    <span>
                      {job.filesTransferred} {job.filesTransferred === 1 ? 'Datei' : 'Dateien'}
                    </span>
                  )}
                  {typeof job.bytesTransferred === 'number' && (
                    <span>{formatBytes(job.bytesTransferred)}</span>
                  )}
                  {typeof job.durationMs === 'number' && (
                    <span>
                      {job.durationMs < 1000
                        ? `${job.durationMs} ms`
                        : `${(job.durationMs / 1000).toFixed(1)} s`}
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-sans font-medium ${
                      job.status === 'completed'
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : job.status === 'running'
                        ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                        : job.status === 'cancelled'
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'bg-red-500/15 text-red-300 border border-red-500/30'
                    }`}
                  >
                    {job.status === 'completed'
                      ? 'Abgeschlossen'
                      : job.status === 'running'
                      ? `${job.progress ?? 0}%`
                      : job.status === 'cancelled'
                      ? 'Abgebrochen'
                      : 'Fehlgeschlagen'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
