import path from 'path';
import { RemoteFileItem } from '../../../src/types';
import { PoolEntry } from './types';
import { escapeShellPath, execCommand } from './remoteExec';
import { listDirectoryViaExec } from './execListing';
import { deleteDirectoryRecursiveSFTP, normalizeSftpRemotePath, statWithTimeout } from './sftpHelpers';

// Remote file-manager operations on one pooled connection.
// Each uses the SFTP subsystem when available, otherwise shell commands over exec.

export async function listDirectory(entry: PoolEntry, remotePath: string): Promise<RemoteFileItem[]> {
  if (entry.mode === 'scp' || !entry.sftp) {
    return listDirectoryViaExec(entry.client, remotePath);
  }

  const sftp = entry.sftp;
  const basePath = await normalizeSftpRemotePath(sftp, remotePath);

  const rawList = await new Promise<
    Array<{ filename: string; attrs: { mode: number; size: number; mtime: number } }>
  >((resolve, reject) => {
    sftp.readdir(basePath, (err, list) => {
      if (err) return reject(err);
      resolve(list || []);
    });
  });

  const filtered = rawList.filter(
    (item) => item.filename !== '.' && item.filename !== '..'
  );

  const items: RemoteFileItem[] = await Promise.all(
    filtered.map(async (item) => {
      const fileType = item.attrs.mode & 0o170000;
      const isSymlink = fileType === 0o120000;
      let isDirectory = fileType === 0o040000;
      const cleanPath =
        basePath === '.'
          ? item.filename
          : path.posix.join(basePath, item.filename);

      let size = item.attrs.size;
      if (isSymlink) {
        const targetStats = await statWithTimeout(sftp, cleanPath, 2500);
        if (targetStats) {
          isDirectory = (targetStats.mode & 0o170000) === 0o040000;
          if (!isDirectory && typeof targetStats.size === 'number') {
            size = targetStats.size;
          }
        }
      }

      return {
        name: item.filename,
        path: cleanPath,
        isDirectory,
        isSymlink,
        size,
        modifyTime: item.attrs.mtime * 1000,
        permissions: (item.attrs.mode & 0o777).toString(8),
      };
    })
  );

  items.sort((a, b) => {
    if (a.isDirectory === b.isDirectory) {
      return a.name.localeCompare(b.name);
    }
    return a.isDirectory ? -1 : 1;
  });

  return items;
}

export async function createDirectory(entry: PoolEntry, remotePath: string): Promise<void> {
  if (entry.mode === 'scp' || !entry.sftp) {
    const res = await execCommand(
      entry.client,
      `mkdir -p ${escapeShellPath(remotePath)}`
    );
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || `Ordner konnte nicht erstellt werden: ${remotePath}`);
    }
    return;
  }

  const sftp = entry.sftp;
  const targetPath = await normalizeSftpRemotePath(sftp, remotePath);
  await new Promise<void>((resolve, reject) => {
    sftp.mkdir(targetPath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function deleteFile(entry: PoolEntry, remotePath: string): Promise<void> {
  if (entry.mode === 'scp' || !entry.sftp) {
    const res = await execCommand(
      entry.client,
      `rm -f ${escapeShellPath(remotePath)}`
    );
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || `Datei konnte nicht gelöscht werden: ${remotePath}`);
    }
    return;
  }

  const sftp = entry.sftp;
  const targetPath = await normalizeSftpRemotePath(sftp, remotePath);
  await new Promise<void>((resolve, reject) => {
    sftp.unlink(targetPath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function readRemoteFile(entry: PoolEntry, remotePath: string): Promise<string> {
  if (entry.mode === 'scp' || !entry.sftp) {
    const res = await execCommand(
      entry.client,
      `cat ${escapeShellPath(remotePath)}`
    );
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || `Datei konnte nicht gelesen werden: ${remotePath}`);
    }
    return res.stdout;
  }

  const sftp = entry.sftp;
  const targetPath = await normalizeSftpRemotePath(sftp, remotePath);
  return new Promise<string>((resolve, reject) => {
    const stream = sftp.createReadStream(targetPath, { encoding: 'utf-8' });
    let content = '';
    stream.on('data', (chunk: string | Buffer) => {
      content += chunk.toString();
    });
    stream.on('end', () => resolve(content));
    stream.on('error', (err: unknown) => reject(err));
  });
}

export async function writeRemoteFile(entry: PoolEntry, remotePath: string, content: string): Promise<void> {
  if (entry.mode === 'scp' || !entry.sftp) {
    const res = await execCommand(
      entry.client,
      `cat > ${escapeShellPath(remotePath)} << 'EOF_PUTTY_WRITE'\n${content}\nEOF_PUTTY_WRITE`
    );
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || `Datei konnte nicht geschrieben werden: ${remotePath}`);
    }
    return;
  }

  const sftp = entry.sftp;
  const targetPath = await normalizeSftpRemotePath(sftp, remotePath);
  return new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(targetPath, { encoding: 'utf-8' });
    stream.on('finish', () => resolve());
    stream.on('error', (err: unknown) => reject(err));
    stream.write(content, 'utf-8');
    stream.end();
  });
}

export async function deleteDirectory(entry: PoolEntry, remotePath: string): Promise<void> {
  if (entry.mode === 'scp' || !entry.sftp) {
    const res = await execCommand(
      entry.client,
      `rm -rf ${escapeShellPath(remotePath)}`
    );
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || `Ordner konnte nicht gelöscht werden: ${remotePath}`);
    }
    return;
  }

  const targetPath = await normalizeSftpRemotePath(entry.sftp, remotePath);
  await deleteDirectoryRecursiveSFTP(entry.sftp, targetPath);
}

export async function renameFile(entry: PoolEntry, oldPath: string, newPath: string): Promise<void> {
  if (entry.mode === 'scp' || !entry.sftp) {
    const res = await execCommand(
      entry.client,
      `mv -f ${escapeShellPath(oldPath)} ${escapeShellPath(newPath)}`
    );
    if (res.code !== 0) {
      throw new Error(
        res.stderr.trim() || `Umbenennen fehlgeschlagen: ${oldPath} -> ${newPath}`
      );
    }
    return;
  }

  const sftp = entry.sftp;
  const resolvedOld = await normalizeSftpRemotePath(sftp, oldPath);
  const resolvedNew = await normalizeSftpRemotePath(sftp, newPath);
  await new Promise<void>((resolve, reject) => {
    sftp.rename(resolvedOld, resolvedNew, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
