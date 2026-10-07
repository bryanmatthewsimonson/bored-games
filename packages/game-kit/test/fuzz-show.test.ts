import { describe, expect, it } from 'vitest';
import { fuzzBatch, fuzzGame, replay, SHOW_DECK } from '../src/index.ts';
import { createShowToy, type ShowToyState, showToy } from './show-toy.ts';

/*
 * Private shows in the fuzzer (D075, PROTOCOL §14). The fuzzer stands in for the session: it turns the chosen
 * marker into the wire form, learns the shown card into the full state and into the views of the shower and the
 * submitter only, and checks every view against the module's redaction, so a module that lets a third seat see a
 * shown card fails.
 */

const rules = showToy.defaultRules();

describe('private shows in the fuzzer (D075)', () => {
  it('models a private show: only the two seats learn the card', () => {
    const report = fuzzBatch(showToy, {
      seed: 'show',
      games: 30,
      seatCounts: [2, 3],
      rules,
      checkViews: true,
    });
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(30);
    expect(report.coverage['event:shown']).toBe(4 * 30);
    expect(report.coverage['end:shown']).toBe(30);
  });

  it('sends the wire form, never a marker, and logs the learn for full mode', () => {
    const game = fuzzGame(showToy, { seed: 'show-wire', seats: 3, rules });
    expect(game.failure).toBeNull();
    const shows = game.actions.filter((a) => (a as { type: string }).type === 'show');
    expect(shows).toHaveLength(4);
    for (const [id, a] of shows.entries())
      expect(a).toEqual({ type: 'show', actor: (id + 1) % 3, id, packet: 'fuzz-only' });
    // The public actions alone leave every shown card unknown, even in full mode: the learn is not in them.
    const order = [0, 1, 2, 3, 4, 5];
    const rep = replay(
      showToy,
      { rules, seats: 3, mode: 'full', deckOrders: { cards: order } },
      game.actions.map((action) => ({ kind: 'action' as const, action })),
    );
    expect(rep.ok && (rep.state as ShowToyState).shows.map((x) => x.card)).toEqual([null, null, null, null]);
    expect(SHOW_DECK).toBe('shown');
  });

  it('fails a module that leaks a shown card to a third seat', () => {
    for (const seats of [2, 3]) {
      const leaky = createShowToy({ bug: 'leakView' });
      const report = fuzzBatch(leaky, {
        seed: 'leak',
        games: 5,
        seatCounts: [seats],
        rules,
        checkViews: true,
      });
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0]?.message).toMatch(/^view mismatch for viewer (seat 2|spectator)$/);
    }
  });

  it('fails a module that offers a marker for a position the shower does not hold', () => {
    const report = fuzzBatch(createShowToy({ bug: 'foreignMarker' }), {
      seed: 'foreign',
      games: 5,
      seatCounts: [3],
      rules,
    });
    expect(report.failures[0]?.message).toBe('show marker for cards:0, which is dealt to seat 0');
  });
});
