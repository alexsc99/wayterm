import { useEffect, useRef, useState } from 'react';
import type { TerminalSettings } from '../types';
import { loadTerminalSettings, saveTerminalSettings } from '../utils/terminalSettings';

const COLORS_STORAGE_KEY = 'putty_plus_mobaxterm_colors'; // legacy key name, kept so saved preferences survive

/** Persistent terminal settings and the colour theme toggle. */
export function useTerminalPreferences() {
  const [settings, setSettings] = useState<TerminalSettings>(() => loadTerminalSettings());
  const settingsRef = useRef<TerminalSettings>(settings);
  settingsRef.current = settings;
  const fontSize = settings.fontSize;
  const setFontSize = (updater: number | ((prev: number) => number)) => {
    setSettings((prev) => {
      const nextSize = typeof updater === 'function' ? updater(prev.fontSize) : updater;
      const clamped = Math.min(24, Math.max(10, nextSize));
      const next = { ...prev, fontSize: clamped };
      saveTerminalSettings(next);
      return next;
    });
  };
  const updateSettings = (next: TerminalSettings) => {
    setSettings(next);
    saveTerminalSettings(next);
  };

  // Child effects run before App's, so this reaches the backend before any (restored) session connects.
  useEffect(() => {
    window.electronAPI?.configureSessionLog({
      enabled: settings.sessionLogging,
      directory: settings.sessionLogDirectory,
    });
  }, [settings.sessionLogging, settings.sessionLogDirectory]);

  // Colour theme & live syntax highlighting state
  const [vividColorsEnabled, setVividColorsEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(COLORS_STORAGE_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const vividColorsEnabledRef = useRef<boolean>(vividColorsEnabled);
  vividColorsEnabledRef.current = vividColorsEnabled;

  useEffect(() => {
    try {
      localStorage.setItem(COLORS_STORAGE_KEY, String(vividColorsEnabled));
    } catch {
      // Ignore storage errors
    }
  }, [vividColorsEnabled]);

  return {
    settings,
    settingsRef,
    fontSize,
    setFontSize,
    updateSettings,
    vividColorsEnabled,
    setVividColorsEnabled,
    vividColorsEnabledRef,
  };
}
