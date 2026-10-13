/*
 * Game-in-progress snapshots for the web previews (D086). One deterministic fuzz game per title, with the game's
 * own policies, read through `observe`: at a few moments when seat 0 has a decision, keep seat 0's view, its
 * legal actions and the events its view has seen. `apps/web/scripts/previews.ts` renders them with the real game
 * screen and saves the pictures. Test tooling only: nothing here is a player.
 */
import { type FuzzPolicy, fuzzGame, type Pending } from '@bored-games/game-kit';
import { evaluate, type Placement, type State as QuillState, TILES } from '@bored-games/quill-and-quarry';
import { TARGETS } from './index.ts';
import { PREVIEW_WORDS } from './preview-words.ts';

export interface PreviewSnapshot {
  readonly game: string;
  readonly seats: number;
  /** The game step the snapshot follows (1-based count of actions applied). */
  readonly step: number;
  /** Seat 0's view of the game. */
  readonly state: unknown;
  readonly legal: readonly unknown[];
  readonly pending: Pending;
  /** Every event seat 0's view has seen, oldest first. */
  readonly events: readonly unknown[];
}

export interface PreviewPlan {
  readonly game: string;
  readonly seed: string;
  readonly seats: number;
  /** Where in the game to look, as fractions of seat 0's decisions (0.5: the middle one). */
  readonly at: readonly number[];
  /** Players in place of the fuzz policies, when those would not look like a real game. */
  // biome-ignore lint/suspicious/noExplicitAny: a policy matches its own game's state type
  readonly policies?: readonly FuzzPolicy<any>[];
  /**
   * Pending decisions that are not a player's choice and should not be pictured, such as a dice share the app
   * sends by itself (`contribute`, D058). Older plans leave it out, so their pictures do not move.
   */
  readonly skip?: readonly string[];
}

/**
 * A Quill & Quarry player that only lays words from `PREVIEW_WORDS`, every word it forms included, and takes the
 * best score. The fuzz policy tests the rules with any letters; a picture for players should show words.
 */
export const QUILL_PREVIEW_POLICY: FuzzPolicy<QuillState> = {
  name: 'preview-words',
  choose(s, seat, legal, rng) {
    if (s.phase === 'review') return { type: 'accept', actor: seat };
    if (s.phase === 'judge') return { type: 'judge', actor: seat, valid: true };
    if (s.phase !== 'turn') return rng.pick(legal);
    const hand = (s.hands[seat] ?? []).flatMap((slot) =>
      slot.card === null ? [] : [{ pos: slot.pos, card: slot.card, letter: TILES[slot.card]?.letter ?? '' }],
    );
    const opening = s.board.every((t) => t === null);
    let best: { tiles: Placement[]; points: number } | null = null;
    for (const word of PREVIEW_WORDS) {
      if (word.length < 2) continue;
      for (const step of [1, 15]) {
        for (let start = 0; start < 225; start++) {
          const last = start + (word.length - 1) * step;
          if (last > 224 || (step === 1 && Math.floor(last / 15) !== Math.floor(start / 15))) continue;
          const before = start - step;
          const after = last + step;
          if (before >= 0 && (step === 15 || start % 15 !== 0) && s.board[before] !== null) continue;
          if (after < 225 && (step === 15 || after % 15 !== 0) && s.board[after] !== null) continue;
          const free = [...hand];
          const tiles: Placement[] = [];
          let fits = true;
          for (let i = 0; i < word.length && fits; i++) {
            const cell = start + i * step;
            const letter = word[i] as string;
            const there = s.board[cell];
            if (there) {
              fits = there.letter === letter;
              continue;
            }
            const k = free.findIndex((t) => t.letter === letter);
            const blank = k < 0 ? free.findIndex((t) => t.letter === '') : k;
            if (blank < 0) {
              fits = false;
              continue;
            }
            const [tile] = free.splice(blank, 1);
            if (tile) tiles.push({ cell, pos: tile.pos, card: tile.card, letter });
          }
          if (!fits || tiles.length === 0 || (opening && !tiles.some((t) => t.cell === 112))) continue;
          const play = evaluate(s, seat, tiles);
          if (!play.ok || !play.value.words.every((w) => PREVIEW_WORDS.has(w.text))) continue;
          const points = play.value.points + rng.int(3);
          if (best === null || points > best.points) best = { tiles, points };
        }
      }
    }
    if (best !== null) return { type: 'place', actor: seat, tiles: best.tiles };
    if (s.bag.length >= 7)
      return { type: 'exchange', actor: seat, positions: hand.map((t) => t.pos).sort((a, b) => a - b) };
    return { type: 'pass', actor: seat };
  },
};

/** Plays `plan`'s game and returns one snapshot per fraction in `plan.at`. Throws if the game fails. */
export function previewSnapshots(plan: PreviewPlan): PreviewSnapshot[] {
  const target = TARGETS[plan.game];
  if (target === undefined) throw new Error(`unknown game ${plan.game}`);
  const { module } = target;
  const events: unknown[] = [];
  const turns: PreviewSnapshot[] = [];
  const report = fuzzGame(module, {
    seed: plan.seed,
    seats: plan.seats,
    rules: module.defaultRules(),
    policies: plan.policies ?? target.policies,
    ...(target.deckOrder ? { deckOrder: target.deckOrder } : {}),
    checkViews: true,
    legalitySample: 0,
    observe: (step, _full, views, viewEvents) => {
      events.push(...(viewEvents[0] ?? []));
      const view = views[0];
      const pending = module.pending(view);
      if (pending.type !== 'player' || pending.seat !== 0) return;
      if (plan.skip?.includes(pending.decision) === true) return;
      const legal = module.legalActions(view, 0);
      if (legal.length === 0) return;
      turns.push({
        game: plan.game,
        seats: plan.seats,
        step,
        state: view,
        legal,
        pending,
        events: [...events],
      });
    },
  });
  if (report.failure !== null) throw new Error(`${plan.game}: ${report.failure.message}`);
  if (turns.length === 0) throw new Error(`${plan.game}: seat 0 never had a decision`);
  return plan.at.map(
    (f) => turns[Math.min(turns.length - 1, Math.floor(f * turns.length))] as PreviewSnapshot,
  );
}
