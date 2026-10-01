import { describe, expect, it, vi } from 'vitest';
import { isLocked, type LockInput, submitUnderLock } from '../src/games/chain-reaction/lock.ts';

const open: LockInput = { canAct: true, busy: false, sentAt: null, seq: 5 };

/** A fake `setSentAt` that records the lock state. */
function recorder() {
  const state = { sentAt: null as number | null };
  return { state, setSentAt: (v: number | null) => (state.sentAt = v) };
}

describe('isLocked', () => {
  it('locks when the viewer cannot act, while busy, and after a move from this seq', () => {
    expect(isLocked(open)).toBe(false);
    expect(isLocked({ ...open, canAct: false })).toBe(true);
    expect(isLocked({ ...open, busy: true })).toBe(true);
    expect(isLocked({ ...open, sentAt: 5 })).toBe(true);
    // A move sent from an older state does not lock the new one.
    expect(isLocked({ ...open, sentAt: 4 })).toBe(false);
  });
});

describe('submitUnderLock', () => {
  it('locks at the current seq and keeps the lock when onAct succeeds', async () => {
    const r = recorder();
    const onAct = vi.fn(async () => {});
    expect(submitUnderLock('a', open, { setSentAt: r.setSentAt, onAct })).toBe(true);
    expect(onAct).toHaveBeenCalledWith('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(r.state.sentAt).toBe(5);
  });

  it('refuses a second submission while locked', () => {
    const r = recorder();
    const onAct = vi.fn();
    submitUnderLock('a', open, { setSentAt: r.setSentAt, onAct });
    const again = { ...open, sentAt: r.state.sentAt };
    expect(submitUnderLock('b', again, { setSentAt: r.setSentAt, onAct })).toBe(false);
    expect(onAct).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the viewer cannot act or the controller is busy', () => {
    const onAct = vi.fn();
    const r = recorder();
    expect(submitUnderLock('a', { ...open, canAct: false }, { setSentAt: r.setSentAt, onAct })).toBe(false);
    expect(submitUnderLock('a', { ...open, busy: true }, { setSentAt: r.setSentAt, onAct })).toBe(false);
    expect(onAct).not.toHaveBeenCalled();
    expect(r.state.sentAt).toBeNull();
  });

  it('releases the lock when onAct rejects, so the player can retry', async () => {
    const r = recorder();
    let fail: (e: Error) => void = () => {};
    const onAct = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)));
    submitUnderLock('a', open, { setSentAt: r.setSentAt, onAct });
    expect(r.state.sentAt).toBe(5);
    fail(new Error('relay down'));
    await vi.waitFor(() => expect(r.state.sentAt).toBeNull());
    expect(submitUnderLock('a', { ...open, sentAt: r.state.sentAt }, { setSentAt: r.setSentAt, onAct })).toBe(
      true,
    );
  });

  it('releases the lock when onAct throws synchronously', () => {
    const r = recorder();
    const onAct = vi.fn(() => {
      throw new Error('signer gone');
    });
    expect(submitUnderLock('a', open, { setSentAt: r.setSentAt, onAct })).toBe(true);
    expect(r.state.sentAt).toBeNull();
  });
});
