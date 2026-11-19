import { Client } from 'ssh2';
import path from 'path';
import { RemoteFileItem } from '../../../src/types';
import { escapeShellPath, execCommand } from './remoteExec';

// Directory listing for SCP/exec-only hosts: parses `ls -la` output.

const MONTH_MAP: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseSymbolicPermissionsToOctal(permStr: string): string {
  if (permStr.length < 10) return '644';
  let mode = 0;
  const chars = permStr.slice(1, 10);
  if (chars[0] === 'r') mode |= 0o400;
  if (chars[1] === 'w') mode |= 0o200;
  if (chars[2] === 'x' || chars[2] === 's') mode |= 0o100;
  if (chars[3] === 'r') mode |= 0o040;
  if (chars[4] === 'w') mode |= 0o020;
  if (chars[5] === 'x' || chars[5] === 's') mode |= 0o010;
  if (chars[6] === 'r') mode |= 0o004;
  if (chars[7] === 'w') mode |= 0o002;
  if (chars[8] === 'x' || chars[8] === 't') mode |= 0o001;
  return mode.toString(8);
}

function parseLsTimestamp(dateToken: string): number {
  if (/^\d+$/.test(dateToken.trim())) {
    return parseInt(dateToken.trim(), 10) * 1000;
  }
  const parts = dateToken.trim().split(/\s+/);
  if (parts.length === 3) {
    const month = MONTH_MAP[parts[0]];
    const day = parseInt(parts[1], 10);
    const third = parts[2];
    if (month !== undefined && !Number.isNaN(day)) {
      const now = new Date();
      if (third.includes(':')) {
        const [hh, mm] = third.split(':').map((n) => parseInt(n, 10));
        const candidate = new Date(now.getFullYear(), month, day, hh || 0, mm || 0, 0);
        if (candidate.getTime() - now.getTime() > 86400000 * 2) {
          candidate.setFullYear(now.getFullYear() - 1);
        }
        return candidate.getTime();
      }
      const year = parseInt(third, 10);
      if (!Number.isNaN(year)) {
        return new Date(year, month, day, 0, 0, 0).getTime();
      }
    }
  }
  const parsed = Date.parse(dateToken);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export async function listDirectoryViaExec(client: Client, remotePath: string): Promise<RemoteFileItem[]> {
  const targetPath = (remotePath || '.').trim();
  const escapedPath = escapeShellPath(targetPath);

  let resolvedBasePath = targetPath;
  if (targetPath === '.' || targetPath === '~' || targetPath.startsWith('~/')) {
    const pwdRes = await execCommand(
      client,
      `cd ${escapedPath} 2>/dev/null && pwd`,
      10000
    );
    const resolvedLine = pwdRes.stdout.trim().split(/\r?\n/)[0];
    if (pwdRes.code === 0 && resolvedLine.startsWith('/')) {
      resolvedBasePath = resolvedLine;
    }
  }

  const lsCmd = `LC_ALL=C ls -la --time-style=+%s ${escapedPath} 2>/dev/null || LC_ALL=C ls -la ${escapedPath}`;
  const res = await execCommand(client, lsCmd, 20000);
  if (res.code !== 0 && !res.stdout.trim()) {
    throw new Error(res.stderr.trim() || `Verzeichnis konnte nicht gelesen werden: ${targetPath}`);
  }

  const lines = res.stdout.split(/\r?\n/);
  const items: RemoteFileItem[] = [];
  const symlinkIndices: number[] = [];

  const epochRegex = /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{1,12})\s+(.+)$/;
  const stdRegex =
    /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Z][a-z]{2}\s+\d+\s+(?:\d{1,2}:\d{2}|\d{4}))\s+(.+)$/;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('total ')) continue;

    let permStr = '';
    let sizeStr = '0';
    let dateStr = '';
    let rawName = '';

    const epochMatch = epochRegex.exec(line);
    if (epochMatch) {
      [, permStr, sizeStr, dateStr, rawName] = epochMatch;
    } else {
      const stdMatch = stdRegex.exec(line);
      if (!stdMatch) continue;
      [, permStr, sizeStr, dateStr, rawName] = stdMatch;
    }

    const typeChar = permStr[0];
    const isSymlink = typeChar === 'l';
    let isDirectory = typeChar === 'd';

    let name = rawName;
    if (isSymlink) {
      const arrowIdx = rawName.indexOf(' -> ');
      if (arrowIdx !== -1) {
        name = rawName.slice(0, arrowIdx);
      }
    }

    if (!name || name === '.' || name === '..') {
      continue;
    }

    const cleanPath =
      resolvedBasePath === '.'
        ? name
        : path.posix.join(resolvedBasePath, name);

    const itemIndex = items.length;
    items.push({
      name,
      path: cleanPath,
      isDirectory,
      isSymlink,
      size: parseInt(sizeStr, 10) || 0,
      modifyTime: parseLsTimestamp(dateStr),
      permissions: parseSymbolicPermissionsToOctal(permStr),
    });

    if (isSymlink) {
      symlinkIndices.push(itemIndex);
    }
  }

  if (symlinkIndices.length > 0) {
    const checks = symlinkIndices
      .map((idx) => `[ -d ${escapeShellPath(items[idx].path)} ] && echo 1 || echo 0`)
      .join('; ');
    try {
      const symRes = await execCommand(client, checks, 10000);
      const results = symRes.stdout.trim().split(/\r?\n/);
      for (let i = 0; i < symlinkIndices.length; i++) {
        if (results[i]?.trim() === '1') {
          items[symlinkIndices[i]].isDirectory = true;
        }
      }
    } catch {
      // Keep default isDirectory = false on symlink check failure
    }
  }

  items.sort((a, b) => {
    if (a.isDirectory === b.isDirectory) {
      return a.name.localeCompare(b.name);
    }
    return a.isDirectory ? -1 : 1;
  });

  return items;
}
