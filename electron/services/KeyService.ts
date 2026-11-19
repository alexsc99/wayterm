import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { SSHKeyFile } from '../../src/types';

const execFileAsync = promisify(execFile);

export class KeyService {
  private static getSshDir(): string {
    const sshDir = path.join(os.homedir(), '.ssh');
    if (!fs.existsSync(sshDir)) {
      try {
        fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });
      } catch (e) {
        console.error('Failed to create ~/.ssh directory:', e);
      }
    }
    return sshDir;
  }

  public static getSshDirPath(): string {
    return this.getSshDir();
  }

  public static listKeys(): SSHKeyFile[] {
    let sshDir: string;
    try {
      sshDir = this.getSshDir();
      if (!fs.existsSync(sshDir)) return [];
    } catch (err) {
      console.warn('Failed to access ~/.ssh directory:', err);
      return [];
    }

    try {
      let files: string[];
      try {
        files = fs.readdirSync(sshDir);
      } catch (err) {
        console.warn('Failed to read ~/.ssh directory (permission denied or inaccessible):', err);
        return [];
      }

      const keys: SSHKeyFile[] = [];

      // Look for candidate key files (exclude config, known_hosts, authorized_keys, *.pub, etc.)
      const NON_KEY_FILES: Record<string, true> = {
        config: true,
        known_hosts: true,
        'known_hosts.old': true,
        authorized_keys: true,
        authorized_keys2: true,
        '.DS_Store': true
      };

      for (const file of files) {
        if (file.endsWith('.pub') || NON_KEY_FILES[file] || file.startsWith('.')) continue;

        const filePath = path.join(sshDir, file);
        try {
          let stat: fs.Stats;
          try {
            stat = fs.statSync(filePath);
          } catch (e) {
            // EACCES or broken symlink
            continue;
          }

          if (!stat.isFile() || stat.size > 512 * 1024) continue;

          let content = '';
          try {
            content = fs.readFileSync(filePath, { encoding: 'utf-8', flag: 'r' });
          } catch (e) {
            // EACCES or unreadable file
            continue;
          }

          const trimmedContent = content.trimStart();
          const head = trimmedContent.slice(0, 512);
          const isPpk =
            trimmedContent.startsWith('PuTTY-User-Key-File-2:') ||
            trimmedContent.startsWith('PuTTY-User-Key-File-3:');
          const isOpenSSHKey = head.includes('-----BEGIN OPENSSH PRIVATE KEY-----');
          const isPemPrivateKey =
            head.includes('-----BEGIN') &&
            (head.includes('PRIVATE KEY-----') || isOpenSSHKey);

          if (!isPemPrivateKey && !isPpk) continue;

          let isEncrypted = false;
          if (isPpk) {
            const encMatch = trimmedContent.match(/^Encryption:\s*([^\r\n]+)/im);
            const encVal = encMatch ? encMatch[1].trim().toLowerCase() : 'none';
            isEncrypted = encVal.length > 0 && encVal !== 'none';
          } else if (isOpenSSHKey) {
            const beginMarker = '-----BEGIN OPENSSH PRIVATE KEY-----';
            const endMarker = '-----END OPENSSH PRIVATE KEY-----';
            const startIdx = trimmedContent.indexOf(beginMarker);
            if (startIdx !== -1) {
              const bodyStart = startIdx + beginMarker.length;
              const endIdx = trimmedContent.indexOf(endMarker, bodyStart);
              const b64Body = (
                endIdx !== -1
                  ? trimmedContent.slice(bodyStart, endIdx)
                  : trimmedContent.slice(bodyStart)
              ).replace(/[\r\n\s]+/g, '');
              const decoded = Buffer.from(b64Body, 'base64');
              const magic = 'openssh-key-v1\0';
              if (
                decoded.length >= magic.length + 4 &&
                decoded.subarray(0, magic.length).toString('ascii') === magic
              ) {
                const cipherLen = decoded.readUInt32BE(magic.length);
                const cipherStart = magic.length + 4;
                if (cipherLen > 0 && cipherLen <= 128 && decoded.length >= cipherStart + cipherLen) {
                  const ciphername = decoded
                    .subarray(cipherStart, cipherStart + cipherLen)
                    .toString('ascii')
                    .trim()
                    .toLowerCase();
                  isEncrypted = ciphername !== 'none';
                }
              }
            }
          } else {
            isEncrypted = head.includes('ENCRYPTED');
          }

          const pubPath = filePath + '.pub';
          let hasPub = false;
          try {
            hasPub = fs.existsSync(pubPath);
          } catch {
            hasPub = false;
          }

          let publicKey: string | undefined = undefined;
          let fingerprint: string | undefined = undefined;

          if (hasPub) {
            try {
              publicKey = fs.readFileSync(pubPath, 'utf-8').trim();
              const parts = publicKey.split(/\s+/);
              if (parts.length >= 2 && parts[1]) {
                const keyBuffer = Buffer.from(parts[1], 'base64');
                if (keyBuffer.length > 0) {
                  const hash = crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
                  fingerprint = `SHA256:${hash}`;
                }
              }
            } catch (e) {
              console.warn(`Could not read or parse public key for ${file}:`, e);
            }
          }

          let keyType = 'other';
          if (isPpk) {
            keyType = 'ppk';
          } else {
            const lowerFile = file.toLowerCase();
            const upperHead = (head + ' ' + (publicKey || '')).toUpperCase();
            if (lowerFile.includes('ed25519') || upperHead.includes('ED25519')) keyType = 'ed25519';
            else if (lowerFile.includes('rsa') || upperHead.includes('RSA')) keyType = 'rsa';
            else if (lowerFile.includes('ecdsa') || upperHead.includes('ECDSA')) keyType = 'ecdsa';
          }

          keys.push({
            name: file,
            path: filePath,
            publicKeyPath: hasPub ? pubPath : undefined,
            type: keyType,
            hasPublic: hasPub,
            publicKey,
            fingerprint,
            isEncrypted
          });
        } catch (e) {
          // Ignore read errors for inaccessible files
          console.warn(`Skipping inaccessible or invalid key file ${file}:`, e);
        }
      }

      return keys;
    } catch (err) {
      console.error('Failed to read ~/.ssh keys:', err);
      return [];
    }
  }

  public static async generateKey(options: {
    name: string;
    type: 'ed25519' | 'rsa';
    comment?: string;
    passphrase?: string;
  }): Promise<SSHKeyFile> {
    const sshDir = this.getSshDir();
    const safeName = options.name.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    const keyPath = path.join(sshDir, safeName);
    const pubPath = `${keyPath}.pub`;

    if (fs.existsSync(keyPath)) {
      throw new Error(`Eine Schlüsseldatei mit dem Namen "${safeName}" existiert bereits in ~/.ssh!`);
    }

    const comment = options.comment?.trim() || `${options.name}@terminus`;
    const passphrase = options.passphrase || '';

    // Generate via native ssh-keygen on macOS with argument array to prevent shell injection
    const args: string[] = [];
    if (options.type === 'ed25519') {
      args.push('-t', 'ed25519');
    } else {
      args.push('-t', 'rsa', '-b', '4096');
    }
    args.push('-C', comment, '-N', passphrase, '-f', keyPath);

    await execFileAsync('ssh-keygen', args);

    // Ensure strict permissions
    try {
      fs.chmodSync(keyPath, 0o600);
      if (fs.existsSync(pubPath)) {
        fs.chmodSync(pubPath, 0o644);
      }
    } catch (e) {}

    let pubContent: string | undefined = undefined;
    try {
      if (fs.existsSync(pubPath)) {
        pubContent = fs.readFileSync(pubPath, 'utf-8').trim();
      }
    } catch (e) {
      console.warn(`Could not read generated public key at ${pubPath}:`, e);
    }

    let fingerprint: string | undefined = undefined;
    if (pubContent) {
      try {
        const parts = pubContent.split(/\s+/);
        if (parts.length >= 2 && parts[1]) {
          const keyBuffer = Buffer.from(parts[1], 'base64');
          if (keyBuffer.length > 0) {
            const hash = crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
            fingerprint = `SHA256:${hash}`;
          }
        }
      } catch (e) {
        console.warn(`Could not calculate fingerprint for ${pubPath}:`, e);
      }
    }

    return {
      name: safeName,
      path: keyPath,
      publicKeyPath: pubPath,
      type: options.type,
      hasPublic: !!pubContent,
      publicKey: pubContent,
      fingerprint,
      isEncrypted: passphrase.length > 0
    };
  }

  public static deleteKey(keyPath: string): boolean {
    if (!keyPath || typeof keyPath !== 'string') {
      throw new Error('Ungültiger Pfad!');
    }

    const sshDir = path.resolve(this.getSshDir());
    const resolved = path.resolve(keyPath);

    // Prevent deleting ~/.ssh directory itself
    if (resolved === sshDir) {
      throw new Error('Ungültiger Pfad: ~/.ssh Verzeichnis kann nicht gelöscht werden!');
    }

    // Security check: ensure path is strictly inside ~/.ssh
    const relative = path.relative(sshDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Ungültiger Pfad außerhalb von ~/.ssh!');
    }

    // Prevent deleting protected SSH files
    const baseName = path.basename(resolved);
    const PROTECTED_FILES: Record<string, true> = {
      config: true,
      known_hosts: true,
      'known_hosts.old': true,
      authorized_keys: true,
      authorized_keys2: true
    };
    if (PROTECTED_FILES[baseName]) {
      throw new Error(`Geschützte Datei "${baseName}" kann nicht gelöscht werden!`);
    }

    try {
      if (fs.existsSync(resolved)) {
        const stat = fs.lstatSync(resolved);
        if (stat.isDirectory()) {
          throw new Error('Verzeichnisse können nicht gelöscht werden!');
        }
        fs.unlinkSync(resolved);
      }
    } catch (e) {
      console.error(`Failed to delete key file ${resolved}:`, e);
      throw e;
    }

    // When deleting a private key (not a .pub file), also delete its .pub companion if present
    if (!resolved.endsWith('.pub')) {
      const pubPath = `${resolved}.pub`;
      if (fs.existsSync(pubPath)) {
        try {
          const pubStat = fs.lstatSync(pubPath);
          if (!pubStat.isDirectory()) {
            fs.unlinkSync(pubPath);
          }
        } catch (e) {
          console.warn(`Could not delete associated public key ${pubPath}:`, e);
        }
      }
    }

    return true;
  }
}
