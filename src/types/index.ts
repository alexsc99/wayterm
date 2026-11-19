export interface SSHHost {
  id: string;
  label?: string;
  hostname: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  keyPath?: string;
  passphrase?: string;
  createdAt: number;
  /** ID of another saved host used as ProxyJump (its credentials are used for the hop). */
  jumpHostId?: string;
  /** Forward the local ssh-agent (SSH_AUTH_SOCK) to the server. */
  agentForwarding?: boolean;
  /** Port forwards opened together with every terminal session to this host. */
  portForwards?: PortForward[];
}

/** local = ssh -L, remote = ssh -R, dynamic = ssh -D (SOCKS5). */
export type PortForwardType = 'local' | 'remote' | 'dynamic';

export interface PortForward {
  id: string;
  type: PortForwardType;
  /** local/dynamic: port on this Mac; remote: port on the server. */
  bindPort: number;
  /** Defaults to 127.0.0.1 (local/dynamic on this Mac, remote on the server). */
  bindAddress?: string;
  /** local: target as seen from the server; remote: target as seen from this Mac. Unused for dynamic. */
  targetHost?: string;
  targetPort?: number;
}

export interface PortForwardStatusEvent {
  sessionId: string;
  forwardId: string;
  state: 'active' | 'error';
  message?: string;
}

export interface SSHKeyFile {
  name: string;
  path: string;
  publicKeyPath?: string;
  type: string;
  hasPublic: boolean;
  publicKey?: string;
  fingerprint?: string;
  isEncrypted: boolean;
}

export type TerminalSessionType = 'local' | 'ssh' | 'serial';

export type SerialParity = 'none' | 'even' | 'mark' | 'odd' | 'space';
export type SerialStopBits = 1 | 1.5 | 2;
export type SerialDataBits = 5 | 6 | 7 | 8;
export type SerialFlowControl = 'none' | 'rtscts' | 'xonxoff';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
}

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits?: SerialDataBits;
  stopBits?: SerialStopBits;
  parity?: SerialParity;
  flowControl?: SerialFlowControl;
}

export interface SerialProfile {
  id: string;
  label: string;
  path: string;
  baudRate: number;
  dataBits: SerialDataBits;
  stopBits: SerialStopBits;
  parity: SerialParity;
  flowControl: SerialFlowControl;
  createdAt: number;
}

export interface SSHSession {
  id: string;
  type: TerminalSessionType;
  host?: SSHHost;
  serialConfig?: SerialConfig;
  connected: boolean;
  title: string;
}

export interface RemoteFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  size: number;
  modifyTime: number;
  permissions: string;
}

export interface LocalFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  size: number;
  modifyTime: number;
}

export interface TransferProgressEvent {
  transferId: string;
  transferred: number;
  total: number;
  percent: number;
  currentFile?: string;
  speedBytesPerSec?: number;
  protocol?: 'sftp' | 'scp';
}

export interface SCPTransferOptions {
  host: SSHHost;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  transferId: string;
  recursive?: boolean;
  preserveTimes?: boolean;
  forceSCPProtocol?: boolean;
}

export interface SCPTransferResult {
  success: boolean;
  protocol: 'scp' | 'sftp';
  filesTransferred: number;
  bytesTransferred: number;
  durationMs: number;
}

export interface SCPJob {
  id: string;
  direction: 'upload' | 'download';
  hostId: string;
  localPath: string;
  remotePath: string;
  recursive?: boolean;
  preserveTimes?: boolean;
  compression?: boolean;
  legacyProtocol?: boolean;
  status?: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
  progress?: number;
  bytesTransferred?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  currentFile?: string;
  protocol?: 'scp' | 'sftp';
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export type TerminalCursorStyle = 'block' | 'underline' | 'bar';
export type TerminalRightClickMode = 'paste' | 'menu';

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  copyOnSelect: boolean;
  rightClickMode: TerminalRightClickMode;
  confirmMultilinePaste: boolean;
  openLinksWithCmdClick: boolean;
  /** Write every session's output to a log file. */
  sessionLogging: boolean;
  /** Log directory; empty = ~/Documents/putty+ Logs. */
  sessionLogDirectory: string;
  /** Reopen the tabs of the last run on startup. */
  restoreSessions: boolean;
  /** Reconnect SSH sessions automatically after an unexpected disconnect. */
  autoReconnect: boolean;
}

export interface CommandSnippet {
  id: string;
  title: string;
  command: string;
  category?: string;
  sendEnter: boolean;
}
