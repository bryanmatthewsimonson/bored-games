import type { ApplyResult, Learn, Pending, Result, SetupInput } from '@bored-games/game-kit';
import { DECK_SIZES, type DeckId, PATRONS, TIER_DECKS, type TierDeck, workshop } from './data.ts';
import type { CardSlot, LusterAction, LusterEvent, LusterPlayer, LusterRules, LusterState } from './types.ts';

export const DEFAULT_RULES: LusterRules = { target: 15 };
const failure = (message: string) => ({ ok: false as const, error: { code: 'invalid', message } });
const zero = () => [0, 0, 0, 0, 0, 0];
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const int = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && !Object.is(x, -0);
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, ks: string[]) =>
  Object.keys(x).sort().join(',') === ks.sort().join(',');
const vector = (x: unknown): x is number[] =>
  Array.isArray(x) && x.length === 6 && Object.keys(x).length === 6 && Array.from(x).every(int);
const tier = (x: unknown): x is TierDeck => TIER_DECKS.includes(x as TierDeck);
const deckId = (x: unknown): x is DeckId => tier(x) || x === 'patrons';

export function validateRules(raw: unknown): Result<LusterRules> {
  try {
    return obj(raw) && keys(raw, ['target']) && raw.target === 15
      ? { ok: true, value: DEFAULT_RULES }
      : failure('The base game uses a target of 15.');
  } catch {
    return failure('Invalid rules.');
  }
}
export function parseAction(raw: unknown): LusterAction | null {
  try {
    if (!obj(raw) || typeof raw.type !== 'string') return null;
    if (raw.type === 'reveal')
      return keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) &&
        raw.actor === 'deck' &&
        deckId(raw.deck) &&
        int(raw.pos) &&
        int(raw.card)
        ? (raw as unknown as LusterAction)
        : null;
    if (!int(raw.actor)) return null;
    switch (raw.type) {
      case 'take':
      case 'return':
        return keys(raw, ['type', 'actor', 'tokens']) && vector(raw.tokens)
          ? (raw as unknown as LusterAction)
          : null;
      case 'reserve':
        return keys(raw, ['type', 'actor', 'deck', 'pos']) && tier(raw.deck) && int(raw.pos)
          ? (raw as unknown as LusterAction)
          : null;
      case 'buy':
        return keys(raw, ['type', 'actor', 'deck', 'pos', 'card', 'pay']) &&
          tier(raw.deck) &&
          int(raw.pos) &&
          int(raw.card) &&
          vector(raw.pay)
          ? (raw as unknown as LusterAction)
          : null;
      case 'patron':
        return keys(raw, ['type', 'actor', 'card']) && int(raw.card)
          ? (raw as unknown as LusterAction)
          : null;
      case 'pass':
        return keys(raw, ['type', 'actor']) ? (raw as unknown as LusterAction) : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
export function bonuses(p: LusterPlayer): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const h of p.bought) {
    const c = h.card === null ? undefined : workshop(h.deck, h.card);
    if (c) out[c.bonus] = (out[c.bonus] ?? 0) + 1;
  }
  return out;
}
export function score(p: LusterPlayer): number {
  return (
    p.patrons.length * 3 +
    p.bought.reduce((n, h) => n + (h.card === null ? 0 : (workshop(h.deck, h.card)?.points ?? 0)), 0)
  );
}
export function eligiblePatrons(s: LusterState): number[] {
  const bs = bonuses(s.players[s.turn] as LusterPlayer);
  return s.patrons.flatMap((p) =>
    p.card !== null && PATRONS[p.card]?.every((n, i) => n <= (bs[i] ?? 0)) ? [p.card] : [],
  );
}
/** All exact payments, including voluntary substitution of prism for colored light. */
export function payments(p: LusterPlayer, deck: TierDeck, card: number): number[][] {
  const c = workshop(deck, card);
  if (!c) return [];
  const bs = bonuses(p);
  const due = c.cost.map((n, i) => Math.max(0, n - (bs[i] ?? 0)));
  const out: number[][] = [];
  function visit(i: number, pay: number[], wild: number): void {
    if (wild > (p.tokens[5] ?? 0)) return;
    if (i === 5) {
      out.push([...pay, wild]);
      return;
    }
    for (let n = Math.min(due[i] ?? 0, p.tokens[i] ?? 0); n >= 0; n--)
      visit(i + 1, [...pay, n], wild + (due[i] ?? 0) - n);
  }
  visit(0, [], 0);
  return out;
}
/** Integer vectors constrained by holdings and an exact total. */
function selections(limits: readonly number[], total: number): number[][] {
  const out: number[][] = [];
  function visit(i: number, left: number, xs: number[]): void {
    if (i === 6) {
      if (left === 0) out.push(xs);
      return;
    }
    for (let n = 0; n <= Math.min(limits[i] ?? 0, left); n++) visit(i + 1, left - n, [...xs, n]);
  }
  visit(0, total, []);
  return out;
}
export function setupGame(input: SetupInput<LusterRules>): Result<LusterState> {
  try {
    const rules = validateRules(input.rules);
    if (!rules.ok) return rules;
    if (!int(input.seats) || input.seats < 2 || input.seats > 4) return failure('Choose 2–4 players.');
    if (input.mode !== 'full' && input.mode !== 'view') return failure('Invalid mode.');
    if (input.mode === 'view' && input.viewer !== null && (!int(input.viewer) || input.viewer >= input.seats))
      return failure('Invalid viewer.');
    const decks = {} as Record<DeckId, { order: readonly number[] | null; next: number }>;
    for (const id of [...TIER_DECKS, 'patrons'] as DeckId[]) {
      const order = input.mode === 'full' ? input.deckOrders[id] : null;
      if (
        input.mode === 'full' &&
        (!Array.isArray(order) ||
          order.length !== DECK_SIZES[id] ||
          new Set(order).size !== order.length ||
          !Array.from(order).every((n) => int(n) && n < DECK_SIZES[id]))
      )
        return failure(`Invalid ${id} order.`);
      decks[id] = { order: order ? [...order] : null, next: id === 'patrons' ? input.seats + 1 : 4 };
    }
    const dealt = TIER_DECKS.flatMap((deck) =>
      Array.from({ length: 4 }, (_, pos) => ({ deck, pos, to: null })),
    );
    const patrons = Array.from({ length: input.seats + 1 }, (_, pos) => ({ pos, card: null }));
    return {
      ok: true,
      value: {
        game: 'luster',
        rules: rules.value,
        seats: input.seats,
        mode: input.mode,
        viewer: input.mode === 'view' ? input.viewer : null,
        decks,
        dealt: [...dealt, ...patrons.map((p) => ({ deck: 'patrons', pos: p.pos, to: null }))],
        market: TIER_DECKS.map((deck) =>
          Array.from({ length: 4 }, (_, pos) => ({ deck, pos, card: null, private: false })),
        ),
        patrons,
        players: Array.from({ length: input.seats }, () => ({
          tokens: zero(),
          bought: [],
          reserved: [],
          patrons: [],
        })),
        supply: [0, 1, 2, 3, 4].map(() => (input.seats === 2 ? 4 : input.seats === 3 ? 5 : 7)).concat(5),
        startingSeat: null,
        turn: 0,
        round: 1,
        phase: 'turn',
        finalRound: false,
        result: null,
        seq: 0,
      },
    };
  } catch {
    return failure('Invalid setup.');
  }
}
export function pendingOf(s: LusterState): Pending {
  for (const deck of TIER_DECKS) {
    const positions =
      s.market[TIER_DECKS.indexOf(deck)]?.flatMap((h) => (h !== null && h.card === null ? [h.pos] : [])) ??
      [];
    if (positions.length) return { type: 'reveal', deck, positions };
  }
  const positions = s.patrons.filter((p) => p.card === null).map((p) => p.pos);
  if (positions.length) return { type: 'reveal', deck: 'patrons', positions };
  return s.phase === 'over' ? { type: 'over' } : { type: 'player', seat: s.turn, decision: s.phase };
}
export function legalActions(s: LusterState, actor: number, publicValidation = false): LusterAction[] {
  const pending = pendingOf(s);
  if (pending.type !== 'player' || pending.seat !== actor) return [];
  const p = s.players[actor] as LusterPlayer;
  if (s.phase === 'return')
    return selections(p.tokens, sum(p.tokens) - 10).map((tokens) => ({ type: 'return', actor, tokens }));
  if (s.phase === 'patron') return eligiblePatrons(s).map((card) => ({ type: 'patron', actor, card }));
  if (!publicValidation && p.reserved.some((h) => h.card === null)) return [];
  const out: LusterAction[] = [];
  const available = s.supply
    .slice(0, 5)
    .map((n) => (n > 0 ? 1 : 0))
    .concat(0);
  // Taking fewer different colors is legal; never take a prism this way.
  for (let n = 1; n <= 3; n++)
    for (const tokens of selections(available, n)) out.push({ type: 'take', actor, tokens });
  for (let i = 0; i < 5; i++)
    if ((s.supply[i] ?? 0) >= 4) {
      const tokens = zero();
      tokens[i] = 2;
      out.push({ type: 'take', actor, tokens });
    }
  for (const h of [...s.market.flat().filter((h): h is CardSlot => h !== null), ...p.reserved]) {
    if (h.card !== null)
      for (const pay of payments(p, h.deck, h.card))
        out.push({ type: 'buy', actor, deck: h.deck, pos: h.pos, card: h.card, pay });
  }
  if (p.reserved.length < 3)
    for (const deck of TIER_DECKS) {
      for (const h of s.market[TIER_DECKS.indexOf(deck)] ?? [])
        if (h !== null) out.push({ type: 'reserve', actor, deck, pos: h.pos });
      if (s.decks[deck].next < DECK_SIZES[deck])
        out.push({ type: 'reserve', actor, deck, pos: s.decks[deck].next });
    }
  // No voluntary pass. This only covers an exhausted supply with no other move.
  return out.length ? out : [{ type: 'pass', actor }];
}
/** Use the fixed setup order, never reveal arrival order. Reject the uneven tail for three seats. */
function chooseStartingSeat(s: LusterState): LusterState {
  if (s.startingSeat !== null) return s;
  const limit = DECK_SIZES['tier-1'] - (DECK_SIZES['tier-1'] % s.seats);
  for (const h of s.market[0] ?? []) {
    if (h?.card === null || h === null) return s;
    if (h.card < limit) {
      const startingSeat = h.card % s.seats;
      return { ...s, startingSeat, turn: startingSeat };
    }
  }
  return s;
}
function finish(s: LusterState): LusterState {
  const finalRound = s.finalRound || s.players.some((p) => score(p) >= 15);
  const nextTurn = (s.turn + 1) % s.seats;
  const roundComplete = nextTurn === s.startingSeat;
  if (finalRound && roundComplete) {
    const scores = s.players.map(score);
    const places = s.players.map(
      (p, i) =>
        1 +
        s.players.filter(
          (q, j) =>
            (scores[j] ?? 0) > (scores[i] ?? 0) ||
            (scores[j] === scores[i] && q.bought.length < p.bought.length),
        ).length,
    );
    return { ...s, phase: 'over', finalRound, result: { scores, places, reason: 'radiance' } };
  }
  return {
    ...s,
    phase: 'turn',
    finalRound,
    turn: nextTurn,
    round: s.round + (roundComplete ? 1 : 0),
  };
}
function afterMain(s: LusterState): LusterState {
  if (sum((s.players[s.turn] as LusterPlayer).tokens) > 10) return { ...s, phase: 'return' };
  return afterReturn(s);
}
function afterReturn(s: LusterState): LusterState {
  const eligible = eligiblePatrons(s);
  if (eligible.length > 1) return { ...s, phase: 'patron' };
  if (eligible.length === 1) return finish(awardPatron(s, eligible[0] as number));
  return finish(s);
}
function awardPatron(s: LusterState, card: number): LusterState {
  return {
    ...s,
    patrons: s.patrons.filter((p) => p.card !== card),
    players: s.players.map((p, i) => (i === s.turn ? { ...p, patrons: [...p.patrons, card] } : p)),
  };
}
function refill(s: LusterState, deck: TierDeck, pos: number): LusterState {
  const d = s.decks[deck];
  const next = d.next;
  const h: CardSlot | null = next < DECK_SIZES[deck] ? { deck, pos: next, card: null, private: false } : null;
  return {
    ...s,
    market: s.market.map((row, i) =>
      i === TIER_DECKS.indexOf(deck) ? row.map((x) => (x?.pos === pos ? h : x)) : row,
    ),
    decks: h === null ? s.decks : { ...s.decks, [deck]: { ...d, next: next + 1 } },
    dealt: h === null ? s.dealt : [...s.dealt, { deck, pos: next, to: null }],
  };
}
export function applyAction(s: LusterState, raw: unknown): ApplyResult<LusterState, LusterEvent> {
  try {
    const a = parseAction(raw);
    if (a === null) return failure('Malformed action.');
    const pending = pendingOf(s);
    let next = s;
    if (a.type === 'reveal') {
      if (
        pending.type !== 'reveal' ||
        pending.deck !== a.deck ||
        !pending.positions.includes(a.pos) ||
        a.card >= DECK_SIZES[a.deck]
      )
        return failure('Unexpected public reveal.');
      const order = s.decks[a.deck].order;
      if (order !== null && order[a.pos] !== a.card)
        return failure('Reveal does not match the shuffled deck.');
      if (a.deck === 'patrons') {
        if (s.patrons.some((p) => p.card === a.card)) return failure('Duplicate patron.');
        next = { ...s, patrons: s.patrons.map((p) => (p.pos === a.pos ? { ...p, card: a.card } : p)) };
      } else {
        if (
          [...s.market.flat(), ...s.players.flatMap((p) => [...p.bought, ...p.reserved])].some(
            (h) => h?.deck === a.deck && h.card === a.card,
          )
        )
          return failure('Duplicate workshop.');
        next = {
          ...s,
          market: s.market.map((row) =>
            row.map((h) => (h?.deck === a.deck && h.pos === a.pos ? { ...h, card: a.card } : h)),
          ),
        };
      }
    } else {
      if (pending.type !== 'player' || pending.seat !== a.actor) return failure('It is not your decision.');
      const p = s.players[a.actor] as LusterPlayer;
      // Purchases validate claimed hidden identities directly so every spectator can fold them.
      if (a.type === 'buy') {
        if (s.phase !== 'turn') return failure('Complete the current decision first.');
        const h = [...s.market.flat(), ...p.reserved].find((h) => h?.deck === a.deck && h.pos === a.pos);
        if (
          !h ||
          !workshop(a.deck, a.card) ||
          (h.card !== null && h.card !== a.card) ||
          (s.decks[a.deck].order !== null && s.decks[a.deck].order?.[a.pos] !== a.card)
        )
          return failure('Invalid workshop identity.');
        if (!payments(p, a.deck, a.card).some((pay) => pay.every((n, i) => n === a.pay[i])))
          return failure('Invalid payment.');
        if (s.players.some((q) => q.bought.some((x) => x.deck === a.deck && x.card === a.card)))
          return failure('Duplicate workshop.');
        const reserved = p.reserved.some((x) => x.deck === a.deck && x.pos === a.pos);
        next = {
          ...s,
          supply: s.supply.map((n, i) => n + (a.pay[i] ?? 0)),
          players: s.players.map((q, i) =>
            i === a.actor
              ? {
                  ...q,
                  tokens: q.tokens.map((n, j) => n - (a.pay[j] ?? 0)),
                  bought: [...q.bought, { ...h, card: a.card }],
                  reserved: q.reserved.filter((x) => x.deck !== a.deck || x.pos !== a.pos),
                }
              : q,
          ),
        };
        if (!reserved) next = refill(next, a.deck, a.pos);
        next = afterMain(next);
      } else {
        // Unknown private cards must not prevent validating public moves in opponents' views.
        // In a view, a pass cannot yet check unknown reservations; full audit checks them.
        const legal = legalActions(s, a.actor, true);
        // Canonical object key order is irrelevant to a parsed action.
        const normalized =
          a.type === 'take' || a.type === 'return'
            ? { type: a.type, actor: a.actor, tokens: a.tokens }
            : a.type === 'reserve'
              ? { type: a.type, actor: a.actor, deck: a.deck, pos: a.pos }
              : a.type === 'patron'
                ? { type: a.type, actor: a.actor, card: a.card }
                : { type: a.type, actor: a.actor };
        if (!legal.some((b) => JSON.stringify(b) === JSON.stringify(normalized)))
          return failure('Illegal action.');
        if (a.type === 'take' || a.type === 'return') {
          const sign = a.type === 'take' ? 1 : -1;
          next = {
            ...s,
            supply: s.supply.map((n, i) => n - sign * (a.tokens[i] ?? 0)),
            players: s.players.map((q, i) =>
              i === a.actor ? { ...q, tokens: q.tokens.map((n, j) => n + sign * (a.tokens[j] ?? 0)) } : q,
            ),
          };
          next = a.type === 'take' ? afterMain(next) : afterReturn(next);
        } else if (a.type === 'reserve') {
          const market = s.market.flat().find((h) => h?.deck === a.deck && h.pos === a.pos);
          const d = s.decks[a.deck];
          const h: CardSlot = market ?? {
            deck: a.deck,
            pos: a.pos,
            card: s.mode === 'full' || s.viewer === a.actor ? (d.order?.[a.pos] ?? null) : null,
            private: true,
          };
          const prism = (s.supply[5] ?? 0) > 0 ? 1 : 0;
          next = {
            ...s,
            supply: s.supply.map((n, i) => (i === 5 ? n - prism : n)),
            players: s.players.map((q, i) =>
              i === a.actor
                ? {
                    ...q,
                    reserved: [...q.reserved, h],
                    tokens: q.tokens.map((n, j) => (j === 5 ? n + prism : n)),
                  }
                : q,
            ),
          };
          if (market) next = refill(next, a.deck, a.pos);
          else
            next = {
              ...next,
              decks: { ...next.decks, [a.deck]: { ...d, next: d.next + 1 } },
              dealt: [...next.dealt, { deck: a.deck, pos: a.pos, to: a.actor }],
            };
          next = afterMain(next);
        } else if (a.type === 'patron') next = finish(awardPatron(s, a.card));
        else next = afterMain(s);
      }
    }
    next = chooseStartingSeat(next);
    return { ok: true, state: { ...next, seq: s.seq + 1 }, events: [{ type: 'acted', action: a }] };
  } catch {
    return failure('Invalid action.');
  }
}
export function learnCard(s: LusterState, l: Learn): ApplyResult<LusterState, LusterEvent> {
  try {
    if (
      s.mode !== 'view' ||
      s.viewer === null ||
      !tier(l.deck) ||
      !int(l.pos) ||
      !int(l.card) ||
      l.card >= DECK_SIZES[l.deck]
    )
      return failure('Invalid private card.');
    const p = s.players[s.viewer] as LusterPlayer;
    const h = p.reserved.find((h) => h.private && h.deck === l.deck && h.pos === l.pos);
    if (!h || (h.card !== null && h.card !== l.card))
      return failure('Card is not privately assigned to this viewer.');
    return {
      ok: true,
      state: {
        ...s,
        players: s.players.map((q, i) =>
          i === s.viewer
            ? { ...q, reserved: q.reserved.map((x) => (x === h ? { ...x, card: l.card } : x)) }
            : q,
        ),
      },
      events: [],
    };
  } catch {
    return failure('Invalid private card.');
  }
}
