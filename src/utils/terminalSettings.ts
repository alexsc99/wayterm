import { TerminalSettings } from '../types';

const SETTINGS_STORAGE_KEY = 'putty_plus_terminal_settings';

export const FONT_FAMILY_OPTIONS: { label: string; value: string }[] = [
  { label: 'Menlo / Monaco (Standard)', value: 'Menlo, Monaco, "Courier New", monospace' },
  { label: 'SF Mono', value: '"SF Mono", Menlo, Monaco, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Menlo, Monaco, monospace' },
  { label: 'Fira Code', value: '"Fira Code", Menlo, Monaco, monospace' },
];

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 13,
  fontFamily: FONT_FAMILY_OPTIONS[0].value,
  lineHeight: 1.25,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: true,
  rightClickMode: 'paste',
  confirmMultilinePaste: true,
  openLinksWithCmdClick: true,
  sessionLogging: false,
  sessionLogDirectory: '',
  restoreSessions: true,
  autoReconnect: true,
};

export function loadTerminalSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TERMINAL_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>;
    return {
      fontSize:
        typeof parsed.fontSize === 'number'
          ? Math.min(24, Math.max(10, Math.round(parsed.fontSize)))
          : DEFAULT_TERMINAL_SETTINGS.fontSize,
      fontFamily:
        typeof parsed.fontFamily === 'string' && parsed.fontFamily.trim()
          ? parsed.fontFamily
          : DEFAULT_TERMINAL_SETTINGS.fontFamily,
      lineHeight:
        typeof parsed.lineHeight === 'number'
          ? Math.min(1.6, Math.max(1.0, Math.round(parsed.lineHeight * 100) / 100))
          : DEFAULT_TERMINAL_SETTINGS.lineHeight,
      cursorStyle:
        parsed.cursorStyle === 'block' || parsed.cursorStyle === 'underline' || parsed.cursorStyle === 'bar'
          ? parsed.cursorStyle
          : DEFAULT_TERMINAL_SETTINGS.cursorStyle,
      cursorBlink:
        typeof parsed.cursorBlink === 'boolean'
          ? parsed.cursorBlink
          : DEFAULT_TERMINAL_SETTINGS.cursorBlink,
      scrollback:
        typeof parsed.scrollback === 'number' && parsed.scrollback >= 1000 && parsed.scrollback <= 100000
          ? parsed.scrollback
          : DEFAULT_TERMINAL_SETTINGS.scrollback,
      copyOnSelect:
        typeof parsed.copyOnSelect === 'boolean'
          ? parsed.copyOnSelect
          : DEFAULT_TERMINAL_SETTINGS.copyOnSelect,
      rightClickMode:
        parsed.rightClickMode === 'paste' || parsed.rightClickMode === 'menu'
          ? parsed.rightClickMode
          : DEFAULT_TERMINAL_SETTINGS.rightClickMode,
      confirmMultilinePaste:
        typeof parsed.confirmMultilinePaste === 'boolean'
          ? parsed.confirmMultilinePaste
          : DEFAULT_TERMINAL_SETTINGS.confirmMultilinePaste,
      openLinksWithCmdClick:
        typeof parsed.openLinksWithCmdClick === 'boolean'
          ? parsed.openLinksWithCmdClick
          : DEFAULT_TERMINAL_SETTINGS.openLinksWithCmdClick,
      sessionLogging:
        typeof parsed.sessionLogging === 'boolean'
          ? parsed.sessionLogging
          : DEFAULT_TERMINAL_SETTINGS.sessionLogging,
      sessionLogDirectory:
        typeof parsed.sessionLogDirectory === 'string'
          ? parsed.sessionLogDirectory.trim()
          : DEFAULT_TERMINAL_SETTINGS.sessionLogDirectory,
      restoreSessions:
        typeof parsed.restoreSessions === 'boolean'
          ? parsed.restoreSessions
          : DEFAULT_TERMINAL_SETTINGS.restoreSessions,
      autoReconnect:
        typeof parsed.autoReconnect === 'boolean'
          ? parsed.autoReconnect
          : DEFAULT_TERMINAL_SETTINGS.autoReconnect,
    };
  } catch {
    return { ...DEFAULT_TERMINAL_SETTINGS };
  }
}

export function saveTerminalSettings(settings: TerminalSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}
