import type { NostrEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { rightOfWay } from '../../games/right-of-way/src/module.ts';
import type { RowAction, RowPlayer, RowState } from '../../games/right-of-way/src/types.ts';
import type { GameSession } from '../src/session.ts';
import { deliver, makeModuleGame, NOW, newSession, trust } from './helpers.ts';

/*
 * A deck with positions of 128 and more. Holler's play-phase epochs sit at `128 * k + i` (D073), but they exist only
 * from the deck size on, so an opening position is any position below the deck size, whatever its value. Right of
 * Way's packet has 580 positions. Its charters, at 550–579, are dealt at setup and again during play, so every
 * share, learn and reveal of a charter must look the position up in the opening deck, not in an epoch.
 */

/** The module state as `s` sees it. */
const stateOf = (s: GameSession): RowState => s.view().state as RowState;

/** The ciphertext the session holds at deck position `pos` (a private lookup, to pin the boundaries). */
const ciphertextAt = (s: GameSession, pos: number): unknown =>
  (s as unknown as { ciphertextAt(pos: number): unknown }).ciphertextAt(pos);

/** Every charter a seat's state lists: kept, offered and returned. */
const chartersOf = (p: RowPlayer | undefined) => [
  ...(p?.charters ?? []),
  ...(p?.offered ?? []),
  ...(p?.memory ?? []),
];

describe('a deck with positions of 128 and more (Right of Way)', () => {
  it('deals and plays a deck with positions of 128 and more (Right of Way)', () => {
    const game = makeModuleGame(rightOfWay, 2, 'large-deck');
    game.modules = new Map([[rightOfWay.id, rightOfWay]]);
    const players = [newSession(game, 0), newSession(game, 1)];
    const spectator = newSession(game, null);
    const all = [...players, spectator];
    const rejected: string[] = [];
    const actions: { seat: number; action: RowAction }[] = [];
    /**
     * The script: both seats keep charters, the seat to move draws three more and keeps one, then the other seat takes
     * two cards. Charters are dealt at setup (550–555) and in play (556–558): both must be shared, verified, learned.
     */
    const WANT = 6;
    let drewCharters = false;

    const choose = (legal: readonly RowAction[]): RowAction | undefined => {
      const keep = legal.find((a) => a.type === 'keep');
      if (keep !== undefined) return keep;
      const charters = legal.find((a) => a.type === 'charters');
      if (charters !== undefined && !drewCharters) {
        drewCharters = true;
        return charters;
      }
      return legal.find((a) => a.type === 'take') ?? legal[0];
    };

    for (let step = 0; step < 400; step++) {
      let progressed = false;
      for (const [seat, s] of players.entries()) {
        const duty = s.duties()[0];
        if (duty === undefined) continue;
        let ev: NostrEvent;
        let action: RowAction | null = null;
        if (duty.kind === 'shuffle') {
          ev = s.buildShuffle(game.rnd, NOW);
          // Shuffle proofs are covered in shuffle-phase.test.ts: this step proved its own, nobody verifies it again.
          trust(all, [ev]);
        } else if (duty.kind === 'deal') ev = s.buildDeal(game.rnd, NOW);
        else if (duty.kind === 'share') ev = s.buildShares(game.rnd, NOW);
        else if (duty.kind === 'seal') ev = s.buildSealed(game.rnd, NOW);
        else if (duty.kind === 'decide') {
          if (actions.length >= WANT) continue;
          action = choose(s.legalActions() as readonly RowAction[]) ?? null;
          if (action === null) throw new Error(`seat ${seat} has a decision and no legal action`);
          ev = s.buildAction(action, game.rnd, NOW);
        } else throw new Error(`unexpected duty ${duty.kind} for seat ${seat}`);
        const results = deliver(all, [ev], undefined, NOW)[0] ?? [];
        for (const r of results) if (r.status === 'rejected') rejected.push(`${duty.kind}: ${r.reason}`);
        if (action !== null) {
          // Every session, a spectator's too, takes a game action the moment it is published.
          expect(results.map((r) => r.status)).toEqual(all.map(() => 'accepted'));
          actions.push({ seat, action });
        }
        progressed = true;
      }
      if (!progressed) break;
    }

    // The deal finished and the game went on: no session waits on a position it cannot find.
    expect(rejected).toEqual([]);
    for (const s of all) expect(s.view().phase).toBe('play');
    expect(actions).toHaveLength(WANT);
    expect(actions.slice(0, 4).map((a) => a.action.type)).toEqual(['keep', 'keep', 'charters', 'keep']);
    const head = spectator.view().head;
    for (const s of players) expect(s.view().head).toEqual(head);

    // The opening deck answers every position below its size, on both sides of 128, and nothing at or past it.
    for (const pos of [0, 127, 128, 129, 549, 550, 579]) expect(ciphertextAt(spectator, pos)).toBeDefined();
    for (const pos of [580, 640, 1000]) expect(ciphertextAt(spectator, pos)).toBeUndefined();

    // Each seat learned its own charters, at positions of 550 and more, and nobody learned another seat's.
    for (const [seat, s] of players.entries()) {
      const own = chartersOf(stateOf(s).players[seat]);
      expect(own.length).toBeGreaterThanOrEqual(3);
      for (const slot of own) {
        expect(slot.pos).toBeGreaterThanOrEqual(550);
        expect(slot.card).not.toBeNull();
      }
      for (const slot of chartersOf(stateOf(s).players[1 - seat])) expect(slot.card).toBeNull();
    }
    for (const seat of [0, 1]) {
      for (const slot of chartersOf(stateOf(spectator).players[seat])) expect(slot.card).toBeNull();
    }

    // The seat that drew charters in play learned them as well: setup deals two seats only 550–555.
    const drawer = actions.find((a) => a.action.type === 'charters')?.seat ?? -1;
    const drawn = chartersOf(stateOf(players[drawer] as GameSession).players[drawer]);
    expect(drawn.some((slot) => slot.pos >= 556 && slot.card !== null)).toBe(true);
  }, 180_000);
});
