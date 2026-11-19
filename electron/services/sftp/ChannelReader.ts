import fs from 'fs';
import path from 'path';
import { ActiveTransferControl } from './types';

/** Pull-style reader over an SSH channel for the byte-oriented SCP protocol. */
export class ChannelReader {
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private ended = false;
  private streamError: Error | null = null;
  private waiter: (() => void) | null = null;

  constructor(stream: NodeJS.ReadableStream) {
    stream.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf.length > 0) {
        this.chunks.push(buf);
        this.bufferedBytes += buf.length;
        if (this.waiter) {
          const w = this.waiter;
          this.waiter = null;
          w();
        }
      }
    });
    stream.on('end', () => {
      this.ended = true;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w();
      }
    });
    stream.on('close', () => {
      this.ended = true;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w();
      }
    });
    stream.on('error', (err: Error) => {
      this.streamError = err;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w();
      }
    });
  }

  private waitForData(): Promise<void> {
    if (this.streamError) {
      return Promise.reject(this.streamError);
    }
    if (this.ended) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiter = resolve;
    });
  }

  private consumeBytes(count: number): Buffer {
    if (count <= 0) return Buffer.alloc(0);
    const out = Buffer.allocUnsafe(count);
    let offset = 0;
    while (offset < count && this.chunks.length > 0) {
      const head = this.chunks[0];
      const toCopy = Math.min(count - offset, head.length);
      head.copy(out, offset, 0, toCopy);
      offset += toCopy;
      this.bufferedBytes -= toCopy;
      if (toCopy === head.length) {
        this.chunks.shift();
      } else {
        this.chunks[0] = head.subarray(toCopy);
      }
    }
    return out;
  }

  public async readByte(checkCancelled: () => void): Promise<number | null> {
    while (this.bufferedBytes < 1) {
      checkCancelled();
      if (this.streamError) throw this.streamError;
      if (this.ended) return null;
      await this.waitForData();
    }
    checkCancelled();
    const buf = this.consumeBytes(1);
    return buf[0];
  }

  public async readLine(checkCancelled: () => void): Promise<string> {
    const parts: Buffer[] = [];
    while (true) {
      checkCancelled();
      if (this.chunks.length > 0) {
        const head = this.chunks[0];
        const nlIdx = head.indexOf(0x0a);
        if (nlIdx !== -1) {
          const lineSlice = this.consumeBytes(nlIdx + 1);
          parts.push(lineSlice.subarray(0, nlIdx));
          return Buffer.concat(parts).toString('utf8');
        }
        parts.push(this.consumeBytes(head.length));
        continue;
      }
      if (this.streamError) throw this.streamError;
      if (this.ended) {
        return Buffer.concat(parts).toString('utf8');
      }
      await this.waitForData();
    }
  }

  public async pipeToFile(
    filePath: string,
    size: number,
    mode: number,
    onProgress: (deltaBytes: number) => void,
    checkCancelled: () => void,
    control: ActiveTransferControl
  ): Promise<void> {
    checkCancelled();
    if (size === 0) {
      await fs.promises.writeFile(filePath, Buffer.alloc(0), { mode });
      onProgress(0);
      return;
    }

    const writeStream = fs.createWriteStream(filePath, { mode });
    let writeStreamError: Error | null = null;
    writeStream.on('error', (err) => {
      writeStreamError = err;
    });
    const abortFile = () => {
      try {
        writeStream.destroy();
      } catch {
        // ignore
      }
    };
    control.abortCallbacks.push(abortFile);

    let remaining = size;
    try {
      while (remaining > 0) {
        checkCancelled();
        if (writeStreamError) throw writeStreamError;
        if (this.bufferedBytes === 0) {
          if (this.streamError) throw this.streamError;
          if (this.ended) {
            throw new Error(`Unerwartetes Stream-Ende beim Lesen von ${path.basename(filePath)} (${remaining} Bytes fehlen).`);
          }
          await this.waitForData();
          continue;
        }

        const chunkLen = Math.min(remaining, this.bufferedBytes, 65536);
        const data = this.consumeBytes(chunkLen);
        remaining -= data.length;

        const canContinue = writeStream.write(data);
        onProgress(data.length);

        if (!canContinue) {
          await new Promise<void>((resolve, reject) => {
            const onDrain = () => {
              writeStream.removeListener('error', onErr);
              resolve();
            };
            const onErr = (err: Error) => {
              writeStream.removeListener('drain', onDrain);
              reject(err);
            };
            writeStream.once('drain', onDrain);
            writeStream.once('error', onErr);
          });
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      const idx = control.abortCallbacks.indexOf(abortFile);
      if (idx !== -1) control.abortCallbacks.splice(idx, 1);
    }
  }
}
