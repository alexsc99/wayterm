import { describe, expect, it } from 'vitest';
import { FlowController } from '../electron/services/FlowControl';

// Mirrors the watermarks in FlowControl.ts.
const HIGH = 512 * 1024;
const LOW = 128 * 1024;

function createController(options: { pauseThrows?: boolean; resumeThrows?: boolean } = {}) {
  const calls = { pause: 0, resume: 0 };
  const controller = new FlowController(
    () => {
      calls.pause++;
      if (options.pauseThrows) throw new Error('pause failed');
    },
    () => {
      calls.resume++;
      if (options.resumeThrows) throw new Error('resume failed');
    }
  );
  return { controller, calls };
}

describe('FlowController', () => {
  it('does not pause below the high watermark', () => {
    const { controller, calls } = createController();
    controller.sent(HIGH - 1);
    expect(calls.pause).toBe(0);
  });

  it('pauses exactly once when the high watermark is reached', () => {
    const { controller, calls } = createController();
    controller.sent(HIGH - 10);
    controller.sent(10);
    expect(calls.pause).toBe(1);
    controller.sent(64 * 1024);
    controller.sent(1);
    expect(calls.pause).toBe(1);
  });

  it('resumes exactly once when unacked data drops to the low watermark', () => {
    const { controller, calls } = createController();
    controller.sent(HIGH);
    controller.ack(HIGH - LOW - 1);
    expect(calls.resume).toBe(0);
    controller.ack(1);
    expect(calls.resume).toBe(1);
    controller.ack(LOW);
    controller.ack(1);
    expect(calls.resume).toBe(1);
  });

  it('never resumes without a prior pause', () => {
    const { controller, calls } = createController();
    controller.sent(LOW * 2);
    controller.ack(LOW * 2);
    expect(calls.resume).toBe(0);
  });

  it('can pause and resume repeatedly', () => {
    const { controller, calls } = createController();
    for (let i = 0; i < 3; i++) {
      controller.sent(HIGH);
      controller.ack(HIGH);
    }
    expect(calls).toEqual({ pause: 3, resume: 3 });
  });

  it('clamps unacked data at zero on over-acknowledgement', () => {
    const { controller, calls } = createController();
    controller.ack(100_000);
    // Without clamping, the negative balance would absorb this and skip the pause.
    controller.sent(HIGH);
    expect(calls.pause).toBe(1);
  });

  it('swallows errors thrown by pause and resume', () => {
    const { controller, calls } = createController({ pauseThrows: true, resumeThrows: true });
    expect(() => controller.sent(HIGH)).not.toThrow();
    // Still counted as paused: no retry on further output.
    expect(() => controller.sent(1)).not.toThrow();
    expect(calls.pause).toBe(1);
    expect(() => controller.ack(HIGH + 1)).not.toThrow();
    expect(calls.resume).toBe(1);
    // State machine keeps working after the failures.
    controller.sent(HIGH);
    expect(calls.pause).toBe(2);
  });
});
