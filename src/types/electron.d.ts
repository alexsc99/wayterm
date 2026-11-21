import {
  SSHHost,
  SSHKeyFile,
  RemoteFileItem,
  LocalFileItem,
  TransferProgressEvent,
  SCPTransferOptions,
  SCPTransferResult,
  SerialPortInfo,
  SerialConfig,
  PortForwardStatusEvent,
} from './index';

declare global {
  interface Window {
    electronAPI?: {
      // Hosts
      getHosts: () => Promise<SSHHost[]>;
      migrateHosts: (hosts: SSHHost[]) => Promise<SSHHost[]>;
      saveHost: (host: SSHHost) => Promise<SSHHost[]>;
      deleteHost: (id: string) => Promise<SSHHost[]>;
      getSSHConfigHosts: () => Promise<Partial<SSHHost>[]>;

      // Keys
      listKeys: () => Promise<SSHKeyFile[]>;
      generateKey: (options: {
        name: string;
        type: 'ed25519' | 'rsa';
        comment?: string;
        passphrase?: string;
      }) => Promise<SSHKeyFile>;
      deleteKey: (keyPath: string) => Promise<boolean>;
      openInFinder: (filePath?: string) => Promise<boolean>;
      // Local Terminal (PTY)
      connectLocalTerm: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
      writeLocalTerm: (sessionId: string, data: string) => void;
      resizeLocalTerm: (sessionId: string, cols: number, rows: number) => void;
      disconnectLocalTerm: (sessionId: string) => Promise<void>;
      onLocalTermData: (sessionId: string, callback: (data: string) => void) => () => void;
      onLocalTermClosed: (
        callback: (data: { sessionId: string; exitCode?: number; signal?: number }) => void
      ) => () => void;

      // SSH Terminal
      connectSSH: (sessionId: string, host: SSHHost, cols: number, rows: number) => Promise<boolean>;
      writeSSH: (sessionId: string, data: string | Uint8Array) => void;
      resizeSSH: (sessionId: string, cols: number, rows: number) => void;
      disconnectSSH: (sessionId: string) => Promise<void>;
      onSSHData: (sessionId: string, callback: (data: Uint8Array) => void) => () => void;
      onSSHClosed: (callback: ({ sessionId }: { sessionId: string }) => void) => () => void;
      onSSHForwardStatus: (callback: (event: PortForwardStatusEvent) => void) => () => void;

      // Serial Terminal
      listSerialPorts: () => Promise<SerialPortInfo[]>;
      connectSerial: (sessionId: string, config: SerialConfig) => Promise<boolean>;
      writeSerial: (sessionId: string, data: string) => void;
      disconnectSerial: (sessionId: string) => Promise<void>;
      onSerialData: (sessionId: string, callback: (data: string) => void) => () => void;
      onSerialClosed: (
        callback: (data: { sessionId: string; error?: string }) => void
      ) => () => void;
      ackTerminalData: (sessionId: string, amount: number) => void;
      configureSessionLog: (config: { enabled: boolean; directory: string }) => void;
      getDefaultSessionLogDirectory: () => Promise<string>;
      // SFTP
      // SFTP & SCP
      listSFTP: (host: SSHHost, remotePath: string) => Promise<RemoteFileItem[]>;
      uploadSFTP: (host: SSHHost, localPath: string, remotePath: string, transferId: string) => Promise<void>;
      downloadSFTP: (host: SSHHost, remotePath: string, localPath: string, transferId: string) => Promise<void>;
      mkdirSFTP: (host: SSHHost, remotePath: string) => Promise<void>;
      deleteFileSFTP: (host: SSHHost, remotePath: string) => Promise<void>;
      deleteDirSFTP: (host: SSHHost, remotePath: string) => Promise<void>;
      renameSFTP: (host: SSHHost, oldPath: string, newPath: string) => Promise<void>;
      readFileSFTP: (host: SSHHost, remotePath: string) => Promise<string>;
      writeFileSFTP: (host: SSHHost, remotePath: string, content: string) => Promise<void>;
      getSFTPProtocolMode: (host: SSHHost) => Promise<'sftp' | 'scp'>;
      executeSCP: (options: SCPTransferOptions) => Promise<SCPTransferResult>;
      cancelTransfer: (transferId: string) => Promise<boolean>;
      onTransferProgress: (callback: (data: TransferProgressEvent) => void) => () => void;

      // Local Files
      getLocalHome: () => Promise<string>;
      listLocalFiles: (dirPath: string) => Promise<LocalFileItem[]>;

      // System
      getSystemInfo: () => Promise<{ platform: string; arch: string }>;
      /** Aligns the native window theme and background with the app theme. */
      setWindowAppearance: (appearance: { mode: 'dark' | 'light'; backgroundColor: string }) => void;

      // Dialogs
      showOpenFileDialog: (options?: {
        title?: string;
        defaultPath?: string;
        buttonLabel?: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<string | null>;
      showOpenDirectoryDialog: (options?: {
        title?: string;
        defaultPath?: string;
        buttonLabel?: string;
      }) => Promise<string | null>;

      // Clipboard
      readClipboard: () => Promise<string>;
      writeClipboard: (text: string) => Promise<void>;

      // File Save & External Links
      saveTextFile: (options: {
        defaultName: string;
        content: string;
        title?: string;
      }) => Promise<{ saved: boolean; filePath?: string }>;
      openExternalUrl: (url: string) => Promise<boolean>;
    };
  }
}

export {};
