import { Client, ConnectConfig, utils } from 'ssh2';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Duplex } from 'stream';
import { SSHHost } from '../../src/types';
import { HostKeyVerifier } from './HostKeyVerifier';

/** TCP connect (direct or through a jump host) must succeed within this time. */
const TCP_CONNECT_TIMEOUT_MS = 20000;
/** Banner, key exchange and authentication; paused while the host-key dialog is open. */
const HANDSHAKE_TIMEOUT_MS = 30000;
const MAX_JUMP_HOPS = 5;

const KEY_PASSPHRASE_ERROR = /Encrypted private key detected|bad passphrase|Cannot parse privateKey|decryption failed|no passphrase/i;
const PASSPHRASE_MESSAGE = 'Authentifizierung fehlgeschlagen: Passphrase für privaten Schlüssel erforderlich oder ungültig.';
const ABORT_MESSAGE = 'SSH-Verbindung wurde abgebrochen.';

export type HostResolver = () => SSHHost[];

export interface SshConnectOptions {
  hostKeyVerifier: HostKeyVerifier;
  /** Saved hosts with decrypted credentials; only consulted when a jump host is configured. */
  resolveHosts: HostResolver;
  signal?: AbortSignal;
  /** Extra liveness check for the host-key dialog (e.g. window still open). */
  isActive?: () => boolean;
  /** Request ssh-agent forwarding on the target host (not on jump hosts). */
  agentForward?: boolean;
}

export interface SshLink {
  /** Authenticated client of the target host. */
  client: Client;
  /** Closes the target and every jump-host client. Idempotent. */
  close: () => void;
}

function describeHost(host: SSHHost): string {
  return host.label && host.label !== host.hostname ? `„${host.label}“ (${host.hostname})` : `„${host.hostname}“`;
}

export function formatSshError(host: SSHHost, message: string): string {
  if (host.authType === 'key' && KEY_PASSPHRASE_ERROR.test(message)) return PASSPHRASE_MESSAGE;
  if (message.includes('All configured authentication methods failed')) {
    return 'Authentifizierung fehlgeschlagen: Der Server hat die Anmeldedaten abgelehnt. Bitte überprüfe Passwort, Benutzername oder SSH-Key.';
  }
  return message;
}

/** Returns the hop list, outermost jump host first and the target last. */
export function resolveJumpChain(host: SSHHost, hosts: SSHHost[]): SSHHost[] {
  const chain = [host];
  const visited = new Set([host.id]);
  let current = host;
  while (current.jumpHostId) {
    const jumpId = current.jumpHostId;
    const jump = hosts.find((candidate) => candidate.id === jumpId);
    if (!jump) throw new Error(`Jump-Host nicht gefunden: ${describeHost(current)} verweist auf einen Host, der nicht mehr gespeichert ist.`);
    if (visited.has(jump.id)) {
      const names = [...chain].reverse().map((hop) => hop.label || hop.hostname);
      throw new Error(`Jump-Host-Schleife erkannt: ${[...names, jump.label || jump.hostname].join(' → ')}.`);
    }
    if (chain.length > MAX_JUMP_HOPS) throw new Error(`Zu viele verschachtelte Jump-Hosts (maximal ${MAX_JUMP_HOPS}).`);
    visited.add(jump.id);
    chain.unshift(jump);
    current = jump;
  }
  return chain;
}

/** Auth, algorithms and keepalive shared by terminal and file-transfer connections. */
export function buildConnectConfig(host: SSHHost): ConnectConfig {
  const config: ConnectConfig = {
    host: host.hostname,
    port: host.port || 22,
    username: host.username,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    tryKeyboard: true,
    algorithms: {
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
        'ssh-rsa',
        'ssh-dss',
      ],
    },
  };
  if (process.env.SSH_AUTH_SOCK) config.agent = process.env.SSH_AUTH_SOCK;

  const homeDir = process.env.HOME || os.homedir();
  let keyPath = host.keyPath ? host.keyPath.replace(/^~(?=$|[\\/])/, homeDir) : undefined;
  if (!keyPath && host.authType === 'key') {
    keyPath = ['id_ed25519', 'id_rsa', 'id_ecdsa']
      .map((name) => path.join(homeDir, '.ssh', name))
      .find((candidate) => fs.existsSync(candidate));
  }
  if (keyPath && fs.existsSync(keyPath)) {
    let keyBuffer: Buffer;
    try {
      keyBuffer = fs.readFileSync(keyPath);
    } catch (error) {
      throw new Error(`Fehler beim Lesen des Schlüssels: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = utils.parseKey(keyBuffer, host.passphrase);
    if (parsed instanceof Error) {
      throw new Error(host.authType === 'key' && KEY_PASSPHRASE_ERROR.test(parsed.message)
        ? PASSPHRASE_MESSAGE
        : `Fehler beim Lesen des Schlüssels: ${parsed.message}`);
    }
    config.privateKey = keyBuffer;
    if (host.passphrase) config.passphrase = host.passphrase;
  }
  if (host.password) config.password = host.password;
  return config;
}

function abortError(): Error {
  return new Error(ABORT_MESSAGE);
}

/** Runs `start` with abort handling; `start` gets settle callbacks and returns a cleanup for the abort case. */
function abortable<T>(signal: AbortSignal | undefined, start: (resolve: (value: T) => void, reject: (error: Error) => void) => () => void): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  if (signal?.aborted) {
    reject(abortError());
    return promise;
  }
  let settled = false;
  const settle = (action: () => void): void => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener('abort', onAbort);
    action();
  };
  const onAbort = (): void => settle(() => {
    dispose();
    reject(abortError());
  });
  const dispose = start((value) => settle(() => resolve(value)), (error) => settle(() => reject(error)));
  signal?.addEventListener('abort', onAbort, { once: true });
  return promise;
}

function openTcpSocket(hostname: string, port: number, signal?: AbortSignal): Promise<net.Socket> {
  return abortable<net.Socket>(signal, (resolve, reject) => {
    const socket = net.connect({ host: hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Zeitüberschreitung: ${hostname}:${port} war nach ${TCP_CONNECT_TIMEOUT_MS / 1000} s nicht erreichbar.`));
    }, TCP_CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.removeAllListeners('error');
      resolve(socket);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      const messages: Record<string, string> = {
        ENOTFOUND: `Host ${hostname} wurde nicht gefunden (DNS).`,
        EAI_AGAIN: `Host ${hostname} konnte nicht aufgelöst werden (DNS).`,
        ECONNREFUSED: `Verbindung zu ${hostname}:${port} wurde abgelehnt.`,
        EHOSTUNREACH: `${hostname}:${port} ist nicht erreichbar.`,
        ENETUNREACH: `Netzwerk für ${hostname}:${port} ist nicht erreichbar.`,
        ETIMEDOUT: `Zeitüberschreitung bei der Verbindung zu ${hostname}:${port}.`,
      };
      const wrapped = new Error(messages[error.code || ''] || error.message) as NodeJS.ErrnoException;
      wrapped.code = error.code;
      reject(wrapped);
    });
    return () => {
      clearTimeout(timer);
      socket.destroy();
    };
  });
}

function forwardThroughJump(jump: Client, jumpHost: SSHHost, hostname: string, port: number, signal?: AbortSignal): Promise<Duplex> {
  return abortable<Duplex>(signal, (resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      reject(new Error(`Jump-Host ${describeHost(jumpHost)} konnte ${hostname}:${port} nicht innerhalb von ${TCP_CONNECT_TIMEOUT_MS / 1000} s erreichen.`));
    }, TCP_CONNECT_TIMEOUT_MS);
    jump.forwardOut('127.0.0.1', 0, hostname, port, (error, channel) => {
      clearTimeout(timer);
      if (done) {
        channel?.close();
        return;
      }
      done = true;
      if (error) {
        reject(new Error(`Jump-Host ${describeHost(jumpHost)} konnte ${hostname}:${port} nicht erreichen: ${error.message}`));
        return;
      }
      resolve(channel);
    });
    return () => {
      done = true;
      clearTimeout(timer);
    };
  });
}

function handshake(client: Client, host: SSHHost, sock: Duplex, options: SshConnectOptions, agentForward: boolean): Promise<void> {
  const config = buildConnectConfig(host);
  const port = host.port || 22;
  return abortable<void>(options.signal, (resolve, reject) => {
    let settled = false;
    let hostKeyError: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    const stopTimer = (): void => clearTimeout(timer);
    const startTimer = (): void => {
      stopTimer();
      timer = setTimeout(() => finish(new Error(`Zeitüberschreitung beim SSH-Handshake mit ${host.hostname}:${port}.`)), HANDSHAKE_TIMEOUT_MS);
    };
    const onError = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error || 'Unbekannter SSH-Fehler');
      finish(new Error(hostKeyError || formatSshError(host, message)));
    };
    const onClose = (): void => finish(new Error(hostKeyError || 'SSH-Verbindung wurde vor dem Abschluss des Handshakes geschlossen.'));
    const onReady = (): void => finish(null);
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      stopTimer();
      client.removeListener('error', onError);
      client.removeListener('close', onClose);
      client.removeListener('ready', onReady);
      if (error) reject(error);
      else resolve();
    };

    // Persistent guard: unhandled 'error' events would crash the main process.
    client.on('error', () => {});
    client.on('error', onError);
    client.once('close', onClose);
    client.once('ready', onReady);
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, answer) => {
      try {
        answer(prompts.length > 0 && host.password ? prompts.map(() => host.password || '') : []);
      } catch {
        // Ignore: connection may already be gone
      }
    });

    startTimer();
    try {
      client.connect({
        ...config,
        sock,
        // Own timer below excludes time spent in the host-key dialog.
        readyTimeout: 0,
        agentForward: agentForward && config.agent !== undefined,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          stopTimer();
          void options.hostKeyVerifier
            .verify(host.hostname, port, key, () => !settled && !options.signal?.aborted && (options.isActive?.() ?? true))
            .then((error) => {
              hostKeyError = error;
              if (!settled) startTimer();
              verify(error === null);
            });
        },
      });
    } catch (error) {
      onError(error);
    }
    return () => finish(abortError());
  });
}

function closeClient(client: Client): void {
  try {
    client.end();
    client.destroy();
  } catch {
    // Ignore: already closed
  }
}

/**
 * Connects to `host`, tunnelling through its jump-host chain if configured.
 * Every hop is host-key verified. When the target or any hop closes, all clients are closed.
 */
export async function connectSsh(host: SSHHost, options: SshConnectOptions): Promise<SshLink> {
  const chain = host.jumpHostId ? resolveJumpChain(host, options.resolveHosts()) : [host];
  const clients: Client[] = [];
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const client of [...clients].reverse()) closeClient(client);
  };

  try {
    for (let index = 0; index < chain.length; index++) {
      const hop = chain[index];
      const isTarget = index === chain.length - 1;
      const port = hop.port || 22;
      try {
        const sock = index === 0
          ? await openTcpSocket(hop.hostname, port, options.signal)
          : await forwardThroughJump(clients[index - 1], chain[index - 1], hop.hostname, port, options.signal);
        const client = new Client();
        clients.push(client);
        try {
          await handshake(client, hop, sock, options, isTarget && options.agentForward === true);
        } catch (error) {
          sock.destroy();
          throw error;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isTarget || message === ABORT_MESSAGE) throw error;
        throw new Error(`Jump-Host ${describeHost(hop)}: ${message}`);
      }
    }
  } catch (error) {
    close();
    throw error;
  }

  for (const client of clients) client.once('close', close);
  return { client: clients[clients.length - 1], close };
}
