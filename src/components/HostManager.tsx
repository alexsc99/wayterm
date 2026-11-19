import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SSHHost, SSHKeyFile, PortForward, PortForwardType } from '../types';
import {
  Server,
  Terminal,
  FolderGit2,
  Send,
  Edit2,
  Trash2,
  Key,
  Lock,
  Plus,
  X,
  DownloadCloud,
  AlertCircle,
  Cable,
  Search,
  MousePointerClick,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  Route,
  KeyRound,
  Settings2,
} from 'lucide-react';

// Port-forward rows are edited as strings and parsed on save.
interface ForwardDraft {
  id: string;
  type: PortForwardType;
  bindAddress: string;
  bindPort: string;
  targetHost: string;
  targetPort: string;
}

interface ForwardDraftErrors {
  bindAddress?: string;
  bindPort?: string;
  targetHost?: string;
  targetPort?: string;
}

const FORWARD_TYPE_LABELS: Record<PortForwardType, string> = {
  local: 'Lokal (-L)',
  remote: 'Remote (-R)',
  dynamic: 'Dynamisch (-D SOCKS)',
};

const FORWARD_TYPE_HELP: Record<PortForwardType, string> = {
  local: '-L: Port auf diesem Mac → Ziel vom Server aus gesehen (z.B. localhost:8080 hier → db:5432 vom Server aus).',
  remote: '-R: Port auf dem Server → Ziel von diesem Mac aus gesehen (z.B. Server :9000 → localhost:3000 hier).',
  dynamic: '-D: SOCKS5-Proxy auf diesem Mac; Verbindungen laufen über den Server (z.B. Browser-Proxy 127.0.0.1:1080).',
};

const parsePortValue = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
};

const validatePortField = (value: string, label: string): string | undefined => {
  if (!value.trim()) return `${label} erforderlich.`;
  return parsePortValue(value) === null ? `${label} muss eine ganze Zahl zwischen 1 und 65535 sein.` : undefined;
};

const validateForwardDrafts = (drafts: ForwardDraft[]): ForwardDraftErrors[] => {
  const errors: ForwardDraftErrors[] = drafts.map((d) => {
    const e: ForwardDraftErrors = {};
    if (/\s/.test(d.bindAddress.trim())) e.bindAddress = 'Bind-Adresse darf keine Leerzeichen enthalten.';
    e.bindPort = validatePortField(d.bindPort, 'Port');
    if (d.type !== 'dynamic') {
      const host = d.targetHost.trim();
      if (!host) e.targetHost = 'Ziel-Host erforderlich.';
      else if (/\s/.test(host)) e.targetHost = 'Ziel-Host darf keine Leerzeichen enthalten.';
      e.targetPort = validatePortField(d.targetPort, 'Ziel-Port');
    }
    return e;
  });
  // Local and dynamic bind on this Mac, remote binds on the server: same side + address + port collides.
  const seen = new Map<string, number>();
  drafts.forEach((d, i) => {
    const port = parsePortValue(d.bindPort);
    if (port === null) return;
    const side = d.type === 'remote' ? 'server' : 'mac';
    const key = `${side}|${d.bindAddress.trim() || '127.0.0.1'}|${port}`;
    if (seen.has(key)) {
      errors[i].bindPort = 'Dieser Port ist bereits in einer anderen Weiterleitung belegt.';
    } else {
      seen.set(key, i);
    }
  });
  return errors;
};

// True if following jumpHostId from `startId` leads back to `targetId`.
const jumpChainReaches = (hosts: SSHHost[], startId: string, targetId: string): boolean => {
  const visited = new Set<string>();
  let current: string | undefined = startId;
  while (current && !visited.has(current)) {
    if (current === targetId) return true;
    visited.add(current);
    current = hosts.find((h) => h.id === current)?.jumpHostId;
  }
  return false;
};

interface HostManagerProps {
  hosts: SSHHost[];
  keys: SSHKeyFile[];
  searchQuery: string;
  onSearchQueryChange?: (q: string) => void;
  isAddModalOpen: boolean;
  setIsAddModalOpen: (open: boolean) => void;
  newHostRequestId?: number;
  createAndConnect?: boolean;
  onSaveHost: (host: SSHHost) => Promise<boolean>;
  onDeleteHost: (id: string) => void;
  onConnectTerminal: (host: SSHHost) => void;
  onOpenSFTP: (host: SSHHost) => void;
  onOpenSCP: (host: SSHHost) => void;
  onImportSshConfig: () => void;
  onOpenSerialModal?: () => void;
}

export const HostManager: React.FC<HostManagerProps> = ({
  hosts,
  keys,
  searchQuery,
  onSearchQueryChange,
  isAddModalOpen,
  setIsAddModalOpen,
  onSaveHost,
  newHostRequestId = 0,
  createAndConnect = false,
  onDeleteHost,
  onConnectTerminal,
  onOpenSFTP,
  onOpenSCP,
  onImportSshConfig,
  onOpenSerialModal,
}) => {
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null);
  const [portInput, setPortInput] = useState<string>('22');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const saveAttemptRef = useRef(0);
  const [deletingHostId, setDeletingHostId] = useState<string | null>(null);
  type FilterType = 'all' | 'key' | 'password' | 'port22' | 'customPort';
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [forwardDrafts, setForwardDrafts] = useState<ForwardDraft[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [forwardSubmitAttempted, setForwardSubmitAttempted] = useState(false);
  const forwardErrors = useMemo(() => validateForwardDrafts(forwardDrafts), [forwardDrafts]);
  const forwardsInvalid = forwardErrors.some((e) => e.bindAddress || e.bindPort || e.targetHost || e.targetPort);
  const [localSearch, setLocalSearch] = useState<string>(searchQuery || '');

  useEffect(() => {
    setLocalSearch(searchQuery || '');
  }, [searchQuery]);

  const handleSearchChange = (val: string) => {
    setLocalSearch(val);
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    }
  };

  const totalCount = hosts.length;
  const keyCount = hosts.filter((h) => h.authType === 'key').length;
  const passwordCount = hosts.filter((h) => h.authType === 'password').length;
  const port22Count = hosts.filter((h) => (h.port || 22) === 22).length;
  const customPortCount = hosts.filter((h) => (h.port || 22) !== 22).length;

  const filterPills: { id: FilterType; label: string; count: number }[] = [
    { id: 'all', label: 'Alle', count: totalCount },
    { id: 'key', label: 'Mit SSH-Key', count: keyCount },
    { id: 'password', label: 'Mit Passwort', count: passwordCount },
    { id: 'port22', label: 'Port 22', count: port22Count },
    { id: 'customPort', label: 'Andere Ports', count: customPortCount },
  ];

  // Form State
  const [formData, setFormData] = useState<Partial<SSHHost>>({
    label: '',
    hostname: '',
    port: 22,
    username: 'root',
    authType: 'password',
    password: '',
    passphrase: '',
    keyPath: '',
  });

  const jumpCandidates = hosts.filter((h) => h.id !== editingHost?.id);
  const jumpError = (() => {
    const jumpId = formData.jumpHostId;
    if (!jumpId) return null;
    if (!hosts.some((h) => h.id === jumpId)) return 'Der gewählte Jump-Host existiert nicht mehr. Bitte einen anderen wählen.';
    if (editingHost && jumpId === editingHost.id) return 'Ein Host kann nicht sein eigener Jump-Host sein.';
    if (editingHost && jumpChainReaches(hosts, jumpId, editingHost.id)) {
      return 'Dieser Jump-Host nutzt (direkt oder indirekt) bereits diesen Host als Jump-Host – das ergäbe eine Schleife.';
    }
    return null;
  })();

  const resetNewHostDraft = () => {
    saveAttemptRef.current += 1;
    savingRef.current = false;
    setIsSaving(false);
    setEditingHost(null);
    setFormError(null);
    setFormData({
      label: '',
      hostname: '',
      port: 22,
      username: 'root',
      authType: 'password',
      password: '',
      passphrase: '',
      keyPath: keys.length > 0 ? keys[0].path : '',
    });
    setPortInput('22');
    setForwardDrafts([]);
    setForwardSubmitAttempted(false);
    setShowAdvanced(false);
  };

  useEffect(() => {
    if (newHostRequestId > 0) resetNewHostDraft();
  }, [newHostRequestId]);

  useEffect(() => {
    if (isAddModalOpen && !formData.keyPath && keys.length > 0) {
      setFormData((prev) => (prev.keyPath ? prev : { ...prev, keyPath: keys[0].path }));
    }
  }, [keys, isAddModalOpen, formData.keyPath]);

  const openAddModal = () => {
    resetNewHostDraft();
    setIsAddModalOpen(true);
  };

  const openEditModal = (host: SSHHost) => {
    setEditingHost(host);
    setFormError(null);
    setFormData({ ...host });
    setPortInput(String(host.port || 22));
    setForwardDrafts(
      (host.portForwards || []).map((f) => ({
        id: f.id,
        type: f.type,
        bindAddress: f.bindAddress || '',
        bindPort: String(f.bindPort ?? ''),
        targetHost: f.targetHost || '',
        targetPort: f.targetPort != null ? String(f.targetPort) : '',
      }))
    );
    setForwardSubmitAttempted(false);
    setShowAdvanced(!!(host.jumpHostId || host.agentForwarding || host.portForwards?.length));
    setIsAddModalOpen(true);
  };

  const closeModal = () => {
    saveAttemptRef.current += 1;
    savingRef.current = false;
    setIsSaving(false);
    setIsAddModalOpen(false);
    setEditingHost(null);
    setFormError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!formData.hostname?.trim()) {
      setFormError('Bitte gib einen Hostnamen oder eine IP-Adresse an.');
      return;
    }
    if (!formData.username?.trim()) {
      setFormError('Bitte gib einen Benutzernamen an.');
      return;
    }

    if (jumpError) {
      setShowAdvanced(true);
      setFormError(jumpError);
      return;
    }
    if (forwardsInvalid) {
      setShowAdvanced(true);
      setForwardSubmitAttempted(true);
      setFormError('Bitte korrigiere die markierten Port-Weiterleitungen.');
      return;
    }
    const parsedPort = parseInt(portInput, 10);
    const finalPort = Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 22;

    const hostToSave: SSHHost = {
      id: editingHost ? editingHost.id : `host_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: (formData.label && formData.label.trim()) || formData.hostname.trim(),
      hostname: formData.hostname.trim(),
      port: finalPort,
      username: formData.username.trim(),
      authType: formData.authType || 'password',
      password: formData.password || '',
      passphrase: formData.passphrase || '',
      keyPath: formData.keyPath || '',
      createdAt: editingHost ? editingHost.createdAt : Date.now(),
    };
    if (formData.jumpHostId) hostToSave.jumpHostId = formData.jumpHostId;
    if (formData.agentForwarding) hostToSave.agentForwarding = true;
    if (forwardDrafts.length > 0) {
      hostToSave.portForwards = forwardDrafts.map((d) => {
        const fwd: PortForward = { id: d.id, type: d.type, bindPort: parsePortValue(d.bindPort)! };
        const bindAddress = d.bindAddress.trim();
        if (bindAddress) fwd.bindAddress = bindAddress;
        if (d.type !== 'dynamic') {
          fwd.targetHost = d.targetHost.trim();
          fwd.targetPort = parsePortValue(d.targetPort)!;
        }
        return fwd;
      });
    }

    const attempt = ++saveAttemptRef.current;
    savingRef.current = true;
    setIsSaving(true);
    setFormError(null);
    try {
      const saved = await onSaveHost(hostToSave);
      if (attempt !== saveAttemptRef.current) return;
      if (saved) {
        closeModal();
      } else {
        setFormError('Host konnte nicht gespeichert werden. Bitte erneut versuchen.');
      }
    } catch (error) {
      if (attempt === saveAttemptRef.current) {
        setFormError(error instanceof Error ? error.message : 'Host konnte nicht gespeichert werden.');
      }
    } finally {
      if (attempt === saveAttemptRef.current) {
        savingRef.current = false;
        setIsSaving(false);
      }
    }
  };

  const filteredHosts = hosts.filter((h) => {
    if (activeFilter === 'key' && h.authType !== 'key') return false;
    if (activeFilter === 'password' && h.authType !== 'password') return false;
    if (activeFilter === 'port22' && (h.port || 22) !== 22) return false;
    if (activeFilter === 'customPort' && (h.port || 22) === 22) return false;

    const q = (localSearch || '').toLowerCase().trim();
    if (!q) return true;

    return (
      (h.label && h.label.toLowerCase().includes(q)) ||
      h.hostname.toLowerCase().includes(q) ||
      h.username.toLowerCase().includes(q) ||
      String(h.port || 22).includes(q)
    );
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            SSH-Server & Verbindungen
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Gespeicherte Remote-Hosts. Klicke auf Terminal, SFTP oder SCP für sofortige Verbindung.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenSerialModal && (
            <button
              onClick={onOpenSerialModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-600/10 hover:bg-amber-600/20 text-amber-300 text-xs font-medium transition-colors shadow-sm"
              title="Serielles USB-Kabel / Konsole verbinden"
            >
              <Cable className="w-3.5 h-3.5 text-amber-400" />
              <span>Serielles Gerät...</span>
            </button>
          )}
          <button
            onClick={onImportSshConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium transition-colors"
            title="Hosts aus ~/.ssh/config einlesen"
          >
            <DownloadCloud className="w-3.5 h-3.5" />
            <span>~/.ssh/config importieren</span>
          </button>
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Neuen Host anlegen</span>
          </button>
        </div>
      </div>
      {/* Search Bar & Filter Pills */}
      <div className="space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Hosts suchen nach Name, Hostname, IP oder Benutzer..."
            className="w-full bg-zinc-900/90 border border-zinc-800 focus:border-blue-500 rounded-xl pl-10 pr-10 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors shadow-inner"
          />
          {localSearch && (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 p-1 rounded-md transition-colors"
              title="Suche leeren"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {filterPills.map((pill) => {
            const isActive = activeFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setActiveFilter(pill.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                    : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-zinc-800'
                }`}
              >
                {pill.label} ({pill.count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Hosts List */}
      {filteredHosts.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl">
          <Server className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-zinc-300">Keine Hosts gefunden</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1 mb-4">
            {hosts.length === 0
              ? 'Lege deinen ersten SSH-Server an oder importiere bestehende Hosts aus deiner ~/.ssh/config.'
              : 'Keine Hosts entsprechen deinen Such- oder Filterkriterien.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            {hosts.length === 0 ? (
              <>
                <button
                  onClick={openAddModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Host hinzufügen
                </button>
                <button
                  onClick={onImportSshConfig}
                  className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
                >
                  <DownloadCloud className="w-4 h-4" />
                  Aus ~/.ssh/config laden
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  handleSearchChange('');
                  setActiveFilter('all');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
              >
                Filter zurücksetzen
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredHosts.map((h) => {
            const matchedKey = keys.find((k) => k.path === h.keyPath);
            return (
              <div
                key={h.id}
                onDoubleClick={() => onConnectTerminal(h)}
                className="group relative bg-zinc-900/70 hover:bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700 rounded-xl p-4 flex flex-col justify-between gap-3.5 transition-all cursor-pointer select-none"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                      <Server className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-zinc-100 truncate" title={h.label || h.hostname}>
                          {h.label || h.hostname}
                        </span>
                        <span className="text-xs text-zinc-400 font-mono truncate" title={`${h.username}@${h.hostname}:${h.port}`}>
                          {h.username}@{h.hostname}:{h.port}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-1 flex items-center gap-2">
                        {h.authType === 'key' ? (
                          <span className="flex items-center gap-1 text-emerald-400 truncate">
                            <Key className="w-3 h-3 shrink-0" />
                            <span className="truncate">Key: {matchedKey ? matchedKey.name : h.keyPath ? h.keyPath.split('/').pop() : 'SSH-Key'}</span>
                          </span>
                        ) : (
                          <span className={`flex items-center gap-1 truncate ${h.password ? 'text-zinc-400' : 'text-amber-400/90'}`}>
                            <Lock className="w-3 h-3 shrink-0" />
                            <span className="truncate">{h.password ? 'Passwort gespeichert' : 'Passwortabfrage bei Verbindung'}</span>
                          </span>
                        )}
                      </div>
                      {(h.jumpHostId || h.agentForwarding || (h.portForwards?.length ?? 0) > 0) && (
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {h.jumpHostId && (() => {
                            const jump = hosts.find((j) => j.id === h.jumpHostId);
                            const jumpLabel = jump ? jump.label || jump.hostname : 'gelöschter Host';
                            return (
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium max-w-[12rem] ${
                                  jump ? 'border-sky-500/30 bg-sky-500/10 text-sky-300' : 'border-red-500/30 bg-red-500/10 text-red-300'
                                }`}
                                title={`Verbindung über Jump-Host ${jumpLabel}`}
                              >
                                <Route className="w-3 h-3 shrink-0" />
                                <span className="truncate">via {jumpLabel}</span>
                              </span>
                            );
                          })()}
                          {h.agentForwarding && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-300 text-[10px] font-medium"
                              title="SSH-Agent wird weitergeleitet"
                            >
                              <KeyRound className="w-3 h-3 shrink-0" />
                              Agent
                            </span>
                          )}
                          {(h.portForwards?.length ?? 0) > 0 && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[10px] font-medium"
                              title={h.portForwards!
                                .map((f) =>
                                  f.type === 'dynamic'
                                    ? `-D ${f.bindAddress || '127.0.0.1'}:${f.bindPort}`
                                    : `${f.type === 'local' ? '-L' : '-R'} ${f.bindAddress || '127.0.0.1'}:${f.bindPort} → ${f.targetHost}:${f.targetPort}`
                                )
                                .join('\n')}
                            >
                              <ArrowRightLeft className="w-3 h-3 shrink-0" />
                              {h.portForwards!.length} {h.portForwards!.length === 1 ? 'Weiterleitung' : 'Weiterleitungen'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => openEditModal(h)}
                      className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                      title="Bearbeiten"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {deletingHostId === h.id ? (
                      <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-500/30 px-2 py-1 rounded-lg">
                        <span className="text-xs text-red-300 font-medium">Löschen?</span>
                        <button
                          onClick={() => {
                            onDeleteHost(h.id);
                            setDeletingHostId(null);
                          }}
                          className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[11px] font-medium rounded transition-colors"
                        >
                          Ja
                        </button>
                        <button
                          onClick={() => setDeletingHostId(null)}
                          className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] rounded transition-colors"
                        >
                          Nein
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingHostId(h.id)}
                        className="p-1.5 hover:bg-red-500/10 rounded-lg text-zinc-400 hover:text-red-400 transition-colors"
                        title="Löschen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Connection Actions & Double-click hint */}
                <div className="flex items-center justify-between pt-2.5 border-t border-zinc-800/60 mt-auto">
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onConnectTerminal(h)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-blue-600 hover:text-white text-zinc-200 text-xs font-medium transition-colors border border-zinc-700"
                      title="Terminal-Sitzung starten"
                    >
                      <Terminal className="w-3.5 h-3.5 text-blue-400 group-hover:text-white" />
                      <span>Terminal</span>
                    </button>

                    <button
                      onClick={() => onOpenSFTP(h)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-600 hover:text-white text-zinc-200 text-xs font-medium transition-colors border border-zinc-700"
                      title="SFTP Dateimanager öffnen"
                    >
                      <FolderGit2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>SFTP</span>
                    </button>

                    <button
                      onClick={() => onOpenSCP(h)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-purple-600 hover:text-white text-zinc-200 text-xs font-medium transition-colors border border-zinc-700"
                      title="SCP Befehl bauen"
                    >
                      <Send className="w-3.5 h-3.5 text-purple-400" />
                      <span>SCP</span>
                    </button>
                  </div>

                  <span className="text-[11px] text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0 ml-2 select-none pointer-events-none">
                    <MousePointerClick className="w-3 h-3 text-zinc-400" />
                    <span className="hidden sm:inline">Doppelklick zum Verbinden</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isAddModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="host-modal-title" className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 id="host-modal-title" className="font-semibold text-sm text-zinc-100">
                {editingHost ? 'Host bearbeiten' : 'Neuen SSH-Host anlegen'}
              </h3>
              <button
                onClick={closeModal}
                aria-label="Hostdialog schließen"
                title="Hostdialog schließen"
                className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} aria-busy={isSaving} className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormError(null)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div>
                <label htmlFor="host-label" className="block text-xs font-medium text-zinc-400 mb-1">
                  Server-Label / Anzeigename (optional)
                </label>
                <input
                  id="host-label"
                  type="text"
                  placeholder="z.B. Webserver Produktion"
                  value={formData.label || ''}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor="host-hostname" className="block text-xs font-medium text-zinc-400 mb-1">
                    Hostname oder IP *
                  </label>
                  <input
                    id="host-hostname"
                    autoFocus
                    type="text"
                    required
                    placeholder="192.168.1.100 oder server.de"
                    value={formData.hostname || ''}
                    onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="host-port" className="block text-xs font-medium text-zinc-400 mb-1">
                    Port
                  </label>
                  <input
                    id="host-port"
                    type="text"
                    inputMode="numeric"
                    placeholder="22"
                    value={portInput}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setPortInput(val);
                    }}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="host-username" className="block text-xs font-medium text-zinc-400 mb-1">
                  Benutzername *
                </label>
                <input
                  id="host-username"
                  type="text"
                  required
                  placeholder="root oder ubuntu"
                  value={formData.username || ''}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* Auth Type Selection */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Authentifizierungsmethode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, authType: 'key' })}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      formData.authType === 'key'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    SSH-Key (~/.ssh)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, authType: 'password' })}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      formData.authType === 'password'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Passwort
                  </button>
                </div>
              </div>

              {/* Conditional Auth Inputs */}
              {formData.authType === 'key' ? (
                <div className="space-y-3 p-3 bg-zinc-950/60 rounded-xl border border-zinc-800">
                  <div>
                    <label htmlFor="host-key" className="block text-xs font-medium text-zinc-400 mb-1">
                      Schlüssel aus ~/.ssh auswählen
                    </label>
                    {keys.length === 0 ? (
                      <p className="text-xs text-amber-400">
                        Keine Keys in ~/.ssh gefunden. Bitte wechsle oben auf den Reiter "SSH-Keys" und erstelle einen Schlüssel.
                      </p>
                    ) : (
                      <select
                        id="host-key"
                        value={formData.keyPath || (keys[0] ? keys[0].path : '')}
                        onChange={(e) => setFormData({ ...formData, keyPath: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                      >
                        {keys.map((k) => (
                          <option key={k.path} value={k.path}>
                            {k.name} ({k.type.toUpperCase()}) {k.isEncrypted ? '🔒 Passphrase' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label htmlFor="host-passphrase" className="block text-xs font-medium text-zinc-400 mb-1">
                      Key-Passphrase (falls der Schlüssel geschützt ist)
                    </label>
                    <input
                      id="host-passphrase"
                      type="password"
                      placeholder="Passphrase für Schlüssel"
                      value={formData.passphrase || ''}
                      onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800">
                  <label htmlFor="host-password" className="block text-xs font-medium text-zinc-400 mb-1">
                    Passwort (optional, wird sonst beim Verbinden abgefragt)
                  </label>
                  <input
                    id="host-password"
                    type="password"
                    placeholder="SSH-Passwort für Login..."
                    value={formData.password || ''}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Advanced: jump host, agent forwarding, port forwards */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  aria-expanded={showAdvanced}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100"
                >
                  <span className="flex items-center gap-1.5">
                    {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <Settings2 className="w-3.5 h-3.5 text-zinc-400" />
                    Erweitert
                  </span>
                  {!showAdvanced && (formData.jumpHostId || formData.agentForwarding || forwardDrafts.length > 0) && (
                    <span className="text-[10px] text-zinc-500">
                      {[
                        formData.jumpHostId ? 'Jump-Host' : null,
                        formData.agentForwarding ? 'Agent' : null,
                        forwardDrafts.length > 0
                          ? `${forwardDrafts.length} ${forwardDrafts.length === 1 ? 'Weiterleitung' : 'Weiterleitungen'}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </button>

                {showAdvanced && (
                  <div className="px-3 pb-3 space-y-4 border-t border-zinc-800 pt-3">
                    {/* Jump host */}
                    <div>
                      <label htmlFor="host-jump" className="block text-xs font-medium text-zinc-400 mb-1">
                        Jump-Host (ProxyJump)
                      </label>
                      <select
                        id="host-jump"
                        value={formData.jumpHostId || ''}
                        onChange={(e) => setFormData({ ...formData, jumpHostId: e.target.value || undefined })}
                        className={`w-full bg-zinc-900 border rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 ${
                          jumpError ? 'border-red-500/60' : 'border-zinc-700'
                        }`}
                      >
                        <option value="">Kein Jump-Host</option>
                        {formData.jumpHostId && !hosts.some((h) => h.id === formData.jumpHostId) && (
                          <option value={formData.jumpHostId}>Gelöschter Host (bitte neu wählen)</option>
                        )}
                        {jumpCandidates.map((h) => {
                          const cycle = !!editingHost && jumpChainReaches(hosts, h.id, editingHost.id);
                          return (
                            <option key={h.id} value={h.id} disabled={cycle && h.id !== formData.jumpHostId}>
                              {h.label || h.hostname} ({h.username}@{h.hostname}:{h.port || 22})
                              {cycle ? ' – Schleife' : ''}
                            </option>
                          );
                        })}
                      </select>
                      {jumpError ? (
                        <p className="text-[11px] text-red-400 mt-1">{jumpError}</p>
                      ) : (
                        <p className="text-[11px] text-zinc-500 mt-1">
                          Die Verbindung läuft über diesen gespeicherten Host; dessen Zugangsdaten werden für den Sprung genutzt.
                        </p>
                      )}
                    </div>

                    {/* Agent forwarding */}
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!formData.agentForwarding}
                        onChange={(e) => setFormData({ ...formData, agentForwarding: e.target.checked || undefined })}
                        className="mt-0.5 accent-blue-500"
                      />
                      <span>
                        <span className="block text-xs font-medium text-zinc-300">SSH-Agent weiterleiten</span>
                        <span className="block text-[11px] text-zinc-500">
                          Gibt deinen lokalen ssh-agent an den Server weiter (ssh -A). Nur bei vertrauenswürdigen Servern aktivieren.
                        </span>
                      </span>
                    </label>

                    {/* Port forwards */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-zinc-400">Port-Weiterleitungen</span>
                        <button
                          type="button"
                          onClick={() =>
                            setForwardDrafts((prev) => [
                              ...prev,
                              { id: crypto.randomUUID(), type: 'local', bindAddress: '', bindPort: '', targetHost: '', targetPort: '' },
                            ])
                          }
                          className="flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[11px] font-medium transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          Weiterleitung hinzufügen
                        </button>
                      </div>

                      {forwardDrafts.length === 0 ? (
                        <p className="text-[11px] text-zinc-500">
                          Keine Weiterleitungen. Sie werden beim Öffnen einer Terminal-Sitzung zu diesem Host automatisch aufgebaut.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {forwardDrafts.map((d, index) => {
                            const errs = forwardErrors[index] || {};
                            const shown = (field: keyof ForwardDraftErrors) =>
                              errs[field] && (forwardSubmitAttempted || d[field].trim() !== '') ? errs[field] : undefined;
                            const update = (patch: Partial<ForwardDraft>) =>
                              setForwardDrafts((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
                            const inputClass = (field: keyof ForwardDraftErrors) =>
                              `w-full bg-zinc-900 border rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 font-mono ${
                                shown(field) ? 'border-red-500/60' : 'border-zinc-700'
                              }`;
                            const rowErrors = (['bindAddress', 'bindPort', 'targetHost', 'targetPort'] as const)
                              .map((f) => shown(f))
                              .filter((m): m is string => !!m);
                            return (
                              <div key={d.id} className="p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2">
                                <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.7fr)_auto] gap-2 items-end">
                                  <div>
                                    <label htmlFor={`fwd-type-${d.id}`} className="block text-[10px] text-zinc-500 mb-0.5">Typ</label>
                                    <select
                                      id={`fwd-type-${d.id}`}
                                      value={d.type}
                                      onChange={(e) => update({ type: e.target.value as PortForwardType })}
                                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                                    >
                                      {(Object.keys(FORWARD_TYPE_LABELS) as PortForwardType[]).map((t) => (
                                        <option key={t} value={t}>{FORWARD_TYPE_LABELS[t]}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label htmlFor={`fwd-bind-${d.id}`} className="block text-[10px] text-zinc-500 mb-0.5">
                                      Bind-Adresse{d.type === 'remote' ? ' (Server)' : ''}
                                    </label>
                                    <input
                                      id={`fwd-bind-${d.id}`}
                                      type="text"
                                      placeholder="127.0.0.1"
                                      value={d.bindAddress}
                                      onChange={(e) => update({ bindAddress: e.target.value })}
                                      className={inputClass('bindAddress')}
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor={`fwd-port-${d.id}`} className="block text-[10px] text-zinc-500 mb-0.5">Port</label>
                                    <input
                                      id={`fwd-port-${d.id}`}
                                      type="text"
                                      inputMode="numeric"
                                      placeholder={d.type === 'dynamic' ? '1080' : '8080'}
                                      value={d.bindPort}
                                      onChange={(e) => update({ bindPort: e.target.value.replace(/[^0-9]/g, '') })}
                                      className={inputClass('bindPort')}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setForwardDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                                    className="p-1.5 mb-0.5 hover:bg-red-500/10 rounded-lg text-zinc-400 hover:text-red-400 transition-colors"
                                    title="Weiterleitung entfernen"
                                    aria-label="Weiterleitung entfernen"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {d.type !== 'dynamic' && (
                                  <div className="grid grid-cols-[minmax(0,2.3fr)_minmax(0,0.7fr)_auto] gap-2 items-end">
                                    <div>
                                      <label htmlFor={`fwd-thost-${d.id}`} className="block text-[10px] text-zinc-500 mb-0.5">
                                        Ziel-Host {d.type === 'local' ? '(vom Server aus)' : '(von diesem Mac aus)'}
                                      </label>
                                      <input
                                        id={`fwd-thost-${d.id}`}
                                        type="text"
                                        placeholder={d.type === 'local' ? 'db.intern oder localhost' : 'localhost'}
                                        value={d.targetHost}
                                        onChange={(e) => update({ targetHost: e.target.value })}
                                        className={inputClass('targetHost')}
                                      />
                                    </div>
                                    <div>
                                      <label htmlFor={`fwd-tport-${d.id}`} className="block text-[10px] text-zinc-500 mb-0.5">Ziel-Port</label>
                                      <input
                                        id={`fwd-tport-${d.id}`}
                                        type="text"
                                        inputMode="numeric"
                                        placeholder={d.type === 'local' ? '5432' : '3000'}
                                        value={d.targetPort}
                                        onChange={(e) => update({ targetPort: e.target.value.replace(/[^0-9]/g, '') })}
                                        className={inputClass('targetPort')}
                                      />
                                    </div>
                                    {/* Keeps columns aligned with the trash button above. */}
                                    <span className="w-[26px]" />
                                  </div>
                                )}

                                {rowErrors.length > 0 ? (
                                  <ul className="text-[11px] text-red-400 space-y-0.5">
                                    {rowErrors.map((m) => (
                                      <li key={`${index}-${m}`}>{m}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-[11px] text-zinc-500">{FORWARD_TYPE_HELP[d.type]}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  {isSaving ? 'Wird gespeichert…' : editingHost ? 'Änderungen speichern' : createAndConnect ? 'Anlegen & verbinden' : 'Host anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
