import type { ApplyResult, GameModule, Outcome, Pending, Result, RollEntry } from '../src/index.ts';

/**
 * "Dice race": a deckless protocol 2 dice toy. Each seat in turn rolls, which appends a roll entry of `count`
 * faces of `sides` and pends the beacon for it; the beacon's `rolled` adds the faces to the roller's score. The
 * game ends after `turns` rolls. It checks the faces it is given against its roll entry, so a fuzz run proves that
 * the fuzzer reads `count` and `sides` from the entry.
 */
export interface DiceRules {
  readonly turns: number;
  readonly count: number;
  readonly sides: number;
}

export interface DiceState {
  readonly rules: DiceRules;
  readonly seats: number;
  readonly turn: number;
  readonly rolls: readonly RollEntry[];
  /** The roll whose faces are owed, or null. */
  readonly beacon: number | null;
  readonly scores: readonly number[];
  /** Every face drawn so far, for the test. */
  readonly faces: readonly number[];
}

type DiceEvent = { readonly type: 'rolled'; readonly sum: number };

const err = (message: string): { ok: false; error: { code: string; message: string } } => ({
  ok: false,
  error: { code: 'bad-action', message },
});

const RULES: DiceRules = { turns: 6, count: 3, sides: 4 };

export function diceToy(rules: DiceRules = RULES): GameModule<DiceState, DiceEvent, DiceRules> {
  const isOver = (s: DiceState): boolean => s.turn >= s.rules.turns && s.beacon === null;
  const seatOf = (s: DiceState): number => s.turn % s.seats;
  return {
    id: 'dice-toy',
    version: '0.0.1',
    protocols: [2],
    defaultRules: () => rules,
    validateRules: (r: unknown): Result<DiceRules> => ({ ok: true, value: r as DiceRules }),
    seatRange: () => ({ min: 2, max: 4 }),
    decks: () => [],
    setup: (input) =>
      ({
        ok: true,
        value: {
          rules: input.rules,
          seats: input.seats,
          turn: 0,
          rolls: [],
          beacon: null,
          scores: Array.from({ length: input.seats }, () => 0),
          faces: [],
        },
      }) as const,
    pending(s): Pending {
      if (s.beacon !== null) return { type: 'beacon', id: s.beacon };
      if (isOver(s)) return { type: 'over' };
      return { type: 'player', seat: seatOf(s), decision: 'roll' };
    },
    legalActions: (s, seat) =>
      s.beacon === null && !isOver(s) && seat === seatOf(s) ? [{ type: 'roll', actor: seat }] : [],
    apply(s, action): ApplyResult<DiceState, DiceEvent> {
      const a = action as { type?: unknown; actor?: unknown; id?: unknown; dice?: unknown } | null;
      if (typeof a !== 'object' || a === null) return err('not an action');
      if (a.type === 'roll') {
        if (s.beacon !== null || isOver(s) || a.actor !== seatOf(s) || Object.keys(a).length !== 2)
          return err('not your roll');
        const id = s.rolls.length;
        const entry: RollEntry = { id, count: s.rules.count, sides: s.rules.sides };
        return { ok: true, state: { ...s, rolls: [...s.rolls, entry], beacon: id }, events: [] };
      }
      if (a.type === 'rolled') {
        const entry = s.rolls.find((r) => r.id === a.id);
        const dice = a.dice;
        if (a.actor !== 'beacon' || s.beacon === null || entry === undefined || a.id !== s.beacon)
          return err('no roll is pending');
        if (
          !Array.isArray(dice) ||
          dice.length !== entry.count ||
          !dice.every((d) => Number.isSafeInteger(d) && d >= 1 && d <= entry.sides)
        )
          return err(`expected ${entry.count} faces of 1..${entry.sides}`);
        const sum = (dice as number[]).reduce((x, y) => x + y, 0);
        const seat = seatOf(s);
        const scores = s.scores.map((v, i) => (i === seat ? v + sum : v));
        return {
          ok: true,
          state: { ...s, scores, beacon: null, turn: s.turn + 1, faces: [...s.faces, ...(dice as number[])] },
          events: [{ type: 'rolled', sum }],
        };
      }
      return err('unknown action');
    },
    learn: () => err('no hidden cards'),
    knownTo: () => [],
    view: (s) => s,
    outcome(s): Outcome | null {
      if (!isOver(s)) return null;
      const places = s.scores.map((v) => 1 + s.scores.filter((w) => w > v).length);
      return { places, scores: [...s.scores], reason: 'turns' };
    },
    standings: (s) => [...s.scores],
    dealt: () => [],
    revealsOf: () => [],
    invariants: () => [],
    rolls: (s) => s.rolls,
  };
}
