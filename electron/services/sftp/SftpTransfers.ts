import { SFTPWrapper } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { ActiveTransferControl, PoolEntry } from './types';
import { ConnectionPool } from './ConnectionPool';
import { emitProgress } from './TransferRegistry';
import { collectLocalTree } from './localTree';
import { ensureRemoteDirSFTP, normalizeSftpRemotePath } from './sftpHelpers';

/**
 * File/directory upload and download over the SFTP subsystem (fastPut/fastGet).
 * Cancelling an in-flight file destroys its pooled connection via the pool.
 */
export class SftpTransfers {
  constructor(private readonly pool: ConnectionPool) {}

  private async sftpPutSingleFile(
    sftp: SFTPWrapper,
    entry: PoolEntry,
    localFilePath: string,
    remoteFilePath: string,
    fileSize: number,
    preserveTimes: boolean,
    mtimeSec: number,
    atimeSec: number,
    control: ActiveTransferControl,
    onDeltaBytes: (delta: number, fileName: string) => void
  ): Promise<void> {
    if (control.cancelled) {
      throw new Error('Übertragung abgebrochen');
    }

    const fileName = path.basename(localFilePath);

    if (fileSize === 0) {
      await new Promise<void>((resolve, reject) => {
        sftp.writeFile(remoteFilePath, Buffer.alloc(0), (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      onDeltaBytes(0, fileName);
    } else {
      await new Promise<void>((resolve, reject) => {
        let prevTransferred = 0;
        let settled = false;
        const cleanup = () => {
          const idx = control.abortCallbacks.indexOf(onAbort);
          if (idx !== -1) control.abortCallbacks.splice(idx, 1);
          entry.client.removeListener('close', onClose);
        };
        const onClose = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('SSH-Verbindung während der Übertragung geschlossen.'));
        };

        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          this.pool.evict(entry.key, entry, false);
          reject(new Error('Übertragung abgebrochen'));
        };
        control.abortCallbacks.push(onAbort);
        entry.client.once('close', onClose);

        sftp.fastPut(
          localFilePath,
          remoteFilePath,
          {
            concurrency: 32,
            chunkSize: 32768,
            step: (totalTransferred) => {
              if (settled) return;
              if (control.cancelled) {
                onAbort();
                return;
              }
              const delta = Math.max(0, totalTransferred - prevTransferred);
              prevTransferred = totalTransferred;
              onDeltaBytes(delta, fileName);
            },
          },
          (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (control.cancelled) {
              return reject(new Error('Übertragung abgebrochen'));
            }
            if (err) return reject(err);
            resolve();
          }
        );
      });
    }

    if (preserveTimes) {
      await new Promise<void>((resolve) => {
        sftp.utimes(remoteFilePath, atimeSec, mtimeSec, () => resolve());
      });
    }
  }

  public async uploadViaSFTP(
    entry: PoolEntry,
    resolvedLocalPath: string,
    remotePath: string,
    transferId: string,
    preserveTimes: boolean,
    control: ActiveTransferControl,
    window?: BrowserWindow | null
  ): Promise<{ filesTransferred: number; bytesTransferred: number }> {
    const sftp = entry.sftp;
    if (!sftp) {
      throw new Error('SFTP-Session nicht verfügbar.');
    }

    const stat = await fs.promises.stat(resolvedLocalPath);
    const normalizedRemote = await normalizeSftpRemotePath(sftp, remotePath);
    const startTime = Date.now();
    let lastEmit = 0;

    if (!stat.isDirectory()) {
      const targetRemote = normalizedRemote.endsWith('/')
        ? path.posix.join(normalizedRemote, path.basename(resolvedLocalPath))
        : normalizedRemote;
      const total = stat.size;
      let transferred = 0;

      await this.sftpPutSingleFile(
        sftp,
        entry,
        resolvedLocalPath,
        targetRemote,
        total,
        preserveTimes,
        Math.floor(stat.mtimeMs / 1000),
        Math.floor(stat.atimeMs / 1000),
        control,
        (delta, fileName) => {
          transferred += delta;
          const now = Date.now();
          if (now - lastEmit >= 80 || transferred === total) {
            lastEmit = now;
            const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
            const percent = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 100;
            emitProgress(window, {
              transferId,
              transferred,
              total,
              percent,
              currentFile: fileName,
              speedBytesPerSec: Math.round(transferred / elapsedSec),
              protocol: 'sftp',
            });
          }
        }
      );

      return { filesTransferred: 1, bytesTransferred: total };
    }

    const tree = await collectLocalTree(resolvedLocalPath, control);
    if (control.cancelled) throw new Error('Übertragung abgebrochen');
    await ensureRemoteDirSFTP(sftp, normalizedRemote);

    let transferred = 0;
    let filesTransferred = 0;
    const total = tree.totalBytes;

    for (const item of tree.entries) {
      if (control.cancelled) {
        throw new Error('Übertragung abgebrochen');
      }
      const remoteItemPath = path.posix.join(normalizedRemote, item.relativePath);
      if (item.isDirectory) {
        await ensureRemoteDirSFTP(sftp, remoteItemPath);
      } else {
        await this.sftpPutSingleFile(
          sftp,
          entry,
          item.localPath,
          remoteItemPath,
          item.size,
          preserveTimes,
          item.mtimeSec,
          item.atimeSec,
          control,
          (delta, fileName) => {
            transferred += delta;
            const now = Date.now();
            if (now - lastEmit >= 80 || transferred === total) {
              lastEmit = now;
              const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
              const percent =
                total > 0
                  ? Math.min(100, Math.round((transferred / total) * 100))
                  : Math.min(100, Math.round(((filesTransferred + 1) / Math.max(1, tree.fileCount)) * 100));
              emitProgress(window, {
                transferId,
                transferred,
                total,
                percent,
                currentFile: fileName,
                speedBytesPerSec: Math.round(transferred / elapsedSec),
                protocol: 'sftp',
              });
            }
          }
        );
        filesTransferred++;
      }
    }
    if (control.cancelled) throw new Error('Übertragung abgebrochen');

    emitProgress(window, {
      transferId,
      transferred,
      total,
      percent: 100,
      protocol: 'sftp',
    });

    return { filesTransferred, bytesTransferred: transferred };
  }

  private async sftpGetSingleFile(
    sftp: SFTPWrapper,
    entry: PoolEntry,
    remoteFilePath: string,
    localFilePath: string,
    fileSize: number,
    preserveTimes: boolean,
    mtimeSec: number,
    control: ActiveTransferControl,
    onDeltaBytes: (delta: number, fileName: string) => void
  ): Promise<void> {
    if (control.cancelled) {
      throw new Error('Übertragung abgebrochen');
    }

    await fs.promises.mkdir(path.dirname(localFilePath), { recursive: true });
    if (control.cancelled) throw new Error('Übertragung abgebrochen');
    const fileName = path.posix.basename(remoteFilePath);

    if (fileSize === 0) {
      await fs.promises.writeFile(localFilePath, Buffer.alloc(0));
      onDeltaBytes(0, fileName);
    } else {
      await new Promise<void>((resolve, reject) => {
        let prevTransferred = 0;
        let settled = false;
        const cleanup = () => {
          const idx = control.abortCallbacks.indexOf(onAbort);
          if (idx !== -1) control.abortCallbacks.splice(idx, 1);
          entry.client.removeListener('close', onClose);
        };
        const onClose = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('SSH-Verbindung während der Übertragung geschlossen.'));
        };

        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          this.pool.evict(entry.key, entry, false);
          reject(new Error('Übertragung abgebrochen'));
        };
        control.abortCallbacks.push(onAbort);
        entry.client.once('close', onClose);

        sftp.fastGet(
          remoteFilePath,
          localFilePath,
          {
            concurrency: 32,
            chunkSize: 32768,
            step: (totalTransferred) => {
              if (settled) return;
              if (control.cancelled) {
                onAbort();
                return;
              }
              const delta = Math.max(0, totalTransferred - prevTransferred);
              prevTransferred = totalTransferred;
              onDeltaBytes(delta, fileName);
            },
          },
          (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (control.cancelled) {
              return reject(new Error('Übertragung abgebrochen'));
            }
            if (err) return reject(err);
            resolve();
          }
        );
      });
    }

    if (preserveTimes && mtimeSec > 0) {
      try {
        await fs.promises.utimes(localFilePath, mtimeSec, mtimeSec);
      } catch {
        // ignore utimes errors
      }
    }
  }

  private async collectRemoteTreeSFTP(
    sftp: SFTPWrapper,
    rootRemotePath: string,
    control: ActiveTransferControl
  ): Promise<{
    items: Array<{
      remotePath: string;
      relativePath: string;
      isDirectory: boolean;
      size: number;
      mtimeSec: number;
    }>;
    totalBytes: number;
    fileCount: number;
  }> {
    const items: Array<{
      remotePath: string;
      relativePath: string;
      isDirectory: boolean;
      size: number;
      mtimeSec: number;
    }> = [];
    let totalBytes = 0;
    let fileCount = 0;

    const walk = async (currRemote: string, relPath: string) => {
      if (control.cancelled) throw new Error('Übertragung abgebrochen');
      const list = await new Promise<
        Array<{ filename: string; attrs: { mode: number; size: number; mtime: number } }>
      >((resolve, reject) => {
        sftp.readdir(currRemote, (err, entries) => {
          if (err) return reject(err);
          resolve(entries || []);
        });
      });

      for (const entry of list) {
        if (control.cancelled) throw new Error('Übertragung abgebrochen');
        if (entry.filename === '.' || entry.filename === '..') continue;
        const fullRemote = path.posix.join(currRemote, entry.filename);
        const childRel = relPath ? path.posix.join(relPath, entry.filename) : entry.filename;
        const fileType = entry.attrs.mode & 0o170000;
        const isDir = fileType === 0o040000;

        items.push({
          remotePath: fullRemote,
          relativePath: childRel,
          isDirectory: isDir,
          size: isDir ? 0 : entry.attrs.size,
          mtimeSec: entry.attrs.mtime,
        });

        if (isDir) {
          await walk(fullRemote, childRel);
        } else {
          totalBytes += entry.attrs.size;
          fileCount++;
        }
      }
    };

    await walk(rootRemotePath, '');
    return { items, totalBytes, fileCount };
  }

  public async downloadViaSFTP(
    entry: PoolEntry,
    remotePath: string,
    resolvedLocalPath: string,
    transferId: string,
    preserveTimes: boolean,
    control: ActiveTransferControl,
    window?: BrowserWindow | null
  ): Promise<{ filesTransferred: number; bytesTransferred: number }> {
    const sftp = entry.sftp;
    if (!sftp) {
      throw new Error('SFTP-Session nicht verfügbar.');
    }

    const normalizedRemote = await normalizeSftpRemotePath(sftp, remotePath);
    const remoteStats = await new Promise<{ mode: number; size: number; mtime: number }>(
      (resolve, reject) => {
        sftp.stat(normalizedRemote, (err, st) => {
          if (err || !st) return reject(err || new Error(`Remote-Pfad nicht gefunden: ${remotePath}`));
          resolve({ mode: st.mode, size: st.size, mtime: st.mtime });
        });
      }
    );

    const isDir = (remoteStats.mode & 0o170000) === 0o040000;
    const startTime = Date.now();
    let lastEmit = 0;

    if (!isDir) {
      let targetLocal = resolvedLocalPath;
      try {
        const localStat = await fs.promises.stat(resolvedLocalPath);
        if (localStat.isDirectory()) {
          targetLocal = path.join(resolvedLocalPath, path.posix.basename(normalizedRemote));
        }
      } catch {
        // targetLocal does not exist yet, treat resolvedLocalPath as target file path
      }

      const total = remoteStats.size;
      let transferred = 0;

      await this.sftpGetSingleFile(
        sftp,
        entry,
        normalizedRemote,
        targetLocal,
        total,
        preserveTimes,
        remoteStats.mtime,
        control,
        (delta, fileName) => {
          transferred += delta;
          const now = Date.now();
          if (now - lastEmit >= 80 || transferred === total) {
            lastEmit = now;
            const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
            const percent = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 100;
            emitProgress(window, {
              transferId,
              transferred,
              total,
              percent,
              currentFile: fileName,
              speedBytesPerSec: Math.round(transferred / elapsedSec),
              protocol: 'sftp',
            });
          }
        }
      );

      return { filesTransferred: 1, bytesTransferred: total };
    }

    await fs.promises.mkdir(resolvedLocalPath, { recursive: true });
    const tree = await this.collectRemoteTreeSFTP(sftp, normalizedRemote, control);
    if (control.cancelled) throw new Error('Übertragung abgebrochen');
    const total = tree.totalBytes;
    let transferred = 0;
    let filesTransferred = 0;

    for (const item of tree.items) {
      if (control.cancelled) {
        throw new Error('Übertragung abgebrochen');
      }
      const localItemPath = path.join(resolvedLocalPath, ...item.relativePath.split('/'));
      if (item.isDirectory) {
        await fs.promises.mkdir(localItemPath, { recursive: true });
      } else {
        await this.sftpGetSingleFile(
          sftp,
          entry,
          item.remotePath,
          localItemPath,
          item.size,
          preserveTimes,
          item.mtimeSec,
          control,
          (delta, fileName) => {
            transferred += delta;
            const now = Date.now();
            if (now - lastEmit >= 80 || transferred === total) {
              lastEmit = now;
              const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
              const percent =
                total > 0
                  ? Math.min(100, Math.round((transferred / total) * 100))
                  : Math.min(100, Math.round(((filesTransferred + 1) / Math.max(1, tree.fileCount)) * 100));
              emitProgress(window, {
                transferId,
                transferred,
                total,
                percent,
                currentFile: fileName,
                speedBytesPerSec: Math.round(transferred / elapsedSec),
                protocol: 'sftp',
              });
            }
          }
        );
        filesTransferred++;
      }
    }
    if (control.cancelled) throw new Error('Übertragung abgebrochen');

    emitProgress(window, {
      transferId,
      transferred,
      total,
      percent: 100,
      protocol: 'sftp',
    });

    return { filesTransferred, bytesTransferred: transferred };
  }
}
