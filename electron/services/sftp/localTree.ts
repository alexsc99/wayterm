import fs from 'fs';
import path from 'path';
import os from 'os';
import { ActiveTransferControl } from './types';

interface LocalFileEntry {
  localPath: string;
  relativePath: string;
  size: number;
  mode: number;
  mtimeSec: number;
  atimeSec: number;
  isDirectory: boolean;
}

/** Expands `~` and resolves the path against the process cwd. */
export function expandLocalPath(inputPath: string): string {
  if (!inputPath || inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  if (inputPath.startsWith('~')) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return path.resolve(inputPath);
}

/** Depth-first listing of a local directory (skips .DS_Store) with byte/file totals. */
export async function collectLocalTree(rootPath: string, control: ActiveTransferControl): Promise<{
  entries: LocalFileEntry[];
  totalBytes: number;
  fileCount: number;
}> {
  const entries: LocalFileEntry[] = [];
  let totalBytes = 0;
  let fileCount = 0;

  const walk = async (currentPath: string, relPath: string) => {
    if (control.cancelled) throw new Error('Übertragung abgebrochen');
    const dirEntries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (control.cancelled) throw new Error('Übertragung abgebrochen');
      if (entry.name === '.DS_Store' || entry.name === '.' || entry.name === '..') continue;
      const fullPath = path.join(currentPath, entry.name);
      const childRel = relPath ? path.posix.join(relPath, entry.name) : entry.name;
      const stat = await fs.promises.stat(fullPath);
      const isDir = stat.isDirectory();
      entries.push({
        localPath: fullPath,
        relativePath: childRel,
        size: isDir ? 0 : stat.size,
        mode: stat.mode & 0o777,
        mtimeSec: Math.floor(stat.mtimeMs / 1000),
        atimeSec: Math.floor(stat.atimeMs / 1000),
        isDirectory: isDir,
      });
      if (isDir) {
        await walk(fullPath, childRel);
      } else {
        totalBytes += stat.size;
        fileCount++;
      }
    }
  };

  await walk(rootPath, '');
  return { entries, totalBytes, fileCount };
}
