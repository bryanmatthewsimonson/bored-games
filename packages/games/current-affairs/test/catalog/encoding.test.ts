import { describe, expect, it } from 'vitest';
import { applyAction, DEFAULT_RULES, parseAction, validateIntent, validateRules } from '../../src/engine.ts';
import { currentAffairs } from '../../src/module.ts';
import type { CurrentState } from '../../src/types.ts';
import { act, fuelled, legal, nextRound, own, sell, skipPhase, started, turnOf } from '../helpers.ts';

/** Round 1's fuel phase with three companies: seat 0 owns 3 (oil), seat 1 4 (coal), seat 2 5 (coal or oil). */
const fuelPhase = (): CurrentState => sell(sell(sell(started(3), 3), 4), 5);

describe('encoding, rules and views', () => {
  it('C26 one encoding per action; validateIntent takes any legal bid, raise, purchase or scrap; one rule set; views are whole', () => {
    // The accepted forms.
    const good = [
      { type: 'contribute', actor: 0, id: 3 },
      { type: 'rolled', actor: 'beacon', id: 3, dice: [5] },
      { type: 'open', actor: 1, station: 4, bid: 9 },
      { type: 'pass', actor: 2 },
      { type: 'bid', actor: 0, amount: 12 },
      { type: 'fold', actor: 0 },
      { type: 'scrap', actor: 0, station: 4, keep: [1, 0, 0, 0] },
      { type: 'fuel', actor: 0, buy: [0, 2, 0, 0] },
      { type: 'build', actor: 0, city: 7 },
      { type: 'done', actor: 0 },
      { type: 'power', actor: 0, stations: [3, 13], hybridCoal: 0 },
    ];
    for (const a of good) expect(parseAction(a)).toEqual(a);
    // Anything else is no action: extra or missing keys, other types, strings, fractions, negatives, -0.
    const bad: unknown[] = [
      null,
      7,
      [],
      { type: 'done' },
      { type: 'done', actor: 0, extra: 1 },
      { type: 'done', actor: '0' },
      { type: 'done', actor: -1 },
      { type: 'done', actor: 0.5 },
      { type: 'done', actor: -0 },
      { type: 'rolled', actor: 0, id: 1, dice: [1] },
      { type: 'rolled', actor: 'beacon', id: 1, dice: [] },
      { type: 'rolled', actor: 'beacon', id: 1, dice: [1.5] },
      { type: 'open', actor: 0, station: 3 },
      { type: 'open', actor: 0, station: 3, bid: '3' },
      { type: 'bid', actor: 0, bid: 5 },
      { type: 'scrap', actor: 0, station: 4, keep: [1, 0, 0] },
      { type: 'scrap', actor: 0, station: 4, keep: [1, 0, 0, -1] },
      { type: 'fuel', actor: 0, buy: [0, 1, 0, 0, 0] },
      { type: 'fuel', actor: 0, buy: { 0: 1, 1: 0, 2: 0, 3: 0, length: 4 } },
      { type: 'build', actor: 0, city: '7' },
      { type: 'power', actor: 0, stations: [13, 3], hybridCoal: 0 },
      { type: 'power', actor: 0, stations: [3, 3], hybridCoal: 0 },
      { type: 'power', actor: 0, stations: [3] },
      { type: 'learn', actor: 0 },
    ];
    for (const a of bad) expect(parseAction(a), JSON.stringify(a)).toBeNull();
    const s = fuelPhase();
    for (const a of bad) expect(applyAction(s, a).ok).toBe(false);
    // A purchase of nothing is refused.
    expect(applyAction(s, { type: 'fuel', actor: 0, buy: [0, 0, 0, 0] }).ok).toBe(false);

    // validateIntent: an opening bid above the number, any raise, any purchase that fits, any scrap that fits.
    const opening = started(3);
    expect(validateIntent(opening, 0, { type: 'open', actor: 0, station: 4, bid: 23 })).toEqual({
      ok: true,
      value: { type: 'open', actor: 0, station: 4, bid: 23 },
    });
    expect(legal(opening, 0)).not.toContainEqual({ type: 'open', actor: 0, station: 4, bid: 23 });
    expect(validateIntent(opening, 0, { type: 'open', actor: 0, station: 4, bid: 3 }).ok).toBe(false);
    expect(validateIntent(opening, 0, { type: 'open', actor: 0, station: 8, bid: 8 }).ok).toBe(false);
    expect(validateIntent(opening, 1, { type: 'open', actor: 1, station: 4, bid: 4 }).ok).toBe(false);
    expect(validateIntent(opening, 0, { type: 'open', actor: 1, station: 4, bid: 4 }).ok).toBe(false);
    const lot = act(opening, { type: 'open', actor: 0, station: 4, bid: 4 });
    expect(validateIntent(lot, 1, { type: 'bid', actor: 1, amount: 7 }).ok).toBe(true);
    expect(validateIntent(lot, 1, { type: 'bid', actor: 1, amount: 4 }).ok).toBe(false);
    expect(validateIntent(lot, 1, { type: 'bid', actor: 1, amount: 51 }).ok).toBe(false);
    // Only those four kinds: a fold, a pass, a build, a power or a done is never an intent.
    expect(validateIntent(lot, 1, { type: 'fold', actor: 1 }).ok).toBe(false);
    expect(validateIntent(s, 0, { type: 'fuel', actor: 0, buy: [0, 3, 0, 0] }).ok).toBe(true);
    expect(validateIntent(s, 0, { type: 'fuel', actor: 0, buy: [0, 5, 0, 0] }).ok).toBe(false);
    expect(validateIntent(s, 0, { type: 'done', actor: 0 }).ok).toBe(false);
    expect(validateIntent(skipPhase(s), 0, { type: 'build', actor: 0, city: 0 }).ok).toBe(false);
    // A scrap that drops more fuel than it must.
    let sc = own(nextRound(fuelPhase()), 2, [13, 19]);
    sc = fuelled(sc, 2, [2, 2, 3, 0]);
    sc = act(sc, { type: 'open', actor: turnOf(sc), station: 8, bid: 8 });
    while (sc.lot !== null) sc = act(sc, { type: 'fold', actor: sc.lot.turn });
    expect(sc.scrapping).toEqual({ seat: 2, bought: 8 });
    const drop = { type: 'scrap', actor: 2, station: 13, keep: [0, 1, 2, 0] };
    expect(legal(sc, 2)).not.toContainEqual(drop);
    expect(validateIntent(sc, 2, drop)).toEqual({ ok: true, value: drop });
    expect(validateIntent(sc, 2, { ...drop, keep: [3, 1, 2, 0] }).ok).toBe(false);
    expect(validateIntent(sc, 2, { ...drop, station: 8 }).ok).toBe(false);
    // Every listed action is accepted.
    for (const t of [opening, lot, s, sc, skipPhase(s)])
      for (let seat = 0; seat < 3; seat++)
        for (const a of legal(t, seat)) expect(applyAction(t, a).ok, JSON.stringify(a)).toBe(true);

    // One rule set.
    expect(DEFAULT_RULES).toEqual({ rulesVersion: 1 });
    expect(currentAffairs.defaultRules()).toEqual({ rulesVersion: 1 });
    expect(validateRules({ rulesVersion: 1 })).toEqual({ ok: true, value: { rulesVersion: 1 } });
    for (const r of [{}, { rulesVersion: 2 }, { rulesVersion: 1, extra: true }, null, 'v1'])
      expect(validateRules(r).ok).toBe(false);
    expect(currentAffairs.seatRange(DEFAULT_RULES)).toEqual({ min: 2, max: 6 });

    // Every view is the whole state; nothing is dealt, learnt or revealed.
    for (const t of [opening, lot, s, sc]) {
      for (const viewer of [0, 1, 2, null]) expect(currentAffairs.view(t, viewer)).toBe(t);
      expect(currentAffairs.dealt(t)).toEqual([]);
      expect(currentAffairs.knownTo(t, 0)).toEqual([]);
      expect(currentAffairs.revealsOf(t, { type: 'done', actor: 0 })).toEqual([]);
      expect(currentAffairs.learn(t, { deck: 'x', pos: 0, card: 0 }).ok).toBe(false);
    }
    expect(currentAffairs.decks(DEFAULT_RULES)).toEqual([]);
    // Rolls go through the beacon: a contribution carries the open roll's share; a player cannot send the faces.
    expect(currentAffairs.beaconOf?.(started(3), { type: 'contribute', actor: 0, id: 1 })).toBeNull();
    const rolling = act(act(lot, { type: 'fold', actor: 1 }), { type: 'fold', actor: 2 });
    expect(rolling.roll).toBeNull();
    const drawing = act(rolling, { type: 'open', actor: 1, station: 3, bid: 3 });
    const open = act(drawing, { type: 'fold', actor: 2 });
    expect(open.roll?.purpose).toBe('draw');
    expect(currentAffairs.beaconOf?.(open, { type: 'contribute', actor: 2, id: open.roll?.id })).toBe(
      open.roll?.id,
    );
    expect(currentAffairs.rollShape?.(open)).toEqual({ count: 1, sides: open.stack.pool.length });
    expect(currentAffairs.rolls?.(open)).toBe(open.rolls);
    expect(applyAction(open, { type: 'rolled', actor: 2, id: open.roll?.id, dice: [1] }).ok).toBe(false);
    expect(applyAction(open, { type: 'rolled', actor: 'beacon', id: open.roll?.id, dice: [1] }).ok).toBe(
      false,
    );
    expect(applyAction(open, { type: 'contribute', actor: 2, id: (open.roll?.id ?? 0) + 1 }).ok).toBe(false);
  });
});
