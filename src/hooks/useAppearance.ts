import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { ITheme } from '@xterm/xterm';
import {
  loadAppearance,
  resolveTerminalColors,
  saveAppearance,
  type AppearanceSettings,
} from '../utils/appearance';
import { applyAppTheme, getAppTheme } from '../utils/appThemes';
import { toXtermTheme } from '../utils/terminalThemes';

/** Persistent app/terminal theme selection; keeps the document and the native window in sync. */
export function useAppearance(): {
  appearance: AppearanceSettings;
  updateAppearance: (next: AppearanceSettings) => void;
  terminalTheme: ITheme;
} {
  const [appearance, setAppearance] = useState<AppearanceSettings>(loadAppearance);
  const { appTheme, accent, terminalTheme: terminalThemeId, customTerminalColors } = appearance;

  const updateAppearance = useCallback((next: AppearanceSettings) => {
    setAppearance(next);
    saveAppearance(next);
  }, []);

  // Layout effect: the stored theme is on the document before the first paint.
  useLayoutEffect(() => {
    applyAppTheme(appTheme, accent);
    const theme = getAppTheme(appTheme);
    window.electronAPI?.setWindowAppearance?.({ mode: theme.mode, backgroundColor: theme.neutral[950] });
  }, [appTheme, accent]);

  // Accent changes must not produce a new xterm theme object, hence the field-wise dependencies.
  const terminalTheme = useMemo(
    () => toXtermTheme(resolveTerminalColors({ appTheme, terminalTheme: terminalThemeId, customTerminalColors })),
    [appTheme, terminalThemeId, customTerminalColors],
  );

  return { appearance, updateAppearance, terminalTheme };
}
