import { describe, expect, it } from 'vitest';
import { ENGINES, engine } from '../helpers.ts';

describe.each(ENGINES)('encoding: engine $version', (m) => {
  const { playRoll, rejects, setup } = engine(m);

  it('C27 extra keys and a false flag are rejected', () => {
    const state = playRoll(setup(3), [1, 2]).state;
    const stay = { type: 'stay', actor: 1 };
    expect(m.apply(state, stay).ok).toBe(true);
    for (const bad of [
      { ...stay, stay: false },
      { ...stay, extra: 1 },
      { type: 'bank', actor: 1, bank: false },
      { type: 'bank', actor: '1' },
      { type: 'bank', actor: 1.5 },
      { type: 'bank', actor: -0 },
      { type: 'bank' },
      { type: 'Bank', actor: 1 },
      { type: 'roll', actor: 0, rollId: 0, faces: [1, 2] },
      { type: 'rolled', actor: 0, id: 0, dice: [1, 2] },
      null,
      'bank',
      ['stay', 1],
    ]) {
      rejects(state, bad, 'malformed');
    }
    const hostile = Object.defineProperty({ type: 'stay' }, 'actor', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    rejects(state, hostile, 'malformed');
  });

  it('C31 a pot that would leave the safe integers is rejected', () => {
    const state = setup(2);
    const huge = {
      ...state,
      pot: Number.MAX_SAFE_INTEGER,
      rolls: 3,
      phase: 'beacon' as const,
      openRoll: 0,
      nextRollId: 1,
      schedule: [{ id: 0, last: m.version === '0.1.0' ? 1 : null }],
    };
    rejects(huge, { type: 'rolled', actor: 'beacon', id: 0, dice: [1, 2] }, 'illegal');
    rejects(huge, { type: 'rolled', actor: 'beacon', id: 0, dice: [6, 6] }, 'illegal');
    expect(huge.pot).toBe(Number.MAX_SAFE_INTEGER);
  });
});
