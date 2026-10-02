import { BLACK, inCheck, KING, legalMoves, PAWN, pieceCode, typeOf } from './board.ts';
import { automaticResult, fromFen, positionKey, toFen, toPos } from './position.ts';
import type { ChessState } from './types.ts';

/** Human-readable violations of the state's structural rules; empty when sound. */
export function checkInvariants(s: ChessState): string[] {
  const out: string[] = [];
  if (s.board.length !== 64) return ['board must have 64 squares'];
  if (s.board.some((p) => p !== null && pieceCode(p) === 0)) out.push('unknown piece letter');
  const pos = toPos(s);
  if (pos.board.filter((p) => p === KING).length !== 1) out.push('White must have one king');
  if (pos.board.filter((p) => p === (KING | BLACK)).length !== 1) out.push('Black must have one king');
  if (out.length > 0) return out;
  for (let f = 0; f < 8; f++) {
    if (typeOf(pos.board[f] as number) === PAWN || typeOf(pos.board[56 + f] as number) === PAWN)
      out.push('pawn on the first or last rank');
  }
  if (inCheck(pos, pos.side === 0 ? 1 : 0)) out.push('the side not to move is in check');
  if (!Number.isSafeInteger(s.halfmove) || s.halfmove < 0) out.push('halfmove clock');
  if (!Number.isSafeInteger(s.fullmove) || s.fullmove < 1) out.push('fullmove number');

  // The FEN must re-import to the same position (castling rights match the pieces, en passant normalized).
  const again = fromFen(toFen(s), s.rules);
  if (!again.ok) out.push(`FEN does not re-import: ${again.error.message}`);
  else if (again.value.ep !== s.ep) out.push('en passant square kept without a legal capture');

  const key = positionKey(pos);
  if (s.positions[s.positions.length - 1] !== key) out.push('positions must end with the current position');
  if (s.positions.length > s.halfmove + 1)
    out.push('positions reach back past the last capture or pawn move');

  const legal = legalMoves(pos);
  if (s.result === null) {
    if (automaticResult(pos, legal, s.positions) !== null) out.push('an automatic ending was missed');
    if (s.drawOffer !== null && s.drawOffer === (s.turn === 'w' ? 0 : 1))
      out.push('a standing draw offer must come from the seat not to move');
  } else {
    if (s.drawOffer !== null) out.push('a finished game keeps no draw offer');
    if (s.result.reason !== 'agreement') {
      const auto = automaticResult(pos, legal, s.positions);
      if (auto === null || auto.reason !== s.result.reason || auto.winner !== s.result.winner)
        out.push(`result ${s.result.reason} does not match the position`);
    }
  }
  const last = s.history[s.history.length - 1];
  if (last && last.seat === (s.turn === 'w' ? 0 : 1)) out.push('the last mover is to move again');
  return out;
}
