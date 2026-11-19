import { CommandSnippet } from '../types';

const SNIPPETS_STORAGE_KEY = 'putty_plus_snippets';

export const DEFAULT_SNIPPETS: CommandSnippet[] = [
  {
    id: 'snip_df',
    title: 'Festplattenbelegung (df -h)',
    command: 'df -h',
    category: 'System',
    sendEnter: true,
  },
  {
    id: 'snip_ss',
    title: 'Offene Ports (ss -tulpn)',
    command: 'ss -tulpn',
    category: 'Netzwerk',
    sendEnter: true,
  },
  {
    id: 'snip_docker_ps',
    title: 'Laufende Container (docker ps)',
    command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"',
    category: 'Docker',
    sendEnter: true,
  },
  {
    id: 'snip_journalctl',
    title: 'System-Logs live (journalctl -f)',
    command: 'journalctl -n 50 -f',
    category: 'Logs',
    sendEnter: true,
  },
  {
    id: 'snip_systemctl_failed',
    title: 'Fehlgeschlagene Dienste',
    command: 'systemctl --failed',
    category: 'System',
    sendEnter: true,
  },
];

export function loadSnippets(): CommandSnippet[] {
  try {
    const raw = localStorage.getItem(SNIPPETS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SNIPPETS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SNIPPETS];
    return parsed.filter(
      (item): item is CommandSnippet =>
        Boolean(item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.command === 'string')
    );
  } catch {
    return [...DEFAULT_SNIPPETS];
  }
}

export function saveSnippets(snippets: CommandSnippet[]): void {
  try {
    localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Escapes a local file path for safe insertion into POSIX shells (zsh/bash).
 */
export function quoteShellPath(filePath: string): string {
  if (/^[a-zA-Z0-9_./-]+$/.test(filePath)) {
    return filePath;
  }
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}
