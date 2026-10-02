import type {
  ApplyResult,
  EngineError,
  Outcome,
  Pending,
  Result,
  Seat,
  SetupInput,
} from '@bored-games/game-kit';
import {
  FLAG_CASTLE,
  FLAG_EN_PASSANT,
  inCheck,
  legalMoves,
  makeMove,
  moveFlag,
  moveFrom,
  movePromo,
  moveTo,
  pieceLetter,
  squareName,
  uciOf,
} from './board.ts';
import {
  automaticResult,
  boardOf,
  castlingString,
  colorOfSide,
  fromFen,
  normalizeEp,
  positionKey,
  START_FEN,
  toPos,
} from './position.ts';
import { type ChessRules, validateRules } from './rules.ts';
import { checkSuffix, sanBody } from './san.ts';
import type { ChessAction, ChessEvent, ChessResult, ChessState, Piece, PromotionLetter } from './types.ts';
import { parseAction } from './validate.ts';

const fail = (code: string, message: string): { ok: false; error: EngineError } => ({
  ok: false,
  error: { code, message },
});

/** The seat to move: seat 0 plays White. */
export function seatToMove(s: ChessState): Seat {
  return s.turn === 'w' ? 0 : 1;
}

export function setupGame(input: SetupInput<ChessRules>): Result<ChessState> {
  const r = validateRules(input.rules);
  if (!r.ok) return r;
  if (input.seats !== 2) return fail('seats', 'chess is played by exactly 2 seats');
  if (input.mode === 'full') {
    if (
      input.deckOrders === null ||
      typeof input.deckOrders !== 'object' ||
      Object.keys(input.deckOrders).length > 0
    )
      return fail('deck', 'chess uses no decks');
  } else if (input.viewer !== null && input.viewer !== 0 && input.viewer !== 1) {
    return fail('viewer', 'viewer must be a seat or null');
  }
  return fromFen(START_FEN, r.value);
}

export function pendingOf(s: ChessState): Pending {
  if (s.result) return { type: 'over' };
  return { type: 'player', seat: seatToMove(s), decision: 'move' };
}

/**
 * Every legal action for `seat`: each legal move, plain and with a draw offer,
 * in UCI order, then `acceptDraw` while the opponent's offer stands.
 */
export function legalActionsOf(s: ChessState, seat: Seat): ChessAction[] {
  if (s.result || seat !== seatToMove(s)) return [];
  const ucis = legalMoves(toPos(s)).map(uciOf).sort();
  const out: ChessAction[] = [];
  for (const uci of ucis) out.push({ type: 'move', actor: seat, uci });
  for (const uci of ucis) out.push({ type: 'move', actor: seat, uci, offerDraw: true });
  if (s.drawOffer !== null && s.drawOffer !== seat) out.push({ type: 'acceptDraw', actor: seat });
  return out;
}

export function applyAction(s: ChessState, raw: unknown): ApplyResult<ChessState, ChessEvent> {
  try {
    return applyParsed(s, raw);
  } catch {
    // Hostile input (a throwing getter, a proxy) is rejected, never thrown.
    return fail('malformed', 'unreadable action');
  }
}

function applyParsed(s: ChessState, raw: unknown): ApplyResult<ChessState, ChessEvent> {
  const parsed = parseAction(raw);
  if (!parsed.ok) return parsed;
  const a = parsed.action;
  if (s.result) return fail('over', 'the game is over');
  const seat = seatToMove(s);
  if (a.actor !== seat) return fail('turn', `it is seat ${seat}'s move`);

  if (a.type === 'acceptDraw') {
    if (s.drawOffer === null || s.drawOffer === seat)
      return fail('no-offer', "there is no standing draw offer from the opponent's last move");
    const result: ChessResult = { reason: 'agreement', winner: null };
    return {
      ok: true,
      state: { ...s, drawOffer: null, result },
      events: [
        { type: 'drawAccepted', seat },
        { type: 'gameEnded', reason: 'agreement', winner: null },
      ],
    };
  }

  const pos = toPos(s);
  const legal = legalMoves(pos);
  const m = legal.find((x) => uciOf(x) === a.uci);
  if (m === undefined) return fail('illegal', `${a.uci} is not a legal move`);

  const from = moveFrom(m);
  const to = moveTo(m);
  const flag = moveFlag(m);
  const promo = movePromo(m);
  const piece = pieceLetter(pos.board[from] as number) as Piece;
  const body = sanBody(pos, m, legal);
  const moveNumber = pos.fullmove;
  const undo = makeMove(pos, m);
  const captured = undo.captured === 0 ? null : (pieceLetter(undo.captured) as Piece);
  const replies = legalMoves(pos);
  normalizeEp(pos, replies);
  const san = body + checkSuffix(pos, replies);
  const key = positionKey(pos);
  const positions = pos.halfmove === 0 ? [key] : [...s.positions, key];
  const result = automaticResult(pos, replies, positions);

  const events: ChessEvent[] = [];
  if (s.drawOffer !== null) events.push({ type: 'drawDeclined', seat });
  events.push({
    type: 'moved',
    seat,
    uci: a.uci,
    san,
    piece,
    captured,
    castle: flag === FLAG_CASTLE ? (to > from ? 'kingside' : 'queenside') : null,
    enPassant: flag === FLAG_EN_PASSANT,
    promotion: promo ? (pieceLetter(promo).toLowerCase() as PromotionLetter) : null,
    check: inCheck(pos),
  });
  if (a.offerDraw && !result) events.push({ type: 'drawOffered', seat });
  if (result) events.push({ type: 'gameEnded', reason: result.reason, winner: result.winner });

  return {
    ok: true,
    state: {
      game: 'chess',
      rules: s.rules,
      board: boardOf(pos),
      turn: colorOfSide(pos.side),
      castling: castlingString(pos.castling),
      ep: pos.ep < 0 ? null : squareName(pos.ep),
      halfmove: pos.halfmove,
      fullmove: pos.fullmove,
      positions,
      drawOffer: a.offerDraw && !result ? seat : null,
      history: [
        ...s.history,
        { seat, moveNumber, uci: a.uci, san, piece, captured, drawOffered: a.offerDraw },
      ],
      result,
    },
    events,
  };
}

/** Win 2/0, draw 1/1. */
export function outcomeOf(s: ChessState): Outcome | null {
  const r = s.result;
  if (!r) return null;
  if (r.winner === null) return { places: [1, 1], scores: [1, 1], reason: r.reason };
  return {
    places: r.winner === 0 ? [1, 2] : [2, 1],
    scores: r.winner === 0 ? [2, 0] : [0, 2],
    reason: r.reason,
  };
}

/** 1/1 while play continues (an even game); the final scores once it is over. */
export function standingsOf(s: ChessState): number[] {
  return outcomeOf(s)?.scores.slice() ?? [1, 1];
}
