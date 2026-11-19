import net from 'net';
import { Duplex } from 'stream';
import { Client, ClientChannel, TcpConnectionDetails, AcceptConnection, RejectConnection } from 'ssh2';
import { PortForward, PortForwardStatusEvent } from '../../src/types';

type OpenStream = (host: string, port: number, callback: (error: Error | undefined, stream?: Duplex) => void) => void;

const SOCKS_HANDSHAKE_TIMEOUT_MS = 30000;
const SOCKS_REPLY_SUCCEEDED = 0x00;
const SOCKS_REPLY_GENERAL_FAILURE = 0x01;
const SOCKS_REPLY_HOST_UNREACHABLE = 0x04;
const SOCKS_REPLY_COMMAND_NOT_SUPPORTED = 0x07;
const SOCKS_REPLY_ADDRESS_NOT_SUPPORTED = 0x08;

/** Pipes both directions; any error or close tears down both sides. */
export function pipeBoth(a: Duplex, b: Duplex): void {
  const destroy = (): void => {
    a.destroy();
    b.destroy();
  };
  a.on('error', destroy);
  b.on('error', destroy);
  a.on('close', destroy);
  b.on('close', destroy);
  a.pipe(b);
  b.pipe(a);
}

export type SocksRequest =
  | { kind: 'incomplete' }
  | { kind: 'error'; reply: number }
  | { kind: 'connect'; host: string; port: number; length: number };

/** Parses a SOCKS5 request (VER CMD RSV ATYP DST.ADDR DST.PORT). */
export function parseSocksRequest(buffer: Buffer): SocksRequest {
  if (buffer.length < 4) return { kind: 'incomplete' };
  if (buffer[0] !== 0x05) return { kind: 'error', reply: SOCKS_REPLY_GENERAL_FAILURE };
  if (buffer[1] !== 0x01) return { kind: 'error', reply: SOCKS_REPLY_COMMAND_NOT_SUPPORTED };
  let host: string;
  let offset: number;
  switch (buffer[3]) {
    case 0x01:
      if (buffer.length < 10) return { kind: 'incomplete' };
      host = Array.from(buffer.subarray(4, 8)).join('.');
      offset = 8;
      break;
    case 0x03: {
      if (buffer.length < 5) return { kind: 'incomplete' };
      const length = buffer[4];
      if (length === 0) return { kind: 'error', reply: SOCKS_REPLY_ADDRESS_NOT_SUPPORTED };
      if (buffer.length < 5 + length + 2) return { kind: 'incomplete' };
      host = buffer.subarray(5, 5 + length).toString('latin1');
      offset = 5 + length;
      break;
    }
    case 0x04: {
      if (buffer.length < 22) return { kind: 'incomplete' };
      const groups: string[] = [];
      for (let index = 4; index < 20; index += 2) groups.push(buffer.readUInt16BE(index).toString(16));
      host = groups.join(':');
      offset = 20;
      break;
    }
    default:
      return { kind: 'error', reply: SOCKS_REPLY_ADDRESS_NOT_SUPPORTED };
  }
  const port = buffer.readUInt16BE(offset);
  if (port === 0) return { kind: 'error', reply: SOCKS_REPLY_GENERAL_FAILURE };
  return { kind: 'connect', host, port, length: offset + 2 };
}

function socksReply(code: number): Buffer {
  return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

/** Minimal SOCKS5 server side: no authentication, CONNECT only. */
export function handleSocksConnection(socket: net.Socket, open: OpenStream): void {
  let buffer = Buffer.alloc(0);
  let greeted = false;
  socket.setTimeout(SOCKS_HANDSHAKE_TIMEOUT_MS, () => socket.destroy());
  socket.on('error', () => socket.destroy());

  const onData = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!greeted) {
      if (buffer.length < 2) return;
      if (buffer[0] !== 0x05) {
        socket.destroy();
        return;
      }
      const methodCount = buffer[1];
      if (buffer.length < 2 + methodCount) return;
      const methods = buffer.subarray(2, 2 + methodCount);
      buffer = buffer.subarray(2 + methodCount);
      if (!methods.includes(0x00)) {
        socket.removeListener('data', onData);
        socket.end(Buffer.from([0x05, 0xff]));
        return;
      }
      greeted = true;
      socket.write(Buffer.from([0x05, 0x00]));
    }
    const request = parseSocksRequest(buffer);
    if (request.kind === 'incomplete') return;
    socket.removeListener('data', onData);
    socket.pause();
    if (request.kind === 'error') {
      socket.end(socksReply(request.reply));
      return;
    }
    const rest = buffer.subarray(request.length);
    buffer = Buffer.alloc(0);
    if (rest.length > 0) socket.unshift(rest);
    open(request.host, request.port, (error, stream) => {
      if (error || !stream) {
        if (!socket.destroyed) socket.end(socksReply(SOCKS_REPLY_HOST_UNREACHABLE));
        stream?.destroy();
        return;
      }
      if (socket.destroyed) {
        stream.destroy();
        return;
      }
      socket.setTimeout(0);
      socket.write(socksReply(SOCKS_REPLY_SUCCEEDED));
      pipeBoth(socket, stream);
    });
  };
  socket.on('data', onData);
}

function describeListenError(error: NodeJS.ErrnoException, address: string, port: number): string {
  switch (error.code) {
    case 'EADDRINUSE': return `Port ${address}:${port} ist bereits belegt.`;
    case 'EACCES': return `Keine Berechtigung für Port ${address}:${port}.`;
    case 'EADDRNOTAVAIL': return `Adresse ${address} ist auf diesem Mac nicht verfügbar.`;
    default: return `Port ${address}:${port} konnte nicht geöffnet werden: ${error.message}`;
  }
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Port forwards (-L/-R/-D) bound to one SSH terminal session's client. */
export class PortForwardSet {
  private closed = false;
  private servers: net.Server[] = [];
  private connections = new Set<Duplex>();
  private remoteBindings: { forward: PortForward; address: string }[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly client: Client,
    private readonly forwards: PortForward[],
    private readonly emit: (event: PortForwardStatusEvent) => void,
  ) {}

  private report(forward: PortForward, state: 'active' | 'error', message: string): void {
    if (!this.closed) this.emit({ sessionId: this.sessionId, forwardId: forward.id, state, message });
  }

  private track(stream: Duplex): void {
    this.connections.add(stream);
    stream.once('close', () => this.connections.delete(stream));
  }

  private forwardOut(source: net.Socket | null, host: string, port: number, callback: (error: Error | undefined, stream?: Duplex) => void): void {
    if (this.closed) return callback(new Error('Sitzung beendet'));
    try {
      this.client.forwardOut(source?.remoteAddress || '127.0.0.1', source?.remotePort || 0, host, port, (error, channel: ClientChannel) => {
        if (error) return callback(error);
        if (this.closed) {
          channel.close();
          return callback(new Error('Sitzung beendet'));
        }
        this.track(channel);
        callback(undefined, channel);
      });
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private listen(forward: PortForward, onConnection: (socket: net.Socket) => void, activeMessage: string): void {
    const address = forward.bindAddress || '127.0.0.1';
    const server = net.createServer((socket) => {
      if (this.closed) {
        socket.destroy();
        return;
      }
      this.track(socket);
      onConnection(socket);
    });
    this.servers.push(server);
    let listening = false;
    server.on('error', (error: NodeJS.ErrnoException) => {
      this.report(forward, 'error', listening ? `Weiterleitung unterbrochen: ${error.message}` : describeListenError(error, address, forward.bindPort));
      server.close();
    });
    server.listen(forward.bindPort, address, () => {
      listening = true;
      this.report(forward, 'active', activeMessage);
    });
  }

  private startLocal(forward: PortForward, targetHost: string, targetPort: number): void {
    const address = forward.bindAddress || '127.0.0.1';
    this.listen(forward, (socket) => {
      socket.on('error', () => socket.destroy());
      socket.pause();
      this.forwardOut(socket, targetHost, targetPort, (error, stream) => {
        if (error || !stream) {
          socket.destroy();
          return;
        }
        pipeBoth(socket, stream);
      });
    }, `${address}:${forward.bindPort} → ${targetHost}:${targetPort} (über Server)`);
  }

  private startDynamic(forward: PortForward): void {
    const address = forward.bindAddress || '127.0.0.1';
    this.listen(forward, (socket) => {
      handleSocksConnection(socket, (host, port, callback) => this.forwardOut(socket, host, port, callback));
    }, `SOCKS5-Proxy auf ${address}:${forward.bindPort}`);
  }

  private startRemote(forward: PortForward, targetHost: string, targetPort: number): void {
    const address = forward.bindAddress || '127.0.0.1';
    try {
      this.client.forwardIn(address, forward.bindPort, (error) => {
        if (this.closed) return;
        if (error) {
          this.report(forward, 'error', `Server-Port ${address}:${forward.bindPort} konnte nicht geöffnet werden: ${error.message}`);
          return;
        }
        this.remoteBindings.push({ forward, address });
        this.report(forward, 'active', `Server ${address}:${forward.bindPort} → ${targetHost}:${targetPort} (auf diesem Mac)`);
      });
    } catch (error) {
      this.report(forward, 'error', `Server-Port ${address}:${forward.bindPort} konnte nicht geöffnet werden: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private onTcpConnection = (details: TcpConnectionDetails, accept: AcceptConnection<ClientChannel>, reject: RejectConnection): void => {
    const binding = this.remoteBindings.find((entry) => entry.forward.bindPort === details.destPort && entry.address === details.destIP)
      || this.remoteBindings.find((entry) => entry.forward.bindPort === details.destPort);
    const { targetHost, targetPort } = binding?.forward ?? {};
    if (this.closed || !binding || !targetHost || !isValidPort(targetPort)) {
      reject();
      return;
    }
    let accepted = false;
    const socket = net.connect({ host: targetHost, port: targetPort });
    this.track(socket);
    socket.once('connect', () => {
      if (this.closed) {
        socket.destroy();
        reject();
        return;
      }
      accepted = true;
      const channel = accept();
      this.track(channel);
      pipeBoth(socket, channel);
    });
    socket.on('error', () => {
      if (!accepted) reject();
      socket.destroy();
    });
  };

  start(): void {
    this.client.on('tcp connection', this.onTcpConnection);
    for (const forward of this.forwards) {
      try {
        if (!isValidPort(forward.bindPort)) {
          this.report(forward, 'error', 'Ungültiger lokaler Port.');
          continue;
        }
        if (forward.type === 'dynamic') {
          this.startDynamic(forward);
          continue;
        }
        if (!forward.targetHost || !isValidPort(forward.targetPort)) {
          this.report(forward, 'error', 'Zielhost oder Zielport fehlt.');
          continue;
        }
        if (forward.type === 'local') this.startLocal(forward, forward.targetHost, forward.targetPort);
        else if (forward.type === 'remote') this.startRemote(forward, forward.targetHost, forward.targetPort);
        else this.report(forward, 'error', 'Unbekannter Weiterleitungstyp.');
      } catch (error) {
        this.report(forward, 'error', error instanceof Error ? error.message : String(error));
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.removeListener('tcp connection', this.onTcpConnection);
    for (const { forward, address } of this.remoteBindings) {
      try {
        this.client.unforwardIn(address, forward.bindPort);
      } catch {
        // Client already disconnected
      }
    }
    this.remoteBindings = [];
    for (const server of this.servers) server.close();
    this.servers = [];
    for (const stream of this.connections) stream.destroy();
    this.connections.clear();
  }
}
