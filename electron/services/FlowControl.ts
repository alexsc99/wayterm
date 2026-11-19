// Watermark-based flow control between a terminal data source and xterm.js.
// The renderer acknowledges every chunk once xterm has parsed it; while more
// than HIGH_WATERMARK units are unacknowledged the source is paused, so fast
// output (cat, yes, logs) cannot flood the renderer's write queue.
// Units are whatever the service sends: bytes for SSH, UTF-16 chars for PTY/serial.
const HIGH_WATERMARK = 512 * 1024;
const LOW_WATERMARK = 128 * 1024;

export class FlowController {
  private unacked = 0;
  private paused = false;

  constructor(
    private readonly pauseSource: () => void,
    private readonly resumeSource: () => void
  ) {}

  public sent(amount: number): void {
    this.unacked += amount;
    if (!this.paused && this.unacked >= HIGH_WATERMARK) {
      this.paused = true;
      try {
        this.pauseSource();
      } catch {
        // Source may already be closing
      }
    }
  }

  public ack(amount: number): void {
    this.unacked = Math.max(0, this.unacked - amount);
    if (this.paused && this.unacked <= LOW_WATERMARK) {
      this.paused = false;
      try {
        this.resumeSource();
      } catch {
        // Source may already be closing
      }
    }
  }
}
