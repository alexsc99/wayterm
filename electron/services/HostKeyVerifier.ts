import { app, BrowserWindow, dialog } from 'electron';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

interface KnownHostKey {
  hostname: string;
  port: number;
  fingerprint: string;
  algorithm: string;
}

/** Shared trust database for terminal SSH and file transfers. */
export class HostKeyVerifier {
  private pending = new Map<string, Promise<void>>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  private readKeys(): KnownHostKey[] {
    const file = path.join(app.getPath('userData'), 'known-host-keys.json');
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const keys: unknown = JSON.parse(raw);
    if (!Array.isArray(keys) || !keys.every((key) => key && typeof key.hostname === 'string' &&
      Number.isInteger(key.port) && typeof key.fingerprint === 'string' && typeof key.algorithm === 'string')) {
      throw new Error('Die Host-Key-Datenbank ist beschädigt.');
    }
    return keys as KnownHostKey[];
  }

  private saveKeys(keys: KnownHostKey[]): void {
    const file = path.join(app.getPath('userData'), 'known-host-keys.json');
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(keys, null, 2), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  async verify(hostname: string, port: number, key: Buffer, isActive: () => boolean): Promise<string | null> {
    const normalizedHost = hostname.trim().toLowerCase();
    const endpoint = JSON.stringify([normalizedHost, port]);
    const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
    const length = key.length >= 4 ? key.readUInt32BE(0) : 0;
    const algorithm = length > 0 && length <= key.length - 4 ? key.subarray(4, 4 + length).toString('ascii') : 'unbekannt';
    const previous = this.pending.get(endpoint) || Promise.resolve();
    const { promise: current, resolve: release } = Promise.withResolvers<void>();
    this.pending.set(endpoint, current);
    await previous;
    try {
      if (!isActive()) return 'Verbindungsaufbau abgebrochen.';
      const keys = this.readKeys();
      const known = keys.find((entry) => entry.hostname === normalizedHost && entry.port === port);
      if (known) {
        if (known.fingerprint === fingerprint) return null;
        const message = `Der Host-Schlüssel von ${hostname}:${port} hat sich geändert. Die Verbindung wurde aus Sicherheitsgründen abgelehnt. Erwartet: ${known.fingerprint}; erhalten: ${fingerprint}.`;
        const window = this.getWindow();
        if (window && !window.isDestroyed()) {
          await dialog.showMessageBox(window, { type: 'error', title: 'Host-Schlüssel geändert', message: 'Warnung: Host-Schlüssel geändert', detail: `${message}\n\nDies kann auf einen Angriff oder eine Serveränderung hinweisen. Prüfe den Schlüssel unabhängig und entferne gegebenenfalls den Eintrag aus known-host-keys.json im App-Datenverzeichnis.`, buttons: ['OK'], noLink: true });
        }
        return message;
      }
      const window = this.getWindow();
      if (!window || window.isDestroyed()) return 'Host-Schlüssel kann ohne Fenster nicht bestätigt werden.';
      const result = await dialog.showMessageBox(window, {
        type: 'warning', title: 'Unbekannter Host-Schlüssel', message: `Verbindung zu ${hostname}:${port} bestätigen?`,
        detail: `Schlüsseltyp: ${algorithm}\nFingerabdruck: ${fingerprint}\n\nVergleiche den Fingerabdruck über einen vertrauenswürdigen unabhängigen Kanal. Nur bei Übereinstimmung dauerhaft vertrauen.`,
        buttons: ['Ablehnen', 'Vertrauen und verbinden'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (result.response !== 1 || !isActive() || window.isDestroyed()) return 'Host-Schlüssel wurde nicht bestätigt.';
      // Re-read before writing so different endpoints confirmed concurrently cannot overwrite each other.
      const latest = this.readKeys();
      const existing = latest.find((entry) => entry.hostname === normalizedHost && entry.port === port);
      if (existing) return existing.fingerprint === fingerprint ? null : 'Der Host-Schlüssel hat sich während der Bestätigung geändert.';
      latest.push({ hostname: normalizedHost, port, fingerprint, algorithm });
      this.saveKeys(latest);
      return null;
    } catch (error) {
      return `Host-Schlüsselprüfung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      release();
      if (this.pending.get(endpoint) === current) this.pending.delete(endpoint);
    }
  }
}
