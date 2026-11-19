import { ClientChannel } from 'ssh2';
import { BrowserWindow } from 'electron';
import { PortForwardStatusEvent, SSHHost } from '../../src/types';
import { HostKeyVerifier } from './HostKeyVerifier';
import { FlowController } from './FlowControl';
import { sessionLog } from './SessionLogService';
import { connectSsh, HostResolver, SshLink } from './SshConnection';
import { PortForwardSet } from './PortForwardService';

interface ActiveSession {
  link: SshLink;
  forwards: PortForwardSet;
  stream: ClientChannel;
  window: BrowserWindow;
  onDestroyed: () => void;
  buffer: Buffer[];
  bufferedBytes: number;
  flushTimer: NodeJS.Timeout | null;
  flush: () => void;
  closed: boolean;
  flow: FlowController;
}

const MAX_BUFFER_BYTES = 16384; // 16KB max micro-batch buffer
const BATCH_WINDOW_MS = 10;     // 10ms micro-batch window (8ms-12ms)

export class SSHService {
  constructor(
    private readonly hostKeyVerifier: HostKeyVerifier,
    private readonly resolveHosts: HostResolver,
  ) {}

  private sessions = new Map<string, ActiveSession>();
  private pending = new Map<string, () => void>();
  private pendingDimensions = new Map<string, { cols: number; rows: number }>();

  private cleanupSession(sessionId: string, emitClosed: boolean = true, expected?: ActiveSession): void {
    const session = this.sessions.get(sessionId);
    if (!session || (expected && session !== expected)) return;
    this.pendingDimensions.delete(sessionId);
    if (session.closed) return;
    session.closed = true;

    // Flush any pending buffered data before closing
    session.flush();

    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    sessionLog.stop(sessionId);

    this.sessions.delete(sessionId);

    try {
      if (!session.window.isDestroyed() && !session.window.webContents.isDestroyed()) {
        session.window.webContents.removeListener('destroyed', session.onDestroyed);
      }
    } catch {
      // Ignore listener removal errors if webContents is already destroyed
    }

    try {
      if (session.stream) {
        session.stream.on('error', () => {});
        session.stream.close();
        session.stream.end();
      }
    } catch {
      // Ignore stream closing errors
    }

    session.forwards.close();
    session.link.close();

    if (emitClosed && !session.window.isDestroyed() && !session.window.webContents.isDestroyed()) {
      session.window.webContents.send('ssh:closed', { sessionId });
    }
  }
  public async connect(
    sessionId: string,
    host: SSHHost,
    cols: number,
    rows: number,
    window: BrowserWindow
  ): Promise<boolean> {
    this.disconnect(sessionId);

    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    let session: ActiveSession | null = null;
    const onDestroyed = (): void => {
      if (session) this.cleanupSession(sessionId, false, session);
      else cancel();
    };
    const windowAlive = (): boolean => !window.isDestroyed() && !window.webContents.isDestroyed();

    if (!windowAlive()) throw new Error('Hauptfenster nicht verfügbar');
    this.pending.set(sessionId, cancel);
    window.webContents.once('destroyed', onDestroyed);

    let link: SshLink | null = null;
    try {
      link = await connectSsh(host, {
        hostKeyVerifier: this.hostKeyVerifier,
        resolveHosts: this.resolveHosts,
        signal: controller.signal,
        isActive: windowAlive,
        agentForward: host.agentForwarding === true,
      });
      const { client } = link;
      const dims = this.pendingDimensions.get(sessionId) || { cols: cols || 80, rows: rows || 24 };
      this.pendingDimensions.delete(sessionId);

      const { promise: shellReady, resolve: resolveShell, reject: rejectShell } = Promise.withResolvers<ClientChannel>();
      const onAbort = (): void => rejectShell(new Error('SSH-Verbindung wurde abgebrochen.'));
      const onEarlyClose = (): void => rejectShell(new Error('SSH-Verbindung wurde vor dem Öffnen der Shell geschlossen.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      client.once('close', onEarlyClose);
      if (controller.signal.aborted) onAbort();
      client.shell({ term: 'xterm-256color', cols: dims.cols, rows: dims.rows }, (err, channel) => {
        if (err) rejectShell(err);
        else resolveShell(channel);
      });
      let stream: ClientChannel;
      try {
        stream = await shellReady;
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
        client.removeListener('close', onEarlyClose);
      }
      if (controller.signal.aborted || !windowAlive()) throw new Error('SSH-Verbindung wurde abgebrochen.');

      if (this.pending.get(sessionId) === cancel) this.pending.delete(sessionId);
      const active: ActiveSession = {
        link,
        forwards: new PortForwardSet(sessionId, client, host.portForwards || [], (event: PortForwardStatusEvent) => {
          if (windowAlive()) window.webContents.send('ssh:forwardStatus', event);
        }),
        stream,
        window,
        onDestroyed,
        buffer: [],
        bufferedBytes: 0,
        flushTimer: null,
        closed: false,
        flow: new FlowController(() => stream.pause(), () => stream.resume()),
        flush: () => {
          if (active.flushTimer) {
            clearTimeout(active.flushTimer);
            active.flushTimer = null;
          }
          if (active.buffer.length === 0) return;
          const chunk =
            active.buffer.length === 1
              ? active.buffer[0]
              : Buffer.concat(active.buffer, active.bufferedBytes);
          active.buffer = [];
          active.bufferedBytes = 0;
          sessionLog.append(sessionId, chunk);
          if (windowAlive()) {
            window.webContents.send(`ssh:data:${sessionId}`, chunk);
            active.flow.sent(chunk.length);
          }
        },
      };
      session = active;
      this.sessions.set(sessionId, active);
      sessionLog.start(sessionId, `${host.username}@${host.label || host.hostname}`);

      const latestDims = this.pendingDimensions.get(sessionId);
      if (latestDims) {
        this.pendingDimensions.delete(sessionId);
        if (stream.writable) {
          try {
            stream.setWindow(latestDims.rows, latestDims.cols, 0, 0);
          } catch {
            // Ignore resize error if stream is closing
          }
        }
      }

      // Micro-batched binary buffer stream to renderer
      stream.on('data', (chunk: Buffer) => {
        if (active.closed) return;
        active.buffer.push(chunk);
        active.bufferedBytes += chunk.length;
        if (active.bufferedBytes >= MAX_BUFFER_BYTES) {
          active.flush();
        } else if (!active.flushTimer) {
          active.flushTimer = setTimeout(() => active.flush(), BATCH_WINDOW_MS);
        }
      });
      stream.on('error', () => this.cleanupSession(sessionId, true, active));
      stream.on('end', () => active.flush());
      stream.on('close', () => this.cleanupSession(sessionId, true, active));
      client.on('error', () => this.cleanupSession(sessionId, true, active));
      client.on('close', () => this.cleanupSession(sessionId, true, active));

      // Forward failures are reported per forward and never fail the terminal session.
      active.forwards.start();
      return true;
    } catch (error) {
      link?.close();
      if (this.pending.get(sessionId) === cancel) {
        this.pending.delete(sessionId);
        this.pendingDimensions.delete(sessionId);
      }
      try {
        if (windowAlive()) window.webContents.removeListener('destroyed', onDestroyed);
      } catch {
        // Ignore listener removal errors
      }
      throw error;
    }
  }

  public write(sessionId: string, data: string | Uint8Array): void {
    const session = this.sessions.get(sessionId);
    if (session && !session.closed && session.stream && session.stream.writable) {
      try {
        session.stream.write(data);
      } catch {
        // Safe write: catch any write errors (e.g. socket closed / EPIPE)
      }
    }
  }

  public ack(sessionId: string, amount: number): void {
    this.sessions.get(sessionId)?.flow.ack(amount);
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    const session = this.sessions.get(sessionId);
    if (session) {
      if (!session.closed && session.stream && session.stream.writable) {
        try {
          session.stream.setWindow(rows, cols, 0, 0);
        } catch {
          // Ignore resize error if stream is closing
        }
      }
    } else if (this.pending.has(sessionId)) {
      this.pendingDimensions.set(sessionId, { cols, rows });
    }
  }

  public disconnect(sessionId: string): void {
    this.pending.get(sessionId)?.();
    this.pendingDimensions.delete(sessionId);
    this.cleanupSession(sessionId, true);
  }

  public disconnectAll(): void {
    for (const cancel of Array.from(this.pending.values())) cancel();
    this.pendingDimensions.clear();
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      this.cleanupSession(sessionId, true);
    }
  }
}
