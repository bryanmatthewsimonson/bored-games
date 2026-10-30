import { describe, expect, it } from 'vitest';
import { deckOf, FIELD_BASE, pilesOf, ROLES, SURGE_BASE } from '../../src/data.ts';
import {
  DEFAULT_RULES,
  legalActions,
  pendingOf,
  roleOf,
  setupGame,
  standingsOf,
  validateRules,
} from '../../src/engine.ts';
import { POPULATION, START_CITY } from '../../src/map.ts';
import { spreadThin } from '../../src/module.ts';
import { deckOrder, edit, refused, settle, started } from '../helpers.ts';

describe('setup', () => {
  it('C01 every card is public: a view is the full state without the deck order, and nothing is learned', () => {
    const s = started(3);
    const v = spreadThin.view(s, 1);
    expect(v.plain).toBeNull();
    expect({ ...s, plain: null }).toEqual(v);
    expect(spreadThin.knownTo(s, 0)).toEqual([]);
    expect(spreadThin.learn(v, { deck: 'pile', pos: 50, card: 50 }).ok).toBe(false);
    expect(spreadThin.dealt(s).every((d) => d.to === null)).toBe(true);
    expect(spreadThin.view(s, null).hands).toEqual(s.hands);
  });

  it('C02 every pawn and the first clinic start in Glenhallow; each seat gets a different role', () => {
    const s = started(4);
    expect(s.at).toEqual([START_CITY, START_CITY, START_CITY, START_CITY]);
    expect(s.clinics).toEqual([START_CITY]);
    expect(new Set(s.roles).size).toBe(4);
    expect(s.roles.every((r) => r >= 0 && r < ROLES.length)).toBe(true);
  });

  it('C03 hands of 4, 3 or 2; one pile per surge, larger on top; a pile surge may lie anywhere in it', () => {
    expect([2, 3, 4].map((n) => started(n).hands.map((h) => h.length))).toEqual([
      [4, 4],
      [3, 3, 3],
      [2, 2, 2, 2],
    ]);
    // 2 seats, 5 surges: 45 cards left, piles of 9 + a surge each.
    expect(pilesOf(DEFAULT_RULES, 2).map((p) => p.length)).toEqual([10, 10, 10, 10, 10]);
    // 3 seats, 4 surges: 44 left, 11 each; 3 seats, 6 surges: 44 = 8, 8, 7, 7, 7, 7.
    expect(pilesOf({ rulesVersion: 1, surges: 4 }, 3).map((p) => p.length - 1)).toEqual([11, 11, 11, 11]);
    expect(pilesOf({ rulesVersion: 1, surges: 6 }, 3).map((p) => p.length - 1)).toEqual([8, 8, 7, 7, 7, 7]);
    // Each pile is mixed with its surge in the second shuffle round.
    const deck = deckOf(DEFAULT_RULES, 3);
    expect(deck.secondRound?.map((g) => g.positions.at(-1))).toEqual(
      [0, 1, 2, 3, 4].map((k) => SURGE_BASE + k),
    );
    // The plan puts the first pile's surge on top: the first draw turns it up.
    const s = started(2, { surgeAt: [0] });
    expect(s.plain?.[String(s.field[0])]).toBe(SURGE_BASE);
    expect(deckOrder(2, { surgeAt: [0] })[FIELD_BASE + 8]).toBe(SURGE_BASE);
  });

  it('C04 the opening infection is 3, 3, 3, 2, 2, 2, 1, 1, 1; the most populous card goes first', () => {
    const s = started(2, { spread: [0, 13, 26, 39, 1, 14, 27, 40, 2] });
    expect([0, 13, 26, 39, 1, 14, 27, 40, 2].map((c) => Math.max(...(s.cases[c] ?? [])))).toEqual([
      3, 3, 3, 2, 2, 2, 1, 1, 1,
    ]);
    expect(s.spent.map((x) => x.city)).toEqual([0, 13, 26, 39, 1, 14, 27, 40, 2]);
    expect(s.pile).toHaveLength(39);
    // Seat 1 holds city 46, the most populous of all.
    const most = POPULATION.indexOf(Math.max(...POPULATION));
    expect(most).toBe(46);
    const t = started(2, { field: [0, 1, 2, 3, 46, 5, 6, 7] });
    expect(t.turn).toBe(1);
    expect(pendingOf(t)).toEqual({ type: 'player', seat: 1, decision: 'act' });
    // Cities 1 and 16 tie; the earlier seat goes first.
    expect(POPULATION[1]).toBe(POPULATION[16]);
    expect(started(2, { field: [16, 5, 6, 7, 1, 9, 10, 11] }).turn).toBe(0);
  });

  it('C05 roles come from the seven role cards, and each holder has its power from the start', () => {
    const s = started(3, { roles: ['virologist', 'warden', 'engineer'] });
    expect([0, 1, 2].map((seat) => roleOf(s, seat))).toEqual(['virologist', 'warden', 'engineer']);
    // The Engineer may open a clinic on turn one without a card.
    const e = edit(s, { turn: 2, at: [START_CITY, START_CITY, 0] });
    expect(legalActions(e, 2)).toContainEqual({ type: 'clinic', actor: 2, remove: null });
  });

  it('C33 one encoding per move; the rules are { rulesVersion: 1, surges }; views agree with the full state', () => {
    expect(validateRules({ rulesVersion: 1, surges: 6 }).ok).toBe(true);
    expect(validateRules({ rulesVersion: 1, surges: 7 }).ok).toBe(false);
    expect(validateRules({ rulesVersion: 1 }).ok).toBe(false);
    expect(setupGame({ rules: DEFAULT_RULES, seats: 5, mode: 'view', viewer: null }).ok).toBe(false);
    const s = started(2);
    const seat = s.turn;
    const move = legalActions(s, seat).find((a) => a.type === 'travel');
    expect(move).toBeDefined();
    refused(s, { ...move, extra: 1 });
    refused(s, { ...move, actor: 1 - seat });
    // A view set up and fed the same public actions reaches the full state's view.
    const full = setupGame({
      rules: DEFAULT_RULES,
      seats: 2,
      mode: 'full',
      deckOrders: { pile: deckOrder(2) },
    });
    const view = setupGame({ rules: DEFAULT_RULES, seats: 2, mode: 'view', viewer: 0 });
    if (!full.ok || !view.ok) throw new Error('setup failed');
    let f = full.value;
    let w = view.value;
    for (let i = 0; i < 40; i++) {
      const p = pendingOf(f);
      const action =
        p.type === 'reveal'
          ? {
              type: 'reveal',
              actor: 'deck',
              deck: 'pile',
              pos: p.positions[0],
              card: f.plain?.[String(p.positions[0])],
            }
          : legalActions(f, f.turn)[0];
      const a = spreadThin.apply(f, action);
      const b = spreadThin.apply(w, action);
      if (!a.ok || !b.ok) throw new Error('an action failed');
      f = a.state;
      w = b.state;
    }
    expect(w).toEqual(spreadThin.view(f, 0));
  });

  it('C34 standings are the cures found, the same for every seat', () => {
    const s = started(3);
    expect(standingsOf(s)).toEqual([0, 0, 0]);
    expect(standingsOf(edit(s, { cured: [true, false, true, false] }))).toEqual([2, 2, 2]);
    expect(settle(s)).toBe(s);
  });
});
