import fs from 'fs';
import path from 'path';
import os from 'os';
import { LocalFileItem } from '../../src/types';

export class LocalFileService {
  public static getHomePath(): string {
    return os.homedir();
  }

  public static async listDirectory(dirPath: string): Promise<LocalFileItem[]> {
    let resolved: string;
    if (!dirPath || dirPath === '~') {
      resolved = os.homedir();
    } else if (dirPath.startsWith('~/') || dirPath.startsWith('~\\')) {
      resolved = path.join(os.homedir(), dirPath.slice(2));
    } else if (dirPath.startsWith('~')) {
      resolved = path.join(os.homedir(), dirPath.slice(1));
    } else {
      resolved = path.resolve(dirPath);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`Verzeichnis existiert nicht: ${resolved}`);
    }

    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    const items: LocalFileItem[] = [];

    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === '.' || entry.name === '..') continue;

      const fullPath = path.join(resolved, entry.name);
      const isSymlink = entry.isSymbolicLink();
      try {
        const stat = await fs.promises.stat(fullPath);
        items.push({
          name: entry.name,
          path: fullPath,
          isDirectory: stat.isDirectory(),
          isSymlink,
          size: stat.size,
          modifyTime: stat.mtimeMs,
        });
      } catch {
        // Skip broken symlinks or inaccessible files
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
}
