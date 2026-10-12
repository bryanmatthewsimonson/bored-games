import { describe, expect, it } from 'vitest';
import { applyAction, DEFAULT_RULES, pendingOf, validateRules } from '../../src/engine.ts';
import { sticksAndStones } from '../../src/module.ts';
import { outcomeOf, tally } from '../../src/scoring.ts';
import type { Clan } from '../../src/types.ts';
import { viewOf } from '../../src/view.ts';
import { act, huntRound, orderWith, placeAll, started, withClan } from '../helpers.ts';

const clan = (over: Partial<Clan>): Clan => ({ ...(started(2).clans[0] as Clan), ...over });

describe('the end of the game', () => {
  it('C27 culture: the different symbols, squared; the duplicates are a second set, squared or one each', () => {
    const c = clan({ cards: [0, 2, 4, 6, 8, 10, 12, 14, 1, 3] });
    expect(tally(c, DEFAULT_RULES, false).culture).toBe(64 + 4);
    expect(tally(c, { duplicates: 'ones' }, false).culture).toBe(64 + 2);
    expect(tally(clan({ cards: [5, 7, 15] }), DEFAULT_RULES, false).culture).toBe(9);
  });

  it('C28 figures multiply harvest, tool value, monuments and people; goods score one each; ties go to the larger clan', () => {
    const c = clan({
      field: 5,
      tools: [2, 2, 1],
      used: [false, false, false],
      spares: [4],
      monuments: [0, 1, 2],
      people: 7,
      cards: [16, 19, 21, 30, 34],
      goods: [1, 2, 0, 3],
      food: 9,
      score: 40,
    });
    const t = tally(c, DEFAULT_RULES, false);
    expect(t.figures).toEqual([15, 5, 9, 14]);
    expect(t.goods).toBe(6);
    expect(t.total).toBe(40 + 15 + 5 + 9 + 14 + 6);
    const s = started(3);
    const even = {
      ...s,
      clans: [clan({ score: 10, field: 2 }), clan({ score: 10, field: 1 }), clan({ score: 10, field: 2 })],
    };
    expect(outcomeOf(even, 'pile').places).toEqual([1, 3, 1]);
  });

  it('C29 face-down cards are turned up before the count; until then the standings leave them out', () => {
    let s = withClan(
      placeAll(started(2, orderWith([24, 0])), [
        [0, 'card1'],
        [1, 'hunt', 5],
        [0, 'hunt', 4],
      ]),
      0,
      (c) => ({ ...c, goods: [2, 0, 0, 0] }),
    );
    s = act(s, { type: 'buy', actor: 0, slot: 1, pay: [2, 0, 0, 0] });
    expect(s.clans[0]?.hidden).toEqual([{ pos: 4, card: 3, open: false }]);
    s = huntRound({ ...s, next: 36 });
    expect(s.stage).toBe('ending');
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: 'camp', positions: [4] });
    expect(sticksAndStones.handsReveal?.(s)).toBe(true);
    expect(sticksAndStones.standings(s)[0]).toBe(1);
    expect(sticksAndStones.standings(viewOf(s, 0))).toEqual(sticksAndStones.standings(viewOf(s, 1)));
    s = act(s, { type: 'reveal', actor: 'deck', deck: 'camp', pos: 4, card: 3 });
    expect(s.stage).toBe('over');
    expect(s.dealt.at(-1)).toEqual({ deck: 'camp', pos: 4, to: null });
    expect(s.result?.scores[0]).toBe(4);
    expect(sticksAndStones.standings(s)).toEqual(s.result?.scores);
  });

  it('C30 every move has one encoding; the rules are exact; a view hides the deck and others’ face-down cards', () => {
    const s = started(2);
    const bad: unknown[] = [
      { type: 'place', actor: 0, spot: 'hunt', count: '1' },
      { type: 'place', actor: 0, spot: 'hunt', count: 1, extra: 1 },
      { type: 'place', actor: 0, spot: 'Hunt', count: 1 },
      { type: 'place', actor: -0, spot: 'hunt', count: 1 },
      { type: 'place', actor: 0, spot: 'hunt', count: 1.5 },
      { type: 'tools', actor: 0, tools: [1, 0], spares: [] },
      { type: 'buy', actor: 0, slot: 0, pay: [1, 0, 0] },
      { type: 'feed', actor: 0 },
      { type: 'rolled', actor: 0, id: 0, dice: [1] },
      { type: 'rolled', actor: 'beacon', id: 0, dice: [7] },
      null,
      'place',
    ];
    for (const a of bad) expect(applyAction(s, a).ok).toBe(false);
    expect(applyAction(s, { type: 'place', actor: 0, spot: 'hunt', count: 1 }).ok).toBe(true);
    expect(validateRules({ duplicates: 'ones' }).ok).toBe(true);
    expect(validateRules({ duplicates: 'squared', x: 1 }).ok).toBe(false);
    expect(validateRules({}).ok).toBe(false);
    const v = viewOf(s, 1);
    expect(v.order).toBeNull();
    expect(v.full).toBe(false);
  });
});
