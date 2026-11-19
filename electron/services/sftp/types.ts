import { Client, SFTPWrapper } from 'ssh2';

/** Pooled SSH connection; `sftp` is null when the host only supports SCP/exec. */
export interface PoolEntry {
  key: string;
  client: Client;
  sftp: SFTPWrapper | null;
  mode: 'sftp' | 'scp';
  idleTimer: NodeJS.Timeout | null;
  activeOperations: number;
  isClosed: boolean;
}

/** Per-transfer cancellation state; abort callbacks tear down in-flight streams. */
export interface ActiveTransferControl {
  transferId: string;
  cancelled: boolean;
  abortCallbacks: Array<() => void>;
}
