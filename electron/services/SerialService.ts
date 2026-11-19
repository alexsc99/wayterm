import fs from 'fs';
import { StringDecoder } from 'string_decoder';
import { SerialPort } from 'serialport';
import { WebContents } from 'electron';
import { FlowController } from './FlowControl';
import { sessionLog } from './SessionLogService';
import { SerialConfig, SerialPortInfo } from '../../src/types';

interface SerialSession {
  port: SerialPort;
  webContents: WebContents;
  onDestroyed: () => void;
  buffer: string[];
  bufferedChars: number;
  flushTimer: NodeJS.Timeout | null;
  flush: () => void;
  closed: boolean;
  cancelOpen: (() => void) | null;
  flow: FlowController;
}

const MAX_BUFFER_CHARS = 16384; // 16KB max micro-batch buffer
const BATCH_WINDOW_MS = 8;      // 8ms micro-batch window

const KNOWN_VENDORS: Record<string, string> = {
  '0403': 'FTDI USB-to-Serial',
  '10c4': 'Silicon Labs CP210x',
  '1a86': 'WCH CH340/CH341',
  '067b': 'Prolific PL2303',
  '2341': 'Arduino',
  '2e8a': 'Raspberry Pi RP2040',
  '303a': 'Espressif ESP32/ESP8266',
};

export class SerialService {
  private sessions = new Map<string, SerialSession>();

  public async listPorts(): Promise<SerialPortInfo[]> {
    const rawPorts = await SerialPort.list();
    const result: SerialPortInfo[] = [];
    const seenPaths = new Set<string>();

    for (const p of rawPorts) {
      let activePath = p.path;

      // On macOS, prefer /dev/cu.* over /dev/tty.* to avoid blocking on DCD
      if (process.platform === 'darwin' && activePath.startsWith('/dev/tty.')) {
        const cuCandidate = activePath.replace('/dev/tty.', '/dev/cu.');
        if (fs.existsSync(cuCandidate)) {
          activePath = cuCandidate;
        }
      }

      if (seenPaths.has(activePath)) continue;
      seenPaths.add(activePath);

      const vendorHex = p.vendorId?.toLowerCase();
      const chipInfo = vendorHex && KNOWN_VENDORS[vendorHex] ? KNOWN_VENDORS[vendorHex] : undefined;

      let friendlyName = activePath;
      if (p.manufacturer && p.serialNumber) {
        friendlyName = `${p.manufacturer} (${p.serialNumber})`;
      } else if (chipInfo) {
        friendlyName = chipInfo;
      } else if (p.manufacturer) {
        friendlyName = p.manufacturer;
      }

      const isUsb =
        activePath.includes('usbserial') ||
        activePath.includes('usbmodem') ||
        activePath.includes('SLAB_USBtoUART') ||
        Boolean(p.vendorId);

      result.push({
        path: activePath,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        pnpId: p.pnpId,
        locationId: p.locationId,
        vendorId: p.vendorId,
        productId: p.productId,
        friendlyName: isUsb ? `🔌 ${friendlyName} (${activePath.split('/').pop()})` : friendlyName,
      });
    }

    // Fallback scan on macOS /dev for any /dev/cu.usb* not reported by bindings
    if (process.platform === 'darwin') {
      try {
        const devFiles = fs.readdirSync('/dev');
        for (const file of devFiles) {
          if (file.startsWith('cu.usbserial-') || file.startsWith('cu.usbmodem')) {
            const devPath = `/dev/${file}`;
            if (!seenPaths.has(devPath)) {
              seenPaths.add(devPath);
              result.push({
                path: devPath,
                friendlyName: `🔌 USB Serial (${file})`,
              });
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    // Sort USB serial devices first, bluetooth and internal debug ports last
    return result.sort((a, b) => {
      const aIsUsb = a.path.includes('usb') || a.friendlyName?.startsWith('🔌');
      const bIsUsb = b.path.includes('usb') || b.friendlyName?.startsWith('🔌');
      if (aIsUsb && !bIsUsb) return -1;
      if (!aIsUsb && bIsUsb) return 1;
      return a.path.localeCompare(b.path);
    });
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.closed) return;
    session.closed = true;
    this.sessions.delete(sessionId);
    session.cancelOpen?.();
    session.cancelOpen = null;

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
      // Ignore
    }

    try {
      if (session.port.isOpen) {
        session.port.close(() => {});
      }
    } catch {
      // Ignore
    }

  }

  public async connect(
    sessionId: string,
    config: SerialConfig,
    webContents: WebContents
  ): Promise<boolean> {
    this.disconnect(sessionId);

    let portPath = config.path;
    // Auto-convert /dev/tty.* to /dev/cu.* on macOS if present to prevent DCD blocking
    if (process.platform === 'darwin' && portPath.startsWith('/dev/tty.')) {
      const cuPath = portPath.replace('/dev/tty.', '/dev/cu.');
      if (fs.existsSync(cuPath)) {
        portPath = cuPath;
      }
    }

    if (!fs.existsSync(portPath)) {
      throw new Error(`Serielles Gerät nicht gefunden: ${portPath}`);
    }

    const baudRate = Number(config.baudRate) || 115200;
    const dataBits = (config.dataBits ?? 8) as 5 | 6 | 7 | 8;
    const stopBits = (config.stopBits ?? 1) as 1 | 1.5 | 2;
    const parity = config.parity ?? 'none';
    const rtscts = config.flowControl === 'rtscts';
    const xon = config.flowControl === 'xonxoff';
    const xoff = config.flowControl === 'xonxoff';

    const port = new SerialPort({
      path: portPath,
      baudRate,
      dataBits,
      stopBits,
      parity,
      rtscts,
      xon,
      xoff,
      autoOpen: false,
    });
    if (webContents.isDestroyed()) {
      throw new Error('Hauptfenster nicht verfügbar');
    }
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();

    const onDestroyed = (): void => {
      this.disconnect(sessionId);
    };

    webContents.once('destroyed', onDestroyed);

    const session: SerialSession = {
      port,
      webContents,
      onDestroyed,
      buffer: [],
      bufferedChars: 0,
      flushTimer: null,
      closed: false,
      cancelOpen: () => reject(new Error('Serielle Verbindung wurde abgebrochen.')),
      flow: new FlowController(() => port.pause(), () => port.resume()),
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
          webContents.send(`serial:data:${sessionId}`, batch);
          session.flow.sent(batch.length);
        }
      },
    };

    this.sessions.set(sessionId, session);

    // Multi-byte UTF-8 characters can be split across chunks; the decoder keeps the partial bytes.
    const decoder = new StringDecoder('utf8');
    port.on('data', (chunk: Buffer) => {
      if (session.closed) return;
      const text = decoder.write(chunk);
      if (!text) return;
      session.buffer.push(text);
      session.bufferedChars += text.length;
      if (session.bufferedChars >= MAX_BUFFER_CHARS) {
        session.flush();
      } else if (!session.flushTimer) {
        session.flushTimer = setTimeout(() => session.flush(), BATCH_WINDOW_MS);
      }
    });

    port.on('error', (err: Error) => {
      if (!session.closed && this.sessions.get(sessionId) === session) {
        const opening = session.cancelOpen !== null;
        if (opening) {
          session.cancelOpen = null;
          reject(new Error(`Fehler beim Öffnen von ${portPath}: ${err.message}`));
        }
        session.flush();
        this.cleanupSession(sessionId);
        if (!opening && !webContents.isDestroyed()) {
          webContents.send('serial:closed', {
            sessionId,
            error: err.message || 'Serieller Verbindungsfehler',
          });
        }
      }
    });
    port.on('close', () => {
      if (!session.closed && this.sessions.get(sessionId) === session) {
        this.disconnect(sessionId);
      }
    });
    port.open((err) => {
      if (session.closed) {
        if (!err && port.isOpen) port.close(() => {});
        return;
      }
      session.cancelOpen = null;
      if (err) {
        reject(new Error(`Fehler beim Öffnen von ${portPath}: ${err.message}`));
        this.cleanupSession(sessionId);
      } else {
        sessionLog.start(sessionId, `seriell_${portPath.split('/').pop() || portPath}`);
        resolve(true);
      }
    });
    return promise;
  }

  public write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed || !session.port.isOpen) {
      return;
    }
    session.port.write(data, 'utf-8');
  }

  public ack(sessionId: string, amount: number): void {
    this.sessions.get(sessionId)?.flow.ack(amount);
  }

  public disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.cleanupSession(sessionId);
    if (!session.webContents.isDestroyed()) {
      session.webContents.send('serial:closed', { sessionId });
    }
  }

  public disconnectAll(): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      try {
        this.disconnect(sessionId);
      } catch {
        // Ignore
      }
    }
  }
}
