import { Client, ClientChannel } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';
import { ActiveTransferControl } from './types';
import { ChannelReader } from './ChannelReader';
import { emitProgress } from './TransferRegistry';
import { collectLocalTree } from './localTree';
import { escapeShellPath, execCommand } from './remoteExec';

// SCP protocol (remote `scp -t` sink / `scp -f` source) over an SSH exec channel.

export async function scpUpload(
  client: Client,
  resolvedLocalPath: string,
  remotePath: string,
  transferId: string,
  preserveTimes: boolean,
  control: ActiveTransferControl,
  window?: BrowserWindow | null
): Promise<{ filesTransferred: number; bytesTransferred: number }> {
  const stat = await fs.promises.stat(resolvedLocalPath);
  const isDir = stat.isDirectory();
  const startTime = Date.now();
  let lastEmit = 0;

  if (isDir) {
    const mkdirRes = await execCommand(
      client,
      `mkdir -p ${escapeShellPath(remotePath)}`
    );
    if (mkdirRes.code !== 0) {
      throw new Error(
        mkdirRes.stderr.trim() || `Zielverzeichnis konnte nicht erstellt werden: ${remotePath}`
      );
    }
  }

  const scpFlags = `${isDir ? '-r ' : ''}${preserveTimes ? '-p ' : ''}-t`;
  const scpCmd = `scp ${scpFlags} ${escapeShellPath(remotePath)}`;

  const stream = await new Promise<ClientChannel>((resolve, reject) => {
    client.exec(scpCmd, (err, ch) => {
      if (err) return reject(err);
      resolve(ch);
    });
  });

  let stderrText = '';
  stream.stderr.on('data', (chunk: Buffer | string) => {
    stderrText += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
  });

  const abortChannel = () => {
    try {
      stream.close();
      stream.destroy();
    } catch {
      // ignore
    }
  };
  control.abortCallbacks.push(abortChannel);

  const checkCancelled = () => {
    if (control.cancelled) {
      throw new Error('Übertragung abgebrochen');
    }
  };

  const reader = new ChannelReader(stream);

  const readAck = async () => {
    const b = await reader.readByte(checkCancelled);
    if (b === null) {
      throw new Error(
        stderrText.trim() || 'SCP-Verbindung vom Server unerwartet beendet (kein ACK).'
      );
    }
    if (b === 0) return;
    if (b === 1 || b === 2) {
      const line = await reader.readLine(checkCancelled);
      throw new Error(line.trim() || stderrText.trim() || `SCP-Fehler (Code ${b})`);
    }
    throw new Error(stderrText.trim() || `Unerwartetes SCP-Statusbyte: ${b}`);
  };

  const writeBuffer = (buf: Buffer | string): Promise<void> => {
    checkCancelled();
    return new Promise<void>((resolve, reject) => {
      const ok = stream.write(buf, (err?: Error | null) => {
        if (err) reject(err);
      });
      if (ok) {
        resolve();
      } else {
        const onDrain = () => {
          stream.removeListener('error', onErr);
          resolve();
        };
        const onErr = (err: Error) => {
          stream.removeListener('drain', onDrain);
          reject(err);
        };
        stream.once('drain', onDrain);
        stream.once('error', onErr);
      }
    });
  };

  try {
    await readAck();

    let totalBytes = stat.size;
    let totalFiles = 1;
    if (isDir) {
      const treeInfo = await collectLocalTree(resolvedLocalPath, control);
      totalBytes = treeInfo.totalBytes;
      totalFiles = treeInfo.fileCount;
    }

    let transferredBytes = 0;
    let filesTransferred = 0;

    const sendSingleFileOverChannel = async (
      filePath: string,
      targetName: string,
      fileStat: fs.Stats
    ) => {
      checkCancelled();
      if (preserveTimes) {
        const mtime = Math.floor(fileStat.mtimeMs / 1000);
        const atime = Math.floor(fileStat.atimeMs / 1000);
        await writeBuffer(`T${mtime} 0 ${atime} 0\n`);
        await readAck();
      }

      const modeStr = (fileStat.mode & 0o777 || 0o644).toString(8).padStart(4, '0');
      const safeName = targetName.replace(/[\r\n/]/g, '_');
      await writeBuffer(`C${modeStr} ${fileStat.size} ${safeName}\n`);
      await readAck();

      if (fileStat.size > 0) {
        const readStream = fs.createReadStream(filePath, { highWaterMark: 65536 });
        const abortRead = () => {
          try {
            readStream.destroy();
          } catch {
            // ignore
          }
        };
        control.abortCallbacks.push(abortRead);

        try {
          for await (const chunk of readStream) {
            checkCancelled();
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            await writeBuffer(buf);
            transferredBytes += buf.length;

            const now = Date.now();
            if (now - lastEmit >= 80 || transferredBytes === totalBytes) {
              lastEmit = now;
              const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
              const percent =
                totalBytes > 0
                  ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100))
                  : 100;
              emitProgress(window, {
                transferId,
                transferred: transferredBytes,
                total: totalBytes,
                percent,
                currentFile: safeName,
                speedBytesPerSec: Math.round(transferredBytes / elapsedSec),
                protocol: 'scp',
              });
            }
          }
        } finally {
          const idx = control.abortCallbacks.indexOf(abortRead);
          if (idx !== -1) control.abortCallbacks.splice(idx, 1);
        }
      } else {
        const now = Date.now();
        const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
        const percent =
          totalBytes > 0
            ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100))
            : Math.min(100, Math.round(((filesTransferred + 1) / Math.max(1, totalFiles)) * 100));
        emitProgress(window, {
          transferId,
          transferred: transferredBytes,
          total: totalBytes,
          percent,
          currentFile: safeName,
          speedBytesPerSec: Math.round(transferredBytes / elapsedSec),
          protocol: 'scp',
        });
      }

      await writeBuffer(Buffer.from([0]));
      await readAck();
      filesTransferred++;
    };

    const sendDirectoryContents = async (dirPath: string) => {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.DS_Store' || entry.name === '.' || entry.name === '..') continue;
        checkCancelled();
        const fullPath = path.join(dirPath, entry.name);
        const itemStat = await fs.promises.stat(fullPath);

        if (itemStat.isDirectory()) {
          if (preserveTimes) {
            const mtime = Math.floor(itemStat.mtimeMs / 1000);
            const atime = Math.floor(itemStat.atimeMs / 1000);
            await writeBuffer(`T${mtime} 0 ${atime} 0\n`);
            await readAck();
          }
          const modeStr = (itemStat.mode & 0o777 || 0o755).toString(8).padStart(4, '0');
          const safeDirName = entry.name.replace(/[\r\n/]/g, '_');
          await writeBuffer(`D${modeStr} 0 ${safeDirName}\n`);
          await readAck();

          await sendDirectoryContents(fullPath);

          await writeBuffer('E\n');
          await readAck();
        } else {
          await sendSingleFileOverChannel(fullPath, entry.name, itemStat);
        }
      }
    };

    if (!isDir) {
      const targetFileName = remotePath.endsWith('/')
        ? path.basename(resolvedLocalPath)
        : path.posix.basename(remotePath) || path.basename(resolvedLocalPath);
      await sendSingleFileOverChannel(resolvedLocalPath, targetFileName, stat);
    } else {
      await sendDirectoryContents(resolvedLocalPath);
    }

    emitProgress(window, {
      transferId,
      transferred: transferredBytes,
      total: totalBytes,
      percent: 100,
      protocol: 'scp',
    });

    stream.end();
    return { filesTransferred, bytesTransferred: transferredBytes };
  } finally {
    const idx = control.abortCallbacks.indexOf(abortChannel);
    if (idx !== -1) control.abortCallbacks.splice(idx, 1);
    try {
      stream.close();
    } catch {
      // ignore
    }
  }
}

export async function scpDownload(
  client: Client,
  remotePath: string,
  resolvedLocalPath: string,
  transferId: string,
  recursive: boolean,
  preserveTimes: boolean,
  control: ActiveTransferControl,
  window?: BrowserWindow | null
): Promise<{ filesTransferred: number; bytesTransferred: number }> {
  let isRemoteDir = recursive;
  if (!isRemoteDir) {
    const dirCheck = await execCommand(
      client,
      `[ -d ${escapeShellPath(remotePath)} ] && echo 1 || echo 0`,
      10000
    );
    if (dirCheck.stdout.trim() === '1') {
      isRemoteDir = true;
    }
  }

  const scpFlags = `${isRemoteDir ? '-r ' : ''}${preserveTimes ? '-p ' : ''}-f`;
  const scpCmd = `scp ${scpFlags} ${escapeShellPath(remotePath)}`;

  const stream = await new Promise<ClientChannel>((resolve, reject) => {
    client.exec(scpCmd, (err, ch) => {
      if (err) return reject(err);
      resolve(ch);
    });
  });

  let stderrText = '';
  stream.stderr.on('data', (chunk: Buffer | string) => {
    stderrText += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
  });

  const abortChannel = () => {
    try {
      stream.close();
      stream.destroy();
    } catch {
      // ignore
    }
  };
  control.abortCallbacks.push(abortChannel);

  const checkCancelled = () => {
    if (control.cancelled) {
      throw new Error('Übertragung abgebrochen');
    }
  };

  const sendAck = (): Promise<void> => {
    checkCancelled();
    return new Promise((resolve, reject) => {
      stream.write(Buffer.from([0]), (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  const reader = new ChannelReader(stream);
  const startTime = Date.now();
  let lastEmit = 0;
  let transferredBytes = 0;
  let estimatedTotalBytes = 0;
  let filesTransferred = 0;

  const dirStack: Array<{ dirPath: string; mtime?: number; atime?: number }> = [];
  let pendingTimes: { mtime: number; atime: number } | null = null;

  try {
    await sendAck();

    while (true) {
      const cmd = await reader.readByte(checkCancelled);
      if (cmd === null) {
        break;
      }

      if (cmd === 0) {
        continue;
      }

      if (cmd === 1 || cmd === 2) {
        const errLine = await reader.readLine(checkCancelled);
        throw new Error(errLine.trim() || stderrText.trim() || `SCP-Download-Fehler (Code ${cmd})`);
      }

      if (cmd === 0x54) {
        // 'T'<mtime> 0 <atime> 0\n
        const timeLine = await reader.readLine(checkCancelled);
        const parts = timeLine.trim().split(/\s+/);
        if (parts.length >= 3) {
          pendingTimes = {
            mtime: parseInt(parts[0], 10) || 0,
            atime: parseInt(parts[2], 10) || 0,
          };
        }
        await sendAck();
        continue;
      }

      if (cmd === 0x44) {
        // 'D'<mode> <size> <dirname>\n
        const dirLine = await reader.readLine(checkCancelled);
        const match = /^([0-7]{4})\s+(\d+)\s+(.+)$/.exec(dirLine.trim());
        if (!match) {
          throw new Error(`Ungültiger SCP-Verzeichnis-Header: D${dirLine}`);
        }
        const dirName = path.basename(match[3]);
        let targetDir: string;
        if (dirStack.length === 0) {
          targetDir = resolvedLocalPath;
        } else {
          targetDir = path.join(dirStack[dirStack.length - 1].dirPath, dirName);
        }

        await fs.promises.mkdir(targetDir, { recursive: true });
        dirStack.push({
          dirPath: targetDir,
          mtime: pendingTimes?.mtime,
          atime: pendingTimes?.atime,
        });
        pendingTimes = null;
        await sendAck();
        continue;
      }

      if (cmd === 0x45) {
        // 'E'\n
        await reader.readLine(checkCancelled);
        const popped = dirStack.pop();
        if (popped && preserveTimes && popped.mtime && popped.atime) {
          try {
            await fs.promises.utimes(popped.dirPath, popped.atime, popped.mtime);
          } catch {
            // ignore
          }
        }
        await sendAck();
        continue;
      }

      if (cmd === 0x43) {
        // 'C'<mode> <size> <filename>\n
        const fileLine = await reader.readLine(checkCancelled);
        const match = /^([0-7]{4})\s+(\d+)\s+(.+)$/.exec(fileLine.trim());
        if (!match) {
          throw new Error(`Ungültiger SCP-Datei-Header: C${fileLine}`);
        }
        const fileMode = parseInt(match[1], 8) || 0o644;
        const fileSize = parseInt(match[2], 10) || 0;
        const fileName = path.basename(match[3]);

        let targetFilePath: string;
        if (dirStack.length > 0) {
          targetFilePath = path.join(dirStack[dirStack.length - 1].dirPath, fileName);
        } else {
          targetFilePath = resolvedLocalPath;
          try {
            const localStat = await fs.promises.stat(resolvedLocalPath);
            if (localStat.isDirectory()) {
              targetFilePath = path.join(resolvedLocalPath, fileName);
            }
          } catch {
            // targetFilePath is file path
          }
        }

        await fs.promises.mkdir(path.dirname(targetFilePath), { recursive: true });
        estimatedTotalBytes = Math.max(estimatedTotalBytes, transferredBytes + fileSize);

        const fileTimes = pendingTimes;
        pendingTimes = null;

        await sendAck();

        await reader.pipeToFile(
          targetFilePath,
          fileSize,
          fileMode,
          (delta) => {
            transferredBytes += delta;
            const now = Date.now();
            if (now - lastEmit >= 80 || transferredBytes >= estimatedTotalBytes) {
              lastEmit = now;
              const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
              const percent =
                estimatedTotalBytes > 0
                  ? Math.min(100, Math.round((transferredBytes / estimatedTotalBytes) * 100))
                  : 100;
              emitProgress(window, {
                transferId,
                transferred: transferredBytes,
                total: estimatedTotalBytes,
                percent,
                currentFile: fileName,
                speedBytesPerSec: Math.round(transferredBytes / elapsedSec),
                protocol: 'scp',
              });
            }
          },
          checkCancelled,
          control
        );

        const trailer = await reader.readByte(checkCancelled);
        if (trailer !== 0 && trailer !== null) {
          const errLine = await reader.readLine(checkCancelled);
          throw new Error(errLine.trim() || stderrText.trim() || 'SCP-Fehler nach Dateiübertragung');
        }

        await sendAck();

        if (preserveTimes && fileTimes) {
          try {
            await fs.promises.utimes(targetFilePath, fileTimes.atime, fileTimes.mtime);
          } catch {
            // ignore
          }
        }

        filesTransferred++;
        continue;
      }

      const unexpectedRest = await reader.readLine(checkCancelled);
      throw new Error(
        stderrText.trim() ||
          `Unerwarteter SCP-Protokoll-Befehl: ${String.fromCharCode(cmd)}${unexpectedRest}`
      );
    }

    if (filesTransferred === 0 && dirStack.length === 0 && stderrText.trim()) {
      throw new Error(stderrText.trim());
    }

    emitProgress(window, {
      transferId,
      transferred: transferredBytes,
      total: estimatedTotalBytes,
      percent: 100,
      protocol: 'scp',
    });

    return { filesTransferred, bytesTransferred: transferredBytes };
  } finally {
    const idx = control.abortCallbacks.indexOf(abortChannel);
    if (idx !== -1) control.abortCallbacks.splice(idx, 1);
    try {
      stream.close();
    } catch {
      // ignore
    }
  }
}
