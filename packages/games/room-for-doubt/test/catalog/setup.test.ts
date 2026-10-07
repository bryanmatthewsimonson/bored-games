import { createRng, range } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  EXHIBITS as ART_EXHIBITS,
  PARTIES as ART_PARTIES,
  SCENES as ART_SCENES,
} from '../../../../../scripts/room-for-doubt/data.ts';
import { BOARD_ROWS, ENTRANCES } from '../../src/board.ts';
import { cardOf, DEFAULT_RULES, pendingOf } from '../../src/engine.ts';
import {
  cardName,
  DECK_ID,
  DECK_SIZE,
  EXHIBITS,
  HAND_POSITIONS,
  kindOf,
  PARTIES,
  ROOM_POSITIONS,
  SCENES,
  SEAT_PARTIES,
  VERDICT_POSITIONS,
} from '../../src/ids.ts';
import { CASE_DECK, roomForDoubt } from '../../src/module.ts';
import { ROOM_FOR_DOUBT_THEME } from '../../src/theme.ts';
import type { RfdState } from '../../src/types.ts';
import {
  act,
  caseOrder,
  fresh,
  freshView,
  learned,
  legal,
  orderWith,
  passTurn,
  refused,
  revealAll,
  rollTo,
  started,
  VERDICT,
} from '../helpers.ts';

const SEATS = [3, 4, 5, 6] as const;

const setupWith = (seats: number, order: readonly number[]) =>
  roomForDoubt.setup({ rules: DEFAULT_RULES, seats, mode: 'full', deckOrders: { [DECK_ID]: order } });

describe('setup', () => {
  it('C01 components: 21 cards with their ids and names, 6 pawns, 6 Exhibit tokens, 2 dice and the board', () => {
    expect(PARTIES).toHaveLength(6);
    expect(EXHIBITS).toHaveLength(6);
    expect(SCENES).toHaveLength(9);
    // The card numbers: Parties 0-5, Exhibits 6-11, Scenes 12-20; room cards 21-29 only place the Exhibits.
    expect(range(21).map(cardName)).toEqual([...PARTIES, ...EXHIBITS, ...SCENES]);
    expect(range(21).map(kindOf)).toEqual([
      ...PARTIES.map(() => 'party'),
      ...EXHIBITS.map(() => 'exhibit'),
      ...SCENES.map(() => 'scene'),
    ]);
    for (const id of [...PARTIES, ...EXHIBITS, ...SCENES]) expect(cardName(cardOf(id))).toBe(id);
    expect(cardOf('nobody' as never)).toBe(-1);
    // One deck: the four groups, the second round over the hands (D076), and the share duties (D075).
    expect(CASE_DECK).toEqual({
      id: 'case',
      size: 30,
      partitions: [
        { id: 'parties', size: 6 },
        { id: 'exhibits', size: 6 },
        { id: 'scenes', size: 9 },
        { id: 'rooms', size: 9 },
      ],
      secondRound: [{ id: 'mix', positions: HAND_POSITIONS }],
      promptShares: true,
    });
    expect(roomForDoubt.decks(DEFAULT_RULES)).toEqual([CASE_DECK]);
    expect(DECK_SIZE).toBe(30);
    // The names of the tables, from the brand pack, as the art draws them.
    const theme = ROOM_FOR_DOUBT_THEME;
    expect(theme.parties.map((p) => p.name)).toContain('Rosalind Ashdown');
    expect(theme.exhibits).toContain('Clock Hand');
    expect(theme.scenes).toContain("Judge's Chambers");
    expect(theme.parties.map((p) => p.name)).toEqual(ART_PARTIES.map((p) => p.name));
    expect(theme.parties.map((p) => [p.role, p.monogram, p.emblem, p.accent, p.door])).toEqual(
      ART_PARTIES.map((p) => [p.role, p.monogram, p.emblem, p.accent, p.entrance]),
    );
    expect(theme.exhibits).toEqual(ART_EXHIBITS.map((e) => e.name));
    expect(theme.scenes).toEqual(ART_SCENES.map((s) => s.name));
    // Six pawns and six Exhibit tokens on the 24 by 24 board; two dice in a roll.
    const s = started(3);
    expect(s.pawns).toHaveLength(6);
    expect(s.exhibits).toHaveLength(6);
    expect(BOARD_ROWS).toHaveLength(24);
    for (const row of BOARD_ROWS) expect(row).toHaveLength(24);
    expect(rollTo(s, [2, 5]).dice).toEqual([2, 5]);
  });

  it('C02 seats: three to six are accepted; two and seven are refused', () => {
    for (const seats of SEATS) {
      expect(setupWith(seats, orderWith()).ok, `${seats} seats`).toBe(true);
      expect(roomForDoubt.setup({ rules: DEFAULT_RULES, seats, mode: 'view', viewer: null }).ok).toBe(true);
    }
    for (const seats of [2, 7, 1, 0, 3.5, -3])
      expect(setupWith(seats, orderWith()).ok, `${seats} seats`).toBe(false);
    for (const seats of [2, 7])
      expect(roomForDoubt.setup({ rules: DEFAULT_RULES, seats, mode: 'view', viewer: 0 }).ok).toBe(false);
    expect(roomForDoubt.seatRange(DEFAULT_RULES)).toEqual({ min: 3, max: 6 });
  });

  it('C03 the Verdict: one Party, one Exhibit and one Scene, sealed at setup and dealt to no seat', () => {
    for (const seats of SEATS) {
      const s = fresh(seats);
      expect(s.dealt.filter((d) => VERDICT_POSITIONS.includes(d.pos))).toEqual([]);
      for (let seat = 0; seat < seats; seat++) {
        expect(roomForDoubt.knownTo(s, seat).filter((l) => VERDICT_POSITIONS.includes(l.pos))).toEqual([]);
        expect(roomForDoubt.view(s, seat).verdict.map((v) => v.card)).toEqual([null, null, null]);
      }
      expect(roomForDoubt.view(s, null).verdict.map((v) => v.card)).toEqual([null, null, null]);
      expect(s.verdict.map((v) => v.card)).toEqual(VERDICT.map((id) => cardOf(id)));
    }
    const rng = createRng('c03');
    for (let i = 0; i < 20; i++) {
      const order = caseOrder(rng);
      const s = fresh(SEATS[i % 4] as number, order);
      expect(s.verdict.map((v) => v.pos)).toEqual(VERDICT_POSITIONS);
      expect(s.verdict.map((v) => kindOf(v.card as number))).toEqual(['party', 'exhibit', 'scene']);
      expect(s.dealt.some((d) => VERDICT_POSITIONS.includes(d.pos))).toBe(false);
    }
    // An order the shuffle cannot produce is refused: here the Verdict's Party position would hold an Exhibit.
    const rest = range(21)
      .filter((n) => !VERDICT.map((id) => cardOf(id)).includes(n))
      .map(cardName);
    const exhibitFirst = orderWith(VERDICT, ['gavel', ...rest.filter((id) => id !== 'gavel')]);
    const swapped = [...exhibitFirst];
    [swapped[0], swapped[1]] = [swapped[1] as number, swapped[0] as number];
    expect(setupWith(3, swapped).ok).toBe(false);
    // With the default deal position 1 holds a Party, so the same swap is merely another Verdict Party.
    const parties = [...orderWith()];
    [parties[0], parties[1]] = [parties[1] as number, parties[0] as number];
    expect(setupWith(3, parties).ok).toBe(true);
    for (const bad of [[...orderWith()].reverse(), orderWith().slice(1), [...orderWith().slice(1), 0]])
      expect(setupWith(3, bad).ok).toBe(false);
  });

  it('C04 the deal: the other 18 cards from seat 0 in the P2 counts, each held by exactly one seat', () => {
    const sizes: Record<number, number[]> = {
      3: [6, 6, 6],
      4: [5, 5, 4, 4],
      5: [4, 4, 4, 3, 3],
      6: [3, 3, 3, 3, 3, 3],
    };
    const rng = createRng('c04');
    for (const seats of SEATS) {
      const s = fresh(seats, caseOrder(rng));
      expect(s.players.map((p) => p.hand.length)).toEqual(sizes[seats]);
      expect(s.dealt).toEqual([
        ...HAND_POSITIONS.map((pos, i) => ({ deck: DECK_ID, pos, to: i % seats })),
        ...ROOM_POSITIONS.map((pos) => ({ deck: DECK_ID, pos, to: null })),
      ]);
      for (const [seat, p] of s.players.entries())
        expect(p.hand.map((h) => h.pos)).toEqual(HAND_POSITIONS.filter((_, i) => i % seats === seat));
      const verdict = s.verdict.map((v) => v.card as number);
      const held = s.players.flatMap((p) => p.hand.map((h) => h.card as number));
      expect([...held].sort((a, b) => a - b)).toEqual(range(21).filter((n) => !verdict.includes(n)));
      // Each seat knows its own hand and nothing else.
      for (let seat = 0; seat < seats; seat++) {
        const v = roomForDoubt.view(s, seat);
        expect(v.players.map((p, i) => p.hand.every((h) => (h.card !== null) === (i === seat)))).toEqual(
          s.players.map(() => true),
        );
        expect(roomForDoubt.knownTo(s, seat).map((l) => l.pos)).toEqual(
          s.players[seat]?.hand.map((h) => h.pos),
        );
      }
    }
  });

  it('C05 Parties and Entrances: seats take Parties as P1 says, and every pawn starts on its Entrance', () => {
    const named: Record<number, string[]> = {
      3: ['ashdown', 'reeve', 'faulk'],
      4: ['ashdown', 'brine', 'crowther', 'faulk'],
      5: ['ashdown', 'brine', 'reeve', 'crowther', 'faulk'],
      6: [...PARTIES],
    };
    for (const seats of SEATS) {
      const s = fresh(seats);
      expect(s.players.map((p) => p.party)).toEqual(SEAT_PARTIES[seats]);
      expect(s.players.map((p) => PARTIES[p.party])).toEqual(named[seats]);
      // All six pawns, played or not, by Party: Entrances 1-6.
      expect(s.pawns).toEqual(['H1', 'S1', 'X8', 'P24', 'G24', 'A13']);
      expect(s.pawns).toEqual(ENTRANCES);
      expect(roomForDoubt.view(s, null).pawns).toEqual(ENTRANCES);
    }
  });

  it('C06 Exhibit start: six distinct rooms from the public setup, identically on every client', () => {
    const s = fresh(4);
    expect(s.stage).toBe('reveal');
    expect(pendingOf(s)).toEqual({ type: 'reveal', deck: DECK_ID, positions: [21, 22, 23, 24, 25, 26] });
    expect(s.exhibits).toEqual([null, null, null, null, null, null]);
    expect(legal(s, 0)).toEqual([]);
    // The full state takes only the deck's card. A view takes the room card the reveal's shares decrypt to, but
    // never a card of another kind, nor a room card already revealed.
    const reveal = (pos: number, card: number) => ({
      type: 'reveal',
      actor: 'deck',
      deck: DECK_ID,
      pos,
      card,
    });
    expect(refused(s, reveal(21, 22))).not.toBeNull();
    expect(refused(s, reveal(27, 27))).not.toBeNull();
    const spectator = act(freshView(4, null), reveal(21, 29));
    expect(spectator.exhibits[0]).toBe('gallery');
    for (const card of [0, 5, 20, 29, 30])
      expect(refused(spectator, reveal(22, card)), `card ${card}`).not.toBeNull();
    expect(refused(spectator, reveal(21, 28))).not.toBeNull();
    const t = revealAll(s);
    expect(t.exhibits).toEqual(['courtroom', 'chambers', 'jury', 'robing', 'registry', 'store']);
    expect(t.roomCards.map((r) => r.card)).toEqual([21, 22, 23, 24, 25, 26]);
    expect(t.stage).toBe('start');
    // A shuffled setup: six different rooms, the same in every seat's view and the spectator's.
    const rng = createRng('c06');
    for (const seats of SEATS) {
      const order = caseOrder(rng);
      const full = revealAll(fresh(seats, order));
      expect(new Set(full.exhibits).size).toBe(6);
      expect(full.exhibits).toEqual(full.roomCards.map((r) => SCENES[(r.card as number) - 21]));
      for (const viewer of [...range(seats), null]) {
        let v: RfdState = revealAll(freshView(seats, viewer), order);
        expect(v.exhibits, `viewer ${viewer}`).toEqual(full.exhibits);
        // With its own hand learned, each view is the redaction of the full state.
        if (viewer !== null) for (const l of roomForDoubt.knownTo(full, viewer)) v = learned(v, l);
        expect(v).toEqual(roomForDoubt.view(full, viewer));
      }
    }
  });

  it('C07 first player: seat 0, the Prosecutor, moves first, then play passes in seat order', () => {
    let s = started(3);
    expect(s.turn).toBe(0);
    expect(PARTIES[s.players[0]?.party as number]).toBe('ashdown');
    expect(pendingOf(s)).toEqual({ type: 'player', seat: 0, decision: 'start' });
    const seen = [s.turn];
    for (let i = 0; i < 3; i++) {
      s = passTurn(s);
      seen.push(s.turn);
      expect(pendingOf(s)).toEqual({ type: 'player', seat: s.turn, decision: 'start' });
    }
    expect(seen).toEqual([0, 1, 2, 0]);
    expect(act(started(5), { type: 'roll', actor: 0 }).stage).toBe('roll');
  });
});
