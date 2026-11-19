import React, { useEffect, useState } from 'react';
import { FolderOpen, RotateCcw, X } from 'lucide-react';
import { TerminalCursorStyle, TerminalRightClickMode, TerminalSettings } from '../types';
import { DEFAULT_TERMINAL_SETTINGS, FONT_FAMILY_OPTIONS } from '../utils/terminalSettings';

interface TerminalSettingsPopoverProps {
  settings: TerminalSettings;
  onChange: (next: TerminalSettings) => void;
  onClose: () => void;
}

export const TerminalSettingsPopover: React.FC<TerminalSettingsPopoverProps> = ({
  settings,
  onChange,
  onClose,
}) => {
  const update = <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const [defaultLogDirectory, setDefaultLogDirectory] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      ?.getDefaultSessionLogDirectory?.()
      .then((dir) => {
        if (!cancelled) setDefaultLogDirectory(dir);
      })
      .catch(() => {
        // Placeholder stays empty
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePickLogDirectory = async () => {
    if (!window.electronAPI?.showOpenDirectoryDialog) return;
    const dir = await window.electronAPI.showOpenDirectoryDialog({
      title: 'Protokoll-Ordner wählen',
      defaultPath: settings.sessionLogDirectory || defaultLogDirectory || undefined,
      buttonLabel: 'Auswählen',
    });
    if (dir) update('sessionLogDirectory', dir.trim());
  };

  return (
    <div
      role="dialog"
      aria-label="Terminal-Einstellungen"
      className="absolute top-12 right-3 z-50 w-80 max-h-[calc(100vh-4rem)] overflow-y-auto bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl p-3.5 text-xs text-zinc-200 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <span className="font-semibold text-zinc-100">Terminal-Einstellungen</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_TERMINAL_SETTINGS })}
            title="Auf Standardwerte zurücksetzen"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Schließen"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Schriftart */}
      <div className="space-y-1">
        <label className="block text-[11px] text-zinc-400">Schriftart</label>
        <select
          value={settings.fontFamily}
          onChange={(e) => update('fontFamily', e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
        >
          {FONT_FAMILY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Schriftgröße & Zeilenhöhe */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-[11px] text-zinc-400">Schriftgröße ({settings.fontSize}px)</label>
          <input
            type="range"
            min={10}
            max={24}
            step={1}
            value={settings.fontSize}
            onChange={(e) => update('fontSize', Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] text-zinc-400">Zeilenhöhe ({settings.lineHeight.toFixed(2)})</label>
          <input
            type="range"
            min={1.0}
            max={1.6}
            step={0.05}
            value={settings.lineHeight}
            onChange={(e) => update('lineHeight', Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Cursor & Scrollback */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-[11px] text-zinc-400">Cursor-Stil</label>
          <select
            value={settings.cursorStyle}
            onChange={(e) => update('cursorStyle', e.target.value as TerminalCursorStyle)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500"
          >
            <option value="block">Block</option>
            <option value="underline">Unterstrich</option>
            <option value="bar">Balken</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] text-zinc-400">Scrollback-Zeilen</label>
          <select
            value={settings.scrollback}
            onChange={(e) => update('scrollback', Number(e.target.value))}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500"
          >
            <option value={5000}>5.000</option>
            <option value={10000}>10.000</option>
            <option value={25000}>25.000</option>
            <option value={50000}>50.000</option>
          </select>
        </div>
      </div>

      {/* Rechtsklick-Verhalten */}
      <div className="space-y-1">
        <label className="block text-[11px] text-zinc-400">Rechtsklick-Aktion</label>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { value: 'paste', label: 'PuTTY (Einfügen)' },
              { value: 'menu', label: 'Kontextmenü' },
            ] as { value: TerminalRightClickMode; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update('rightClickMode', opt.value)}
              className={`px-2 py-1.5 rounded-lg border text-xs transition-colors ${
                settings.rightClickMode === opt.value
                  ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 font-medium'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2 pt-1 border-t border-zinc-800">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-300">Cursor blinken lassen</span>
          <input
            type="checkbox"
            checked={settings.cursorBlink}
            onChange={(e) => update('cursorBlink', e.target.checked)}
            className="accent-blue-500"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-300">Auto-Copy beim Markieren</span>
          <input
            type="checkbox"
            checked={settings.copyOnSelect}
            onChange={(e) => update('copyOnSelect', e.target.checked)}
            className="accent-blue-500"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-300">Warnung vor mehrzeiligem Paste</span>
          <input
            type="checkbox"
            checked={settings.confirmMultilinePaste}
            onChange={(e) => update('confirmMultilinePaste', e.target.checked)}
            className="accent-blue-500"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-300">URLs per ⌘+Klick öffnen</span>
          <input
            type="checkbox"
            checked={settings.openLinksWithCmdClick}
            onChange={(e) => update('openLinksWithCmdClick', e.target.checked)}
            className="accent-blue-500"
          />
        </label>
      </div>

      {/* Sitzungen */}
      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Sitzungen</span>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-300">Tabs beim Start wiederherstellen</span>
          <input
            type="checkbox"
            checked={settings.restoreSessions}
            onChange={(e) => update('restoreSessions', e.target.checked)}
            className="accent-blue-500"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-300">SSH automatisch neu verbinden</span>
          <input
            type="checkbox"
            checked={settings.autoReconnect}
            onChange={(e) => update('autoReconnect', e.target.checked)}
            className="accent-blue-500"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-zinc-300">Sitzungen protokollieren</span>
          <input
            type="checkbox"
            checked={settings.sessionLogging}
            onChange={(e) => update('sessionLogging', e.target.checked)}
            className="accent-blue-500"
          />
        </label>
        {settings.sessionLogging && (
          <div className="space-y-1.5 pl-2 border-l border-zinc-800">
            <label className="block text-[11px] text-zinc-400">Protokoll-Ordner</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                readOnly
                value={settings.sessionLogDirectory}
                placeholder={defaultLogDirectory || 'Standardordner'}
                title={settings.sessionLogDirectory || defaultLogDirectory}
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none truncate"
              />
              <button
                type="button"
                onClick={() => update('sessionLogDirectory', '')}
                disabled={!settings.sessionLogDirectory}
                title="Auf Standardordner zurücksetzen"
                className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={handlePickLogDirectory}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-300 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Ordner wählen…
            </button>
            <p className="text-[11px] leading-snug text-zinc-500">
              Protokolle enthalten die Rohausgabe inkl. ANSI-Codes (mit <code className="text-zinc-400">less -R</code>{' '}
              lesbar) und können sensible Daten wie Passwörter oder Tokens enthalten.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
