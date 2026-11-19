import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { app, dialog, safeStorage } from 'electron';
import { PortForward, PortForwardType, SSHHost } from '../../src/types';

const FORWARD_TYPES: readonly PortForwardType[] = ['local', 'remote', 'dynamic'];

function parsePort(value: unknown): number | null {
  const port = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? parseInt(value, 10) : NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Keeps valid forwards only; local/remote need a target, dynamic has none. */
function sanitizePortForwards(raw: unknown): PortForward[] {
  if (!Array.isArray(raw)) return [];
  const forwards: PortForward[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const type = FORWARD_TYPES.find((candidate) => candidate === entry.type);
    const bindPort = parsePort(entry.bindPort);
    if (!type || bindPort === null) continue;
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : newId();
    if (ids.has(id)) id = newId();
    const bindAddress = typeof entry.bindAddress === 'string' ? entry.bindAddress.trim() : '';
    const forward: PortForward = { id, type, bindPort, ...(bindAddress ? { bindAddress } : {}) };
    if (type !== 'dynamic') {
      const targetHost = typeof entry.targetHost === 'string' ? entry.targetHost.trim() : '';
      const targetPort = parsePort(entry.targetPort);
      if (!targetHost || targetPort === null) continue;
      forward.targetHost = targetHost;
      forward.targetPort = targetPort;
    }
    ids.add(id);
    forwards.push(forward);
  }
  return forwards;
}

export class HostStore {
  private hostsPath: string = '';
  private initialized: boolean = false;

  constructor() {
    this.ensureInit();
  }

  private ensureInit() {
    if (this.initialized) return;
    try {
      let userDataPath = '';
      try {
        if (app && typeof app.getPath === 'function') {
          userDataPath = app.getPath('userData');
        }
      } catch (e) {}

      if (!userDataPath) {
        userDataPath = path.join(os.homedir(), '.terminus');
      }

      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }

      this.hostsPath = path.join(userDataPath, 'hosts.json');
      this.initialized = true;
    } catch (err) {
      console.error('Failed to initialize HostStore:', err);
    }
  }

  private isSecureStorageAvailable(): boolean {
    return safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }

  private encryptSecret(value: string): string {
    if (!value) return value;
    if (!this.isSecureStorageAvailable()) {
      throw new Error('Sichere Speicherung ist nicht verfügbar. Zugangsdaten wurden nicht gespeichert.');
    }
    return 'enc:v1:' + safeStorage.encryptString(value).toString('base64');
  }

  private decryptSecret(value: string): string {
    if (!value || !value.startsWith('enc:v1:')) return value;
    if (!this.isSecureStorageAvailable()) {
      throw new Error('Sichere Speicherung ist nicht verfügbar. Zugangsdaten können nicht gelesen werden.');
    }
    try {
      return safeStorage.decryptString(Buffer.from(value.slice('enc:v1:'.length), 'base64'));
    } catch {
      throw new Error('Gespeicherte Zugangsdaten konnten nicht entschlüsselt werden. Die Hostdatei wurde nicht verändert.');
    }
  }

  private sanitizeHost(raw: Record<string, unknown>, fallbackHostname: string = ''): SSHHost | null {
    const hostname = typeof raw.hostname === 'string' && raw.hostname.trim()
      ? raw.hostname.trim()
      : fallbackHostname;
    if (!hostname) return null;

    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : newId();

    const port = parsePort(raw.port) ?? 22;

    const username = typeof raw.username === 'string' && raw.username.trim()
      ? raw.username.trim()
      : 'root';
    const authType: 'password' | 'key' = raw.authType === 'password' ? 'password' : 'key';
    const createdAt = typeof raw.createdAt === 'number' && !isNaN(raw.createdAt) && raw.createdAt > 0
      ? raw.createdAt
      : Date.now();
    const label = typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : hostname;

    const password = typeof raw.password === 'string' ? raw.password : '';
    const passphrase = typeof raw.passphrase === 'string' ? raw.passphrase : '';
    const decryptedPassword = password;
    const decryptedPassphrase = passphrase;
    const jumpHostId = typeof raw.jumpHostId === 'string' ? raw.jumpHostId.trim() : '';
    const portForwards = sanitizePortForwards(raw.portForwards);

    return {
      id,
      label,
      hostname,
      port,
      username,
      authType,
      createdAt,
      ...(typeof raw.password === 'string' && raw.password.length > 0 && decryptedPassword.length > 0 ? { password: decryptedPassword } : {}),
      ...(typeof raw.keyPath === 'string' && raw.keyPath.trim() ? { keyPath: raw.keyPath.trim() } : {}),
      ...(typeof raw.passphrase === 'string' && raw.passphrase.length > 0 && decryptedPassphrase.length > 0 ? { passphrase: decryptedPassphrase } : {}),
      ...(jumpHostId && jumpHostId !== id ? { jumpHostId } : {}),
      ...(raw.agentForwarding === true ? { agentForwarding: true } : {}),
      ...(portForwards.length > 0 ? { portForwards } : {}),
    };
  }

  private persistHosts(hosts: SSHHost[]): void {
    const diskHosts = hosts.map(h => ({
      ...h,
      ...(typeof h.password === 'string' && h.password.length > 0 ? { password: this.encryptSecret(h.password) } : {}),
      ...(typeof h.passphrase === 'string' && h.passphrase.length > 0 ? { passphrase: this.encryptSecret(h.passphrase) } : {})
    }));
    this.atomicWrite(this.hostsPath, JSON.stringify(diskHosts, null, 2));
  }

  public getHosts(): SSHHost[] {
    this.ensureInit();
    if (!this.hostsPath) throw new Error('Hostspeicher konnte nicht initialisiert werden.');
    if (!fs.existsSync(this.hostsPath)) return [];
    const data = fs.readFileSync(this.hostsPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error('Die Hostdatei ist beschädigt und wurde nicht überschrieben.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Die Hostdatei hat ein ungültiges Format und wurde nicht überschrieben.');
    }
    const hosts: SSHHost[] = [];
    let needsMigration = false;
    let recoveredAmbiguousSecret = false;
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Die Hostdatei enthält ungültige Einträge und wurde nicht überschrieben.');
      }
      const raw = item as Record<string, unknown>;
      const decoded = { ...raw };
      for (const key of ['password', 'passphrase'] as const) {
        const value = raw[key];
        if (typeof value !== 'string' || !value) continue;
        if (!value.startsWith('enc:v1:')) {
          needsMigration = true;
          continue;
        }
        try {
          decoded[key] = this.decryptSecret(value);
        } catch (error) {
          if (!this.isSecureStorageAvailable()) throw error;
          const choice = dialog.showMessageBoxSync({
            type: 'warning',
            title: 'Zugangsdaten wiederherstellen',
            message: 'Gespeicherte Zugangsdaten konnten nicht entschlüsselt werden.',
            detail: `Bei ${String(raw.hostname || 'diesem Host')} beginnt ${key === 'password' ? 'das Passwort' : 'die Passphrase'} mit „enc:v1:“. Das kann ein altes Klartext-Passwort oder ein beschädigter verschlüsselter Wert sein. Nur wenn Sie sicher sind, dass der vollständige Wert Klartext ist, wählen Sie „Als Klartext übernehmen“. Eine lokale Sicherung der Originaldatei wird angelegt und kann Klartext enthalten. Andernfalls bleibt die Hostdatei unverändert.`,
            buttons: ['Abbrechen', 'Als Klartext übernehmen'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (choice !== 1) throw error;
          decoded[key] = value;
          needsMigration = true;
          recoveredAmbiguousSecret = true;
        }
      }
      const host = this.sanitizeHost(decoded);
      if (!host) throw new Error('Die Hostdatei enthält einen ungültigen Host und wurde nicht überschrieben.');
      hosts.push(host);
    }
    if (recoveredAmbiguousSecret) {
      const backup = `${this.hostsPath}.recovery.${crypto.randomBytes(12).toString('hex')}.bak`;
      fs.writeFileSync(backup, data, { mode: 0o600, flag: 'wx' });
    }
    if (needsMigration) this.persistHosts(hosts);
    return hosts;
  }

  public migrateHosts(legacyHosts: unknown): SSHHost[] {
    if (!Array.isArray(legacyHosts)) {
      throw new Error('Die alten Hostdaten haben ein ungültiges Format.');
    }
    const hosts = this.getHosts();
    for (const item of legacyHosts) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Die alten Hostdaten enthalten ungültige Einträge.');
      }
      const host = this.sanitizeHost(item as Record<string, unknown>);
      if (!host) throw new Error('Die alten Hostdaten enthalten einen ungültigen Host.');
      const existing = hosts.find(h => h.id === host.id);
      if (!existing) {
        hosts.push(host);
      } else {
        // Keep different identities or conflicting credentials as separate hosts.
        if (existing.hostname !== host.hostname || existing.port !== host.port ||
            existing.username !== host.username ||
            (existing.password && host.password && existing.password !== host.password) ||
            (existing.passphrase && host.passphrase && existing.passphrase !== host.passphrase)) {
          const alreadyImported = hosts.some(h =>
            h.hostname === host.hostname && h.port === host.port && h.username === host.username &&
            h.label === host.label && h.authType === host.authType && h.createdAt === host.createdAt &&
            h.password === host.password && h.passphrase === host.passphrase && h.keyPath === host.keyPath
          );
          if (!alreadyImported) hosts.push({ ...host, id: crypto.randomUUID() });
        } else {
          if (!existing.password && host.password) existing.password = host.password;
          if (!existing.passphrase && host.passphrase) existing.passphrase = host.passphrase;
        }
      }
    }
    this.persistHosts(hosts);
    return hosts;
  }

  public saveHost(host: SSHHost): SSHHost[] {
    this.ensureInit();
    if (!host || typeof host !== 'object') {
      throw new Error('Invalid host data provided');
    }

    const sanitizedHost = this.sanitizeHost(host as unknown as Record<string, unknown>, 'localhost')!;

    try {
      const hosts = this.getHosts();
      const index = hosts.findIndex(h => h.id === sanitizedHost.id);
      if (index >= 0) {
        hosts[index] = sanitizedHost;
      } else {
        hosts.push(sanitizedHost);
      }

      this.persistHosts(hosts);
      return hosts;
    } catch (err) {
      console.error('Failed to save host to disk:', err);
      throw err;
    }
  }

  public deleteHost(id: string): SSHHost[] {
    this.ensureInit();
    if (!id || typeof id !== 'string') {
      return this.getHosts();
    }
    try {
      const targetId = id.trim();
      const hosts = this.getHosts().filter(h => h.id !== targetId);
      // Hosts that used the deleted host as jump host connect directly from now on.
      for (const host of hosts) {
        if (host.jumpHostId === targetId) delete host.jumpHostId;
      }
      this.persistHosts(hosts);
      return hosts;
    } catch (err) {
      console.error('Failed to delete host from disk:', err);
      throw err;
    }
  }

  // Write encrypted data to a private temporary file before replacing the original.
  private atomicWrite(targetPath: string, content: string): void {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${targetPath}.tmp.${crypto.randomBytes(12).toString('hex')}`;
    try {
      fs.writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tempPath, targetPath);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  // Reads ~/.ssh/config to discover existing SSH hosts
  public getSSHConfigHosts(): Partial<SSHHost>[] {
    try {
      const sshDir = path.join(os.homedir(), '.ssh');
      const configPath = path.join(sshDir, 'config');
      if (!fs.existsSync(configPath)) return [];

      interface ParsedConfigBlock {
        patterns: string[];
        hostname?: string;
        port?: number;
        username?: string;
        keyPath?: string;
        forwardAgent?: boolean;
        proxyJump?: string;
        forwards: Omit<PortForward, 'id'>[];
      }

      // [bind_address:]port, [ipv6]:port or host/port; empty or '*' bind means all interfaces.
      const parseEndpoint = (spec: string, isListen: boolean): { address?: string; port: number } | null => {
        const match = spec.match(/^\[([^\]]+)\][:/](\d+)$/) || spec.match(/^(?:(.*)[:/])?(\d+)$/);
        const port = match ? parsePort(match[2]) : null;
        if (!match || port === null) return null;
        const address = match[1]?.trim();
        if (isListen) return { port, ...(address === undefined ? {} : { address: address === '' || address === '*' ? '0.0.0.0' : address }) };
        return address ? { address, port } : null;
      };

      const parseForward = (type: PortForwardType, value: string): Omit<PortForward, 'id'> | null => {
        const tokens = parseTokens(value);
        const listen = tokens[0] ? parseEndpoint(tokens[0], true) : null;
        if (!listen) return null;
        const bind = listen.address ? { bindAddress: listen.address } : {};
        if (type === 'dynamic') return tokens.length === 1 ? { type, bindPort: listen.port, ...bind } : null;
        // Unix-socket and remote-dynamic variants are not supported.
        const target = tokens.length === 2 ? parseEndpoint(tokens[1], false) : null;
        return target ? { type, bindPort: listen.port, ...bind, targetHost: target.address, targetPort: target.port } : null;
      };

      const blocks: ParsedConfigBlock[] = [];
      const visitedFiles = new Set<string>();

      const stripComment = (raw: string): string => {
        let inDouble = false;
        let inSingle = false;
        for (let i = 0; i < raw.length; i++) {
          const ch = raw[i];
          if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
          } else if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
          } else if (ch === '#' && !inDouble && !inSingle) {
            return raw.slice(0, i);
          }
        }
        return raw;
      };

      const parseTokens = (val: string): string[] => {
        const tokens: string[] = [];
        const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(val)) !== null) {
          const token = match[1] ?? match[2] ?? match[0];
          if (token) tokens.push(token.trim());
        }
        return tokens;
      };

      const wildcardToRegExp = (pattern: string): RegExp => {
        const escaped = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`, 'i');
      };

      const expandIncludePattern = (rawPattern: string): string[] => {
        const homeExpanded = rawPattern.replace(/^~(?=$|\/|\\)/, os.homedir());
        const fullPattern = path.isAbsolute(homeExpanded)
          ? path.normalize(homeExpanded)
          : path.join(sshDir, homeExpanded);

        if (!fullPattern.includes('*') && !fullPattern.includes('?')) {
          try {
            if (fs.existsSync(fullPattern) && fs.statSync(fullPattern).isFile()) {
              return [fullPattern];
            }
          } catch {}
          return [];
        }

        const isRooted = fullPattern.startsWith(path.sep);
        const segments = fullPattern.split(path.sep).filter(Boolean);
        let candidates: string[] = [isRooted ? path.sep : '.'];

        for (const seg of segments) {
          const nextCandidates: string[] = [];
          if (!seg.includes('*') && !seg.includes('?')) {
            for (const base of candidates) {
              const nextPath = path.join(base, seg);
              try {
                if (fs.existsSync(nextPath)) {
                  nextCandidates.push(nextPath);
                }
              } catch {}
            }
          } else {
            const segRegex = wildcardToRegExp(seg);
            const allowDot = seg.startsWith('.');
            for (const base of candidates) {
              try {
                if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
                const entries = fs.readdirSync(base).sort((a, b) => a.localeCompare(b));
                for (const entry of entries) {
                  if (!allowDot && entry.startsWith('.')) continue;
                  if (segRegex.test(entry)) {
                    nextCandidates.push(path.join(base, entry));
                  }
                }
              } catch {}
            }
          }
          candidates = nextCandidates;
          if (candidates.length === 0) break;
        }

        return candidates.filter(candidate => {
          try {
            return fs.statSync(candidate).isFile();
          } catch {
            return false;
          }
        });
      };

      const parseConfigFile = (filePath: string, depth: number) => {
        if (depth > 16) return;

        let canonicalPath: string;
        try {
          canonicalPath = fs.realpathSync(filePath);
        } catch {
          canonicalPath = path.resolve(filePath);
        }
        if (visitedFiles.has(canonicalPath)) return;
        visitedFiles.add(canonicalPath);

        let content = '';
        try {
          content = fs.readFileSync(filePath, 'utf-8');
        } catch (readErr) {
          console.warn(`Could not read SSH config file ${filePath}:`, readErr);
          return;
        }

        // Top-level directives before the first Host block act as global defaults (Host *)
        let currentBlock: ParsedConfigBlock | null = { patterns: ['*'], forwards: [] };
        blocks.push(currentBlock);

        const lines = content.split(/\r?\n/);
        for (const rawLine of lines) {
          const cleanLine = stripComment(rawLine).trim();
          if (!cleanLine) continue;

          const match = cleanLine.match(/^([a-zA-Z0-9_-]+)(?:\s*=\s*|\s+)(.*)$/);
          if (!match) continue;

          const key = match[1].toLowerCase();
          let value = match[2].trim();

          if (key === 'include') {
            const includePatterns = parseTokens(value);
            for (const pattern of includePatterns) {
              const matchedFiles = expandIncludePattern(pattern);
              for (const includedFile of matchedFiles) {
                parseConfigFile(includedFile, depth + 1);
              }
            }
            continue;
          }

          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1).trim();
          }

          if (key === 'host') {
            const patterns = parseTokens(value);
            currentBlock = patterns.length > 0 ? { patterns, forwards: [] } : null;
            if (currentBlock) {
              blocks.push(currentBlock);
            }
          } else if (key === 'match') {
            currentBlock = null;
          } else if (currentBlock) {
            // OpenSSH first-match-wins semantics within a block
            if (key === 'hostname') {
              if (value && currentBlock.hostname === undefined) {
                currentBlock.hostname = value;
              }
            } else if (key === 'user') {
              if (value && currentBlock.username === undefined) {
                currentBlock.username = value;
              }
            } else if (key === 'port') {
              const parsedPort = parseInt(value, 10);
              if (!isNaN(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 && currentBlock.port === undefined) {
                currentBlock.port = parsedPort;
              }
            } else if (key === 'identityfile') {
              if (value && currentBlock.keyPath === undefined) {
                currentBlock.keyPath = value.replace(/^~(?=$|\/|\\)/, os.homedir());
              }
            } else if (key === 'forwardagent') {
              if (currentBlock.forwardAgent === undefined) currentBlock.forwardAgent = value.toLowerCase() === 'yes';
            } else if (key === 'proxyjump') {
              if (value && currentBlock.proxyJump === undefined) currentBlock.proxyJump = value;
            } else if (key === 'localforward' || key === 'remoteforward' || key === 'dynamicforward') {
              // Forwards accumulate across all matching blocks, like OpenSSH.
              const type: PortForwardType = key === 'localforward' ? 'local' : key === 'remoteforward' ? 'remote' : 'dynamic';
              const forward = parseForward(type, value);
              if (forward) currentBlock.forwards.push(forward);
            }
          }
        }
      };

      parseConfigFile(configPath, 0);

      // Collect unique concrete host aliases in order of first appearance
      const concreteLabels: string[] = [];
      const seenLabels = new Set<string>();
      for (const block of blocks) {
        for (const p of block.patterns) {
          if (p && !p.includes('*') && !p.includes('?') && !p.startsWith('!') && !seenLabels.has(p)) {
            seenLabels.add(p);
            concreteLabels.push(p);
          }
        }
      }

      const matchesSpecificBlock = (label: string, patterns: string[]): boolean => {
        let matched = false;
        for (const p of patterns) {
          if (!p || p === '*') continue;
          if (p.startsWith('!')) {
            const negated = p.slice(1);
            if (negated && wildcardToRegExp(negated).test(label)) {
              return false;
            }
          } else if (wildcardToRegExp(p).test(label)) {
            matched = true;
          }
        }
        return matched;
      };

      const matchesGlobalWildcardBlock = (label: string, patterns: string[]): boolean => {
        if (!patterns.includes('*')) return false;
        for (const p of patterns) {
          if (p.startsWith('!')) {
            const negated = p.slice(1);
            if (negated && wildcardToRegExp(negated).test(label)) {
              return false;
            }
          }
        }
        return true;
      };

      const entries: { host: Partial<SSHHost>; proxyJump?: string }[] = [];
      for (const label of concreteLabels) {
        let hostname: string | undefined;
        let port: number | undefined;
        let username: string | undefined;
        let keyPath: string | undefined;
        let forwardAgent: boolean | undefined;
        let proxyJump: string | undefined;
        const forwardBlocks = new Set<ParsedConfigBlock>();

        // 1. Apply specific & wildcard (non-'*') blocks using OpenSSH first-match-wins semantics
        for (const block of blocks) {
          if (!matchesSpecificBlock(label, block.patterns)) continue;
          if (hostname === undefined && block.hostname !== undefined) hostname = block.hostname;
          if (port === undefined && block.port !== undefined) port = block.port;
          if (username === undefined && block.username !== undefined) username = block.username;
          if (keyPath === undefined && block.keyPath !== undefined) keyPath = block.keyPath;
          if (forwardAgent === undefined && block.forwardAgent !== undefined) forwardAgent = block.forwardAgent;
          if (proxyJump === undefined && block.proxyJump !== undefined) proxyJump = block.proxyJump;
          forwardBlocks.add(block);
        }

        // 2. Apply Host * global fallback defaults (first-match-wins across Host * blocks)
        for (const block of blocks) {
          if (!matchesGlobalWildcardBlock(label, block.patterns)) continue;
          if (port === undefined && block.port !== undefined) port = block.port;
          if (username === undefined && block.username !== undefined) username = block.username;
          if (keyPath === undefined && block.keyPath !== undefined) keyPath = block.keyPath;
          if (forwardAgent === undefined && block.forwardAgent !== undefined) forwardAgent = block.forwardAgent;
          if (proxyJump === undefined && block.proxyJump !== undefined) proxyJump = block.proxyJump;
          forwardBlocks.add(block);
        }

        const targetHost = (hostname ? hostname.replace(/%h/g, label) : label).trim();
        if (!targetHost) continue;

        const portForwards = [...forwardBlocks].flatMap((block) => block.forwards).map((forward) => ({ ...forward, id: newId() }));
        entries.push({
          host: {
            id: newId(),
            label,
            hostname: targetHost,
            port: port ?? 22,
            username: username ?? 'root',
            authType: keyPath ? 'key' : 'password',
            ...(keyPath ? { keyPath } : {}),
            ...(forwardAgent ? { agentForwarding: true } : {}),
            ...(portForwards.length > 0 ? { portForwards } : {}),
          },
          proxyJump,
        });
      }

      // ProxyJump maps to jumpHostId only for a single alias imported in the same run.
      for (const entry of entries) {
        const alias = entry.proxyJump?.trim();
        if (!alias || alias.includes(',')) continue;
        const jump = entries.find((candidate) => candidate !== entry && candidate.host.label === alias);
        if (jump) entry.host.jumpHostId = jump.host.id;
      }

      return entries.map((entry) => entry.host);
    } catch (err) {
      console.error('Failed to parse ~/.ssh/config:', err);
      return [];
    }
  }
}
