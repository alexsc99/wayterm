import { useEffect, useRef, useState } from 'react';
import type { TerminalSettings } from '../types';
import { loadTerminalSettings, saveTerminalSettings } from '../utils/terminalSettings';

const MOBA_STORAGE_KEY = 'putty_plus_mobaxterm_colors';

/** Persistent terminal settings and the MobaXterm colour toggle. */
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

  // MobaXterm Colors & Live Syntax Highlighting State
  const [mobaColorsEnabled, setMobaColorsEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(MOBA_STORAGE_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const mobaColorsEnabledRef = useRef<boolean>(mobaColorsEnabled);
  mobaColorsEnabledRef.current = mobaColorsEnabled;

  useEffect(() => {
    try {
      localStorage.setItem(MOBA_STORAGE_KEY, String(mobaColorsEnabled));
    } catch {
      // Ignore storage errors
    }
  }, [mobaColorsEnabled]);

  return {
    settings,
    settingsRef,
    fontSize,
    setFontSize,
    updateSettings,
    mobaColorsEnabled,
    setMobaColorsEnabled,
    mobaColorsEnabledRef,
  };
}
