import { isRollEntry, moduleProtocols } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { BANK_ID, BANK_V1_VERSION, BANK_VERSION, bank, bankV1 } from '../../src/index.ts';
import { ENGINES, engine } from '../helpers.ts';

/*
 * Engine 0.2.0 (protocol 2) against engine 0.1.0 (protocol 1): what differs after a Roll (PROTOCOL-v2 §6.2, §10;
 * build plan D-C). Everything else is the shared catalog, which runs against both.
 */

describe('engine 0.2.0 (protocol 2)', () => {
  const { act, playRoll, rejects, setup, toRoller, bustRound } = engine(bank);

  it('C32 engine 0.2.0: a roll pends the beacon at once', () => {
    for (const seats of [2, 3, 6]) {
      const ready = toRoller(setup(seats));
      const committed = act(ready, { type: 'roll', actor: ready.roller, rollId: 0 });
      expect(committed.events).toEqual([{ type: 'committed', seat: ready.roller, rollId: 0 }]);
      const s = committed.state;
      expect(s.phase).toBe('beacon');
      expect(bank.pending(s)).toEqual({ type: 'beacon', id: 0 });
      expect(s.owe).toEqual([]);
      expect(s.openRoll).toBe(0);
      expect(s.schedule).toEqual([{ id: 0, last: null }]);
      for (let seat = 0; seat < seats; seat++) expect(bank.legalActions(s, seat)).toEqual([]);
      // No player action is accepted while the beacon pends: not a bank, a stay, a second roll or a contribution.
      rejects(s, { type: 'bank', actor: ready.roller }, 'illegal');
      rejects(s, { type: 'roll', actor: ready.roller, rollId: 1 }, 'illegal');
      const resolved = act(s, { type: 'rolled', actor: 'beacon', id: 0, dice: [2, 3] }).state;
      expect(resolved.pot).toBe(5);
      expect(resolved.phase).toBe('call');
    }
  });

  it('C33 engine 0.2.0: each roll is a roll entry of two six-sided dice', () => {
    let state = setup(3);
    expect(bank.rolls?.(state)).toEqual([]);
    let seen: unknown[] = [];
    // Three rounds, each busted: ids run on across rounds and the list only grows.
    for (let round = 0; round < 3; round++) {
      state = bustRound(state);
      const list = bank.rolls?.(state) ?? [];
      expect(list.slice(0, seen.length)).toEqual(seen);
      seen = [...list];
    }
    expect(seen.length).toBeGreaterThan(3);
    seen.forEach((entry, id) => {
      expect(entry).toEqual({ id, count: 2, sides: 6 });
      expect(isRollEntry(entry)).toBe(true);
    });
    // Engine 0.1.0 lists its own form for the same play.
    const v1 = engine(bankV1);
    const old = v1.playRoll(v1.setup(3), [1, 2]).state;
    expect(bankV1.rolls?.(old)).toEqual([{ id: 0, last: 1 }]);
    expect(isRollEntry(bankV1.rolls?.(old)[0])).toBe(false);
    // And a resolved 0.2.0 roll keeps its entry.
    expect(bank.rolls?.(playRoll(setup(3), [1, 2]).state)).toEqual([{ id: 0, count: 2, sides: 6 }]);
  });

  it('C34 engine 0.2.0: there is no contribute action and no beaconOf', () => {
    expect(bank.beaconOf).toBeUndefined();
    expect(typeof bankV1.beaconOf).toBe('function');
    const call = setup(3);
    const beacon = act(toRoller(call), { type: 'roll', actor: 0, rollId: 0 }).state;
    const after = playRoll(setup(3), [1, 2]).state;
    for (const s of [call, beacon, after]) {
      for (let seat = 0; seat < 3; seat++) {
        for (const rollId of [0, 1, s.nextRollId])
          rejects(s, { type: 'contribute', actor: seat, rollId }, 'malformed');
      }
    }
    // The same contribution is a turn in engine 0.1.0.
    const v1 = engine(bankV1);
    const collecting = v1.act(v1.toRoller(v1.setup(3)), { type: 'roll', actor: 0, rollId: 0 }).state;
    expect(bankV1.apply(collecting, { type: 'contribute', actor: 2, rollId: 0 }).ok).toBe(true);
  });
});

describe.each(ENGINES)('both engines: engine $version', (m) => {
  const { act, rejects, setup, toRoller } = engine(m);

  it('C35 a player-sent rolled is rejected', () => {
    const call = setup(3);
    let rolled = act(toRoller(call), { type: 'roll', actor: 0, rollId: 0 }).state;
    while (rolled.phase === 'collect') {
      rolled = act(rolled, { type: 'contribute', actor: rolled.owe[0], rollId: 0 }).state;
    }
    expect(m.pending(rolled)).toEqual({ type: 'beacon', id: 0 });
    for (const s of [call, rolled]) {
      for (const actor of [0, 1, 2, 'seat', null, 'Beacon']) {
        rejects(s, { type: 'rolled', actor, id: 0, dice: [3, 4] }, 'malformed');
      }
    }
    // Only the beacon's derived roll resolves it.
    expect(m.apply(rolled, { type: 'rolled', actor: 'beacon', id: 0, dice: [3, 4] }).ok).toBe(true);
  });
});

describe('versions and protocols', () => {
  it('C36 engine 0.2.0 runs under protocol 2 only, engine 0.1.0 under protocol 1 only', () => {
    expect([bank.id, bank.version, moduleProtocols(bank)]).toEqual([BANK_ID, BANK_VERSION, [2]]);
    expect([bankV1.id, bankV1.version, moduleProtocols(bankV1)]).toEqual([BANK_ID, BANK_V1_VERSION, [1]]);
    expect(BANK_VERSION).toBe('0.2.0');
    expect(BANK_V1_VERSION).toBe('0.1.0');
  });
});
