import React from 'react';
import { createPortal } from 'react-dom';
import { Laptop, Server, Cable, Plus } from 'lucide-react';
import type { SSHHost } from '../../types';

interface NewSessionMenuProps {
  menuRef: React.RefObject<HTMLDivElement>;
  position: { left: number; top: number; width: number; maxHeight: number };
  hosts: SSHHost[];
  onClose: () => void;
  onNewLocalSession: () => void;
  onOpenSerialConnectModal?: () => void;
  onOpenNewHostModal?: () => void;
  onNewSessionFromHost: (host: SSHHost) => void;
}

/** Portal menu for opening a local, serial or saved SSH session (arrow-key navigable). */
export const NewSessionMenu: React.FC<NewSessionMenuProps> = ({
  menuRef,
  position,
  hosts,
  onClose,
  onNewLocalSession,
  onOpenSerialConnectModal,
  onOpenNewHostModal,
  onNewSessionFromHost,
}) => createPortal(
  <div
    ref={menuRef}
    role="menu"
    aria-label="Neue Sitzung öffnen"
    style={{ position: 'fixed', ...position, zIndex: 1000, overflowY: 'auto', overscrollBehavior: 'contain' }}
    className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 text-xs text-zinc-200"
    onKeyDown={(event) => {
      event.stopPropagation();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key === 'Tab') onClose();
    }}
  >
    <button role="menuitem" type="button" className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-zinc-800" onClick={() => { onClose(); onNewLocalSession(); }}>
      <Laptop className="w-4 h-4 text-blue-400 shrink-0" />Lokales Terminal (zsh)
    </button>
    {onOpenSerialConnectModal && (
      <button role="menuitem" type="button" className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-zinc-800" onClick={() => { onClose(); onOpenSerialConnectModal(); }}>
        <Cable className="w-4 h-4 text-amber-400 shrink-0" />Serielles Terminal (USB) …
      </button>
    )}
    {onOpenNewHostModal && (
      <button role="menuitem" type="button" className="w-full px-3 py-2 flex items-center gap-2 text-left text-blue-400 hover:bg-zinc-800" onClick={() => { onClose(); onOpenNewHostModal(); }}>
        <Plus className="w-4 h-4 shrink-0" />Neuen SSH-Host anlegen und verbinden …
      </button>
    )}
    {hosts.length > 0 && <div className="px-3 pt-2 pb-1 border-t border-zinc-800 text-zinc-500">Gespeicherte SSH-Hosts</div>}
    {hosts.map((host) => (
      <button
        key={host.id}
        role="menuitem"
        type="button"
        aria-label={`SSH verbinden: ${host.label || host.hostname}`}
        title={`${host.username}@${host.hostname}:${host.port}`}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-zinc-800"
        onClick={() => { onClose(); onNewSessionFromHost(host); }}
      ><Server className="w-4 h-4 shrink-0" /><span className="min-w-0 break-words">{host.label || host.hostname}</span></button>
    ))}
  </div>,
  document.body
);
