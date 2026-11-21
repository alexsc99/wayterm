import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Palette, RotateCcw, X } from 'lucide-react';
import { ACCENTS, APP_THEMES, AppTheme, ThemeMode, getAccent, getAppTheme } from '../utils/appThemes';
import {
  TERMINAL_COLOR_LABELS,
  TERMINAL_THEME_PRESETS,
  TerminalColorKey,
  TerminalColors,
  getTerminalPreset,
} from '../utils/terminalThemes';
import { AppearanceSettings, DEFAULT_APPEARANCE } from '../utils/appearance';

export interface AppearanceModalProps {
  isOpen: boolean;
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
  onClose: () => void;
}

const BASE_KEYS: readonly TerminalColorKey[] = ['background', 'foreground', 'cursor', 'selectionBackground'];
const NORMAL_KEYS: readonly TerminalColorKey[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];
const BRIGHT_KEYS: readonly TerminalColorKey[] = [
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];
const COLOR_GROUPS: readonly { title: string; keys: readonly TerminalColorKey[] }[] = [
  { title: 'Basis', keys: BASE_KEYS },
  { title: 'Normal', keys: NORMAL_KEYS },
  { title: 'Hell', keys: BRIGHT_KEYS },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

const MODE_LABELS: Record<ThemeMode, string> = { dark: 'Dunkel', light: 'Hell' };

/** Miniature app window drawn from the theme's own colours, independent of the active theme. */
const AppThemePreview: React.FC<{ theme: AppTheme }> = ({ theme }) => {
  const { neutral } = theme;
  const accent = getAccent(theme.defaultAccent);
  return (
    <div
      aria-hidden="true"
      className="flex h-14 w-full overflow-hidden rounded-md border"
      style={{ backgroundColor: neutral[950], borderColor: neutral[700] }}
    >
      <div
        className="flex w-1/4 flex-col gap-1 border-r p-1.5"
        style={{ backgroundColor: neutral[900], borderColor: neutral[800] }}
      >
        <span className="h-1 w-full rounded-full" style={{ backgroundColor: neutral[700] }} />
        <span className="h-1 w-2/3 rounded-full" style={{ backgroundColor: neutral[700] }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
        <span className="h-1 w-3/4 rounded-full" style={{ backgroundColor: neutral[300] }} />
        <span className="h-1 w-1/2 rounded-full" style={{ backgroundColor: neutral[500] }} />
        <span className="mt-auto h-2 w-8 self-end rounded-full" style={{ backgroundColor: accent.scale[600] }} />
      </div>
    </div>
  );
};

/** Miniature terminal drawn from the given colour set. */
const TerminalPreview: React.FC<{ colors: TerminalColors }> = ({ colors }) => (
  <div
    aria-hidden="true"
    className="w-full overflow-hidden rounded-md border border-zinc-700 px-2 py-1.5 font-mono text-[9px] leading-[1.35]"
    style={{ backgroundColor: colors.background, color: colors.foreground }}
  >
    <div className="truncate whitespace-pre">
      <span style={{ color: colors.green }}>user@host</span> <span style={{ color: colors.blue }}>~</span> ${' '}
      <span style={{ backgroundColor: colors.selectionBackground }}>ls</span>
    </div>
    <div className="truncate whitespace-pre">
      <span style={{ color: colors.green }}>ok</span>
      {'  '}
      <span style={{ color: colors.yellow }}>warn</span>
      {'  '}
      <span style={{ color: colors.red }}>error</span>
    </div>
    <div className="flex items-center whitespace-pre">
      {'$ '}
      <span className="inline-block h-[1.1em] w-[0.6em]" style={{ backgroundColor: colors.cursor }} />
    </div>
    <div className="mt-1 grid grid-cols-8 gap-px">
      {[...NORMAL_KEYS, ...BRIGHT_KEYS].map((key) => (
        <span key={key} className="h-1.5" style={{ backgroundColor: colors[key] }} />
      ))}
    </div>
  </div>
);

interface RadioCardProps {
  checked: boolean;
  label: string;
  description: string;
  onSelect: () => void;
  children: React.ReactNode;
}

const RadioCard: React.FC<RadioCardProps> = ({ checked, label, description, onSelect, children }) => (
  <button
    type="button"
    role="radio"
    aria-checked={checked}
    onClick={onSelect}
    className={`flex min-w-0 flex-col gap-2 rounded-xl border p-2 text-left transition-colors ${FOCUS_RING} ${
      checked
        ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
        : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
    }`}
  >
    {children}
    <span className="flex w-full min-w-0 items-start justify-between gap-1.5">
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className={`block truncate text-[11px] ${checked ? 'text-blue-300' : 'text-zinc-500'}`}>
          {description}
        </span>
      </span>
      {checked && <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
    </span>
  </button>
);

interface ColorFieldProps {
  label: string;
  value: string;
  onCommit: (hex: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({ label, value, onCommit }) => {
  const hexInputId = useId();
  // Free-form text while the hex field is being edited; null shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const stored = value.toLowerCase();
  const draftInvalid = draft !== null && !HEX_COLOR.test(draft.trim());

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={stored}
        aria-label={`${label} (Farbwähler)`}
        onChange={(e) => onCommit(e.target.value.toLowerCase())}
        className={`h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-950 p-0.5 ${FOCUS_RING}`}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={hexInputId} className="block truncate text-[11px] text-zinc-400">
          {label}
        </label>
        <input
          id={hexInputId}
          type="text"
          value={draft ?? stored}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={draftInvalid}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            const candidate = text.trim().toLowerCase();
            if (HEX_COLOR.test(candidate) && candidate !== stored) onCommit(candidate);
          }}
          onBlur={() => setDraft(null)}
          className={`w-full rounded-lg border bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none ${
            draftInvalid ? 'border-red-500/60' : 'border-zinc-700 focus:border-blue-500'
          }`}
        />
      </div>
    </div>
  );
};

export const AppearanceModal: React.FC<AppearanceModalProps> = ({ isOpen, appearance, onChange, onClose }) => {
  const titleId = useId();
  const appThemeHeadingId = useId();
  const accentHeadingId = useId();
  const terminalHeadingId = useId();
  const customHeadingId = useId();
  const templateSelectId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const pairedPreset = getTerminalPreset(getAppTheme(appearance.appTheme).terminalTheme);
  const [templateId, setTemplateId] = useState<string>(() => pairedPreset.id);

  // Move focus into the dialog while it is open and hand it back afterwards.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen]);

  // Capture phase + stopPropagation: Escape must not reach the terminal or other global shortcuts.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const customColors = appearance.customTerminalColors;

  const selectTerminalTheme = (terminalTheme: string) => {
    onChange({ ...appearance, terminalTheme });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-3xl max-h-[85vh] flex-col bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl text-xs text-zinc-200">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/50">
              <Palette aria-hidden="true" className="w-4 h-4" />
            </div>
            <div>
              <h3 id={titleId} className="text-sm font-semibold text-zinc-100">
                Erscheinungsbild
              </h3>
              <p className="text-xs text-zinc-400">Farben der Anwendung und des Terminals anpassen.</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            title="Schließen"
            className={`p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors ${FOCUS_RING}`}
          >
            <X aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* App-Theme */}
          <section className="space-y-2">
            <h4 id={appThemeHeadingId} className="text-xs font-semibold text-zinc-100">
              App-Theme
            </h4>
            <div
              role="radiogroup"
              aria-labelledby={appThemeHeadingId}
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
            >
              {APP_THEMES.map((theme) => (
                <RadioCard
                  key={theme.id}
                  checked={appearance.appTheme === theme.id}
                  label={theme.label}
                  description={MODE_LABELS[theme.mode]}
                  onSelect={() => onChange({ ...appearance, appTheme: theme.id, accent: theme.defaultAccent })}
                >
                  <AppThemePreview theme={theme} />
                </RadioCard>
              ))}
            </div>
          </section>

          {/* Akzentfarbe */}
          <section className="space-y-2">
            <h4 id={accentHeadingId} className="text-xs font-semibold text-zinc-100">
              Akzentfarbe
            </h4>
            <div role="radiogroup" aria-labelledby={accentHeadingId} className="flex flex-wrap items-center gap-3 px-1">
              {ACCENTS.map((accent) => {
                const checked = appearance.accent === accent.id;
                return (
                  <button
                    key={accent.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={accent.label}
                    title={accent.label}
                    onClick={() => onChange({ ...appearance, accent: accent.id })}
                    className={`h-7 w-7 rounded-full transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400 ${
                      checked
                        ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900'
                        : 'ring-1 ring-zinc-700 hover:ring-2 hover:ring-zinc-500'
                    }`}
                    style={{ backgroundColor: accent.scale[500] }}
                  />
                );
              })}
            </div>
          </section>

          {/* Terminal-Theme */}
          <section className="space-y-2">
            <h4 id={terminalHeadingId} className="text-xs font-semibold text-zinc-100">
              Terminal-Theme
            </h4>
            <div
              role="radiogroup"
              aria-labelledby={terminalHeadingId}
              className="grid grid-cols-2 sm:grid-cols-3 gap-2"
            >
              <RadioCard
                checked={appearance.terminalTheme === 'auto'}
                label="Automatisch"
                description={`Passend zum App-Theme: ${pairedPreset.label}`}
                onSelect={() => selectTerminalTheme('auto')}
              >
                <TerminalPreview colors={pairedPreset.colors} />
              </RadioCard>
              {TERMINAL_THEME_PRESETS.map((preset) => (
                <RadioCard
                  key={preset.id}
                  checked={appearance.terminalTheme === preset.id}
                  label={preset.label}
                  description={MODE_LABELS[preset.mode]}
                  onSelect={() => selectTerminalTheme(preset.id)}
                >
                  <TerminalPreview colors={preset.colors} />
                </RadioCard>
              ))}
              <RadioCard
                checked={appearance.terminalTheme === 'custom'}
                label="Eigene Farben"
                description="Frei anpassbar"
                onSelect={() => selectTerminalTheme('custom')}
              >
                <TerminalPreview colors={customColors} />
              </RadioCard>
            </div>
          </section>

          {/* Eigene Terminal-Farben */}
          {appearance.terminalTheme === 'custom' && (
            <section aria-labelledby={customHeadingId} className="space-y-3 border-t border-zinc-800 pt-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h4 id={customHeadingId} className="text-xs font-semibold text-zinc-100">
                  Eigene Terminal-Farben
                </h4>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <label htmlFor={templateSelectId} className="block text-[11px] text-zinc-400">
                      Vorlage übernehmen
                    </label>
                    <select
                      id={templateSelectId}
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      className="w-48 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
                    >
                      {TERMINAL_THEME_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...appearance, customTerminalColors: { ...getTerminalPreset(templateId).colors } })
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 border border-zinc-700 transition-colors ${FOCUS_RING}`}
                  >
                    Übernehmen
                  </button>
                </div>
              </div>

              {COLOR_GROUPS.map((group) => (
                <fieldset key={group.title} className="space-y-1.5">
                  <legend className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {group.title}
                  </legend>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
                    {group.keys.map((key) => (
                      <ColorField
                        key={key}
                        label={TERMINAL_COLOR_LABELS[key]}
                        value={customColors[key]}
                        onCommit={(hex) =>
                          onChange({ ...appearance, customTerminalColors: { ...customColors, [key]: hex } })
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_APPEARANCE })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 border border-zinc-700 transition-colors ${FOCUS_RING}`}
            >
              <RotateCcw aria-hidden="true" className="w-3.5 h-3.5" />
              Auf Standard zurücksetzen
            </button>
            <p className="text-[11px] text-zinc-500">Änderungen werden sofort übernommen.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors ${FOCUS_RING}`}
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
};
