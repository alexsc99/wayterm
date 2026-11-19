import React, { useState, useEffect } from 'react';
import { version as appVersion } from '../../package.json';
import { Server, Terminal, FolderGit2, Send, Key, Plus, Cable, PanelLeftClose, PanelLeft } from 'lucide-react';
export type ActiveTab = 'hosts' | 'terminal' | 'sftp' | 'scp' | 'keys';

interface NavigationProps {
  currentTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  activeSessionCount: number;
  onNewHost: () => void;
  onOpenSerialModal?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onTabChange,
  activeSessionCount,
  onNewHost,
  onOpenSerialModal,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [systemBadge, setSystemBadge] = useState('macOS arm64');

  useEffect(() => {
    let mounted = true;
    if (window.electronAPI?.getSystemInfo) {
      window.electronAPI
        .getSystemInfo()
        .then((info) => {
          if (!mounted || !info) return;
          const platformMap: Record<string, string> = {
            darwin: 'macOS',
            win32: 'Windows',
            linux: 'Linux',
          };
          const osName = platformMap[info.platform] || info.platform || 'macOS';
          const archName = info.arch || '';
          setSystemBadge(`${osName} ${archName}`.trim());
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, []);
  const tabs = [
    {
      id: 'hosts' as ActiveTab,
      label: 'Hosts',
      description: 'Server & SSH-Ziele',
      icon: Server,
    },
    {
      id: 'terminal' as ActiveTab,
      label: 'Terminal',
      description: 'Shell & Remote-Sessions',
      icon: Terminal,
      badge: activeSessionCount > 0 ? activeSessionCount : undefined,
    },
    {
      id: 'sftp' as ActiveTab,
      label: 'SFTP',
      description: 'Dateimanager',
      icon: FolderGit2,
    },
    {
      id: 'scp' as ActiveTab,
      label: 'SCP Builder',
      description: 'Befehlsgenerator',
      icon: Send,
    },
    {
      id: 'keys' as ActiveTab,
      label: 'SSH-Keys',
      description: '~/.ssh Schlüssel',
      icon: Key,
    },
  ];

  return (
    <aside
      className={`app-navigation h-screen border-r flex flex-col justify-between select-none shrink-0 z-20 transition-all duration-200 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Top Section with Traffic lights offset & Brand */}
      <div>
        <div
          className={`h-14 titlebar-drag-region flex items-center justify-between border-b border-zinc-800/50 ${
            isCollapsed ? 'px-3 justify-center' : 'pl-20 pr-3'
          }`}
        >
          {!isCollapsed && (
            <div className="flex items-center gap-2.5 no-drag">
              <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-xs text-white shadow-sm">
                P+
              </div>
              <div>
                <div className="font-bold text-xs tracking-wider uppercase text-zinc-100 flex items-center gap-1.5">
                  <span>PuTTY+</span>
                </div>
                <div className="text-[10px] text-zinc-500 font-medium -mt-0.5">
                  Terminus für macOS
                </div>
              </div>
            </div>
          )}

          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
              aria-expanded={!isCollapsed}
              aria-controls="main-navigation"
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors no-drag cursor-pointer"
              title={isCollapsed ? 'Seitenleiste ausklappen (⌘B)' : 'Seitenleiste einklappen (⌘B)'}
            >
              {isCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          )}
        </div>
        <div className={isCollapsed ? 'px-2 pt-3' : 'px-3 pt-4'}>
          {!isCollapsed && (
            <div className="px-3 pb-2 text-[10px] uppercase font-bold tracking-wider text-zinc-500">
              Bereiche
            </div>
          )}
          <nav id="main-navigation" aria-label="Hauptnavigation" className="space-y-1 no-drag">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={`${tab.label}${tab.id === 'terminal' ? `, ${activeSessionCount} aktive ${activeSessionCount === 1 ? 'Sitzung' : 'Sitzungen'}` : ''}`}
                  title={isCollapsed ? `${tab.label} — ${tab.description}` : undefined}
                  className={`w-full flex items-center rounded-xl text-xs transition-all cursor-pointer group text-left ${
                    isCollapsed ? 'justify-center p-2.5 my-1' : 'justify-between px-3 py-2.5 my-0.5'
                  } ${
                    isActive
                      ? 'app-navigation-current border shadow-sm font-semibold'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border border-transparent font-medium'
                  }`}
                >
                  {isCollapsed ? (
                    <div className="relative">
                      <Icon className="w-4 h-4" />
                      {tab.badge !== undefined && (
                        <span className="absolute -top-1.5 -right-2 w-3.5 h-3.5 rounded-full text-[9px] font-bold bg-blue-600 text-white flex items-center justify-center">
                          {tab.badge}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : 'bg-zinc-800/80 text-zinc-400 group-hover:text-zinc-200 group-hover:bg-zinc-800'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="truncate">
                          <div className="truncate">{tab.label}</div>
                          <div
                            className={`text-[10px] truncate font-normal ${
                              isActive ? 'text-blue-300' : 'text-zinc-500'
                            }`}
                          >
                            {tab.description}
                          </div>
                        </div>
                      </div>

                      {tab.badge !== undefined && (
                        <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white shadow-sm shrink-0">
                          {tab.badge}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Section: Action & Info */}
      <div className={`border-t border-zinc-800/80 no-drag ${isCollapsed ? 'p-2 space-y-2' : 'p-3 space-y-2.5'}`}>
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onNewHost}
              className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-sm transition-colors cursor-pointer"
              aria-label="Neuen SSH-Host anlegen"
              title="Neuen SSH-Host anlegen"
            >
              <Plus className="w-4 h-4" />
            </button>
            {onOpenSerialModal && (
              <button
                onClick={onOpenSerialModal}
                className="w-10 h-10 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Serielles Gerät verbinden"
                title="Serielles Gerät verbinden"
              >
                <Cable className="w-4 h-4 text-amber-400" />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onNewHost}
                className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition-colors cursor-pointer truncate"
                title="Neuen SSH-Host anlegen"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>SSH-Host</span>
              </button>
              {onOpenSerialModal && (
                <button
                  onClick={onOpenSerialModal}
                  className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-xs font-medium transition-colors cursor-pointer truncate"
                  title="Direkte serielle USB-Verbindung starten"
                >
                  <Cable className="w-3.5 h-3.5 text-amber-400" />
                  <span>Seriell</span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between px-2 pt-1 text-[10px] text-zinc-500 font-mono">
              <span>v{appVersion}</span>
              <span>{systemBadge}</span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
