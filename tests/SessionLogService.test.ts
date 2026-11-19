import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { sessionLog as SessionLogInstance } from '../electron/services/SessionLogService';

let tmpRoot: string;
let sessionLog: typeof SessionLogInstance;

function logFiles(directory: string): string[] {
  return fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.log')) : [];
}

function readOnlyLog(directory: string): string {
  const files = logFiles(directory);
  expect(files).toHaveLength(1);
  return fs.readFileSync(path.join(directory, files[0]), 'utf8');
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wayterm-sessionlog-'));
  // Dynamic import after resetModules: the module exports a singleton and each test needs a fresh one.
  vi.resetModules();
  ({ sessionLog } = await import('../electron/services/SessionLogService'));
});

afterEach(() => {
  sessionLog.stopAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('SessionLogService', () => {
  it('writes raw output to a new file per session when enabled', async () => {
    const directory = path.join(tmpRoot, 'nested', 'logs');
    sessionLog.configure({ enabled: true, directory: `  ${directory}  ` });
    sessionLog.start('s1', 'root@server:22');
    sessionLog.append('s1', 'hello\r\n');
    sessionLog.append('s1', Buffer.from('\x1b[31mred\x1b[0m'));
    sessionLog.stop('s1');

    await vi.waitFor(() => expect(readOnlyLog(directory)).toBe('hello\r\n\x1b[31mred\x1b[0m'));
    const [file] = logFiles(directory);
    expect(file).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_root@server_22\.log$/);
    expect(fs.statSync(path.join(directory, file)).mode & 0o777).toBe(0o600);
  });

  it('creates no file while disabled', () => {
    const directory = path.join(tmpRoot, 'disabled');
    sessionLog.configure({ enabled: false, directory });
    sessionLog.start('s1', 'host');
    sessionLog.append('s1', 'ignored');
    sessionLog.stop('s1');
    expect(fs.existsSync(directory)).toBe(false);
  });

  it('stops open streams when logging is disabled', async () => {
    const directory = path.join(tmpRoot, 'toggle');
    sessionLog.configure({ enabled: true, directory });
    sessionLog.start('s1', 'first');
    sessionLog.append('s1', 'before');

    sessionLog.configure({ enabled: false, directory });
    sessionLog.append('s1', 'after');
    await vi.waitFor(() => expect(readOnlyLog(directory)).toBe('before'));

    // A later session flushing proves earlier writes to s1 would have landed by now.
    sessionLog.configure({ enabled: true, directory });
    sessionLog.start('s2', 'second');
    sessionLog.append('s2', 'x');
    sessionLog.stop('s2');
    await vi.waitFor(() => {
      const second = logFiles(directory).find((name) => name.endsWith('_second.log'));
      expect(second && fs.readFileSync(path.join(directory, second), 'utf8')).toBe('x');
    });
    const first = logFiles(directory).find((name) => name.endsWith('_first.log'));
    expect(first).toBeDefined();
    expect(fs.readFileSync(path.join(directory, first!), 'utf8')).toBe('before');
  });
});
