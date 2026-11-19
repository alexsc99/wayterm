import { SFTPWrapper } from 'ssh2';
import path from 'path';

// Low-level SFTP subsystem helpers shared by file operations and transfers.

/** Resolves `.`, `~` and `~/…` against the SFTP server's home (realpath '.'). */
export async function normalizeSftpRemotePath(sftp: SFTPWrapper, remotePath: string): Promise<string> {
  const trimmed = (remotePath || '.').trim();
  if (trimmed === '.' || trimmed === '~' || trimmed.startsWith('~/')) {
    const realHome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('.'), 3000);
      sftp.realpath('.', (err, absPath) => {
        clearTimeout(timer);
        if (err || !absPath) {
          resolve('.');
        } else {
          resolve(absPath);
        }
      });
    });
    if (trimmed === '.' || trimmed === '~') {
      return realHome;
    }
    const sub = trimmed.slice(2);
    if (!sub) return realHome;
    return realHome === '.' ? sub : path.posix.join(realHome, sub);
  }
  return trimmed;
}

/** stat() that resolves null on error or timeout instead of rejecting. */
export function statWithTimeout(
  sftp: SFTPWrapper,
  targetPath: string,
  timeoutMs: number = 2500
): Promise<{ mode: number; size: number; mtime: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);

    sftp.stat(targetPath, (err, stats) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err || !stats) {
        resolve(null);
      } else {
        resolve({
          mode: stats.mode,
          size: stats.size,
          mtime: stats.mtime,
        });
      }
    });
  });
}

export async function deleteDirectoryRecursiveSFTP(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  const list = await new Promise<
    Array<{ filename: string; attrs: { mode: number } }>
  >((resolve, reject) => {
    sftp.readdir(dirPath, (err, entries) => {
      if (err) return reject(err);
      resolve(entries || []);
    });
  });

  for (const item of list) {
    if (item.filename === '.' || item.filename === '..') continue;
    const childPath = path.posix.join(dirPath, item.filename);
    const fileType = item.attrs.mode & 0o170000;
    const isTrueDirectory = fileType === 0o040000;

    if (isTrueDirectory) {
      await deleteDirectoryRecursiveSFTP(sftp, childPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(childPath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    sftp.rmdir(dirPath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/** mkdir -p over SFTP; tolerates concurrent creation of the same directory. */
export async function ensureRemoteDirSFTP(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const existing = await statWithTimeout(sftp, remoteDir, 4000);
  if (existing && (existing.mode & 0o170000) === 0o040000) {
    return;
  }

  const parts = remoteDir.split('/').filter(Boolean);
  const isAbsolute = remoteDir.startsWith('/');
  let current = isAbsolute ? '/' : '';

  for (const part of parts) {
    current = current === '/' ? `/${part}` : current ? `${current}/${part}` : part;
    const st = await statWithTimeout(sftp, current, 4000);
    if (!st) {
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(current, (err) => {
          if (err) {
            statWithTimeout(sftp, current, 3000).then((recheck) => {
              if (recheck && (recheck.mode & 0o170000) === 0o040000) {
                resolve();
              } else {
                reject(err);
              }
            });
            return;
          }
          resolve();
        });
      });
    }
  }
}
