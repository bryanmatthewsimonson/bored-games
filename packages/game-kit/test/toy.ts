import type {
  ApplyResult,
  GameModule,
  Learn,
  Outcome,
  Pending,
  Result,
  Seat,
  SetupInput,
} from '../src/index.ts';

/**
 * "High Card": a minimal hidden-hand game used to test the kit without any
 * real game. 12 cards (values 0..11). One public "trump" card is revealed at
 * setup; each seat holds 2 hidden cards. On a turn, the seat plays one card
 * (revealing it) and draws the next deck position while cards remain. Score =
 * sum of played values, +5 for playing the trump's parity. Ends when hands are
 * empty.
 */
export interface ToyRules {
  readonly cards: number;
  readonly hand: number;
}

interface Slot {
  readonly pos: number;
  readonly card: number | null;
}

export interface ToyState {
  readonly mode: 'full' | 'view';
  readonly viewer: Seat | null;
  readonly rules: ToyRules;
  readonly order: readonly number[] | null;
  readonly next: number;
  /** Positions assigned so far, in order: the trump is public (null), hand cards belong to a seat. */
  readonly dealt: readonly { readonly pos: number; readonly to: Seat | null }[];
  readonly trump: { readonly pos: number; readonly card: number | null };
  readonly hands: readonly (readonly Slot[])[];
  readonly scores: readonly number[];
  readonly turn: Seat;
  readonly over: boolean;
}

export type ToyEvent = { type: 'played'; seat: Seat; card: number } | { type: 'trump'; card: number };

const err = (code: string, message: string) => ({ ok: false as const, error: { code, message } });

function knownCard(s: ToyState, pos: number): number | null {
  return s.order ? (s.order[pos] ?? null) : null;
}

export interface ToyOptions {
  /** Deliberate bugs for testing the fuzzer itself. */
  readonly bug?:
    | 'mutate'
    | 'invariant'
    | 'nondeterministic'
    | 'acceptsImpostor'
    | 'neverEnds'
    | 'badRevealsOf';
}

export function createToy(opts: ToyOptions = {}): GameModule<ToyState, ToyEvent, ToyRules> {
  let counter = 0;
  const module: GameModule<ToyState, ToyEvent, ToyRules> = {
    id: 'toy',
    version: '1.0.0',
    defaultRules: () => ({ cards: 12, hand: 2 }),
    validateRules(rules: unknown): Result<ToyRules> {
      const r = rules as ToyRules;
      if (!r || typeof r.cards !== 'number' || typeof r.hand !== 'number') return err('rules', 'bad rules');
      return { ok: true, value: r };
    },
    seatRange: () => ({ min: 2, max: 4 }),
    decks: (r) => [{ id: 'cards', size: r.cards }],
    setup(input: SetupInput<ToyRules>) {
      const full = input.mode === 'full';
      const order = full ? (input.deckOrders.cards ?? null) : null;
      let next = 1;
      const dealt: { pos: number; to: Seat | null }[] = [{ pos: 0, to: null }];
      const hands: Slot[][] = [];
      for (let s = 0; s < input.seats; s++) {
        const hand: Slot[] = [];
        for (let i = 0; i < input.rules.hand; i++) {
          hand.push({ pos: next, card: order ? (order[next] ?? null) : null });
          dealt.push({ pos: next, to: s });
          next++;
        }
        hands.push(hand);
      }
      return {
        ok: true,
        value: {
          mode: input.mode,
          viewer: full ? null : input.viewer,
          rules: input.rules,
          order,
          next,
          dealt,
          trump: { pos: 0, card: null },
          hands,
          scores: hands.map(() => 0),
          turn: 0,
          over: false,
        },
      };
    },
    pending(s): Pending {
      if (s.over) return { type: 'over' };
      if (s.trump.card === null) return { type: 'reveal', deck: 'cards', positions: [0] };
      return { type: 'player', seat: s.turn, decision: 'play' };
    },
    legalActions(s, seat) {
      if (s.over || s.trump.card === null || seat !== s.turn) return [];
      const hand = s.hands[seat] ?? [];
      if (hand.some((h) => h.card === null)) return [];
      return hand.map((h) => ({ type: 'play', actor: seat, pos: h.pos, card: h.card }));
    },
    apply(s, action: unknown): ApplyResult<ToyState, ToyEvent> {
      const a = action as Record<string, unknown>;
      if (!a || typeof a !== 'object') return err('shape', 'not an object');
      if (a.type === 'reveal') {
        if (s.trump.card !== null || a.pos !== 0 || typeof a.card !== 'number')
          return err('reveal', 'bad reveal');
        const expected = knownCard(s, 0);
        if (expected !== null && expected !== a.card) return err('reveal', 'wrong card');
        return {
          ok: true,
          state: { ...s, trump: { pos: 0, card: a.card } },
          events: [{ type: 'trump', card: a.card }],
        };
      }
      if (a.type !== 'play' || s.over || s.trump.card === null) return err('phase', 'cannot play now');
      if (a.actor !== s.turn && opts.bug !== 'acceptsImpostor') return err('actor', 'not your turn');
      const seat = s.turn;
      const hand = s.hands[seat] ?? [];
      const slot = hand.find((h) => h.pos === a.pos);
      const card = a.card;
      if (!slot || typeof card !== 'number') return err('card', 'not in hand');
      if (slot.card !== null && slot.card !== card) return err('card', 'wrong card');
      if (opts.bug === 'mutate') (s as { turn: number }).turn = s.turn;
      let next = s.next;
      let dealt = s.dealt;
      const newHand = hand.filter((h) => h.pos !== a.pos);
      if (next < s.rules.cards && opts.bug !== 'neverEnds') {
        newHand.push({ pos: next, card: knownCard(s, next) });
        dealt = [...dealt, { pos: next, to: seat }];
        next++;
      }
      const hands = s.hands.map((h, i) => (i === seat ? newHand : h));
      const bonus = card % 2 === (s.trump.card ?? 0) % 2 ? 5 : 0;
      const nondet = opts.bug === 'nondeterministic' ? counter++ : 0;
      const scores = s.scores.map((v, i) => (i === seat ? v + card + bonus + nondet : v));
      const over = opts.bug === 'neverEnds' ? false : hands.every((h) => h.length === 0);
      const turn = opts.bug === 'neverEnds' ? s.turn : (seat + 1) % hands.length;
      return {
        ok: true,
        state: {
          ...s,
          next,
          dealt,
          hands,
          scores: opts.bug === 'invariant' ? scores.map(() => -1) : scores,
          turn: over ? seat : turn,
          over,
          ...(opts.bug === 'neverEnds' ? { hands: s.hands } : {}),
        },
        events: [{ type: 'played', seat, card }],
      };
    },
    learn(s, l: Learn) {
      if (s.viewer === null || s.mode === 'full') return err('learn', 'no private view');
      const hand = s.hands[s.viewer] ?? [];
      if (!hand.some((h) => h.pos === l.pos)) return err('learn', 'not your card');
      const hands = s.hands.map((h, i) =>
        i === s.viewer ? h.map((slot) => (slot.pos === l.pos ? { pos: slot.pos, card: l.card } : slot)) : h,
      );
      return { ok: true, state: { ...s, hands }, events: [] };
    },
    knownTo(s, seat) {
      return (s.hands[seat] ?? [])
        .filter((h) => h.card !== null)
        .map((h) => ({ deck: 'cards', pos: h.pos, card: h.card as number }));
    },
    view(s, viewer) {
      return {
        ...s,
        mode: 'view',
        viewer,
        order: null,
        hands: s.hands.map((h, i) => (i === viewer ? h : h.map((slot) => ({ pos: slot.pos, card: null })))),
      };
    },
    outcome(s): Outcome | null {
      if (!s.over) return null;
      const places = s.scores.map((v) => 1 + s.scores.filter((o) => o > v).length);
      return { places, scores: s.scores, reason: 'handsEmpty' };
    },
    standings: (s) => s.scores,
    dealt: (s) => s.dealt.map((d) => ({ deck: 'cards', pos: d.pos, to: d.to })),
    revealsOf(_s, action: unknown) {
      const a = action as Record<string, unknown> | null;
      if (!a || typeof a !== 'object' || a.type !== 'play') return [];
      if (typeof a.pos !== 'number' || typeof a.card !== 'number') return [];
      const card = opts.bug === 'badRevealsOf' ? a.card + 1 : a.card;
      return [{ deck: 'cards', pos: a.pos, card }];
    },
    invariants(s) {
      return s.scores.some((v) => v < 0) ? ['negative score'] : [];
    },
    coverage(_s, events) {
      return events.filter((e) => e.type === 'played' && e.card === 11).map(() => 'playedTopCard');
    },
  };
  return module;
}
