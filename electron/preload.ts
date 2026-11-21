import { contextBridge, ipcRenderer } from 'electron';
import { SSHHost, SCPTransferOptions, TransferProgressEvent, SerialConfig, PortForwardStatusEvent } from '../src/types';
contextBridge.exposeInMainWorld('electronAPI', {
  // Hosts
  getHosts: () => ipcRenderer.invoke('hosts:get'),
  migrateHosts: (hosts: SSHHost[]) => ipcRenderer.invoke('hosts:migrate', hosts),
  saveHost: (host: SSHHost) => ipcRenderer.invoke('hosts:save', host),
  deleteHost: (id: string) => ipcRenderer.invoke('hosts:delete', id),
  getSSHConfigHosts: () => ipcRenderer.invoke('hosts:importSshConfig'),

  // Keys in ~/.ssh
  listKeys: () => ipcRenderer.invoke('keys:list'),
  generateKey: (options: { name: string; type: 'ed25519' | 'rsa'; comment?: string; passphrase?: string }) =>
    ipcRenderer.invoke('keys:generate', options),
  deleteKey: (keyPath: string) => ipcRenderer.invoke('keys:delete', keyPath),
  openInFinder: (filePath?: string) => ipcRenderer.invoke('keys:openInFinder', filePath),

  // Local Terminal (PTY)
  connectLocalTerm: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty:connect', { sessionId, cols, rows }),
  // Fire-and-forget: input and resize need no reply, so no promise round trip per keystroke.
  writeLocalTerm: (sessionId: string, data: string) =>
    ipcRenderer.send('pty:write', { sessionId, data }),
  resizeLocalTerm: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', { sessionId, cols, rows }),
  disconnectLocalTerm: (sessionId: string) =>
    ipcRenderer.invoke('pty:disconnect', { sessionId }),
  onLocalTermData: (sessionId: string, callback: (data: string) => void) => {
    const channel = `term:data:${sessionId}`;
    const handler = (_: unknown, data: string) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onLocalTermClosed: (callback: (data: { sessionId: string; exitCode?: number; signal?: number }) => void) => {
    const handler = (_: unknown, data: { sessionId: string; exitCode?: number; signal?: number }) => callback(data);
    ipcRenderer.on('term:closed', handler);
    return () => {
      ipcRenderer.removeListener('term:closed', handler);
    };
  },

  // SSH Terminal
  connectSSH: (sessionId: string, host: SSHHost, cols: number, rows: number) =>
    ipcRenderer.invoke('ssh:connect', { sessionId, host, cols, rows }),
  writeSSH: (sessionId: string, data: string | Uint8Array) =>
    ipcRenderer.send('ssh:write', { sessionId, data }),
  resizeSSH: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('ssh:resize', { sessionId, cols, rows }),
  disconnectSSH: (sessionId: string) =>
    ipcRenderer.invoke('ssh:disconnect', { sessionId }),
  onSSHData: (sessionId: string, callback: (data: Uint8Array) => void) => {
    const channel = `ssh:data:${sessionId}`;
    const handler = (_: unknown, data: Uint8Array) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onSSHClosed: (callback: ({ sessionId }: { sessionId: string }) => void) => {
    const handler = (_: unknown, data: { sessionId: string }) => callback(data);
    ipcRenderer.on('ssh:closed', handler);
    return () => {
      ipcRenderer.removeListener('ssh:closed', handler);
    };
  },
  onSSHForwardStatus: (callback: (event: PortForwardStatusEvent) => void) => {
    const handler = (_: unknown, event: PortForwardStatusEvent) => callback(event);
    ipcRenderer.on('ssh:forwardStatus', handler);
    return () => {
      ipcRenderer.removeListener('ssh:forwardStatus', handler);
    };
  },

  // Serial Terminal
  listSerialPorts: () => ipcRenderer.invoke('serial:list'),
  connectSerial: (sessionId: string, config: SerialConfig) =>
    ipcRenderer.invoke('serial:connect', { sessionId, config }),
  writeSerial: (sessionId: string, data: string) =>
    ipcRenderer.send('serial:write', { sessionId, data }),
  disconnectSerial: (sessionId: string) =>
    ipcRenderer.invoke('serial:disconnect', { sessionId }),
  onSerialData: (sessionId: string, callback: (data: string) => void) => {
    const channel = `serial:data:${sessionId}`;
    const handler = (_: unknown, data: string) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  // Flow control: acknowledge output that xterm has processed (local, SSH and serial sessions)
  ackTerminalData: (sessionId: string, amount: number) =>
    ipcRenderer.send('terminal:ack', { sessionId, amount }),

  // Session logging
  configureSessionLog: (config: { enabled: boolean; directory: string }) =>
    ipcRenderer.send('sessionlog:configure', config),
  getDefaultSessionLogDirectory: () => ipcRenderer.invoke('sessionlog:defaultDirectory'),
  onSerialClosed: (
    callback: (data: { sessionId: string; error?: string }) => void
  ) => {
    const handler = (_: unknown, data: { sessionId: string; error?: string }) => callback(data);
    ipcRenderer.on('serial:closed', handler);
    return () => {
      ipcRenderer.removeListener('serial:closed', handler);
    };
  },

  // SFTP & SCP
  listSFTP: (host: SSHHost, remotePath: string) =>
    ipcRenderer.invoke('sftp:list', { host, remotePath }),
  uploadSFTP: (host: SSHHost, localPath: string, remotePath: string, transferId: string) =>
    ipcRenderer.invoke('sftp:upload', { host, localPath, remotePath, transferId }),
  downloadSFTP: (host: SSHHost, remotePath: string, localPath: string, transferId: string) =>
    ipcRenderer.invoke('sftp:download', { host, remotePath, localPath, transferId }),
  mkdirSFTP: (host: SSHHost, remotePath: string) =>
    ipcRenderer.invoke('sftp:mkdir', { host, remotePath }),
  deleteFileSFTP: (host: SSHHost, remotePath: string) =>
    ipcRenderer.invoke('sftp:deleteFile', { host, remotePath }),
  deleteDirSFTP: (host: SSHHost, remotePath: string) =>
    ipcRenderer.invoke('sftp:deleteDir', { host, remotePath }),
  renameSFTP: (host: SSHHost, oldPath: string, newPath: string) =>
    ipcRenderer.invoke('sftp:rename', { host, oldPath, newPath }),
  readFileSFTP: (host: SSHHost, remotePath: string) =>
    ipcRenderer.invoke('sftp:readFile', { host, remotePath }),
  writeFileSFTP: (host: SSHHost, remotePath: string, content: string) =>
    ipcRenderer.invoke('sftp:writeFile', { host, remotePath, content }),
  getSFTPProtocolMode: (host: SSHHost) =>
    ipcRenderer.invoke('sftp:protocolMode', { host }),
  executeSCP: (options: SCPTransferOptions) =>
    ipcRenderer.invoke('scp:execute', options),
  cancelTransfer: (transferId: string) =>
    ipcRenderer.invoke('transfer:cancel', { transferId }),
  onTransferProgress: (callback: (data: TransferProgressEvent) => void) => {
    const handler = (_: unknown, data: TransferProgressEvent) => callback(data);
    ipcRenderer.on('transfer:progress', handler);
    return () => {
      ipcRenderer.removeListener('transfer:progress', handler);
    };
  },

  // Local Files
  getLocalHome: () => ipcRenderer.invoke('local:home'),
  listLocalFiles: (dirPath: string) => ipcRenderer.invoke('local:list', dirPath),

  // System
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  setWindowAppearance: (appearance: { mode: 'dark' | 'light'; backgroundColor: string }) =>
    ipcRenderer.send('window:setAppearance', appearance),

  // Dialogs
  showOpenFileDialog: (options?: Electron.OpenDialogOptions) => ipcRenderer.invoke('dialog:openFile', options),
  showOpenDirectoryDialog: (options?: Electron.OpenDialogOptions) => ipcRenderer.invoke('dialog:openDirectory', options),

  // Clipboard
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),

  // File Save & External Links
  saveTextFile: (options: { defaultName: string; content: string; title?: string }) =>
    ipcRenderer.invoke('dialog:saveTextFile', options),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
});
