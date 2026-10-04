import { canonicalJson, deepFreeze, type Pending } from '@bored-games/game-kit';
import type { ParsedMove } from '@bored-games/protocol';
import type { LoggedAction } from '../audit.ts';
import { shuffleStepSeat } from '../partitioned-deck.ts';
import type { GameCtx, HeldMove, Judgement, LinePoint } from './types.ts';

/*
 * One line's fold (build plan D-E layer 2): the point at the root, a move judged at its prev's point (PROTOCOL-v2
 * §5.1: valid-looking, valid), and the point after a valid move links. Pure functions of the game's context, the
 * point and the move: every client that folds the same line reaches the same points.
 *
 * Built so far (T7): deckless games without dice. A game with a deck (the shuffle, the deal, card shares, derived
 * reveals and learns) is T8, and dice (roll contributions, derived rolls) T9; the session refuses both until then.
 */

/** True when a seat's action claims to be the derived dice: players never send those (PROTOCOL-v2 §6.2, D058). */
export function playerSentDice(action: unknown): boolean {
  return action !== null && typeof action === 'object' && (action as { type?: unknown }).type === 'rolled';
}

/**
 * Why held move `m` by `seat` can never be valid, whatever its prev's state, or null (the checks of v1's
 * `moveShape`): a shuffle step where a game action belongs or the reverse, a shuffle step by the wrong seat, and
 * any share or reveal in a deckless game (a dice game included, PROTOCOL-v2 §3 on §4.4).
 */
export function moveShape(ctx: GameCtx, m: ParsedMove, seat: number): string | null {
  const c = m.content;
  if (m.seq <= ctx.shuffleSteps) {
    if (c.type !== 'shuffle') return `move ${m.seq} must be a shuffle step`;
    const expected = shuffleStepSeat(m.seq - 1, ctx.partitions);
    if (expected === null) return `move ${m.seq} cannot be a shuffle step: the game has no deck`;
    if (seat !== expected) return `shuffle step ${m.seq} must be signed by seat ${expected}`;
    return null;
  }
  if (c.type !== 'action') return `move ${m.seq} must be a game action`;
  if (ctx.deckId === null && (c.shares.length > 0 || c.reveals.length > 0))
    return 'a deckless game carries no shares or reveals';
  return null;
}

/** The point at the root: a deckless game starts in play, its view-mode state set up at once. */
export function rootPoint(ctx: GameCtx): LinePoint {
  if (ctx.deckId !== null) throw new Error('protocol 2 games with a deck are folded from build task T8');
  const r = ctx.module.setup({ rules: ctx.rules, seats: ctx.seats, mode: 'view', viewer: ctx.viewer });
  // validateRoot accepted these rules and this seat count, so setup cannot fail for a sound module.
  if (!r.ok) throw new Error(`module setup failed: ${r.error.message}`);
  const state = deepFreeze(r.value);
  return { id: ctx.rootId, seq: 0, phase: phaseOf(ctx, state), state, logLength: 0, eventsLength: 0 };
}

/** The phase of a point in play: `end` once the module is over. */
function phaseOf(ctx: GameCtx, state: unknown): 'play' | 'end' {
  return ctx.module.pending(state).type === 'over' ? 'end' : 'play';
}

/** The module's pending decision at `p`, or null before the module is set up. */
export function pendingAt(ctx: GameCtx, p: LinePoint): Pending | null {
  return p.state === null ? null : ctx.module.pending(p.state);
}

/**
 * Judge held move `h` at `p`, the point of its prev (PROTOCOL-v2 §5.1). A deckless game action is valid-looking,
 * and then valid (it owes no share), when: it is not a player-sent roll; a player decision is pending and its
 * signer is the pending seat; the module accepts the action; and the action shows no card. A module that throws
 * judges the move invalid.
 */
export function judge(ctx: GameCtx, p: LinePoint, h: HeldMove): Judgement {
  const { m, seat } = h;
  if (m.seq !== p.seq + 1) return { kind: 'invalid', why: `seq ${m.seq} does not follow its prev` };
  if (h.shape !== null) return { kind: 'invalid', why: h.shape };
  const c = m.content;
  if (c.type !== 'action' || p.state === null)
    return { kind: 'invalid', why: 'protocol 2 games with a deck are folded from build task T8' };
  try {
    // Faces are derived from the contributions; a seat that sends them is inventing the roll (PROTOCOL-v2 §6.2).
    if (playerSentDice(c.action)) return { kind: 'invalid', why: 'a player does not send the dice' };
    const pending = ctx.module.pending(p.state);
    if (pending.type !== 'player') return { kind: 'invalid', why: 'no player decision is pending' };
    if (seat !== pending.seat)
      return { kind: 'invalid', why: `move ${m.seq} must be signed by seat ${pending.seat}` };
    const r = ctx.module.apply(p.state, c.action);
    if (!r.ok)
      return { kind: 'invalid', why: `the module rejects the action: ${r.error.code}: ${r.error.message}` };
    if (canonicalJson(ctx.module.revealsOf(p.state, c.action)) !== '[]')
      return { kind: 'invalid', why: 'the reveals do not match the positions the action shows' };
    return { kind: 'valid', state: r.state, events: r.events };
  } catch (e) {
    return { kind: 'invalid', why: `the module threw: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The point after valid move `h` links at its prev's point, given its judgement: the new state, its log entry and its module
 * events appended to the line's `log` and `events` (owned by the caller, which folds one line at a time).
 */
export function link(
  ctx: GameCtx,
  h: HeldMove,
  j: Extract<Judgement, { kind: 'valid' }>,
  log: LoggedAction[],
  events: unknown[],
): LinePoint {
  const c = h.m.content;
  const state = deepFreeze(j.state);
  if (c.type === 'action') log.push({ actor: h.seat, action: c.action, seq: h.m.seq });
  for (const e of j.events) events.push(deepFreeze(e));
  return {
    id: h.m.id,
    seq: h.m.seq,
    phase: phaseOf(ctx, state),
    state,
    logLength: log.length,
    eventsLength: events.length,
  };
}
