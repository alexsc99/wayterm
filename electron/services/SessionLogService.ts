import fs from 'fs';
import os from 'os';
import path from 'path';

export interface SessionLogConfig {
  enabled: boolean;
  /** Empty = default directory. */
  directory: string;
}

export const DEFAULT_LOG_DIRECTORY = path.join(os.homedir(), 'Documents', 'putty+ Logs');

// Writes raw terminal output (including ANSI sequences; view with `less -R`) to one file per connection.
// The renderer pushes the configuration; sessions started while logging is disabled are not logged.
class SessionLogService {
  private config: SessionLogConfig = { enabled: false, directory: '' };
  private streams = new Map<string, fs.WriteStream>();

  public configure(config: SessionLogConfig): void {
    this.config = { enabled: config.enabled === true, directory: typeof config.directory === 'string' ? config.directory.trim() : '' };
    if (!this.config.enabled) this.stopAll();
  }

  public start(sessionId: string, label: string): void {
    this.stop(sessionId);
    if (!this.config.enabled) return;
    try {
      const directory = this.config.directory.replace(/^~(?=$|\/)/, os.homedir()) || DEFAULT_LOG_DIRECTORY;
      fs.mkdirSync(directory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeLabel = label.replace(/[^\w.@-]+/g, '_').slice(0, 80) || 'session';
      const stream = fs.createWriteStream(path.join(directory, `${stamp}_${safeLabel}.log`), { flags: 'a', mode: 0o600 });
      stream.on('error', (err) => {
        console.error(`[session-log] ${sessionId}:`, err);
        if (this.streams.get(sessionId) === stream) this.streams.delete(sessionId);
      });
      this.streams.set(sessionId, stream);
    } catch (err) {
      console.error(`[session-log] ${sessionId}:`, err);
    }
  }

  public append(sessionId: string, data: string | Buffer): void {
    this.streams.get(sessionId)?.write(data);
  }

  public stop(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (!stream) return;
    this.streams.delete(sessionId);
    stream.end();
  }

  public stopAll(): void {
    for (const sessionId of Array.from(this.streams.keys())) this.stop(sessionId);
  }
}

export const sessionLog = new SessionLogService();
