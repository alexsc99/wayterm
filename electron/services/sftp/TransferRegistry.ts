import { BrowserWindow } from 'electron';
import { TransferProgressEvent } from '../../../src/types';
import { ActiveTransferControl } from './types';

/** Tracks running transfers by id so the renderer can cancel them. */
export class TransferRegistry {
  private activeTransfers = new Map<string, ActiveTransferControl>();
  // Cancel requests that arrived before the transfer started.
  private cancelledTransfers = new Set<string>();

  public begin(transferId: string): ActiveTransferControl {
    if (this.cancelledTransfers.delete(transferId)) {
      throw new Error('Übertragung abgebrochen');
    }
    const control: ActiveTransferControl = {
      transferId,
      cancelled: false,
      abortCallbacks: [],
    };
    if (transferId) {
      this.activeTransfers.set(transferId, control);
    }
    return control;
  }

  public end(transferId: string): void {
    if (!transferId) return;
    this.activeTransfers.delete(transferId);
    this.cancelledTransfers.delete(transferId);
  }

  public cancel(transferId: string): boolean {
    if (!transferId) return false;
    this.cancelledTransfers.add(transferId);
    const control = this.activeTransfers.get(transferId);
    if (control) {
      control.cancelled = true;
      const callbacks = [...control.abortCallbacks];
      for (const cb of callbacks) {
        try {
          cb();
        } catch {
          // ignore
        }
      }
      return true;
    }
    return false;
  }

  public cancelAll(): void {
    for (const [id, control] of this.activeTransfers.entries()) {
      control.cancelled = true;
      for (const cb of [...control.abortCallbacks]) {
        try {
          cb();
        } catch {
          // ignore
        }
      }
      this.activeTransfers.delete(id);
    }
    this.cancelledTransfers.clear();
  }
}

export function emitProgress(
  window: BrowserWindow | null | undefined,
  payload: TransferProgressEvent
): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send('transfer:progress', payload);
  }
}
