import React, { useState, useEffect, useRef } from 'react';
import { SSHHost, RemoteFileItem, LocalFileItem } from '../types';
import {
  FolderGit2,
  Folder,
  File,
  ArrowUp,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Trash2,
  Edit2,
  FolderPlus,
  HardDrive,
  Cloud,
  CheckCircle,
  Lock,
  AlertCircle,
  X,
  Eye,
  EyeOff,
  Terminal,
  Send,
  Copy,
  Check,
  FileText,
} from 'lucide-react';
import { SFTPFileEditorModal } from './SFTPFileEditorModal';
import { useVirtualRows } from '../hooks/useVirtualRows';

interface SFTPExplorerProps {
  hosts: SSHHost[];
  /** Remote listing is only fetched while the SFTP tab is visible. */
  isActive: boolean;
  selectedHost: SSHHost | null;
  onSelectHost: (host: SSHHost) => void;
  onSaveHost?: (host: SSHHost) => void;
  onOpenTerminal?: (host: SSHHost) => void;
  onOpenSCP?: (host: SSHHost) => void;
}

export const SFTPExplorer: React.FC<SFTPExplorerProps> = ({
  hosts,
  selectedHost,
  isActive,
  onSelectHost,
  onSaveHost,
  onOpenTerminal,
  onOpenSCP,
}) => {
  // Interactive Auth / Password Prompt state
  const [authPrompt, setAuthPrompt] = useState<{
    host: SSHHost;
    error?: string;
    onSuccess: (password: string, save: boolean) => void;
  } | null>(null);
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [savePasswordCheck, setSavePasswordCheck] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  // Local state
  const [localPath, setLocalPath] = useState<string>('~');
  const [localFiles, setLocalFiles] = useState<LocalFileItem[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<LocalFileItem | null>(null);

  // Remote state
  const [remotePath, setRemotePath] = useState<string>('.');
  const [remoteFiles, setRemoteFiles] = useState<RemoteFileItem[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<RemoteFileItem | null>(null);
  const [loadingRemote, setLoadingRemote] = useState<boolean>(false);
  const [protocolMode, setProtocolMode] = useState<'sftp' | 'scp' | null>(null);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [editorFile, setEditorFile] = useState<RemoteFileItem | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorSaving, setEditorSaving] = useState(false);

  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Non-blocking status/error banner
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);

  // Inline modals / actions for Remote operations
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<RemoteFileItem | null>(null);
  const [renameItem, setRenameItem] = useState<RemoteFileItem | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');

  // Drag-and-drop state
  const [isDraggingOverLocal, setIsDraggingOverLocal] = useState<boolean>(false);
  const [isDraggingOverRemote, setIsDraggingOverRemote] = useState<boolean>(false);

  // Transfer state
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [transferProgress, setTransferProgress] = useState<number>(0);
  const [transferCurrentFile, setTransferCurrentFile] = useState<string | null>(null);
  const [transferSpeed, setTransferSpeed] = useState<number | null>(null);
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);
  const activeTransferIdRef = useRef<string | null>(null);

  // Race condition protection for host switching and directory loads
  const fetchRequestIdRef = useRef<number>(0);
  // Selected host whose initial listing was deferred until the tab becomes active
  const pendingInitialLoadRef = useRef<boolean>(false);

  // Keep refs for callbacks
  const hostRef = useRef(selectedHost);
  hostRef.current = selectedHost;
  const localPathRef = useRef(localPath);
  localPathRef.current = localPath;
  const remotePathRef = useRef(remotePath);
  remotePathRef.current = remotePath;

  const renderBreadcrumbSegments = (currentPath: string, onNavigate: (target: string) => void) => {
    if (!currentPath || currentPath === '.') {
      return <span className="font-mono text-zinc-400 text-xs">./ (Home)</span>;
    }
    const parts = currentPath.split('/').filter(Boolean);
    const isAbsolute = currentPath.startsWith('/');

    return (
      <div className="flex items-center gap-0.5 font-mono text-xs overflow-x-auto no-scrollbar py-0.5 max-w-full">
        <button
          type="button"
          onClick={() => onNavigate(isAbsolute ? '/' : '.')}
          className="px-1 py-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
        >
          {isAbsolute ? '/' : '.'}
        </button>
        {parts.map((part, index) => {
          const targetPath = (isAbsolute ? '/' : '') + parts.slice(0, index + 1).join('/');
          const isLast = index === parts.length - 1;
          return (
            <React.Fragment key={targetPath}>
              <span className="text-zinc-600 shrink-0">/</span>
              <button
                type="button"
                onClick={() => onNavigate(targetPath)}
                className={`px-1 py-0.5 rounded transition-colors cursor-pointer shrink-0 truncate max-w-[120px] ${
                  isLast
                    ? 'font-semibold text-zinc-200 hover:bg-zinc-800'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
                title={targetPath}
              >
                {part}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const handleOpenRemoteFile = async (file: RemoteFileItem) => {
    if (!selectedHost || !window.electronAPI?.readFileSFTP) return;
    try {
      setBannerMessage({ type: 'info', text: `Lade ${file.name}...` });
      const content = await window.electronAPI.readFileSFTP(selectedHost, file.path);
      setEditorFile(file);
      setEditorContent(content);
      setEditorModalOpen(true);
      setBannerMessage(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerMessage({ type: 'error', text: `Datei konnte nicht geladen werden: ${msg}` });
    }
  };

  const handleSaveRemoteFile = async (newContent: string) => {
    if (!selectedHost || !editorFile || !window.electronAPI?.writeFileSFTP) return;
    setEditorSaving(true);
    try {
      await window.electronAPI.writeFileSFTP(selectedHost, editorFile.path, newContent);
      setEditorContent(newContent);
      setBannerMessage({ type: 'success', text: `${editorFile.name} erfolgreich gespeichert.` });
      setTimeout(() => setBannerMessage(null), 3000);
      loadRemoteFiles(selectedHost, remotePath);
    } finally {
      setEditorSaving(false);
    }
  };
  const joinRemotePath = (basePath: string, name: string): string => {
    const cleanName = name.replace(/^\/+/, '');
    if (!basePath || basePath === '.') {
      return cleanName;
    }
    if (basePath === '/') {
      return `/${cleanName}`;
    }
    return `${basePath.replace(/\/+$/, '')}/${cleanName}`;
  };

  // Initialize local path and transfer progress listener
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getLocalHome().then((home) => {
        setLocalPath(home);
        loadLocalFiles(home);
      });

      const cleanup = window.electronAPI.onTransferProgress((data) => {
        if (!activeTransferIdRef.current || data.transferId === activeTransferIdRef.current) {
          setTransferProgress(data.percent);
          if (data.currentFile !== undefined) {
            setTransferCurrentFile(data.currentFile);
          }
          if (data.speedBytesPerSec !== undefined) {
            setTransferSpeed(data.speedBytesPerSec);
          }
          if (data.protocol) {
            setProtocolMode(data.protocol);
          }
        }
      });
      return () => {
        if (cleanup) cleanup();
      };
    }
  }, []);

  // When selected host changes, reset state immediately; fetch only while the tab is visible
  useEffect(() => {
    fetchRequestIdRef.current += 1;
    setRemoteFiles([]);
    setRemotePath('.');
    setSelectedRemote(null);
    setRemoteError(null);
    setProtocolMode(null);
    setDeleteConfirmItem(null);
    setRenameItem(null);
    setIsCreatingFolder(false);
    setNewFolderName('');
    setLoadingRemote(false);

    pendingInitialLoadRef.current = false;
    if (!selectedHost) return;
    if (isActive) {
      loadRemoteFiles(selectedHost, '.');
    } else {
      pendingInitialLoadRef.current = true;
    }
  }, [selectedHost]);

  // On activation, run the deferred initial load; already loaded listings are kept
  useEffect(() => {
    if (!isActive || !pendingInitialLoadRef.current || !hostRef.current) return;
    pendingInitialLoadRef.current = false;
    loadRemoteFiles(hostRef.current, '.');
  }, [isActive]);

  const localVirtual = useVirtualRows(localFiles.length, { rowGap: 4 });
  const remoteVirtual = useVirtualRows(remoteFiles.length, { rowGap: 4 });

  const loadLocalFiles = async (dir: string) => {
    if (!window.electronAPI) return;
    try {
      const items = await window.electronAPI.listLocalFiles(dir);
      setLocalFiles(items);
      setSelectedLocal(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerMessage({
        type: 'error',
        text: `Fehler beim Lesen des lokalen Verzeichnisses: ${msg}`,
      });
    }
  };
  const loadRemoteFiles = async (host: SSHHost, dir: string) => {
    if (!window.electronAPI) return;
    const requestId = ++fetchRequestIdRef.current;

    // If password auth and no password stored, prompt directly
    if (host.authType === 'password' && !host.password) {
      if (requestId !== fetchRequestIdRef.current) return;
      setAuthPasswordInput('');
      setSavePasswordCheck(true);
      setShowPassword(false);
      setAuthPrompt({
        host,
        onSuccess: async (password, save) => {
          const updatedHost: SSHHost = { ...host, password };
          if (save && onSaveHost) {
            onSaveHost(updatedHost);
          }
          onSelectHost(updatedHost);
          loadRemoteFiles(updatedHost, dir);
        },
      });
      return;
    }

    setLoadingRemote(true);
    setRemoteError(null);
    try {
      const items = await window.electronAPI.listSFTP(host, dir);
      if (requestId !== fetchRequestIdRef.current) return;
      setRemoteFiles(items);
      setRemotePath(dir);
      setSelectedRemote(null);
      setRemoteError(null);

      try {
        const mode = await window.electronAPI.getSFTPProtocolMode(host);
        if (requestId === fetchRequestIdRef.current) {
          setProtocolMode(mode);
        }
      } catch {
        if (requestId === fetchRequestIdRef.current) {
          setProtocolMode('sftp');
        }
      }
    } catch (err: unknown) {
      if (requestId !== fetchRequestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('Authentifizierung fehlgeschlagen') ||
        msg.includes('All configured authentication methods failed') ||
        msg.includes('authentication')
      ) {
        setAuthPasswordInput('');
        setSavePasswordCheck(true);
        setShowPassword(false);
        setAuthPrompt({
          host,
          error:
            'Authentifizierung fehlgeschlagen: Bitte Passwort oder SSH-Key-Passphrase eingeben.',
          onSuccess: async (password, save) => {
            const updatedHost: SSHHost = { ...host, password, passphrase: password };
            if (save && onSaveHost) {
              onSaveHost(updatedHost);
            }
            onSelectHost(updatedHost);
            loadRemoteFiles(updatedHost, dir);
          },
        });
      } else {
        setRemoteError(msg);
        setRemoteFiles([]);
      }
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setLoadingRemote(false);
      }
    }
  };

  const navigateLocalUp = () => {
    const parent = localPath.substring(0, localPath.lastIndexOf('/')) || '/';
    setLocalPath(parent);
    loadLocalFiles(parent);
  };

  const navigateRemoteUp = () => {
    if (!selectedHost) return;
    let targetPath: string;
    if (remotePath === '/') {
      targetPath = '/';
    } else if (remotePath === '.') {
      targetPath = '..';
    } else {
      const idx = remotePath.lastIndexOf('/');
      if (idx === -1) {
        targetPath = '.';
      } else {
        targetPath = remotePath.substring(0, idx) || '/';
      }
    }
    loadRemoteFiles(selectedHost, targetPath);
  };

  const uploadSingleItem = async (localItemPath: string, itemName: string): Promise<boolean> => {
    if (!selectedHost || !window.electronAPI) return false;
    const destRemote = joinRemotePath(remotePathRef.current, itemName);
    const transferId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    activeTransferIdRef.current = transferId;
    setActiveTransferId(transferId);
    setTransferStatus(`Lade hoch: ${itemName}...`);
    setTransferCurrentFile(itemName);
    setTransferSpeed(null);
    setTransferProgress(0);
    setBannerMessage(null);

    try {
      await window.electronAPI.uploadSFTP(selectedHost, localItemPath, destRemote, transferId);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('abgebrochen') || msg.toLowerCase().includes('cancel')) {
        setBannerMessage({ type: 'info', text: `Upload von "${itemName}" wurde abgebrochen.` });
      } else {
        setBannerMessage({ type: 'error', text: `Upload fehlgeschlagen (${itemName}): ${msg}` });
      }
      return false;
    } finally {
      if (activeTransferIdRef.current === transferId) {
        activeTransferIdRef.current = null;
        setActiveTransferId(null);
        setTransferCurrentFile(null);
        setTransferSpeed(null);
      }
    }
  };

  const downloadSingleItem = async (remoteItemPath: string, itemName: string): Promise<boolean> => {
    if (!selectedHost || !window.electronAPI) return false;
    const currentLocal = localPathRef.current;
    const destLocal =
      currentLocal === '/'
        ? `/${itemName}`
        : `${currentLocal.replace(/\/+$/, '')}/${itemName}`;
    const transferId = `download_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    activeTransferIdRef.current = transferId;
    setActiveTransferId(transferId);
    setTransferStatus(`Lade herunter: ${itemName}...`);
    setTransferCurrentFile(itemName);
    setTransferSpeed(null);
    setTransferProgress(0);
    setBannerMessage(null);

    try {
      await window.electronAPI.downloadSFTP(selectedHost, remoteItemPath, destLocal, transferId);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('abgebrochen') || msg.toLowerCase().includes('cancel')) {
        setBannerMessage({ type: 'info', text: `Download von "${itemName}" wurde abgebrochen.` });
      } else {
        setBannerMessage({ type: 'error', text: `Download fehlgeschlagen (${itemName}): ${msg}` });
      }
      return false;
    } finally {
      if (activeTransferIdRef.current === transferId) {
        activeTransferIdRef.current = null;
        setActiveTransferId(null);
        setTransferCurrentFile(null);
        setTransferSpeed(null);
      }
    }
  };

  // Upload Local -> Remote
  const handleUpload = async () => {
    if (!selectedHost || !selectedLocal) return;
    const ok = await uploadSingleItem(selectedLocal.path, selectedLocal.name);
    if (ok) {
      setTransferStatus('Upload erfolgreich!');
      setTimeout(() => setTransferStatus(null), 2500);
      loadRemoteFiles(selectedHost, remotePathRef.current);
    } else {
      setTransferStatus(null);
    }
  };

  // Download Remote -> Local
  const handleDownload = async () => {
    if (!selectedHost || !selectedRemote) return;
    const ok = await downloadSingleItem(selectedRemote.path, selectedRemote.name);
    if (ok) {
      setTransferStatus('Download erfolgreich!');
      setTimeout(() => setTransferStatus(null), 2500);
      loadLocalFiles(localPathRef.current);
    } else {
      setTransferStatus(null);
    }
  };

  const handleCancelTransfer = async () => {
    const idToCancel = activeTransferIdRef.current || activeTransferId;
    if (!idToCancel || !window.electronAPI) return;
    try {
      await window.electronAPI.cancelTransfer(idToCancel);
      activeTransferIdRef.current = null;
      setActiveTransferId(null);
      setTransferCurrentFile(null);
      setTransferSpeed(null);
      setTransferStatus(null);
      setBannerMessage({ type: 'info', text: 'Übertragung abgebrochen.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerMessage({ type: 'error', text: `Abbruch fehlgeschlagen: ${msg}` });
    }
  };

  // Drop onto Remote pane (from Local pane or macOS Finder)
  const handleDropOnRemote = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverRemote(false);
    if (!selectedHost) return;

    const localPayloadRaw = e.dataTransfer.getData('application/x-wayterm-local');
    if (localPayloadRaw) {
      try {
        const parsed: unknown = JSON.parse(localPayloadRaw);
        if (
          parsed &&
          typeof parsed === 'object' &&
          'path' in parsed &&
          typeof parsed.path === 'string' &&
          'name' in parsed &&
          typeof parsed.name === 'string' &&
          parsed.path &&
          parsed.name
        ) {
          const ok = await uploadSingleItem(parsed.path, parsed.name);
          if (ok) {
            setTransferStatus('Upload erfolgreich!');
            setTimeout(() => setTransferStatus(null), 2500);
            loadRemoteFiles(selectedHost, remotePathRef.current);
          } else {
            setTransferStatus(null);
          }
        }
      } catch {
        setBannerMessage({ type: 'error', text: 'Ungültige Drag-and-Drop-Daten.' });
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      let completedCount = 0;
      for (const file of files) {
        const filePath = 'path' in file && typeof file.path === 'string' ? file.path : '';
        if (!filePath) continue;
        const itemName = file.name || filePath.split(/[\\/]/).pop() || 'file';
        const ok = await uploadSingleItem(filePath, itemName);
        if (!ok) break;
        completedCount += 1;
      }
      if (completedCount > 0) {
        setTransferStatus(
          completedCount === 1
            ? 'Upload erfolgreich!'
            : `${completedCount} Elemente erfolgreich hochgeladen!`
        );
        setTimeout(() => setTransferStatus(null), 2500);
        loadRemoteFiles(selectedHost, remotePathRef.current);
      } else {
        setTransferStatus(null);
      }
    }
  };

  // Drop onto Local pane (from Remote pane)
  const handleDropOnLocal = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverLocal(false);
    if (!selectedHost) return;

    const remotePayloadRaw = e.dataTransfer.getData('application/x-wayterm-remote');
    if (!remotePayloadRaw) return;

    try {
      const parsed: unknown = JSON.parse(remotePayloadRaw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'path' in parsed &&
        typeof parsed.path === 'string' &&
        'name' in parsed &&
        typeof parsed.name === 'string' &&
        parsed.path &&
        parsed.name
      ) {
        const ok = await downloadSingleItem(parsed.path, parsed.name);
        if (ok) {
          setTransferStatus('Download erfolgreich!');
          setTimeout(() => setTransferStatus(null), 2500);
          loadLocalFiles(localPathRef.current);
        } else {
          setTransferStatus(null);
        }
      }
    } catch {
      setBannerMessage({ type: 'error', text: 'Ungültige Drag-and-Drop-Daten.' });
    }
  };

  // Confirm and execute remote deletion
  const handleConfirmDeleteRemote = async () => {
    if (!selectedHost || !deleteConfirmItem || !window.electronAPI) return;
    const itemToDelete = deleteConfirmItem;
    setDeleteConfirmItem(null);

    try {
      if (itemToDelete.isDirectory) {
        await window.electronAPI.deleteDirSFTP(selectedHost, itemToDelete.path);
      } else {
        await window.electronAPI.deleteFileSFTP(selectedHost, itemToDelete.path);
      }
      setBannerMessage({
        type: 'success',
        text: `"${itemToDelete.name}" wurde gelöscht.`,
      });
      loadRemoteFiles(selectedHost, remotePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerMessage({ type: 'error', text: `Fehler beim Löschen: ${msg}` });
    }
  };

  // Rename remote file or folder
  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHost || !renameItem || !window.electronAPI) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameItem.name) {
      setRenameItem(null);
      return;
    }

    const lastSlash = renameItem.path.lastIndexOf('/');
    const newPath =
      lastSlash === -1
        ? joinRemotePath(remotePath, trimmed)
        : joinRemotePath(renameItem.path.substring(0, lastSlash) || '/', trimmed);

    try {
      await window.electronAPI.renameSFTP(selectedHost, renameItem.path, newPath);
      setRenameItem(null);
      setBannerMessage({
        type: 'success',
        text: `"${renameItem.name}" wurde in "${trimmed}" umbenannt.`,
      });
      loadRemoteFiles(selectedHost, remotePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerMessage({ type: 'error', text: `Fehler beim Umbenennen: ${msg}` });
    }
  };

  // Create remote directory
  const handleCreateRemoteDirSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHost || !window.electronAPI) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    const newPath = joinRemotePath(remotePath, trimmed);

    try {
      await window.electronAPI.mkdirSFTP(selectedHost, newPath);
      setIsCreatingFolder(false);
      setNewFolderName('');
      setBannerMessage({
        type: 'success',
        text: `Ordner "${trimmed}" wurde erstellt.`,
      });
      loadRemoteFiles(selectedHost, remotePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerMessage({ type: 'error', text: `Fehler beim Erstellen des Ordners: ${msg}` });
    }
  };
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 p-4 space-y-3">
      {/* Top Bar: Host Selector & Status */}
      <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5">
        <div className="flex items-center gap-3">
          <FolderGit2 className="w-5 h-5 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-200">SFTP Dual-Pane:</span>

          <select
            value={selectedHost ? selectedHost.id : ''}
            onChange={(e) => {
              const h = hosts.find((item) => item.id === e.target.value);
              if (h) onSelectHost(h);
            }}
            className="bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
          >
            <option value="" disabled>
              -- Server für SFTP auswählen --
            </option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label || h.hostname} ({h.username}@{h.hostname})
              </option>
            ))}
          </select>
        </div>

        {transferStatus && (
          <div className="flex items-center gap-3 text-xs text-zinc-200 flex-wrap">
            <span className="font-medium text-zinc-200">{transferStatus}</span>
            {transferCurrentFile && (
              <span
                className="font-mono text-[11px] text-zinc-400 max-w-[160px] truncate"
                title={transferCurrentFile}
              >
                ({transferCurrentFile})
              </span>
            )}
            <div className="w-28 bg-zinc-800 rounded-full h-2 overflow-hidden border border-zinc-700">
              <div
                className="bg-emerald-500 h-full transition-all duration-200"
                style={{ width: `${transferProgress}%` }}
              />
            </div>
            <span className="font-mono text-zinc-300">{transferProgress}%</span>
            {transferSpeed !== null && transferSpeed > 0 && (
              <span className="font-mono text-[11px] text-emerald-400">
                {formatSize(transferSpeed)}/s
              </span>
            )}
            {activeTransferId && (
              <button
                type="button"
                onClick={handleCancelTransfer}
                className="px-2 py-0.5 bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 rounded text-[11px] font-medium transition-colors flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                <span>Abbrechen</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Non-blocking Status / Error Banner */}
      {bannerMessage && (
        <div
          className={`flex items-center justify-between px-4 py-2 rounded-xl border text-xs ${
            bannerMessage.type === 'error'
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : bannerMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {bannerMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            ) : (
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
            )}
            <span className="truncate">{bannerMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="p-1 hover:bg-zinc-800/60 rounded text-zinc-400 hover:text-zinc-200 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Dual-Pane View */}
      <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
        {/* Left Pane: Local Files */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDraggingOverLocal) setIsDraggingOverLocal(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setIsDraggingOverLocal(false);
            }
          }}
          onDrop={handleDropOnLocal}
          className={`relative bg-zinc-900/80 border rounded-xl flex flex-col overflow-hidden transition-all ${
            isDraggingOverLocal
              ? 'border-blue-500 ring-2 ring-blue-500/50 bg-blue-950/10'
              : 'border-zinc-800'
          }`}
        >
          {isDraggingOverLocal && (
            <div className="pointer-events-none absolute inset-0 bg-blue-500/10 backdrop-blur-[1px] flex items-center justify-center z-20">
              <div className="px-4 py-2 rounded-xl bg-zinc-900/95 border border-blue-500/50 text-blue-300 text-xs font-medium shadow-lg flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" />
                <span>Hier ablegen zum Herunterladen nach {localPath}</span>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
            <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
              <HardDrive className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="text-xs font-semibold text-zinc-300 shrink-0">Lokal</span>
              <div className="flex-1 min-w-0">
                {renderBreadcrumbSegments(localPath, (p) => loadLocalFiles(p))}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={navigateLocalUp}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
                title="Übergeordneter Ordner"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => loadLocalFiles(localPath)}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
                title="Aktualisieren"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Local File List */}
          <div
            ref={localVirtual.containerRef}
            onScroll={localVirtual.onScroll}
            className="flex-1 overflow-y-auto p-2 space-y-1"
          >
            {localVirtual.padTop > 0 && <div aria-hidden style={{ height: localVirtual.padTop }} />}
            {localFiles.slice(localVirtual.start, localVirtual.end).map((file) => {
              const isSelected = selectedLocal?.path === file.path;
              return (
                <div
                  key={file.path}
                  data-vrow
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'application/x-wayterm-local',
                      JSON.stringify({
                        path: file.path,
                        name: file.name,
                        isDirectory: file.isDirectory,
                      })
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => setSelectedLocal(file)}
                  onDoubleClick={() => {
                    if (file.isDirectory) {
                      setLocalPath(file.path);
                      loadLocalFiles(file.path);
                    }
                  }}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {file.isDirectory ? (
                      <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <File className="w-4 h-4 text-zinc-400 shrink-0" />
                    )}
                    <span className="truncate">{file.name}</span>
                  </div>
                  {!file.isDirectory && (
                    <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                      {formatSize(file.size)}
                    </span>
                  )}
                </div>
              );
            })}
            {localVirtual.padBottom > 0 && (
              <div aria-hidden style={{ height: localVirtual.padBottom }} />
            )}
          </div>

          {/* Local Action Bar */}
          <div className="p-2.5 border-t border-zinc-800 bg-zinc-900 flex items-center justify-between">
            <span className="text-[11px] text-zinc-400 truncate max-w-[65%]">
              {selectedLocal
                ? `Ausgewählt: ${selectedLocal.name}${selectedLocal.isDirectory ? ' (Ordner)' : ''}`
                : 'Keine Datei oder Ordner ausgewählt'}
            </span>
            <button
              onClick={handleUpload}
              disabled={!selectedLocal || !selectedHost || Boolean(activeTransferId)}
              className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
            >
              <span>Hochladen</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right Pane: Remote SFTP Files */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (selectedHost && !isDraggingOverRemote) {
              setIsDraggingOverRemote(true);
            }
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setIsDraggingOverRemote(false);
            }
          }}
          onDrop={handleDropOnRemote}
          className={`relative bg-zinc-900/80 border rounded-xl flex flex-col overflow-hidden transition-all ${
            isDraggingOverRemote
              ? 'border-emerald-500 ring-2 ring-emerald-500/50 bg-emerald-950/10'
              : 'border-zinc-800'
          }`}
        >
          {isDraggingOverRemote && (
            <div className="pointer-events-none absolute inset-0 bg-emerald-500/10 backdrop-blur-[1px] flex items-center justify-center z-20">
              <div className="px-4 py-2 rounded-xl bg-zinc-900/95 border border-emerald-500/50 text-emerald-300 text-xs font-medium shadow-lg flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                <span>Hier ablegen zum Hochladen nach {remotePath}</span>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
            <div className="flex items-center gap-2 min-w-0">
              <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-zinc-300 shrink-0">Remote</span>
              {selectedHost && protocolMode === 'sftp' && (
                <span
                  className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0"
                  title="Verbunden über SFTP-Subsystem"
                >
                  SFTP
                </span>
              )}
              {selectedHost && protocolMode === 'scp' && (
                <span
                  className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0 cursor-help"
                  title="SFTP-Subsystem ist auf dem Server nicht verfügbar. Wayterm verwendet automatisch den SSH/SCP-Modus."
                >
                  SCP-Fallback
                </span>
              )}
              <div className="flex-1 min-w-0">
                {renderBreadcrumbSegments(remotePath, (p) => selectedHost && loadRemoteFiles(selectedHost, p))}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  setIsCreatingFolder((prev) => !prev);
                  setNewFolderName('');
                  setRenameItem(null);
                }}
                disabled={!selectedHost}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                title="Neues Verzeichnis anlegen"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={navigateRemoteUp}
                disabled={!selectedHost}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                title="Übergeordneter Ordner"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => selectedHost && loadRemoteFiles(selectedHost, remotePath)}
                disabled={!selectedHost}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                title="Aktualisieren"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRemote ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* SCP-Fallback Mode Subtitle */}
          {selectedHost && protocolMode === 'scp' && (
            <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 text-[11px] text-amber-300">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">
                SFTP-Subsystem auf dem Server nicht verfügbar – Wayterm nutzt automatisch den SSH/SCP-Modus.
              </span>
            </div>
          )}

          {/* Inline New Folder Form */}
          {selectedHost && isCreatingFolder && (
            <form
              onSubmit={handleCreateRemoteDirSubmit}
              className="p-2.5 bg-zinc-900/95 border-b border-zinc-800 flex items-center gap-2"
            >
              <FolderPlus className="w-4 h-4 text-emerald-400 shrink-0" />
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Name des neuen Ordners..."
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                Erstellen
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingFolder(false);
                  setNewFolderName('');
                }}
                className="p-1 text-zinc-400 hover:text-zinc-200 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {/* Inline Rename Form */}
          {selectedHost && renameItem && (
            <form
              onSubmit={handleRenameSubmit}
              className="p-2.5 bg-zinc-900/95 border-b border-zinc-800 flex items-center gap-2"
            >
              <Edit2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Neuer Name..."
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                Umbenennen
              </button>
              <button
                type="button"
                onClick={() => setRenameItem(null)}
                className="p-1 text-zinc-400 hover:text-zinc-200 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {/* Remote File List */}
          <div
            ref={remoteVirtual.containerRef}
            onScroll={remoteVirtual.onScroll}
            className="flex-1 overflow-y-auto p-2 space-y-1"
          >
            {!selectedHost ? (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                Wähle oben einen Server aus, um dessen Dateien anzuzeigen.
              </div>
            ) : remoteError ? (
              remoteError.includes('SFTP-Subsystem') || remoteError.includes('subsystem: sftp') || remoteError.includes('sftp-server') ? (
                <div className="h-full flex flex-col items-center justify-center p-5 text-center max-w-lg mx-auto">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-semibold text-zinc-100 mb-1">
                    SFTP-Subsystem auf diesem Server nicht verfügbar
                  </h4>
                  <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                    Der SSH-Server hat den Start des SFTP-Dienstes verweigert (<span className="text-amber-300 font-mono text-[11px]">Unable to start subsystem: sftp</span>).
                  </p>

                  <div className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-left mb-4 space-y-2">
                    <div className="text-[11px] font-medium text-zinc-300 flex items-center justify-between">
                      <span>Lösung 1 (Debian/Ubuntu/Linux Server):</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText('sudo apt update && sudo apt install -y openssh-sftp-server');
                          setCopiedCommand(true);
                          setTimeout(() => setCopiedCommand(false), 2000);
                        }}
                        className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 bg-zinc-800 px-2 py-0.5 rounded transition-colors"
                      >
                        {copiedCommand ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedCommand ? 'Kopiert' : 'Kopieren'}</span>
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-emerald-400 bg-zinc-900/80 p-2 rounded border border-zinc-800/80 overflow-x-auto select-all">
                      sudo apt update && sudo apt install -y openssh-sftp-server
                    </pre>

                    <div className="text-[11px] font-medium text-zinc-300 pt-1 border-t border-zinc-800/60">
                      <span>Lösung 2 (/etc/ssh/sshd_config):</span>
                    </div>
                    <pre className="text-[11px] font-mono text-zinc-300 bg-zinc-900/80 p-2 rounded border border-zinc-800/80 overflow-x-auto select-all">
                      Subsystem sftp internal-sftp
                    </pre>
                    <p className="text-[10px] text-zinc-500">
                      Danach sshd neu starten: <code className="text-zinc-400 font-mono">sudo systemctl restart ssh</code>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-center">
                    {onOpenTerminal && selectedHost && (
                      <button
                        type="button"
                        onClick={() => onOpenTerminal(selectedHost)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                        title="Terminal mit diesem Host öffnen, um den Befehl auszuführen"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Im Terminal ausführen</span>
                      </button>
                    )}
                    {onOpenSCP && selectedHost && (
                      <button
                        type="button"
                        onClick={() => onOpenSCP(selectedHost)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                        title="SCP nutzen (funktioniert auch ohne SFTP-Subsystem)"
                      >
                        <Send className="w-3.5 h-3.5 text-purple-400" />
                        <span>SCP nutzen</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => selectedHost && loadRemoteFiles(selectedHost, remotePath)}
                      className="px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg text-xs transition-colors"
                    >
                      Erneut prüfen
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-red-400 max-w-sm mx-auto">
                  <AlertCircle className="w-8 h-8 mb-2 text-red-400" />
                  <p className="font-semibold text-zinc-200 mb-1">Fehler beim Laden des Verzeichnisses</p>
                  <p className="text-zinc-400 mb-3">{remoteError}</p>
                  <button
                    type="button"
                    onClick={() => selectedHost && loadRemoteFiles(selectedHost, remotePath)}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs"
                  >
                    Erneut versuchen
                  </button>
                </div>
              )
            ) : remoteFiles.length === 0 && !loadingRemote ? (
              <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                Verzeichnis ist leer.
              </div>
            ) : (
              <>
              {remoteVirtual.padTop > 0 && (
                <div aria-hidden style={{ height: remoteVirtual.padTop }} />
              )}
              {remoteFiles.slice(remoteVirtual.start, remoteVirtual.end).map((file) => {
                const isSelected = selectedRemote?.path === file.path;
                return (
                  <div
                    key={file.path}
                    data-vrow
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        'application/x-wayterm-remote',
                        JSON.stringify({
                          path: file.path,
                          name: file.name,
                          isDirectory: file.isDirectory,
                        })
                      );
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => setSelectedRemote(file)}
                    onDoubleClick={() => {
                      if (file.isDirectory && selectedHost) {
                        loadRemoteFiles(selectedHost, file.path);
                      } else if (!file.isDirectory && selectedHost) {
                        handleOpenRemoteFile(file);
                      }
                    }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 text-white'
                        : 'hover:bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {file.isDirectory ? (
                        <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <File className="w-4 h-4 text-zinc-400 shrink-0" />
                      )}
                      <span className="truncate">{file.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {file.permissions}
                      </span>
                      {!file.isDirectory && (
                        <span className="text-[11px] font-mono text-zinc-400">
                          {formatSize(file.size)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {remoteVirtual.padBottom > 0 && (
                <div aria-hidden style={{ height: remoteVirtual.padBottom }} />
              )}
              </>
            )}
          </div>

          {/* Remote Action Bar */}
          <div className="p-2.5 border-t border-zinc-800 bg-zinc-900 flex items-center justify-between">
            <button
              onClick={handleDownload}
              disabled={!selectedRemote || !selectedHost || Boolean(activeTransferId)}
              className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Herunterladen</span>
            </button>
            {selectedRemote && !selectedRemote.isDirectory && (
              <button
                type="button"
                onClick={() => handleOpenRemoteFile(selectedRemote)}
                className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-blue-300 text-xs font-medium rounded-lg transition-colors border border-blue-500/30 cursor-pointer"
                title="Datei im Editor ansehen / bearbeiten"
              >
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                <span>Bearbeiten</span>
              </button>
            )}

            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] text-zinc-400 truncate max-w-[160px]">
                {selectedRemote
                  ? `${selectedRemote.name}${selectedRemote.isDirectory ? ' (Ordner)' : ''}`
                  : ''}
              </span>
              {selectedRemote && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameItem(selectedRemote);
                      setRenameValue(selectedRemote.name);
                      setIsCreatingFolder(false);
                    }}
                    className="p-1 hover:bg-blue-500/10 text-zinc-400 hover:text-blue-400 rounded transition-colors"
                    title="Umbenennen"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmItem(selectedRemote)}
                    className="p-1 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 rounded transition-colors"
                    title="Auf Server löschen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-sm text-zinc-100">
                  {deleteConfirmItem.isDirectory ? 'Ordner löschen' : 'Datei löschen'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeleteConfirmItem(null)}
                className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Soll{' '}
                <span className="font-mono font-semibold text-zinc-100">
                  &quot;{deleteConfirmItem.name}&quot;
                </span>{' '}
                {deleteConfirmItem.isDirectory
                  ? 'inklusive aller enthaltenen Dateien und Unterordner '
                  : ''}
                auf dem Server wirklich unwiderruflich gelöscht werden?
              </p>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmItem(null)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteRemote}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                >
                  Endgültig löschen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* SFTP Interactive Auth Modal */}
      {authPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-zinc-100">
                    SFTP-Authentifizierung
                  </h3>
                  <p className="text-[11px] text-zinc-400 font-mono">
                    {authPrompt.host.username}@{authPrompt.host.hostname}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAuthPrompt(null)}
                className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const pass = authPasswordInput;
                const save = savePasswordCheck;
                const cb = authPrompt.onSuccess;
                setAuthPrompt(null);
                cb(pass, save);
              }}
              className="p-5 space-y-4"
            >
              {authPrompt.error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-2.5 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authPrompt.error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  {authPrompt.host.authType === 'key'
                    ? 'Passphrase für SSH-Schlüssel oder Server-Passwort'
                    : 'SSH-Passwort eingeben'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoFocus
                    required
                    value={authPasswordInput}
                    onChange={(e) => setAuthPasswordInput(e.target.value)}
                    placeholder="Passwort eingeben..."
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-3 pr-10 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={savePasswordCheck}
                  onChange={(e) => setSavePasswordCheck(e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-700 text-emerald-600 focus:ring-0"
                />
                <span>Passwort für diesen Host speichern</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setAuthPrompt(null)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                >
                  Verbinden
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remote File Quick Editor Modal */}
      {editorFile && (
        <SFTPFileEditorModal
          isOpen={editorModalOpen}
          onClose={() => setEditorModalOpen(false)}
          fileName={editorFile.name}
          filePath={editorFile.path}
          initialContent={editorContent}
          onSave={handleSaveRemoteFile}
          isSaving={editorSaving}
        />
      )}
    </div>
  );
};
