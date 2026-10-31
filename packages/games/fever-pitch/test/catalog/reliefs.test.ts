import { describe, expect, it } from 'vitest';
import { reliefCard } from '../../src/data.ts';
import { legalActions, pendingOf } from '../../src/engine.ts';
import { act, clean, edit, endTurn, run, started, withHand } from '../helpers.ts';

const quiet = (plan = {}) => clean(started(2, { roles: ['archivist', 'courier'], ...plan }));
const MEDEVAC = reliefCard('medevac');
const WARNING = reliefCard('warning');
const PERMIT = reliefCard('permit');
const LULL = reliefCard('lull');
const HERD = reliefCard('immunity');

describe('relief cards', () => {
  it('C22 Medevac, Early Warning, Field Permit, Lull and Herd Immunity', () => {
    // Medevac moves any pawn anywhere, for no action.
    let s = withHand(quiet(), 0, [MEDEVAC, PERMIT, WARNING]);
    s = act(s, { type: 'medevac', actor: 0, pawn: 1, to: 30 });
    expect(s.at[1]).toBe(30);
    expect(s.actions).toBe(4);
    expect(s.discard).toEqual([MEDEVAC]);
    // Field Permit opens a clinic anywhere, without a card.
    s = act(s, { type: 'permit', actor: 0, city: 40, remove: null });
    expect(s.clinics).toEqual([4, 40]);
    // Early Warning turns up the top six spread cards; its player puts them back in any order.
    s = act(s, { type: 'warning', actor: 0 });
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'arrange' });
    expect(s.pile.slice(0, 6).map((x) => x.city)).toEqual([9, 10, 11, 12, 13, 14]);
    expect(legalActions(s, 0)).toHaveLength(720);
    s = act(s, { type: 'arrange', actor: 0, order: [14, 13, 12, 11, 10, 9] });
    const r = endTurn(s);
    expect(r.events.filter((e) => e.type === 'infect').map((e) => (e as { city: number }).city)).toEqual([
      14, 13,
    ]);
    // Lull skips the next spread step.
    const l = endTurn(act(withHand(quiet(), 0, [LULL]), { type: 'lull', actor: 0 }));
    expect(l.events.filter((e) => e.type === 'infect')).toHaveLength(0);
    expect(l.events.map((e) => e.type)).toContain('quiet');
    expect(l.state.quiet).toBe(false);
    // Herd Immunity takes a spent card out of the game.
    const h = act(withHand(quiet(), 0, [HERD]), { type: 'immunity', actor: 0, city: 3 });
    expect(h.purged).toEqual([3]);
    expect(h.spent.map((x) => x.city)).not.toContain(3);
  });

  it('C23 windows before the spread, between two surges and (Herd Immunity) before a restack', () => {
    // Seat 1 holds Lull: the window before the spread asks it.
    let s = withHand(quiet(), 1, [LULL]);
    s = act(s, { type: 'end', actor: 0 });
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 1, decision: 'relief' });
    expect(legalActions(s, 1)).toEqual([
      { type: 'lull', actor: 1 },
      { type: 'pass', actor: 1 },
    ]);
    const played = run(s, { type: 'lull', actor: 1 });
    expect(played.events.filter((e) => e.type === 'infect')).toHaveLength(0);
    expect(played.state.turn).toBe(1);
    // Nobody holds a relief: no window, the spread runs at once.
    expect(pendingOf(act(quiet(), { type: 'end', actor: 0 })).type).toBe('player');
    // A surge: Herd Immunity, and only it, may be played between the strike and the restack.
    let h = withHand(quiet({ surgeAt: [0] }), 1, [HERD, LULL]);
    h = act(h, { type: 'end', actor: 0 });
    expect(pendingOf(h)).toEqual({ type: 'player', seat: 1, decision: 'relief' });
    expect(h.history.at(-1)?.kind).toBe('strike');
    const opts = legalActions(h, 1);
    expect(opts.every((a) => a.type === 'immunity' || a.type === 'pass')).toBe(true);
    h = act(h, { type: 'immunity', actor: 1, city: 47 });
    expect(h.purged).toEqual([47]);
    // The restack left 47 out; then the window before the spread asks seat 1 again, for Lull.
    expect(h.pile.length + h.spent.length).toBe(47);
    expect(pendingOf(h)).toEqual({ type: 'player', seat: 1, decision: 'relief' });
    // Between two surges any relief may be played.
    const base = edit(quiet({ surgeAt: [0, 0] }), {});
    const firsts = [
      base.field.find((p) => base.plain?.[String(p)] === 101),
      base.field.find((p) => base.plain?.[String(p)] === 102),
    ];
    let two = withHand(
      edit(base, { field: [...(firsts as number[]), ...base.field.filter((p) => !firsts.includes(p))] }),
      1,
      [LULL],
    );
    two = act(two, { type: 'end', actor: 0 });
    expect(two.history.filter((x) => x.kind === 'restack')).toHaveLength(1);
    expect(pendingOf(two)).toEqual({ type: 'player', seat: 1, decision: 'relief' });
    expect(legalActions(two, 1)).toContainEqual({ type: 'lull', actor: 1 });
  });
});
