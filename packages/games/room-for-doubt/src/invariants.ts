/*
 * State invariants for the fuzzer and the tests (C43, C45). Every state: the pawns, the Exhibits, the deal, the
 * indictments and the stage agree with each other. In full mode the cards agree with the deck, and every claim
 * made so far is true: what the end audit replays.
 */
import { type DealtPosition, jsonEqual } from '@bored-games/game-kit';
import { CORRIDOR, squareIndex } from './board.ts';
import { holds, namedCards } from './engine.ts';
import {
  DECK_ID,
  EXHIBITS,
  HAND_POSITIONS,
  PARTIES,
  ROOM_POSITIONS,
  SCENES,
  type SceneId,
  VERDICT_POSITIONS,
} from './ids.ts';
import type { RfdState } from './types.ts';

const isScene = (x: string): x is SceneId => (SCENES as readonly string[]).includes(x);
/** Room card `21 + r` names `SCENES[r]` (ids.ts). */
const FIRST_ROOM_CARD = PARTIES.length + EXHIBITS.length + SCENES.length;

export function checkInvariants(s: RfdState): string[] {
  const out: string[] = [];
  const n = s.seats;

  // The pawns: six, each on a corridor square or in a room, never two on one square.
  if (s.pawns.length !== PARTIES.length) out.push(`${s.pawns.length} pawns`);
  const squares: number[] = [];
  for (const place of s.pawns) {
    const i = squareIndex(place);
    if (i === null ? !isScene(place) : !CORRIDOR.has(i)) out.push(`a pawn stands on ${place}`);
    if (i !== null) squares.push(i);
  }
  if (new Set(squares).size !== squares.length) out.push('two pawns share a square');

  // The Exhibits: the revealed room cards name six different rooms (P3), all six once the reveals are done. Each
  // Exhibit stands in the room its card names until a submission names it, then where the last one did.
  const revealed = s.roomCards.flatMap((r) => (r.card === null ? [] : [r.card]));
  if (s.exhibits.length !== EXHIBITS.length) out.push(`${s.exhibits.length} Exhibits`);
  if (new Set(revealed).size !== revealed.length) out.push('two room cards name one room');
  if (s.stage !== 'reveal' && revealed.length !== EXHIBITS.length) out.push('an Exhibit has no room');
  EXHIBITS.forEach((id, e) => {
    const card = s.roomCards[e]?.card ?? null;
    const start = card === null ? null : (SCENES[card - FIRST_ROOM_CARD] ?? null);
    const want = s.submissions.findLast((x) => x.exhibit === id)?.scene ?? start;
    if (s.exhibits[e] !== want) out.push(`the ${id} stands in ${s.exhibits[e]}, not ${want}`);
  });

  // The deal (P2), then the Verdict for each indicter, in order.
  s.players.forEach((p, seat) => {
    const want = HAND_POSITIONS.filter((_, k) => k % n === seat);
    if (
      !jsonEqual(
        p.hand.map((h) => h.pos),
        want,
      )
    )
      out.push(`seat ${seat} holds positions ${p.hand.map((h) => h.pos).join(',')}`);
  });
  const dealt: DealtPosition[] = [
    ...HAND_POSITIONS.map((pos, k) => ({ deck: DECK_ID, pos, to: k % n })),
    ...ROOM_POSITIONS.map((pos) => ({ deck: DECK_ID, pos, to: null })),
    ...s.indictments.flatMap((x) => VERDICT_POSITIONS.map((pos) => ({ deck: DECK_ID, pos, to: x.by }))),
  ];
  if (!jsonEqual(s.dealt, dealt)) out.push('dealt is not the deal followed by the Verdict for each indicter');

  // Seats: once each indicts; a wrong indictment dismisses; two stand until the game is over.
  const indicters = s.indictments.map((x) => x.by);
  if (new Set(indicters).size !== indicters.length) out.push('a seat indicted twice');
  s.players.forEach((p, seat) => {
    if (p.indicted !== indicters.includes(seat)) out.push(`seat ${seat}: indicted does not match the record`);
    const dismissed = s.indictments.some((x) => x.by === seat && x.upheld === false);
    if (p.dismissed !== dismissed) out.push(`seat ${seat}: dismissed does not match the record`);
    if (p.summoned && (p.dismissed || !isScene(s.pawns[p.party] ?? ''))) out.push(`seat ${seat}: summoned`);
  });
  if (s.indictments.slice(0, -1).some((x) => x.upheld !== false))
    out.push('only the last indictment may be open or upheld');
  if (s.stage !== 'over') {
    if (s.players.filter((p) => !p.dismissed).length < 2) out.push('fewer than two seats stand');
    if (s.players[s.turn]?.dismissed !== false) out.push('the turn seat is dismissed');
  }
  if ((s.result !== null) !== (s.stage === 'over')) out.push('a result is set exactly when the game is over');
  if ((s.stage === 'verdict') !== (s.indictments.at(-1)?.upheld === null))
    out.push('an indictment is open exactly at the verdict');

  // The stage's own fields.
  if ((s.stage === 'rebut') !== (s.asking !== null)) out.push('a seat is asked exactly while rebutting');
  if ((s.stage === 'roll') !== (s.roll !== null)) out.push('a roll is open exactly while rolling');
  if (s.roll !== null && s.roll !== s.rolls.length - 1) out.push('the open roll is not the last');
  if (s.stage !== 'roll' && s.contributors.length > 0) out.push('contributions owed outside a roll');
  if (s.stage === 'walk' && s.dice === null) out.push('walking without dice');
  s.rolls.forEach((r, i) => {
    if (r.id !== i) out.push(`roll ${i} has id ${r.id}`);
  });

  if (s.mode !== 'full' || s.order === null) return out;
  // Full mode: the cards are the deck's, and every claim is true.
  const order = s.order;
  for (const p of s.players)
    for (const h of p.hand) if (h.card !== order[h.pos]) out.push(`position ${h.pos} holds the wrong card`);
  for (const v of [...s.verdict, ...s.roomCards])
    if (v.card !== null && v.card !== order[v.pos]) out.push(`position ${v.pos} holds the wrong card`);
  if (s.verdict.some((v) => v.card === null)) out.push('the full state does not know the Verdict');
  s.submissions.forEach((x, i) => {
    const named = namedCards(x);
    for (const seat of x.passed) if (holds(s, seat, named)) out.push(`submission ${i}: seat ${seat} lied`);
    if (x.shownBy !== null && !holds(s, x.shownBy, named)) out.push(`submission ${i}: nothing to show`);
    if (x.card !== null && (x.shownBy === null || !named.includes(x.card) || !holds(s, x.shownBy, [x.card])))
      out.push(`submission ${i}: the shown card is not the shower's`);
  });
  const verdict = s.verdict.map((v) => v.card);
  for (const x of s.indictments)
    if (x.upheld !== null && x.upheld !== namedCards(x).every((c, i) => c === verdict[i]))
      out.push(`seat ${x.by}'s verdict is false`);
  return out;
}
