import {
  type ApplyResult,
  type DealtPosition,
  type GameModule,
  type Learn,
  type Outcome,
  type Pending,
  type PrivateShow,
  type Result,
  type Seat,
  type SetupInput,
  SHOW_DECK,
} from '../src/index.ts';

/**
 * "Show and tell": a minimal private-show game (D077, PROTOCOL §14) for testing the kit and the session without a
 * real game. Six cards (0..5). Position p is dealt to seat floor(p / 2) at setup, so each of the 2 or 3 seats holds
 * two. On a turn, the turn seat t asks; then seat (t + 1) mod n shows t one card it holds, privately: only the two
 * of them learn which. The turn then passes on. After four shows the game is over, and each seat scores the shows
 * it was given.
 */
export type ShowToyRules = Record<string, never>;

export interface ShowSlot {
  readonly pos: number;
  readonly card: number | null;
}

/** One show: who showed whom, and the card where this state may know it (full mode, the shower, the submitter). */
export interface ShowRecord {
  readonly from: Seat;
  readonly to: Seat;
  readonly card: number | null;
}

export interface ShowToyState {
  readonly mode: 'full' | 'view';
  readonly viewer: Seat | null;
  readonly hands: readonly (readonly ShowSlot[])[];
  readonly turn: Seat;
  readonly stage: 'ask' | 'show';
  readonly shows: readonly ShowRecord[];
}

export type ShowToyEvent =
  | { readonly type: 'asked'; readonly seat: Seat }
  | { readonly type: 'shown'; readonly from: Seat; readonly to: Seat };

export interface ShowToyOptions {
  /**
   * Deliberate bugs for testing the fuzzer itself:
   * - `leakView`: `view` keeps every show's card for every viewer;
   * - `foreignMarker`: the shower is offered a marker for a position the submitter holds.
   */
  readonly bug?: 'leakView' | 'foreignMarker';
}

const DECK = 'cards';
const CARDS = 6;
const SHOWS = 4;

const err = (code: string, message: string) => ({ ok: false as const, error: { code, message } });

const isObject = (a: unknown): a is Record<string, unknown> =>
  typeof a === 'object' && a !== null && !Array.isArray(a);

const keysAre = (a: Record<string, unknown>, keys: string): boolean =>
  Object.keys(a).sort().join(',') === keys;

/** The seat that shows on this turn. */
const showerOf = (s: ShowToyState): Seat => (s.turn + 1) % s.hands.length;

function pendingOf(s: ShowToyState): Pending {
  if (s.shows.length >= SHOWS) return { type: 'over' };
  return s.stage === 'ask'
    ? { type: 'player', seat: s.turn, decision: 'ask' }
    : { type: 'player', seat: showerOf(s), decision: 'show' };
}

function privateShowOf(s: ShowToyState): PrivateShow | null {
  if (s.stage !== 'show' || s.shows.length >= SHOWS) return null;
  return { id: s.shows.length, from: showerOf(s), to: s.turn };
}

/** The shows each seat was given: public, so every view scores alike. */
const received = (s: ShowToyState): number[] =>
  s.hands.map((_, seat) => s.shows.filter((x) => x.to === seat).length);

export function createShowToy(
  opts: ShowToyOptions = {},
): GameModule<ShowToyState, ShowToyEvent, ShowToyRules> {
  return {
    id: 'show-and-tell',
    version: '0.1.0',
    defaultRules: () => ({}),
    validateRules(rules: unknown): Result<ShowToyRules> {
      if (!isObject(rules) || Object.keys(rules).length > 0) return err('rules', 'expected {}');
      return { ok: true, value: {} };
    },
    seatRange: () => ({ min: 2, max: 3 }),
    decks: () => [{ id: DECK, size: CARDS }],
    privateShow: privateShowOf,
    setup(input: SetupInput<ShowToyRules>): Result<ShowToyState> {
      if (input.seats < 2 || input.seats > 3) return err('seats', 'two or three seats');
      const order = input.mode === 'full' ? (input.deckOrders[DECK] ?? null) : null;
      if (input.mode === 'full' && order?.length !== CARDS) return err('deck', 'expected six cards');
      const hands = Array.from({ length: input.seats }, (_, seat) =>
        [2 * seat, 2 * seat + 1].map((pos) => ({ pos, card: order === null ? null : (order[pos] ?? null) })),
      );
      return {
        ok: true,
        value: {
          mode: input.mode,
          viewer: input.mode === 'view' ? input.viewer : null,
          hands,
          turn: 0,
          stage: 'ask',
          shows: [],
        },
      };
    },
    pending: pendingOf,
    legalActions(s, seat) {
      const p = pendingOf(s);
      if (p.type !== 'player' || p.seat !== seat) return [];
      if (s.stage === 'ask') return [{ type: 'ask', actor: seat }];
      // One marker per position the shower holds; the session turns the chosen one into the wire.
      if (opts.bug === 'foreignMarker') return [{ type: 'show', actor: seat, pos: 2 * s.turn }];
      return (s.hands[seat] ?? []).map((h) => ({ type: 'show', actor: seat, pos: h.pos }));
    },
    apply(s, action: unknown): ApplyResult<ShowToyState, ShowToyEvent> {
      if (!isObject(action)) return err('shape', 'not an object');
      const p = pendingOf(s);
      if (p.type !== 'player') return err('phase', 'no decision is pending');
      if (action.actor !== p.seat) return err('actor', 'not your decision');
      if (s.stage === 'ask') {
        if (action.type !== 'ask' || !keysAre(action, 'actor,type')) return err('ask', 'expected an ask');
        return { ok: true, state: { ...s, stage: 'show' }, events: [{ type: 'asked', seat: s.turn }] };
      }
      const plan = privateShowOf(s);
      if (plan === null) return err('show', 'no show is pending');
      // Only the wire: a marker names its position, so it never reaches apply.
      if (
        action.type !== 'show' ||
        !keysAre(action, 'actor,id,packet,type') ||
        action.id !== plan.id ||
        typeof action.packet !== 'string'
      )
        return err('show', 'expected a private show');
      return {
        ok: true,
        state: {
          ...s,
          stage: 'ask',
          turn: (s.turn + 1) % s.hands.length,
          shows: [...s.shows, { from: plan.from, to: plan.to, card: null }],
        },
        events: [{ type: 'shown', from: plan.from, to: plan.to }],
      };
    },
    learn(s, l: Learn): ApplyResult<ShowToyState, ShowToyEvent> {
      if (l.deck === SHOW_DECK) {
        const show = s.shows[l.pos];
        if (show === undefined || !Number.isSafeInteger(l.card) || l.card < 0 || l.card >= CARDS)
          return err('learn', 'no such show');
        if (s.mode === 'view' && s.viewer !== show.from && s.viewer !== show.to)
          return err('learn', 'that show was not made to this seat');
        // Full mode (and the shower's own view) knows the shower's hand: the card must be one it holds.
        const hand = s.hands[show.from] ?? [];
        if (hand.every((h) => h.card !== null) && !hand.some((h) => h.card === l.card))
          return err('learn', 'the shower does not hold that card');
        if (show.card !== null && show.card !== l.card) return err('learn', 'another card was shown');
        const shows = s.shows.map((x, i) => (i === l.pos ? { ...x, card: l.card } : x));
        return { ok: true, state: { ...s, shows }, events: [] };
      }
      if (l.deck !== DECK || s.mode === 'full' || s.viewer === null) return err('learn', 'no private view');
      const viewer = s.viewer;
      if (!(s.hands[viewer] ?? []).some((h) => h.pos === l.pos)) return err('learn', 'not your card');
      const hands = s.hands.map((h, i) =>
        i === viewer ? h.map((slot) => (slot.pos === l.pos ? { pos: slot.pos, card: l.card } : slot)) : h,
      );
      return { ok: true, state: { ...s, hands }, events: [] };
    },
    // Hand cards only: a shown card is delivered by the platform, never listed here.
    knownTo: (s, seat) =>
      (s.hands[seat] ?? [])
        .filter((h) => h.card !== null)
        .map((h) => ({ deck: DECK, pos: h.pos, card: h.card as number })),
    view(s, viewer) {
      return {
        ...s,
        mode: 'view',
        viewer,
        hands: s.hands.map((h, i) => (i === viewer ? h : h.map((slot) => ({ pos: slot.pos, card: null })))),
        shows: s.shows.map((x) =>
          opts.bug === 'leakView' || viewer === x.from || viewer === x.to ? x : { ...x, card: null },
        ),
      };
    },
    outcome(s): Outcome | null {
      if (s.shows.length < SHOWS) return null;
      const scores = received(s);
      return { places: scores.map((v) => 1 + scores.filter((o) => o > v).length), scores, reason: 'shown' };
    },
    standings: received,
    dealt: (s): DealtPosition[] =>
      s.hands.flatMap((h, seat) => h.map((slot) => ({ deck: DECK, pos: slot.pos, to: seat }))),
    revealsOf: () => [],
    invariants(s) {
      const out: string[] = [];
      if (s.shows.length > SHOWS) out.push('more than four shows');
      if (s.mode !== 'full') return out;
      for (const [i, x] of s.shows.entries()) {
        if (x.card === null) out.push(`show ${i} has no card in full mode`);
        else if (!(s.hands[x.from] ?? []).some((h) => h.card === x.card))
          out.push(`show ${i} is not a card seat ${x.from} holds`);
      }
      return out;
    },
    // An early deck secret would open every show to or from its seat (PROTOCOL §14).
    resignAllowed: () => false,
  };
}

export const showToy = createShowToy();
