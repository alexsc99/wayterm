import type { ITheme } from '@xterm/xterm';

/**
 * Classic MobaXterm Dark color palette with vivid, high-contrast ANSI colors
 * and crisp legibility for dark backgrounds (including readable bright blues).
 */
export const MOBAXTERM_THEME: ITheme = {
  background: '#0c0e14',
  foreground: '#e6e8ee',
  cursor: '#a6e22e',
  cursorAccent: '#0c0e14',
  selectionBackground: 'rgba(82, 153, 242, 0.32)',
  black: '#10131a',
  red: '#ff5555',
  green: '#8ce10b',
  yellow: '#e6db74',
  blue: '#5299f2',
  magenta: '#ae81ff',
  cyan: '#38ccd1',
  white: '#d8dee9',
  brightBlack: '#68707d',
  brightRed: '#ff6e6e',
  brightGreen: '#a6e22e',
  brightYellow: '#ffd866',
  brightBlue: '#66d9ef',
  brightMagenta: '#c792ea',
  brightCyan: '#56d8e6',
  brightWhite: '#ffffff',
};

/**
 * Original Putty+ Zinc dark palette (used when MobaXterm mode is toggled off).
 */
export const DEFAULT_TERMINAL_THEME: ITheme = {
  background: '#09090b',
  foreground: '#f4f4f5',
  cursor: '#38bdf8',
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(56, 189, 248, 0.28)',
  black: '#18181b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#f4f4f5',
  brightBlack: '#71717a',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fde047',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

// Single-pass token regex for uncolored terminal output.
// Priority order prevents sub-matches inside URLs, MACs, IPs, dates, or file paths.
const MOBA_TOKEN_REGEX = new RegExp(
  [
    // 1. URLs
    '(?<url>\\bhttps?:\\/\\/[^\\s"\'<>()[\\]]+)',
    // 2. MAC addresses (standard colon/hyphen & Cisco dotted quad)
    '(?<mac>\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b|\\b(?:[0-9A-Fa-f]{4}\\.){2}[0-9A-Fa-f]{4}\\b)',
    // 3. IPv4 addresses with optional CIDR or port
    '(?<ipv4>\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\/\\d{1,2})?(?::\\d{1,5})?\\b)',
    // 4. ISO dates & timestamps (YYYY-MM-DD, HH:MM:SS.mmm)
    '(?<datetime>\\b\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?\\b|\\b\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?\\b)',
    // 5. Unix file paths (well-known roots or multi-segment paths)
    '(?<path>(?<![A-Za-z0-9._~-])(?:~\\/|\\/(?:etc|var|usr|opt|home|Users|tmp|dev|proc|sys|run|bin|sbin|lib|root|srv|mnt|Volumes|Library|Applications|System)\\b)[A-Za-z0-9._~\\/-]*|(?<=[\\s:=("\'])\\/[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+)+)',
    // 6. Error / Critical / Down states
    '(?<error>\\b(?:administratively\\s+down|ERROR|ERRORS|ERR|FAIL|FAILED|FAILURE|FATAL|CRITICAL|CRIT|PANIC|ALERT|EMERGENCY|DENIED|REFUSED|UNREACHABLE|DISCONNECTED|TIMED?\\s*OUT|TIMEOUT|INVALID|FORBIDDEN|UNAUTHORIZED|CORRUPT|CRASHED|ABORTED|SEGFAULT|KILLED|OFFLINE|INACTIVE|DEAD|DOWN)\\b|(?<=\\s{2})down(?=\\s{2}|\\r?\\n|$))',
    // 7. Warning / Degraded states
    '(?<warn>\\b(?:WARN|WARNING|WARNINGS|DEPRECATED|CAUTION|RETRY|RETRYING|PENDING|DEGRADED|EXPIRING|EXPIRED|THROTTLED|SUSPENDED|LOCKED)\\b)',
    // 8. Success / Active / Up states
    '(?<success>\\b(?:SUCCESS|SUCCESSFUL|SUCCESSFULLY|CONNECTED|ESTABLISHED|ACTIVE|RUNNING|ONLINE|READY|ENABLED|PASSED|ACCEPTED|AUTHENTICATED|HEALTHY|REACHABLE|OK|UP|YES|TRUE)\\b|(?<=\\s{2})up(?=\\s{2}|\\r?\\n|$))',
    // 9. Network protocols & common interface identifiers (eth0, en0, wlan0, Gi0/1, GigabitEthernet0/1, etc.)
    '(?<proto>\\b(?:SSH|SFTP|SCP|TCP|UDP|ICMP|HTTP|HTTPS|TLS|SSL|DNS|DHCP|ARP|BGP|OSPF|VLAN|VPN|IPV4|IPV6)\\b|\\b(?:eth\\d+|en\\d+|wlan\\d+|lo0|tun\\d+|wg\\d+|br\\d+|docker\\d+|(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|Gi|Fa|Te)\\d+\\/\\d+(?:\\/\\d+)*|(?:Loopback|Vlan)\\d+)\\b)',
    // 10. Units & metrics (ms, MB/GB/GiB, %, bps)
    '(?<metric>\\b\\d+(?:\\.\\d+)?\\s?(?:ms|us|ns|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Kbps|Mbps|Gbps|%)\\b|(?<=\\s)\\d+(?:\\.\\d+)?%(?=\\s|$|[),;]))',
  ].join('|'),
  'gi'
);

// Case-sensitive uppercase-only tokens where lowercase in English prose should not trigger
const CASE_SENSITIVE_UPPER = new Set(['ok', 'up', 'yes', 'true', 'down', 'err', 'dead']);

/**
 * Stateful per-session stream highlighter modeled after MobaXterm:
 * - Preserves existing ANSI colors (e.g. `ls --color`, `git`, themed prompts)
 * - Automatically bypasses Alternate Screen Buffer TUI apps (`vim`, `nano`, `htop`, `less`)
 * - Safely decodes streaming UTF-8 binary buffers and handles split ANSI escape sequences
 */
export class MobaHighlighterSession {
  private decoder = new TextDecoder('utf-8');
  private pendingEscape = '';
  private inAltScreen = false;
  private hasExplicitFg = false;
  private hasExplicitBg = false;
  private isBold = false;
  private isReverse = false;

  public decodeChunk(chunk: string | Uint8Array): string {
    if (typeof chunk === 'string') {
      return chunk;
    }
    return this.decoder.decode(chunk, { stream: true });
  }

  public reset(): void {
    this.pendingEscape = '';
    this.inAltScreen = false;
    this.hasExplicitFg = false;
    this.hasExplicitBg = false;
    this.isBold = false;
    this.isReverse = false;
  }

  public process(rawChunk: string | Uint8Array, enabled: boolean): string {
    const text = this.decodeChunk(rawChunk);
    if (!text && !this.pendingEscape) return '';

    const input = this.pendingEscape ? this.pendingEscape + text : text;
    this.pendingEscape = '';

    // Even when highlighting is disabled, track AltScreen / SGR state lightly
    // so toggling MobaXterm mode mid-session behaves accurately.
    let out = '';
    let plainStart = 0;
    let i = 0;
    const len = input.length;

    while (i < len) {
      if (input.charCodeAt(i) !== 0x1b) {
        i++;
        continue;
      }

      // Flush plain text preceding ESC
      if (i > plainStart) {
        const plain = input.slice(plainStart, i);
        out += this.shouldHighlight() && enabled ? this.highlightPlain(plain) : plain;
      }

      if (i + 1 >= len) {
        this.pendingEscape = input.slice(i);
        plainStart = len;
        break;
      }

      const nextChar = input[i + 1];

      // CSI: ESC [ ... finalByte (0x40 - 0x7E)
      if (nextChar === '[') {
        let j = i + 2;
        while (j < len) {
          const code = input.charCodeAt(j);
          if (code >= 0x20 && code <= 0x3f) {
            j++;
          } else {
            break;
          }
        }

        if (j >= len) {
          if (len - i <= 128) {
            this.pendingEscape = input.slice(i);
            plainStart = len;
            break;
          }
          // Malformed overly long CSI; emit as-is
          out += input.slice(i, j);
          i = j;
          plainStart = i;
          continue;
        }

        const finalCode = input.charCodeAt(j);
        if (finalCode >= 0x40 && finalCode <= 0x7e) {
          const params = input.slice(i + 2, j);
          const finalChar = input[j];
          this.handleCsi(params, finalChar);
          out += input.slice(i, j + 1);
          i = j + 1;
          plainStart = i;
          continue;
        } else {
          out += input.slice(i, j);
          i = j;
          plainStart = i;
          continue;
        }
      }

      // OSC / DCS / APC / PM: ESC ] / P / _ / ^ ... terminated by BEL (\x07) or ST (ESC \)
      if (nextChar === ']' || nextChar === 'P' || nextChar === '_' || nextChar === '^') {
        let j = i + 2;
        let terminatedEnd = -1;
        while (j < len) {
          const c = input.charCodeAt(j);
          if (c === 0x07) {
            terminatedEnd = j + 1;
            break;
          }
          if (c === 0x1b) {
            if (j + 1 >= len) {
              // Possible split ST (ESC \) at end of chunk
              terminatedEnd = -2;
              break;
            }
            if (input[j + 1] === '\\') {
              terminatedEnd = j + 2;
              break;
            }
          }
          j++;
        }

        if (terminatedEnd >= 0) {
          out += input.slice(i, terminatedEnd);
          i = terminatedEnd;
          plainStart = i;
          continue;
        }

        if (len - i <= 2048) {
          this.pendingEscape = input.slice(i);
          plainStart = len;
          break;
        }

        out += input.slice(i, len);
        plainStart = len;
        break;
      }

      // 3-byte charset / intermediate ESC sequences: ESC ( B, ESC # 8, etc.
      if ('()*+-./#%'.includes(nextChar)) {
        if (i + 2 >= len) {
          this.pendingEscape = input.slice(i);
          plainStart = len;
          break;
        }
        out += input.slice(i, i + 3);
        i += 3;
        plainStart = i;
        continue;
      }

      // 2-byte ESC sequence (e.g., ESC c = full reset, ESC =, ESC >, ESC M)
      if (nextChar === 'c') {
        this.reset();
      }
      out += input.slice(i, i + 2);
      i += 2;
      plainStart = i;
    }

    if (plainStart < len) {
      const tail = input.slice(plainStart, len);
      out += this.shouldHighlight() && enabled ? this.highlightPlain(tail) : tail;
    }

    return out;
  }

  private shouldHighlight(): boolean {
    return (
      !this.inAltScreen &&
      !this.hasExplicitFg &&
      !this.hasExplicitBg &&
      !this.isReverse
    );
  }

  private handleCsi(params: string, finalChar: string): void {
    // Alternate screen buffer detection (?1049h/l, ?47h/l, ?1047h/l)
    if ((finalChar === 'h' || finalChar === 'l') && params.startsWith('?')) {
      const modes = params.slice(1).split(';');
      if (modes.some((m) => m === '1049' || m === '47' || m === '1047')) {
        this.inAltScreen = finalChar === 'h';
        if (!this.inAltScreen) {
          this.hasExplicitFg = false;
          this.hasExplicitBg = false;
          this.isBold = false;
          this.isReverse = false;
        }
      }
      return;
    }

    if (finalChar !== 'm') return;

    if (params === '' || params === '0') {
      this.hasExplicitFg = false;
      this.hasExplicitBg = false;
      this.isBold = false;
      this.isReverse = false;
      return;
    }

    // Support both semicolon and colon SGR separators
    const parts = params.split(';');
    for (let idx = 0; idx < parts.length; idx++) {
      const raw = parts[idx];
      const subParts = raw.includes(':') ? raw.split(':') : null;
      const code = Number(subParts ? subParts[0] : raw);
      if (Number.isNaN(code)) continue;

      if (code === 0) {
        this.hasExplicitFg = false;
        this.hasExplicitBg = false;
        this.isBold = false;
        this.isReverse = false;
      } else if (code === 1) {
        this.isBold = true;
      } else if (code === 22) {
        this.isBold = false;
      } else if (code === 7) {
        this.isReverse = true;
      } else if (code === 27) {
        this.isReverse = false;
      } else if (code === 39) {
        this.hasExplicitFg = false;
      } else if (code === 49) {
        this.hasExplicitBg = false;
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        this.hasExplicitFg = true;
      } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        this.hasExplicitBg = true;
      } else if (code === 38) {
        this.hasExplicitFg = true;
        if (!subParts) {
          const mode = Number(parts[idx + 1]);
          if (mode === 5) idx += 2;
          else if (mode === 2) idx += 4;
        }
      } else if (code === 48) {
        this.hasExplicitBg = true;
        if (!subParts) {
          const mode = Number(parts[idx + 1]);
          if (mode === 5) idx += 2;
          else if (mode === 2) idx += 4;
        }
      }
    }
  }

  private highlightPlain(segment: string): string {
    // Fast skip for tiny single-char keystroke echoes or pure whitespace/control chars
    if (segment.length < 2) return segment;

    const boldReset = this.isBold ? '' : ';22';

    return segment.replace(MOBA_TOKEN_REGEX, (match, ...args) => {
      const groups = args[args.length - 1] as Record<string, string | undefined>;
      const fullStr = args[args.length - 2] as string;
      const offset = args[args.length - 3] as number;
      const lower = match.toLowerCase();
      const isTableColumn =
        offset >= 2 &&
        (fullStr[offset - 1] === ' ' || fullStr[offset - 1] === '\t') &&
        (fullStr[offset - 2] === ' ' || fullStr[offset - 2] === '\t');

      if (groups.url !== undefined) {
        return `\x1b[4;96m${match}\x1b[24;39m`;
      }
      if (groups.mac !== undefined) {
        return `\x1b[95m${match}\x1b[39m`;
      }
      if (groups.ipv4 !== undefined) {
        return `\x1b[96m${match}\x1b[39m`;
      }
      if (groups.datetime !== undefined) {
        return `\x1b[94m${match}\x1b[39m`;
      }
      if (groups.path !== undefined) {
        return `\x1b[35m${match}\x1b[39m`;
      }
      if (groups.error !== undefined) {
        if (
          CASE_SENSITIVE_UPPER.has(lower) &&
          match !== match.toUpperCase() &&
          !(lower === 'down' && isTableColumn)
        ) {
          return match;
        }
        return `\x1b[1;91m${match}\x1b[39${boldReset}m`;
      }
      if (groups.warn !== undefined) {
        return `\x1b[1;93m${match}\x1b[39${boldReset}m`;
      }
      if (groups.success !== undefined) {
        if (
          CASE_SENSITIVE_UPPER.has(lower) &&
          match !== match.toUpperCase() &&
          !(lower === 'up' && isTableColumn)
        ) {
          return match;
        }
        return `\x1b[1;92m${match}\x1b[39${boldReset}m`;
      }
      if (groups.proto !== undefined) {
        return `\x1b[36m${match}\x1b[39m`;
      }
      if (groups.metric !== undefined) {
        return `\x1b[33m${match}\x1b[39m`;
      }
      return match;
    });
  }
}
