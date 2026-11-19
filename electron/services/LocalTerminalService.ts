import fs from 'fs';
import path from 'path';
import os from 'os';
import * as pty from 'node-pty';
import { WebContents } from 'electron';
import { FlowController } from './FlowControl';
import { sessionLog } from './SessionLogService';

interface TerminalSession {
  process: pty.IPty;
  webContents: WebContents;
  onDestroyed: () => void;
  buffer: string[];
  bufferedChars: number;
  flushTimer: NodeJS.Timeout | null;
  flush: () => void;
  disposables: pty.IDisposable[];
  flow: FlowController;
  closed: boolean;
  exited: boolean;
}

const MAX_BUFFER_CHARS = 16384; // 16KB max micro-batch buffer
const BATCH_WINDOW_MS = 8;      // 8ms micro-batch window

export class LocalTerminalService {
  private terminals = new Map<string, TerminalSession>();

  private ensureSpawnHelperExecutable(): void {
    try {
      const dynamicArch = `${process.platform}-${process.arch}`;
      const archDirs = [dynamicArch];
      if (dynamicArch !== 'darwin-arm64') archDirs.push('darwin-arm64');
      if (dynamicArch !== 'darwin-x64') archDirs.push('darwin-x64');

      const baseDirs = [
        path.join(__dirname, '../../node_modules/node-pty/prebuilds'),
        path.join(__dirname, '../node_modules/node-pty/prebuilds'),
        path.join(
          process.resourcesPath || '',
          'app.asar.unpacked/node_modules/node-pty/prebuilds'
        ),
      ];
      for (const baseDir of baseDirs) {
        for (const archDir of archDirs) {
          const candidate = path.join(baseDir, archDir, 'spawn-helper');
          if (candidate && fs.existsSync(candidate)) {
            const stat = fs.statSync(candidate);
            if ((stat.mode & 0o111) === 0) {
              fs.chmodSync(candidate, 0o755);
            }
          }
        }
      }
    } catch {
      // Ignore if not permitted
    }
  }

  private cleanupSession(sessionId: string): void {
    const session = this.terminals.get(sessionId);
    if (!session) return;
    if (session.closed) return;
    session.closed = true;

    session.flush();

    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    sessionLog.stop(sessionId);

    try {
      if (!session.webContents.isDestroyed()) {
        session.webContents.removeListener('destroyed', session.onDestroyed);
      }
    } catch {
      // Ignore listener removal error if webContents is already destroyed
    }

    for (const d of session.disposables) {
      try {
        d.dispose();
      } catch {
        // Ignore dispose error
      }
    }
    session.disposables = [];

    this.terminals.delete(sessionId);
  }

  public spawn(
    sessionId: string,
    cols: number,
    rows: number,
    webContents: WebContents
  ): boolean {
    if (this.terminals.has(sessionId)) {
      this.kill(sessionId);
    }

    this.ensureSpawnHelperExecutable();

    const shell = process.env.SHELL || '/bin/zsh';
    const home = process.env.HOME || os.homedir();

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, ['--login'], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: home,
        env: {
          CLICOLOR: '1',
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Lokales Terminal konnte nicht gestartet werden: ${msg}`);
    }

    const onDestroyed = (): void => {
      if (this.terminals.has(sessionId)) {
        this.kill(sessionId);
      }
    };

    if (!webContents.isDestroyed()) {
      webContents.once('destroyed', onDestroyed);
    }

    const session: TerminalSession = {
      process: ptyProcess,
      webContents,
      onDestroyed,
      buffer: [],
      bufferedChars: 0,
      flushTimer: null,
      disposables: [],
      flow: new FlowController(() => ptyProcess.pause(), () => ptyProcess.resume()),
      closed: false,
      exited: false,
      flush: () => {
        if (session.flushTimer) {
          clearTimeout(session.flushTimer);
          session.flushTimer = null;
        }
        if (session.buffer.length === 0) return;
        const batch =
          session.buffer.length === 1
            ? session.buffer[0]
            : session.buffer.join('');
        session.buffer = [];
        session.bufferedChars = 0;
        sessionLog.append(sessionId, batch);
        if (!webContents.isDestroyed()) {
          webContents.send(`term:data:${sessionId}`, batch);
          session.flow.sent(batch.length);
        }
      },
    };

    const dataSub = ptyProcess.onData((data: string) => {
      session.buffer.push(data);
      session.bufferedChars += data.length;
      if (session.bufferedChars >= MAX_BUFFER_CHARS) {
        session.flush();
      } else if (!session.flushTimer) {
        session.flushTimer = setTimeout(() => session.flush(), BATCH_WINDOW_MS);
      }
    });
    session.disposables.push(dataSub);

    const exitSub = ptyProcess.onExit(({ exitCode, signal }) => {
      session.exited = true;
      session.flush();
      if (!session.closed) {
        this.cleanupSession(sessionId);
        if (!webContents.isDestroyed()) {
          webContents.send('term:closed', { sessionId, exitCode, signal });
        }
      }
    });
    session.disposables.push(exitSub);

    this.terminals.set(sessionId, session);
    sessionLog.start(sessionId, 'lokal');
    return true;
  }

  public write(sessionId: string, data: string): void {
    const session = this.terminals.get(sessionId);
    if (session && !session.closed) {
      try {
        session.process.write(data);
      } catch {
        // Safe write: catch any write errors (e.g. process exiting / dead pipe / closed fd)
      }
    }
  }

  public ack(sessionId: string, amount: number): void {
    this.terminals.get(sessionId)?.flow.ack(amount);
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const session = this.terminals.get(sessionId);
    if (session && !session.closed && cols > 0 && rows > 0) {
      try {
        session.process.resize(cols, rows);
      } catch {
        // Ignore resize failure if process is exiting
      }
    }
  }

  public kill(sessionId: string): void {
    const session = this.terminals.get(sessionId);
    if (session) {
      this.cleanupSession(sessionId);
      try {
        session.process.kill();
      } catch {
        // Ignore ESRCH or already-dead process errors
      }
      const forceKillTimer = setTimeout(() => {
        try {
          if (!session.exited && session.process.pid > 0) {
            process.kill(session.process.pid, 0);
            session.process.kill('SIGKILL');
          }
        } catch {
          // Ignore ESRCH or already-dead process errors
        }
      }, 400);
      forceKillTimer.unref?.();
      if (!session.webContents.isDestroyed()) {
        session.webContents.send('term:closed', { sessionId });
      }
    }
  }

  public killAll(): void {
    const entries = Array.from(this.terminals.entries());
    for (const [sessionId, session] of entries) {
      this.cleanupSession(sessionId);
      try {
        session.process.kill();
      } catch {
        // Ignore ESRCH or already-dead process errors
      }
      const forceKillTimer = setTimeout(() => {
        try {
          if (!session.exited && session.process.pid > 0) {
            process.kill(session.process.pid, 0);
            session.process.kill('SIGKILL');
          }
        } catch {
          // Ignore ESRCH or already-dead process errors
        }
      }, 400);
      forceKillTimer.unref?.();
      if (!session.webContents.isDestroyed()) {
        session.webContents.send('term:closed', { sessionId });
      }
    }
    this.terminals.clear();
  }
}
