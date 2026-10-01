import {
  type ChainReactionEvent,
  type ChainReactionRules,
  type ChainReactionState,
  chainReaction,
  type HandSlot,
} from '@bored-games/chain-reaction';
import { type Ciphertext, makeShare, type RandomBytes, type ShareCtx } from '@bored-games/deck';
import type { GameModule } from '@bored-games/game-kit';
import { finalizeEvent, type Hex, moveTemplate, type NostrEvent, type PosShare } from '@bored-games/protocol';
import type { GameSession } from '../src/session.ts';
import type { ShareStore } from '../src/shares.ts';
import type { Identity } from '../src/types.ts';

/*
 * Test-only cheating. Nothing in src offers a way to publish an illegal move; these helpers reach into a session's
 * private fields to do what a hacked client would.
 */

/** The private parts of a session that a cheat needs. */
interface Internals {
  me: Identity | null;
  module: GameModule<unknown, { readonly type: string }, unknown>;
  state: unknown;
  shares: ShareStore;
  root: { id: Hex };
  chain: readonly unknown[];
  finalDeck(): Ciphertext[] | null;
  shareCtx(pos: number): ShareCtx;
  headId(): Hex;
}

/**
 * Seat `session`'s game-action move carrying `action` at the head, without `buildAction`'s legality check. Its
 * owed shares and reveal shares are made exactly as `buildAction` makes them, from the session's own share store
 * and state, so peers that cannot see the seat's hand accept it.
 */
export function forgeAction(
  session: GameSession,
  action: unknown,
  rnd: RandomBytes,
  createdAt: number,
): NostrEvent {
  const s = session as unknown as Internals;
  const me = s.me;
  const deck = s.finalDeck();
  if (me === null || deck === null)
    throw new Error('forgeAction: a seated session after the shuffle is needed');
  const share = (pos: number): PosShare => ({
    pos,
    share: makeShare(me.deckSecret, deck[pos] as Ciphertext, s.shareCtx(pos), rnd),
  });
  const shares = s.shares.missing(me.seat, s.module.dealt(s.state)).map(share);
  const shown = [...new Set(s.module.revealsOf(s.state, action).map((l) => l.pos))].sort((a, b) => a - b);
  const t = moveTemplate(
    {
      rootId: s.root.id,
      prevId: s.headId(),
      seq: s.chain.length + 1,
      content: { type: 'action', action, reveals: shown.map(share), shares },
    },
    createdAt,
  );
  return finalizeEvent(t, me.sessionSk, rnd);
}

/** `s` with `seat`'s hand replaced by `hand`. */
function withHand(s: ChainReactionState, seat: number, hand: readonly HandSlot[]): ChainReactionState {
  return { ...s, players: s.players.map((p, k) => (k === seat ? { ...p, hand } : p)) };
}

/** `seat`'s hand in `s` with every tile hidden, as the other seats see it. */
const masked = (s: ChainReactionState, seat: number): ChainReactionState =>
  withHand(
    s,
    seat,
    (s.players[seat]?.hand ?? []).map((h) => ({ ...h, tile: null })),
  );

/**
 * Chain Reaction as the cheating seat's own client runs it, so that client keeps playing after its forged
 * `skipPlace`: in view mode, `seat`'s skipPlace is judged as the other seats judge it, with the seat's hand
 * hidden, and the hand is put back afterwards. Full mode (the audit) is the real engine.
 */
export function lenientSkips(
  seat: number,
): GameModule<ChainReactionState, ChainReactionEvent, ChainReactionRules> {
  return {
    ...chainReaction,
    apply(state, action) {
      const a = action as { type?: unknown; actor?: unknown } | null;
      if (state.mode !== 'view' || a?.type !== 'skipPlace' || a.actor !== seat) {
        return chainReaction.apply(state, action);
      }
      const hand = state.players[seat]?.hand ?? [];
      const r = chainReaction.apply(masked(state, seat), action);
      return r.ok ? { ...r, state: withHand(r.state, seat, hand) } : r;
    },
  };
}

/**
 * Chain Reaction as the cheating seat's own client runs it, so that client keeps playing after an `endTurn` that
 * keeps a dead tile: in view mode, when the real engine refuses `seat`'s endTurn for its discards, it is judged
 * with the seat's hand hidden, as the other seats judge it, and the known tiles are put back by position. Other
 * actions, and full mode (the audit), use the real engine.
 */
export function lenientDiscards(
  seat: number,
): GameModule<ChainReactionState, ChainReactionEvent, ChainReactionRules> {
  return {
    ...chainReaction,
    apply(state, action) {
      const r = chainReaction.apply(state, action);
      const a = action as { type?: unknown; actor?: unknown } | null;
      if (
        r.ok ||
        r.error.code !== 'discard' ||
        state.mode !== 'view' ||
        a?.type !== 'endTurn' ||
        a.actor !== seat
      ) {
        return r;
      }
      const known = new Map((state.players[seat]?.hand ?? []).map((h) => [h.pos, h.tile]));
      const m = chainReaction.apply(masked(state, seat), action);
      if (!m.ok) return m;
      const hand = (m.state.players[seat]?.hand ?? []).map((h) => ({
        ...h,
        tile: known.get(h.pos) ?? h.tile,
      }));
      return { ...m, state: withHand(m.state, seat, hand) };
    },
  };
}
