import React, { useEffect, useRef } from 'react';
import {
  Clipboard,
  Copy,
  Download,
  RefreshCw,
  Search,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Trash2,
  CopyPlus,
} from 'lucide-react';

interface TerminalContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  isConnected: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onSearch: () => void;
  onClear: () => void;
  onSaveLog: () => void;
  onReconnect: () => void;
  onDuplicate: () => void;
  onSplitColumns: () => void;
  onSplitRows: () => void;
  onClose: () => void;
}

export const TerminalContextMenu: React.FC<TerminalContextMenuProps> = ({
  x,
  y,
  hasSelection,
  isConnected,
  onCopy,
  onPaste,
  onSelectAll,
  onSearch,
  onClear,
  onSaveLog,
  onReconnect,
  onDuplicate,
  onSplitColumns,
  onSplitRows,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 320);

  const Item: React.FC<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    onClick: () => void;
  }> = ({ icon: Icon, label, shortcut, disabled, onClick }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onClick();
        onClose();
      }}
      className="w-full flex items-center justify-between px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-blue-600/20 hover:text-blue-200 disabled:opacity-40 disabled:pointer-events-none transition-colors"
    >
      <span className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-zinc-400" />
        <span>{label}</span>
      </span>
      {shortcut && <span className="text-[10px] font-mono text-zinc-500">{shortcut}</span>}
    </button>
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: 'fixed', left, top, zIndex: 1100 }}
      className="w-52 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 overflow-hidden"
    >
      <Item icon={Copy} label="Kopieren" shortcut="⌘C" disabled={!hasSelection} onClick={onCopy} />
      <Item icon={Clipboard} label="Einfügen" shortcut="⌘V" onClick={onPaste} />
      <Item icon={Copy} label="Alles markieren" onClick={onSelectAll} />
      <div className="my-1 border-t border-zinc-800" />
      <Item icon={Search} label="Suchen" shortcut="⌘F" onClick={onSearch} />
      <Item icon={Trash2} label="Terminal leeren" shortcut="⌘K" onClick={onClear} />
      <Item icon={Download} label="Verlauf speichern …" onClick={onSaveLog} />
      <div className="my-1 border-t border-zinc-800" />
      {!isConnected && <Item icon={RefreshCw} label="Neu verbinden" onClick={onReconnect} />}
      <Item icon={CopyPlus} label="Sitzung duplizieren" onClick={onDuplicate} />
      <Item icon={SplitSquareHorizontal} label="Vertikal teilen" shortcut="⌘D" onClick={onSplitColumns} />
      <Item icon={SplitSquareVertical} label="Horizontal teilen" shortcut="⌘⇧D" onClick={onSplitRows} />
    </div>
  );
};
