// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats, positions and shows.
/*
 * A private show over the session and real crypto (D075, PROTOCOL §14), on the "show and tell" test module: seat
 * (t + 1) mod 3 shows the turn seat t one card it holds. Only the shower and the submitter learn the card, the wire
 * names neither the card nor its position, every client keeps one chain whatever the packet holds, and the end audit
 * opens every packet with the released deck secrets.
 */
import { b64u, type Ciphertext, encodeScalar, G, makeShare, q, type Share } from '@bored-games/deck';
import type { PrivateShow } from '@bored-games/game-kit';
import {
  finalizeEvent,
  getConversationKey,
  moveTemplate,
  type NostrEvent,
  nip44Encrypt,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { type ShowToyState, showToy } from '../../game-kit/test/show-toy.ts';
import { makeShow, showEnvelope } from '../src/private-show.ts';
import type { GameSession } from '../src/session.ts';
import { catchUp, makeModuleGame, NOW, newSession } from './helpers.ts';

const SEATS = 3;
const CARDS = 6;
/** Every session's status for one delivery: the three players', then the spectator's. */
const ALL = ['accepted', 'accepted', 'accepted', 'accepted'];

/** A game of the test module at 3 seats, shuffled and dealt, with a player session per seat and a spectator. */
function table(seed: string) {
  const game = makeModuleGame(showToy, SEATS, seed);
  game.modules = new Map([[showToy.id, showToy]]);
  const players = [0, 1, 2].map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const events: NostrEvent[] = [];
  const send = (ev: NostrEvent): string[] => {
    events.push(ev);
    return all.map((s) => s.receive(ev, NOW).status);
  };
  for (const seat of [0, 1, 2]) send(players[seat]!.buildShuffle(game.rnd, NOW));
  for (const p of players) send(p.buildDeal(game.rnd, NOW));
  /** Each seat's x-only deck key, as the conversation keys use it. */
  const keys = game.ids.map((id) => G.multiply(id.deckSecret).toHex(true).slice(2));
  /** Seat `seat`'s move with `action` on the head, signed with its session key, built by hand. */
  const signed = (seat: number, action: unknown): NostrEvent => {
    const head = spectator.view().head;
    const t = moveTemplate(
      {
        rootId: game.rootId,
        prevId: head.id,
        seq: head.seq + 1,
        content: { type: 'action', action, reveals: [], shares: [] },
      },
      NOW,
    );
    return finalizeEvent(t, game.ids[seat]!.sessionSk, game.rnd);
  };
  return { game, players, spectator, all, events, send, keys, signed };
}
type Table = ReturnType<typeof table>;

const stateOf = (s: GameSession): ShowToyState => s.view().state as ShowToyState;

/** The card at `pos` in seat `seat`'s hand, as its own view knows it. */
const cardAt = (t: Table, seat: number, pos: number): number | null =>
  stateOf(t.players[seat]!).hands[seat]!.find((h) => h.pos === pos)!.card;

/** The final deck's ciphertext at `pos`, read through a private method, for building packets by hand. */
const ciphertext = (s: GameSession, pos: number): Ciphertext =>
  (s as unknown as { finalDeck(): Ciphertext[] }).finalDeck()[pos]!;

/** The turn seat asks. */
const ask = (t: Table, turn: number): string[] =>
  t.send(t.players[turn]!.buildAction({ type: 'ask', actor: turn }, t.game.rnd, NOW));

/** A turn: `turn` asks, then the next seat shows it the card at `pos` (by default its first position). */
function round(t: Table, turn: number, pos?: number): NostrEvent {
  expect(ask(t, turn)).toEqual(ALL);
  const from = (turn + 1) % SEATS;
  const ev = t.players[from]!.buildAction(
    { type: 'show', actor: from, pos: pos ?? 2 * from },
    t.game.rnd,
    NOW,
  );
  expect(t.send(ev)).toEqual(ALL);
  return ev;
}

/** Every seat publishes its deck secret, so the audit runs. */
function reveal(t: Table): void {
  for (const p of t.players) t.send(p.buildSecret(t.game.rnd, NOW));
}

/** The action a move carries. */
const actionOf = (ev: NostrEvent) => (JSON.parse(ev.content) as { action: { packet: string } }).action;

describe('a private show over the session (D075)', () => {
  it('only the shower and the submitter learn the card; the wire holds no position or card', () => {
    const t = table('show-private');
    expect(ask(t, 0)).toEqual(ALL);
    // Seat 1 shows a card that is neither its seat nor the show id, so a JSON value equal to it could only be the card.
    const slot = stateOf(t.players[1]!).hands[1]!.find((h) => h.card !== null && h.card > 1)!;
    expect(slot).toBeDefined();
    const ev = t.players[1]!.buildAction({ type: 'show', actor: 1, pos: slot.pos }, t.game.rnd, NOW);
    expect(t.send(ev)).toEqual(ALL);
    expect(stateOf(t.players[0]!).shows[0]).toEqual({ from: 1, to: 0, card: slot.card });
    expect(stateOf(t.players[1]!).shows[0]).toEqual({ from: 1, to: 0, card: slot.card });
    expect(stateOf(t.players[2]!).shows[0]).toEqual({ from: 1, to: 0, card: null });
    expect(stateOf(t.spectator).shows[0]).toEqual({ from: 1, to: 0, card: null });
    // The move carries the wire alone: no position, no card, and no share or reveal that would name a position.
    const content = JSON.parse(ev.content) as {
      action: Record<string, unknown>;
      reveals: unknown[];
      shares: unknown[];
    };
    expect(Object.keys(content.action).sort()).toEqual(['actor', 'id', 'packet', 'type']);
    expect(content.action).toMatchObject({ type: 'show', actor: 1, id: 0 });
    expect(content.reveals).toEqual([]);
    expect(content.shares).toEqual([]);
    const asValue = new RegExp(`[\\[:,]${slot.card}[,\\]}]`);
    for (const text of [JSON.stringify(ev), ev.content]) {
      expect(text).not.toContain('"pos"');
      expect(text).not.toMatch(asValue);
    }
  });

  it('makes two shows of one position unlinkable', () => {
    const t = table('show-twice');
    // Seat 1 shows seat 0 the card at its position 2 on the first turn and again on the fourth.
    const first = round(t, 0, 2);
    round(t, 1);
    round(t, 2);
    const again = round(t, 0, 2);
    const a = actionOf(first);
    const b = actionOf(again);
    expect(a.packet).not.toBe(b.packet);
    expect(a.packet.length).toBe(b.packet.length);
    expect(showEnvelope(a, { id: 0, from: 1, to: 0 }, CARDS)).toBe(true);
    expect(showEnvelope(b, { id: 3, from: 1, to: 0 }, CARDS)).toBe(true);
    const card = cardAt(t, 1, 2);
    expect(card).not.toBeNull();
    for (const s of [t.players[0]!, t.players[1]!])
      expect([stateOf(s).shows[0]!.card, stateOf(s).shows[3]!.card]).toEqual([card, card]);
    for (const s of [t.players[2]!, t.spectator])
      expect([stateOf(s).shows[0]!.card, stateOf(s).shows[3]!.card]).toEqual([null, null]);
  });

  it('re-learns the card on reload', () => {
    const t = table('show-reload');
    round(t, 0);
    const card = stateOf(t.players[0]!).shows[0]!.card;
    expect(card).toBe(cardAt(t, 1, 2));
    expect(card).not.toBeNull();
    expect(stateOf(catchUp(t.game, 0, t.events)).shows[0]!.card).toBe(card);
    expect(stateOf(catchUp(t.game, 1, t.events)).shows[0]!.card).toBe(card);
    expect(stateOf(catchUp(t.game, 2, t.events)).shows[0]!.card).toBeNull();
  });

  it('rejects a malformed show and keeps one chain for a bad packet', () => {
    const t = table('show-malformed');
    expect(ask(t, 0)).toEqual(ALL);
    const plan: PrivateShow = { id: 0, from: 1, to: 0 };
    const pos = 2;
    const head = t.spectator.view().head;
    const x1 = t.game.ids[1]!.deckSecret;
    const ctx = { rootId: t.game.rootId, deckId: 'cards', pos };
    const share = makeShare(x1, ciphertext(t.spectator, pos), ctx, t.game.rnd);
    const good = makeShow(plan, pos, x1, share, t.keys, t.game.rootId, head.id, CARDS, t.game.rnd);
    expect(showEnvelope(good, plan, CARDS)).toBe(true);
    const conversation = getConversationKey(b64u.decode(encodeScalar(x1)), t.keys[0]!);
    const long = nip44Encrypt('x'.repeat(400), conversation, t.game.rnd(32));
    for (const action of [
      { ...good, extra: 1 },
      { ...good, packet: long },
      { ...good, id: 1 },
      // The marker itself names the position: it never goes on the wire.
      { type: 'show', actor: 1, pos },
    ]) {
      expect(t.send(t.signed(1, action))).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    }
    expect(t.spectator.view().head).toEqual(head);
    // Well formed, but sealed to seat 2: every session accepts it, so they keep one chain, and nobody learns the card.
    const toSeat2 = t.keys.map((k, seat) => (seat === 0 ? t.keys[2]! : k));
    const astray = makeShow(plan, pos, x1, share, toSeat2, t.game.rootId, head.id, CARDS, t.game.rnd);
    expect(showEnvelope(astray, plan, CARDS)).toBe(true);
    expect(t.send(t.signed(1, astray))).toEqual(ALL);
    expect(t.spectator.view().head.seq).toBe(head.seq + 1);
    expect(new Set(t.all.map((s) => s.view().head.id)).size).toBe(1);
    for (const s of t.all) expect(stateOf(s).shows[0]).toEqual({ from: 1, to: 0, card: null });
  });

  it('audits shows: pass for honest play, fail for the shower otherwise', () => {
    const honest = table('show-audit');
    for (const turn of [0, 1, 2, 0]) round(honest, turn);
    expect(honest.spectator.view().phase).toBe('end');
    reveal(honest);
    for (const s of honest.all) expect(s.view().audit).toBe('pass');

    const pos = 2;
    /** Seat 1's first show carries `share` (of its position 2) in a packet seat 0 can open; then honest play. */
    const cheat = (
      seed: string,
      share: (t: Table, ctx: { rootId: string; deckId: string; pos: number }) => Share,
    ) => {
      const t = table(seed);
      expect(ask(t, 0)).toEqual(ALL);
      const head = t.spectator.view().head;
      const s = share(t, { rootId: t.game.rootId, deckId: 'cards', pos });
      const wire = makeShow(
        { id: 0, from: 1, to: 0 },
        pos,
        t.game.ids[1]!.deckSecret,
        s,
        t.keys,
        t.game.rootId,
        head.id,
        CARDS,
        t.game.rnd,
      );
      expect(t.send(t.signed(1, wire))).toEqual(ALL);
      // The packet opens, but its share does not verify for seat 1: seat 0 learns nothing, and play goes on.
      expect(stateOf(t.players[0]!).shows[0]!.card).toBeNull();
      for (const turn of [1, 2, 0]) round(t, turn);
      reveal(t);
      for (const session of t.all) {
        const audit = session.view().audit;
        expect(audit).toMatchObject({ fail: [1] });
        expect((audit as { reason: string }).reason).toMatch(/^move 5 private show fails: /);
      }
    };
    // A share made with another seat's secret.
    cheat('show-audit-other', (t, ctx) =>
      makeShare(t.game.ids[2]!.deckSecret, ciphertext(t.spectator, pos), ctx, t.game.rnd),
    );
    // The shower's own share with a broken proof: the right D, which the submitter cannot verify.
    cheat('show-audit-proof', (t, ctx) => {
      const share = makeShare(t.game.ids[1]!.deckSecret, ciphertext(t.spectator, pos), ctx, t.game.rnd);
      return { ...share, s: (share.s + 1n) % q };
    });
  });
});
