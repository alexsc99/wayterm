import { BrowserWindow } from 'electron';
import {
  SSHHost,
  RemoteFileItem,
  SCPTransferOptions,
  SCPTransferResult,
} from '../../src/types';
import { HostKeyVerifier } from './HostKeyVerifier';
import { HostResolver } from './SshConnection';
import { ConnectionPool } from './sftp/ConnectionPool';
import { TransferRegistry } from './sftp/TransferRegistry';
import { SftpTransfers } from './sftp/SftpTransfers';
import { scpDownload, scpUpload } from './sftp/scpTransfer';
import { expandLocalPath } from './sftp/localTree';
import { isScpBinaryMissingError, isSubsystemUnavailableError } from './sftp/connectionErrors';
import * as remoteFileOps from './sftp/remoteFileOps';

/**
 * Remote file access for the file manager and SCP dialog. Facade over the pooled
 * connections (sftp/ConnectionPool), SFTP-subsystem transfers and the SCP/exec fallback.
 */
export class SFTPService {
  private readonly pool: ConnectionPool;
  private readonly transfers = new TransferRegistry();
  private readonly sftpTransfers: SftpTransfers;

  constructor(hostKeyVerifier: HostKeyVerifier, resolveHosts: HostResolver) {
    this.pool = new ConnectionPool(hostKeyVerifier, resolveHosts);
    this.sftpTransfers = new SftpTransfers(this.pool);
  }

  public getHostProtocolMode(host: SSHHost): 'sftp' | 'scp' {
    return this.pool.getHostProtocolMode(host);
  }

  public async listDirectory(host: SSHHost, remotePath: string = '.'): Promise<RemoteFileItem[]> {
    return this.pool.withConnection(host, (entry) => remoteFileOps.listDirectory(entry, remotePath));
  }

  public async createDirectory(host: SSHHost, remotePath: string): Promise<void> {
    return this.pool.withConnection(host, (entry) => remoteFileOps.createDirectory(entry, remotePath));
  }

  public async deleteFile(host: SSHHost, remotePath: string): Promise<void> {
    return this.pool.withConnection(host, (entry) => remoteFileOps.deleteFile(entry, remotePath));
  }

  public async readRemoteFile(host: SSHHost, remotePath: string): Promise<string> {
    return this.pool.withConnection(host, (entry) => remoteFileOps.readRemoteFile(entry, remotePath));
  }

  public async writeRemoteFile(host: SSHHost, remotePath: string, content: string): Promise<void> {
    return this.pool.withConnection(host, (entry) =>
      remoteFileOps.writeRemoteFile(entry, remotePath, content)
    );
  }

  public async deleteDirectory(host: SSHHost, remotePath: string): Promise<void> {
    return this.pool.withConnection(host, (entry) => remoteFileOps.deleteDirectory(entry, remotePath));
  }

  public async renameFile(host: SSHHost, oldPath: string, newPath: string): Promise<void> {
    return this.pool.withConnection(host, (entry) => remoteFileOps.renameFile(entry, oldPath, newPath));
  }

  public cancelTransfer(transferId: string): boolean {
    return this.transfers.cancel(transferId);
  }

  public async uploadFile(
    host: SSHHost,
    localPath: string,
    remotePath: string,
    transferId: string,
    window: BrowserWindow
  ): Promise<void> {
    const resolvedLocalPath = expandLocalPath(localPath);
    const control = this.transfers.begin(transferId);

    try {
      await this.pool.withConnection(host, async (entry) => {
        if (entry.mode === 'scp' || !entry.sftp) {
          await scpUpload(
            entry.client,
            resolvedLocalPath,
            remotePath,
            transferId,
            false,
            control,
            window
          );
          return;
        }

        await this.sftpTransfers.uploadViaSFTP(
          entry,
          resolvedLocalPath,
          remotePath,
          transferId,
          false,
          control,
          window
        );
      }, control);
    } finally {
      this.transfers.end(transferId);
    }
  }

  public async downloadFile(
    host: SSHHost,
    remotePath: string,
    localPath: string,
    transferId: string,
    window: BrowserWindow
  ): Promise<void> {
    const resolvedLocalPath = expandLocalPath(localPath);
    const control = this.transfers.begin(transferId);

    try {
      await this.pool.withConnection(host, async (entry) => {
        if (entry.mode === 'scp' || !entry.sftp) {
          await scpDownload(
            entry.client,
            remotePath,
            resolvedLocalPath,
            transferId,
            false,
            false,
            control,
            window
          );
          return;
        }

        await this.sftpTransfers.downloadViaSFTP(
          entry,
          remotePath,
          resolvedLocalPath,
          transferId,
          false,
          control,
          window
        );
      }, control);
    } finally {
      this.transfers.end(transferId);
    }
  }

  /** SCP dialog transfer: SCP first (unless disabled), SFTP fallback, then SCP again if SFTP vanished. */
  public async executeSCPTransfer(
    options: SCPTransferOptions,
    mainWindow: BrowserWindow
  ): Promise<SCPTransferResult> {
    const {
      host,
      direction,
      localPath,
      remotePath,
      transferId,
      recursive = false,
      preserveTimes = false,
      forceSCPProtocol = true,
    } = options;

    const resolvedLocalPath = expandLocalPath(localPath);
    const startTime = Date.now();
    const control = this.transfers.begin(transferId);

    try {
      return await this.pool.withConnection(host, async (entry) => {
        const preferSCP = forceSCPProtocol !== false || entry.mode === 'scp' || !entry.sftp;

        if (preferSCP) {
          try {
            const stats =
              direction === 'upload'
                ? await scpUpload(
                    entry.client,
                    resolvedLocalPath,
                    remotePath,
                    transferId,
                    preserveTimes,
                    control,
                    mainWindow
                  )
                : await scpDownload(
                    entry.client,
                    remotePath,
                    resolvedLocalPath,
                    transferId,
                    recursive,
                    preserveTimes,
                    control,
                    mainWindow
                  );

            return {
              success: true,
              protocol: 'scp',
              filesTransferred: stats.filesTransferred,
              bytesTransferred: stats.bytesTransferred,
              durationMs: Math.max(1, Date.now() - startTime),
            };
          } catch (scpErr: unknown) {
            if (control.cancelled || !isScpBinaryMissingError(scpErr) || !entry.sftp) {
              throw scpErr;
            }
            console.warn(
              `[SCP] Remote scp binary unavailable on ${host.hostname}, falling back to SFTP.`
            );
          }
        }

        if (entry.sftp) {
          try {
            const stats =
              direction === 'upload'
                ? await this.sftpTransfers.uploadViaSFTP(
                    entry,
                    resolvedLocalPath,
                    remotePath,
                    transferId,
                    preserveTimes,
                    control,
                    mainWindow
                  )
                : await this.sftpTransfers.downloadViaSFTP(
                    entry,
                    remotePath,
                    resolvedLocalPath,
                    transferId,
                    preserveTimes,
                    control,
                    mainWindow
                  );

            return {
              success: true,
              protocol: 'sftp',
              filesTransferred: stats.filesTransferred,
              bytesTransferred: stats.bytesTransferred,
              durationMs: Math.max(1, Date.now() - startTime),
            };
          } catch (sftpErr: unknown) {
            if (control.cancelled || !isSubsystemUnavailableError(sftpErr)) {
              throw sftpErr;
            }
            entry.mode = 'scp';
            entry.sftp = null;
            this.pool.setHostProtocolMode(host, 'scp');
          }
        }

        const fallbackStats =
          direction === 'upload'
            ? await scpUpload(
                entry.client,
                resolvedLocalPath,
                remotePath,
                transferId,
                preserveTimes,
                control,
                mainWindow
              )
            : await scpDownload(
                entry.client,
                remotePath,
                resolvedLocalPath,
                transferId,
                recursive,
                preserveTimes,
                control,
                mainWindow
              );

        return {
          success: true,
          protocol: 'scp',
          filesTransferred: fallbackStats.filesTransferred,
          bytesTransferred: fallbackStats.bytesTransferred,
          durationMs: Math.max(1, Date.now() - startTime),
        };
      }, control);
    } finally {
      this.transfers.end(transferId);
    }
  }

  public closeAll(): void {
    // Order matters: invalidate pending connects, abort transfers (SFTP aborts
    // destroy their connection), then gracefully close what is left.
    this.pool.invalidate();
    this.transfers.cancelAll();
    this.pool.evictAll();
  }
}
