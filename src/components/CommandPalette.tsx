import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Server,
  Terminal,
  FolderGit2,
  Send,
  Key,
  Cable,
  CornerDownLeft,
  Palette,
  X,
} from 'lucide-react';
import { SSHHost, SSHSession } from '../types';
import { ActiveTab } from './Navigation';
import { APP_THEMES } from '../utils/appThemes';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: SSHHost[];
  onConnectSSH: (host: SSHHost) => void;
  onConnectLocal: () => void;
  onOpenSerialModal: () => void;
  onSelectTab: (tab: ActiveTab) => void;
  activeSessions: SSHSession[];
  onSelectSession: (sessionId: string) => void;
  onOpenAppearance?: () => void;
  appThemeId?: string;
  onSetAppTheme?: (id: string) => void;
}

type PaletteCategory = 'Aktionen' | 'Themes' | 'Offene Sitzungen' | 'SSH-Server';

interface PaletteItem {
  id: string;
  category: PaletteCategory;
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  hosts,
  onConnectSSH,
  onConnectLocal,
  onOpenSerialModal,
  onSelectTab,
  activeSessions,
  onSelectSession,
  onOpenAppearance,
  appThemeId,
  onSetAppTheme,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Focus input and reset query on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Global Escape key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, onClose]);

  // Build complete list of items
  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      // Built-in Navigation
      {
        id: 'nav-hosts',
        category: 'Aktionen',
        title: 'Zu Hosts & Servern wechseln',
        subtitle: 'Serververwaltung & gespeicherte Verbindungen',
        icon: Server,
        badge: 'Navigation',
        action: () => {
          onSelectTab('hosts');
          onClose();
        },
      },
      {
        id: 'nav-terminal',
        category: 'Aktionen',
        title: 'Zu Terminal wechseln',
        subtitle: 'Aktive Terminalsitzungen anzeigen',
        icon: Terminal,
        badge: 'Navigation',
        action: () => {
          onSelectTab('terminal');
          onClose();
        },
      },
      {
        id: 'nav-sftp',
        category: 'Aktionen',
        title: 'Zu SFTP Explorer wechseln',
        subtitle: 'Dateien auf Remote-Servern verwalten',
        icon: FolderGit2,
        badge: 'Navigation',
        action: () => {
          onSelectTab('sftp');
          onClose();
        },
      },
      {
        id: 'nav-scp',
        category: 'Aktionen',
        title: 'Zu SCP Builder wechseln',
        subtitle: 'Schneller Dateitransfer per SCP',
        icon: Send,
        badge: 'Navigation',
        action: () => {
          onSelectTab('scp');
          onClose();
        },
      },
      {
        id: 'nav-keys',
        category: 'Aktionen',
        title: 'Zu SSH-Keys wechseln',
        subtitle: 'SSH-Schlüsselpaare konfigurieren',
        icon: Key,
        badge: 'Navigation',
        action: () => {
          onSelectTab('keys');
          onClose();
        },
      },
      // Quick Connect
      {
        id: 'quick-local',
        category: 'Aktionen',
        title: 'Lokales Terminal starten (zsh)',
        subtitle: 'Lokale macOS Shell öffnen',
        icon: Terminal,
        badge: 'Lokal',
        action: () => {
          onConnectLocal();
          onClose();
        },
      },
      {
        id: 'quick-serial',
        category: 'Aktionen',
        title: 'Serielles Gerät ansprechen (USB-Kabel)...',
        subtitle: 'USB-Serial & Konsolenverbindungen',
        icon: Cable,
        badge: 'Serial',
        action: () => {
          onOpenSerialModal();
          onClose();
        },
      },
    ];

    // Items are pushed in category display order so keyboard navigation matches the rendered list.
    if (onOpenAppearance) {
      items.push({
        id: 'appearance-open',
        category: 'Aktionen',
        title: 'Erscheinungsbild & Themes öffnen …',
        subtitle: 'App-Theme, Akzentfarbe und Terminal-Farben',
        icon: Palette,
        badge: '⌘,',
        action: () => {
          onOpenAppearance();
          onClose();
        },
      });
    }

    // App themes
    if (onSetAppTheme) {
      APP_THEMES.forEach((theme) => {
        items.push({
          id: `theme-${theme.id}`,
          category: 'Themes',
          title: `Theme: ${theme.label}`,
          subtitle: theme.mode === 'dark' ? 'Dunkles App-Theme' : 'Helles App-Theme',
          icon: Palette,
          badge: theme.id === appThemeId ? 'Aktiv' : undefined,
          action: () => {
            onSetAppTheme(theme.id);
            onClose();
          },
        });
      });
    }

    // Open Sessions
    if (activeSessions && activeSessions.length > 0) {
      activeSessions.forEach((session) => {
        items.push({
          id: `session-${session.id}`,
          category: 'Offene Sitzungen',
          title: `Sitzung: ${session.title}`,
          subtitle:
            session.type === 'ssh' && session.host
              ? `${session.host.username}@${session.host.hostname}`
              : session.type === 'serial' && session.serialConfig
              ? `${session.serialConfig.path} @ ${session.serialConfig.baudRate}`
              : 'Lokale Shell',
          icon: session.type === 'serial' ? Cable : Terminal,
          badge: session.connected ? 'Aktiv' : 'Getrennt',
          action: () => {
            onSelectSession(session.id);
            onSelectTab('terminal');
            onClose();
          },
        });
      });
    }

    // Saved SSH Hosts
    if (hosts && hosts.length > 0) {
      hosts.forEach((host) => {
        items.push({
          id: `host-${host.id}`,
          category: 'SSH-Server',
          title: host.label || host.hostname,
          subtitle: `${host.username}@${host.hostname}${
            host.port && host.port !== 22 ? `:${host.port}` : ''
          }`,
          icon: Server,
          badge: `Port ${host.port || 22}`,
          action: () => {
            onConnectSSH(host);
            onClose();
          },
        });
      });
    }

    return items;
  }, [
    hosts,
    activeSessions,
    onSelectTab,
    onConnectLocal,
    onOpenSerialModal,
    onSelectSession,
    onConnectSSH,
    onClose,
    onOpenAppearance,
    appThemeId,
    onSetAppTheme,
  ]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;

    return allItems.filter((item) => {
      if (item.category === 'SSH-Server') {
        const hostId = item.id.replace(/^host-/, '');
        const host = hosts.find((h) => h.id === hostId);
        if (host) {
          const matchLabel = host.label?.toLowerCase().includes(q) ?? false;
          const matchHost = host.hostname?.toLowerCase().includes(q) ?? false;
          const matchUser = host.username?.toLowerCase().includes(q) ?? false;
          return matchLabel || matchHost || matchUser;
        }
      }

      const matchTitle = item.title.toLowerCase().includes(q);
      const matchSub = item.subtitle?.toLowerCase().includes(q) ?? false;
      return matchTitle || matchSub;
    });
  }, [allItems, query, hosts]);

  // Reset selectedIndex when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (filteredItems.length > 0 && selectedIndex >= 0) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [selectedIndex, filteredItems]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredItems.length === 0
          ? 0
          : (prev - 1 + filteredItems.length) % filteredItems.length
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  const categories: PaletteCategory[] = [
    'Aktionen',
    'Themes',
    'Offene Sitzungen',
    'SSH-Server',
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center px-4"
      onClick={onClose}
    >
      <div
        className="relative top-20 w-full max-w-xl bg-zinc-900/95 border border-zinc-700/80 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden flex flex-col max-h-[calc(100vh-8rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-zinc-800 gap-3">
          <Search className="w-5 h-5 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Befehl eingeben oder suchen (z. B. Server, Terminal, SFTP)..."
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
            autoFocus
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md transition-colors"
              title="Suche leeren"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-zinc-800 border border-zinc-700/80 rounded shadow-sm shrink-0">
            Esc
          </kbd>
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-2 space-y-3 flex-1">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-zinc-500 text-sm">
              Keine passenden Befehle oder Server gefunden
            </div>
          ) : (
            categories.map((cat) => {
              const itemsInCat = filteredItems.filter(
                (item) => item.category === cat
              );
              if (itemsInCat.length === 0) return null;

              return (
                <div key={cat} className="space-y-0.5">
                  <div className="px-2.5 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    {cat}
                  </div>
                  {itemsInCat.map((item) => {
                    const itemIndex = filteredItems.indexOf(item);
                    const isSelected = itemIndex === selectedIndex;
                    const Icon = item.icon;

                    return (
                      <div
                        key={item.id}
                        ref={(el) => {
                          itemRefs.current[itemIndex] = el;
                        }}
                        onClick={item.action}
                        onMouseEnter={() => setSelectedIndex(itemIndex)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-zinc-800 text-zinc-100'
                            : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                              isSelected
                                ? 'bg-zinc-700/80 text-amber-400'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="truncate">
                            <div className="font-medium truncate">
                              {item.title}
                            </div>
                            {item.subtitle && (
                              <div className="text-[11px] text-zinc-400 truncate">
                                {item.subtitle}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          {item.badge && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-zinc-400 font-mono">
                              {item.badge}
                            </span>
                          )}
                          {isSelected && (
                            <CornerDownLeft className="w-3.5 h-3.5 text-zinc-400" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts info */}
        <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-950/40 flex items-center justify-between text-[11px] text-zinc-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 text-[9px] font-mono bg-zinc-800 border border-zinc-700/60 rounded text-zinc-400">
                ↑
              </kbd>
              <kbd className="px-1 py-0.5 text-[9px] font-mono bg-zinc-800 border border-zinc-700/60 rounded text-zinc-400">
                ↓
              </kbd>
              Navigieren
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 text-[9px] font-mono bg-zinc-800 border border-zinc-700/60 rounded text-zinc-400">
                ↵
              </kbd>
              Auswählen
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 text-[9px] font-mono bg-zinc-800 border border-zinc-700/60 rounded text-zinc-400">
                Esc
              </kbd>
              Schließen
            </span>
          </div>
          <div className="text-[10px] text-zinc-400">Wayterm Befehlspalette</div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
