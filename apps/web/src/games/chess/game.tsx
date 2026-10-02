/*
 * The Chess screen (a placeholder until Phase D2): an 8×8 board of buttons with Unicode pieces, click a piece
 * then a target square, a promotion select, draw offer and acceptance, the move list in SAN and the result. Only
 * the board (`ChessBoard`) and the piece glyphs are meant to be replaced; the rest is props-driven, as D032.
 */
import type { ChessAction, ChessState, PromotionLetter } from '@bored-games/chess';
import { CHESS_THEME } from '@bored-games/chess/theme';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { CHESS_META } from './meta.ts';
import {
  canAcceptDraw,
  colorName,
  glyph,
  moveAction,
  moveRows,
  movesTo,
  pieceSeat,
  resultText,
  type SquareView,
  squareViews,
  statusLine,
} from './model.ts';
import './chess.css';

const PROMOTIONS: readonly PromotionLetter[] = ['q', 'r', 'b', 'n'];

/** The board: 64 buttons in display order, with file and rank hints on the edge squares. */
export function ChessBoard(props: {
  squares: readonly SquareView[];
  interactive: boolean;
  onSquare: (square: string) => void;
}) {
  return (
    <fieldset class="chess-board-wrap">
      <legend class="sr-only">Board</legend>
      <div class="chess-board">
        {props.squares.map((sq, i) => {
          const cls = [
            'chess-sq',
            sq.dark ? 'dark' : 'light',
            sq.last ? 'last' : '',
            sq.check ? 'check' : '',
            sq.selected ? 'selected' : '',
            sq.target ? 'target' : '',
          ]
            .filter((c) => c !== '')
            .join(' ');
          return (
            <button
              key={sq.square}
              type="button"
              class={cls}
              aria-label={sq.target ? `${sq.label}, legal move` : sq.label}
              aria-pressed={sq.selected}
              aria-disabled={!props.interactive}
              data-square={sq.square}
              onClick={() => props.onSquare(sq.square)}
            >
              {sq.piece !== null && (
                <span
                  class={pieceSeat(sq.piece) === 0 ? 'chess-piece white' : 'chess-piece black'}
                  aria-hidden="true"
                >
                  {glyph(sq.piece)}
                </span>
              )}
              {i % 8 === 0 && (
                <span class="chess-coord rank" aria-hidden="true">
                  {sq.square[1]}
                </span>
              )}
              {i >= 56 && (
                <span class="chess-coord file" aria-hidden="true">
                  {sq.square[0]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ChessGame(props: GameViewProps) {
  const state = props.view.state as ChessState;
  const { mySeat, names } = props;
  const legal = props.legal as readonly ChessAction[];
  const flipped = mySeat === 1;
  const seq = state.history.length;
  const [from, setFrom] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<PromotionLetter>('q');
  const [offer, setOffer] = useState(false);
  // The move count a move was sent at: no second move until the state moves on or the send fails.
  const [sentAt, setSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  useEffect(() => {
    setFrom(null);
    setOffer(false);
  }, [seq]);

  const myTurn = props.canAct && legal.length > 0 && mySeat !== null && !props.busy && sentAt !== seq;
  const squares = useMemo(() => squareViews(state, flipped, from), [state, flipped, from]);
  const promoting =
    from !== null && squares.some((s) => s.target && movesTo(state, from, s.square).length > 1);
  const result = resultText(state, props.view.outcome, names, props.view.resigned);

  const send = (action: ChessAction) => {
    setSentAt(seq);
    props.onAct(action).catch(() => setSentAt(null));
  };
  const onSquare = (square: string) => {
    if (!myTurn || mySeat === null) return;
    if (from !== null && from !== square) {
      const action = moveAction(state, mySeat, from, square, promotion, offer);
      if (action !== null) {
        send(action);
        return;
      }
    }
    const piece = squares.find((s) => s.square === square)?.piece ?? null;
    setFrom(square === from || piece === null || pieceSeat(piece) !== mySeat ? null : square);
  };

  const rows = moveRows(state.history);
  return (
    <div
      class="chess-game"
      data-testid="chess-game"
      data-seq={seq}
      data-turn={state.turn}
      data-result={props.view.outcome?.reason ?? ''}
    >
      <section class="chess-main" aria-labelledby="chess-title">
        <h1 id="chess-title" class="sr-only">
          {CHESS_THEME.title}
        </h1>
        <PlayerBar seat={flipped ? 0 : 1} {...props} />
        <ChessBoard squares={squares} interactive={myTurn} onSquare={onSquare} />
        <PlayerBar seat={flipped ? 1 : 0} {...props} />
      </section>
      <div class="chess-side">
        {result !== null ? (
          <section class="panel chess-result" aria-labelledby="chess-result-h">
            <h2 id="chess-result-h">Game over</h2>
            <p class="chess-result-text" role="status">
              {result}
            </p>
          </section>
        ) : (
          <section class="panel chess-status" aria-label="Status">
            <p class="chess-status-line" role="status">
              {statusLine(state, names, mySeat)}
            </p>
            {props.deadline !== undefined && <p class="muted">{props.deadline}</p>}
            {props.notice !== undefined && <p class="muted">{props.notice}</p>}
            {props.onClaimTimeout !== undefined && props.timeoutExplanation !== undefined && (
              <ClaimTimeout
                explanation={props.timeoutExplanation}
                busy={props.busy}
                onClaim={props.onClaimTimeout}
              />
            )}
            {mySeat !== null && !myTurn && legal.length === 0 && !props.ended && (
              <p class="muted">{props.lockedReason}</p>
            )}
            {myTurn && (
              <div class="chess-controls">
                <p class="hint">
                  {from === null
                    ? 'Pick one of your pieces, then the square to move it to.'
                    : `Moving from ${from}: pick a square.`}
                </p>
                {promoting && (
                  <label class="field chess-promotion">
                    Promote to
                    <select
                      value={promotion}
                      onChange={(e) => setPromotion(e.currentTarget.value as PromotionLetter)}
                    >
                      {PROMOTIONS.map((p) => (
                        <option key={p} value={p}>
                          {CHESS_THEME.pieces[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label class="check">
                  <input
                    type="checkbox"
                    checked={offer}
                    onChange={(e) => setOffer(e.currentTarget.checked)}
                  />
                  Offer a draw with this move
                </label>
                {canAcceptDraw(legal) && (
                  <div class="chess-draw-offer">
                    <p>{names[1 - mySeat] ?? colorName(1 - (mySeat ?? 0))} offers a draw.</p>
                    <button
                      type="button"
                      class="btn btn-small btn-primary"
                      onClick={() => send({ type: 'acceptDraw', actor: mySeat as number })}
                    >
                      Accept the draw
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        <section class="panel chess-moves" aria-labelledby="chess-moves-h">
          <div class="panel-head">
            <h2 id="chess-moves-h">Moves</h2>
            <a class="btn btn-small" href={rulesHref(CHESS_META.id)} target="_blank" rel="noopener">
              Rules<span class="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          {rows.length === 0 ? (
            <p class="muted">No moves yet.</p>
          ) : (
            <ol class="chess-move-list">
              {rows.map((r) => (
                <li key={r.n} value={r.n}>
                  <span class="chess-move-n">{r.n}.</span>
                  <span class="chess-san">{r.white ?? '…'}</span>
                  <span class="chess-san">{r.black ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

/** A player's name, colour and avatar above or below the board; the side to move is marked. */
function PlayerBar(props: GameViewProps & { seat: number }) {
  const state = props.view.state as ChessState;
  const toMove = state.result === null && (state.turn === 'w' ? 0 : 1) === props.seat && !props.ended;
  return (
    <div class={toMove ? 'chess-player to-move' : 'chess-player'}>
      {props.avatars[props.seat]}
      <span class="chess-player-name">
        <bdi>{props.names[props.seat] ?? `Seat ${props.seat + 1}`}</bdi> ({colorName(props.seat)})
        {props.mySeat === props.seat ? ', you' : ''}
      </span>
      {toMove && <span class="chip">to move</span>}
    </div>
  );
}
