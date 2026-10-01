import { type ChainReactionState, chainReaction } from '@bored-games/chain-reaction';
import { type Ciphertext, cardTable, initialDeck } from '@bored-games/deck';
import { createRng, type Outcome, range, shuffle } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { type AuditInput, auditGame, type LoggedAction, rankWithForfeits } from '../src/audit.ts';

describe('rankWithForfeits (D030 R5)', () => {
  it('ranks by score, descending, with ties sharing a place', () => {
    expect(rankWithForfeits([100, 300, 300, 50], [], null)).toEqual({
      places: [3, 1, 1, 4],
      reason: 'forfeit',
      scores: [100, 300, 300, 50],
    });
  });

  it('puts forfeiting seats in a shared last place and ranks the others by standings', () => {
    expect(rankWithForfeits([500, 300, 300, 900], [0, 3], null).places).toEqual([3, 1, 1, 3]);
    // The scores are reported as given, even a forfeiter's high one.
    expect(rankWithForfeits([500, 300, 300, 900], [0, 3], null).scores).toEqual([500, 300, 300, 900]);
  });

  it('ranks the one seat left first when all the others forfeit, and everyone shares a place if all do', () => {
    expect(rankWithForfeits([1, 2, 3, 4], [1, 2, 3], null).places).toEqual([1, 2, 2, 2]);
    expect(rankWithForfeits([1, 2, 3], [0, 1, 2], null).places).toEqual([1, 1, 1]);
  });

  it('at the end, keeps the declared order among the others, ties included, and moves forfeiters last', () => {
    // Declared: seat 0 first, seats 1 and 2 tied second, seat 3 fourth. Seat 0 failed the audit.
    expect(rankWithForfeits([9000, 7000, 7000, 100], [0], [1, 2, 2, 4]).places).toEqual([4, 1, 1, 3]);
    // The declared order wins over the scores (the module's tie-breaks are kept).
    expect(rankWithForfeits([500, 500, 400], [2], [2, 1, 3]).places).toEqual([2, 1, 3]);
    expect(rankWithForfeits([500, 500, 400], [], [2, 1, 3]).places).toEqual([2, 1, 3]);
  });

  it('ignores entries that are not seats, and repeats', () => {
    expect(rankWithForfeits([3, 2, 1], [1, 1, 7, -1], null).places).toEqual([1, 3, 2]);
  });
});

/**
 * A full-mode game with a known deck order, and an unencrypted final deck `(O, M)`: with every `a` the identity,
 * `decryptWithSecrets` gives back `M` for any secrets, so the audit sees exactly that order.
 */
function playedGame(seed: string): { input: AuditInput; final: ChainReactionState } {
  const rng = createRng(seed);
  const order = shuffle(range(108), rng);
  const plain = initialDeck('tiles', 108);
  const deck: Ciphertext[] = order.map((card) => plain[card] as Ciphertext);
  const init = chainReaction.setup({
    rules: chainReaction.defaultRules(),
    seats: 3,
    mode: 'full',
    deckOrders: { tiles: order },
  });
  if (!init.ok) throw new Error(init.error.message);
  let state = init.value;
  const log: LoggedAction[] = [];
  for (let seq = 1; ; seq++) {
    const p = chainReaction.pending(state);
    if (p.type === 'over') break;
    let entry: LoggedAction;
    if (p.type === 'reveal') {
      const pos = p.positions[0] as number;
      entry = {
        actor: 'deck',
        action: { type: 'reveal', actor: 'deck', deck: 'tiles', pos, card: order[pos] },
        seq,
      };
    } else {
      const legal = chainReaction.legalActions(state, p.seat) as { declareEnd?: boolean }[];
      const declare = legal.find((a) => a.declareEnd === true);
      entry = { actor: p.seat, action: declare ?? rng.pick(legal), seq };
    }
    const r = chainReaction.apply(state, entry.action);
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
    log.push(entry);
  }
  const input: AuditInput = {
    // biome-ignore lint/suspicious/noExplicitAny: the audit takes a module of any game type.
    module: chainReaction as any,
    rules: chainReaction.defaultRules(),
    seats: 3,
    deckId: 'tiles',
    deck,
    secrets: [1n, 2n, 3n],
    cards: cardTable('tiles', 108),
    log,
    outcome: chainReaction.outcome(state),
  };
  return { input, final: state };
}

describe('auditGame (D030 R6)', () => {
  const { input } = playedGame('client-audit');

  it('passes an honest log with the declared outcome', () => {
    expect(input.log.length).toBeGreaterThan(20);
    expect(auditGame(input)).toBe('pass');
  });

  it('fails every seat when the declared outcome differs from the replay', () => {
    const declared = input.outcome as Outcome;
    const outcome = { ...declared, scores: declared.scores.map((s, k) => (k === 0 ? s + 100 : s)) };
    expect(auditGame({ ...input, outcome })).toEqual({ fail: [0, 1, 2], reason: 'outcome mismatch' });
  });

  it('fails the actor of the first action the full engine rejects: a skipPlace while holding a playable tile', () => {
    const i = input.log.findIndex((e) => (e.action as { type: string }).type === 'place');
    const entry = input.log[i] as LoggedAction;
    const log = input.log.map((e, n) =>
      n === i ? { ...e, action: { type: 'skipPlace', actor: entry.actor } } : e,
    );
    const r = auditGame({ ...input, log });
    expect(r).toEqual({
      fail: [entry.actor],
      reason: `move ${entry.seq} by seat ${String(entry.actor)} fails: playable: you hold a playable tile`,
    });
  });

  it('fails every seat when a derived reveal does not match the deck', () => {
    const i = input.log.findIndex((e) => e.actor === 'deck');
    const log = input.log.map((e, n) =>
      n === i
        ? { ...e, action: { ...(e.action as object), card: 107 - (e.action as { card: number }).card } }
        : e,
    );
    const r = auditGame({ ...input, log });
    expect(typeof r === 'object' && r.fail).toEqual([0, 1, 2]);
  });
});
