import { Client } from 'ssh2';
import { PoolEntry } from './types';

interface ClientWithSocket {
  _sock?: {
    destroyed?: boolean;
    writable?: boolean;
  };
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return typeof err === 'string' ? err : '';
}

function getErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return '';
}

export function isSocketDestroyed(client: Client): boolean {
  if (typeof client === 'object' && client !== null && '_sock' in client) {
    const sock = (client as unknown as ClientWithSocket)._sock;
    return Boolean(sock && (sock.destroyed || sock.writable === false));
  }
  return false;
}

export function isSubsystemUnavailableError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('unable to start subsystem') ||
    msg.includes('subsystem request failed') ||
    msg.includes('sftp subsystem') ||
    msg.includes('subsystem: sftp')
  );
}

export function isScpBinaryMissingError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes('scp: command not found') ||
    msg.includes('scp: not found') ||
    msg.includes('command not found') ||
    msg.includes('exit code 127') ||
    (msg.includes('scp') && msg.includes('not found')) ||
    (msg.includes('scp') && msg.includes('no such file or directory') && !msg.includes('scp:'))
  );
}

/** True when the error (or the entry's socket state) means the pooled connection is dead. */
export function isConnectionError(err: unknown, entry?: PoolEntry): boolean {
  if (entry?.isClosed) return true;
  if (entry && isSocketDestroyed(entry.client)) {
    return true;
  }
  if (!err) return false;
  const msg = getErrorMessage(err).toLowerCase();
  if (msg.includes('übertragung abgebrochen')) {
    return false;
  }
  const code = getErrorCode(err).toLowerCase();
  return (
    code === 'econnreset' ||
    code === 'epipe' ||
    code === 'etimedout' ||
    code === 'econnrefused' ||
    code === 'ehostunreach' ||
    code === 'enetunreach' ||
    code === 'err_stream_destroyed' ||
    code === 'err_stream_write_after_end' ||
    msg.includes('channel closed') ||
    msg.includes('session closed') ||
    msg.includes('socket closed') ||
    msg.includes('socket is closed') ||
    msg.includes('connection closed') ||
    msg.includes('connection lost') ||
    msg.includes('connection reset') ||
    msg.includes('not connected') ||
    msg.includes('not open') ||
    msg.includes('socket hang up') ||
    msg.includes('epipe') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('stream destroyed') ||
    msg.includes('write after end')
  );
}
