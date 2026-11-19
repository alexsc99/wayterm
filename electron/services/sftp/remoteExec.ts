import { Client } from 'ssh2';

/** Quotes a remote path for a POSIX shell; `~` / `~/…` expand via "$HOME". */
export function escapeShellPath(remotePath: string): string {
  if (!remotePath || remotePath === '~') {
    return '"$HOME"';
  }
  if (remotePath.startsWith('~/')) {
    const sub = remotePath.slice(2).replace(/'/g, "'\\''");
    return `"$HOME"/'${sub}'`;
  }
  return `'${remotePath.replace(/'/g, "'\\''")}'`;
}

/** Runs one remote command over an exec channel and collects stdout/stderr/exit code. */
export function execCommand(
  client: Client,
  command: string,
  timeoutMs: number = 30000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    client.exec(command, (err, stream) => {
      if (err) {
        return reject(err);
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            stream.close();
            stream.destroy();
          } catch {
            // ignore
          }
          reject(new Error(`Zeitüberschreitung bei Remote-Befehl: ${command}`));
        }, timeoutMs);
      }

      stream.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      stream.stderr.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      stream.on('error', (streamErr: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer ?? undefined);
        reject(streamErr);
      });

      stream.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer ?? undefined);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          code: typeof code === 'number' ? code : 0,
        });
      });
    });
  });
}
