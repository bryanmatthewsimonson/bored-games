import type { Seat } from '@bored-games/game-kit';
import type { ChessRules } from './rules.ts';

/** A FEN piece letter: uppercase is White, lowercase is Black. */
export type Piece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Color = 'w' | 'b';
export type PromotionLetter = 'q' | 'r' | 'b' | 'n';

export type EndReason = 'checkmate' | 'stalemate' | 'repetition' | 'fifty-move' | 'material' | 'agreement';

export interface ChessResult {
  readonly reason: EndReason;
  /** The winning seat, or null for a draw. */
  readonly winner: Seat | null;
}

/** One played move, as the move list shows it. */
export interface MoveRecord {
  readonly seat: Seat;
  /** The fullmove number the move belongs to (FEN field 6 before the move). */
  readonly moveNumber: number;
  readonly uci: string;
  readonly san: string;
  /** The piece that moved (a pawn for a promotion). */
  readonly piece: Piece;
  /** The piece captured, including en passant, or null. */
  readonly captured: Piece | null;
  /** Whether this move carried a draw offer. */
  readonly drawOffered: boolean;
}

/**
 * The whole game state. Chess has perfect information, so every viewer's state
 * is identical; the state records no mode or viewer.
 */
export interface ChessState {
  readonly game: 'chess';
  readonly rules: ChessRules;
  /** 64 squares, a1, b1, ..., h1, a2, ..., h8; null is empty. */
  readonly board: readonly (Piece | null)[];
  readonly turn: Color;
  /** FEN castling field: a subset of "KQkq" in that order, or "-". */
  readonly castling: string;
  /**
   * The en passant target square, kept only when an en passant capture is
   * actually legal (so it is part of the position for repetition and FEN).
   */
  readonly ep: string | null;
  readonly halfmove: number;
  readonly fullmove: number;
  /**
   * Position keys (FEN fields 1-4) since the last capture or pawn move, oldest
   * first, ending with the current position. Earlier positions can never recur.
   */
  readonly positions: readonly string[];
  /** The seat whose draw offer, made with its last move, stands; null when none. */
  readonly drawOffer: Seat | null;
  readonly history: readonly MoveRecord[];
  readonly result: ChessResult | null;
}

export type ChessAction =
  | {
      readonly type: 'move';
      readonly actor: Seat;
      readonly uci: string;
      /** Present only when true. */
      readonly offerDraw?: true;
    }
  | { readonly type: 'acceptDraw'; readonly actor: Seat };

export type ChessEvent =
  | {
      readonly type: 'moved';
      readonly seat: Seat;
      readonly uci: string;
      readonly san: string;
      readonly piece: Piece;
      readonly captured: Piece | null;
      readonly castle: 'kingside' | 'queenside' | null;
      readonly enPassant: boolean;
      readonly promotion: PromotionLetter | null;
      readonly check: boolean;
    }
  | { readonly type: 'drawOffered'; readonly seat: Seat }
  | { readonly type: 'drawDeclined'; readonly seat: Seat }
  | { readonly type: 'drawAccepted'; readonly seat: Seat }
  | { readonly type: 'gameEnded'; readonly reason: EndReason; readonly winner: Seat | null };
