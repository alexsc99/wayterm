import { SFTPWrapper } from 'ssh2';
import crypto from 'crypto';
import { SSHHost } from '../../../src/types';
import { HostKeyVerifier } from '../HostKeyVerifier';
import { connectSsh, HostResolver } from '../SshConnection';
import { ActiveTransferControl, PoolEntry } from './types';
import {
  getErrorMessage,
  isConnectionError,
  isSocketDestroyed,
  isSubsystemUnavailableError,
} from './connectionErrors';

/**
 * Pooled SSH connections keyed by host + credentials, with idle eviction,
 * SFTP-subsystem detection (falls back to 'scp' mode) and one reconnect retry.
 */
export class ConnectionPool {
  constructor(
    private readonly hostKeyVerifier: HostKeyVerifier,
    private readonly resolveHosts: HostResolver,
  ) {}

  private static readonly IDLE_TIMEOUT_MS = 60000;
  private pool = new Map<string, PoolEntry>();
  private connecting = new Map<string, Promise<PoolEntry>>();
  private hostProtocolModes = new Map<string, 'sftp' | 'scp'>();
  // Bumped by invalidate(); connections started under an older generation are discarded.
  private generation = 0;

  private getPoolKey(host: SSHHost): string {
    const port = host.port || 22;
    const keyPath = host.keyPath || '';
    const authType = host.authType || 'password';
    const credHash = crypto
      .createHash('sha256')
      .update(`${host.password || ''}:${host.passphrase || ''}`)
      .digest('hex')
      .slice(0, 12);
    return `${host.id || ''}:${host.username}@${host.hostname}:${port}:${authType}:${keyPath}:${credHash}:${host.jumpHostId || ''}`;
  }

  public setHostProtocolMode(host: SSHHost, mode: 'sftp' | 'scp'): void {
    const poolKey = this.getPoolKey(host);
    const endpointKey = `${host.username}@${host.hostname}:${host.port || 22}`;
    this.hostProtocolModes.set(poolKey, mode);
    this.hostProtocolModes.set(endpointKey, mode);
    if (host.id) {
      this.hostProtocolModes.set(host.id, mode);
    }
  }

  public getHostProtocolMode(host: SSHHost): 'sftp' | 'scp' {
    if (!host) return 'sftp';
    const poolKey = this.getPoolKey(host);
    const existing = this.pool.get(poolKey);
    if (existing && !existing.isClosed) {
      return existing.mode;
    }
    const byPoolKey = this.hostProtocolModes.get(poolKey);
    if (byPoolKey) return byPoolKey;
    if (host.id) {
      const byId = this.hostProtocolModes.get(host.id);
      if (byId) return byId;
    }
    const endpointKey = `${host.username}@${host.hostname}:${host.port || 22}`;
    return this.hostProtocolModes.get(endpointKey) || 'sftp';
  }

  public evict(key: string, entry: PoolEntry, graceful: boolean = true): void {
    if (entry.isClosed) {
      return;
    }
    entry.isClosed = true;

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    if (this.pool.get(key) === entry) {
      this.pool.delete(key);
    }

    if (entry.sftp) {
      try {
        entry.sftp.end();
      } catch {
        // ignore
      }
    }

    try {
      if (graceful) {
        entry.client.end();
      } else {
        entry.client.destroy();
      }
    } catch {
      // ignore
    }
  }

  private resetIdleTimer(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    if (entry.isClosed || entry.activeOperations > 0) {
      return;
    }

    entry.idleTimer = setTimeout(() => {
      this.evict(entry.key, entry, true);
    }, ConnectionPool.IDLE_TIMEOUT_MS);

    if (entry.idleTimer.unref) {
      entry.idleTimer.unref();
    }
  }

  private createConnection(key: string, host: SSHHost): Promise<PoolEntry> {
    const startGeneration = this.generation;

    return connectSsh(host, {
      hostKeyVerifier: this.hostKeyVerifier,
      resolveHosts: this.resolveHosts,
      isActive: () => startGeneration === this.generation,
    }).then((link) => new Promise<PoolEntry>((resolve, reject) => {
      const { client } = link;
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        link.close();
        reject(err);
      };

      const onInitialError = (err: unknown) => {
        fail(new Error(getErrorMessage(err) || 'Unbekannter SSH/SFTP-Fehler'));
      };

      const onInitialClose = () => {
        fail(new Error('SSH-Verbindung unerwartet geschlossen vor Authentifizierung.'));
      };

      const onInitialEnd = () => {
        fail(new Error('SSH-Verbindung beendet vor Authentifizierung.'));
      };

      client.once('error', onInitialError);
      client.once('close', onInitialClose);
      client.once('end', onInitialEnd);

      const finalizeEntry = (sftp: SFTPWrapper | null, mode: 'sftp' | 'scp') => {
        if (settled) return;
        if (startGeneration !== this.generation) {
          settled = true;
          try {
            sftp?.end();
          } catch {
            // ignore
          }
          link.close();
          reject(new Error('SFTP-Verbindung wurde während des Aufbaus geschlossen.'));
          return;
        }

        settled = true;
        this.setHostProtocolMode(host, mode);

        const entry: PoolEntry = {
          key,
          client,
          sftp,
          mode,
          idleTimer: null,
          activeOperations: 0,
          isClosed: false,
        };

        client.removeListener('error', onInitialError);
        client.removeListener('close', onInitialClose);
        client.removeListener('end', onInitialEnd);

        client.on('error', (clientErr: unknown) => {
          console.warn(`[SFTP] Client error for ${key}:`, getErrorMessage(clientErr));
          this.evict(key, entry, false);
        });

        client.on('close', () => {
          this.evict(key, entry, false);
        });

        client.on('end', () => {
          this.evict(key, entry, false);
        });

        if (sftp) {
          sftp.on('error', (sftpErr: unknown) => {
            console.warn(`[SFTP] SFTP session error for ${key}:`, getErrorMessage(sftpErr));
            this.evict(key, entry, false);
          });

          sftp.on('close', () => {
            this.evict(key, entry, false);
          });

          sftp.on('end', () => {
            this.evict(key, entry, false);
          });
        }

        this.pool.set(key, entry);
        resolve(entry);
      };

      if (startGeneration !== this.generation) {
        return fail(new Error('SFTP-Verbindung wurde während des Aufbaus geschlossen.'));
      }

      client.sftp((err, sftp) => {
        if (err) {
          if (isSubsystemUnavailableError(err) && !isSocketDestroyed(client)) {
            console.warn(
              `[SFTP] SFTP subsystem unavailable for ${host.hostname}, falling back to SCP/SSH-Exec mode.`
            );
            finalizeEntry(null, 'scp');
            return;
          }
          return fail(new Error(getErrorMessage(err) || 'SFTP-Subsystem konnte nicht gestartet werden'));
        }

        finalizeEntry(sftp, 'sftp');
      });
    })).finally(() => {
      this.connecting.delete(key);
    });
  }

  private async acquireConnection(host: SSHHost): Promise<PoolEntry> {
    const key = this.getPoolKey(host);

    const existing = this.pool.get(key);
    if (existing) {
      if (existing.isClosed || isConnectionError(null, existing)) {
        this.evict(key, existing, false);
      } else {
        if (existing.idleTimer) {
          clearTimeout(existing.idleTimer);
          existing.idleTimer = null;
        }
        existing.activeOperations++;
        return existing;
      }
    }

    let connectingPromise = this.connecting.get(key);
    if (!connectingPromise) {
      connectingPromise = this.createConnection(key, host);
      this.connecting.set(key, connectingPromise);
    }

    const entry = await connectingPromise;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.activeOperations++;
    return entry;
  }

  private releaseConnection(entry: PoolEntry): void {
    entry.activeOperations = Math.max(0, entry.activeOperations - 1);
    if (entry.activeOperations === 0 && !entry.isClosed) {
      this.resetIdleTimer(entry);
    }
  }

  /**
   * Runs `operation` on a pooled connection. Retries once on a fresh connection
   * after a connection error or a late SFTP-subsystem failure (switching to 'scp').
   */
  public async withConnection<T>(
    host: SSHHost,
    operation: (entry: PoolEntry) => Promise<T>,
    control?: ActiveTransferControl
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (control?.cancelled) throw new Error('Übertragung abgebrochen');
      const entry = await this.acquireConnection(host);
      if (control?.cancelled) {
        this.releaseConnection(entry);
        throw new Error('Übertragung abgebrochen');
      }
      if (entry.isClosed || isSocketDestroyed(entry.client)) {
        this.evict(entry.key, entry, false);
        this.releaseConnection(entry);
        if (attempt === 0) continue;
        throw new Error('SSH-Verbindung wurde vor Beginn der Operation geschlossen.');
      }

      try {
        const result = await operation(entry);
        if (control?.cancelled) throw new Error('Übertragung abgebrochen');
        return result;
      } catch (err: unknown) {
        if (control?.cancelled) throw new Error('Übertragung abgebrochen');
        if (isSubsystemUnavailableError(err) && !isSocketDestroyed(entry.client)) {
          entry.mode = 'scp';
          entry.sftp = null;
          this.setHostProtocolMode(host, 'scp');
          if (attempt === 0) {
            continue;
          }
        }
        if (entry.isClosed || isConnectionError(err, entry)) {
          this.evict(entry.key, entry, false);
          if (attempt === 0) {
            continue;
          }
        }
        throw err;
      } finally {
        this.releaseConnection(entry);
      }
    }
    throw new Error('SSH-Verbindungsoperation fehlgeschlagen.');
  }

  /** Makes in-flight connection attempts reject instead of joining the pool. */
  public invalidate(): void {
    this.generation++;
  }

  public evictAll(): void {
    for (const [key, entry] of this.pool.entries()) {
      this.evict(key, entry, true);
    }
    this.pool.clear();
    this.connecting.clear();
  }
}
