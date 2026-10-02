/*
 * The Chess screen (D048): the board, the players with their captures, the status and draw offer, the move list
 * and the result.
 * - The board is 64 buttons, labelled "e4, white knight" plus the square's state. Click (or Enter/Space) a piece,
 *   then a target; or drag a piece with the pointer. Arrow keys, Home and End move the focus; Escape drops the
 *   selection. Targets show a dot (a quiet move) or a ring (a capture); the last move and a king in check are
 *   tinted and outlined, and say so in their names, so colour is never the only cue.
 * - A promotion opens a dialog with the four pieces.
 * - The pieces are the Cburnett set (BSD-3-Clause, pieces/LICENSE.txt and #/credits).
 * Resign is the platform's button (screens/game.tsx); a draw offer rides on a move, as the engine wants.
 */
import type { ChessAction, ChessState, Piece, PromotionLetter } from '@bored-games/chess';
import { CHESS_THEME } from '@bored-games/chess/theme';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import { rulesHref } from '../../router.ts';
import type { GameViewProps } from '../types.ts';
import { CHESS_META } from './meta.ts';
import {
  canAcceptDraw,
  capturedText,
  colorName,
  drawNotice,
  isLegal,
  liveAnnouncement,
  type MoveCell,
  materialViews,
  moveAction,
  moveRows,
  movesTo,
  PROMOTIONS,
  pieceSeat,
  promotionName,
  promotionPiece,
  resultView,
  type SquareView,
  squareViews,
  statusLine,
  stepSquare,
} from './model.ts';
import { pieceSrc } from './pieces/cburnett.ts';
import './chess.css';

/** A piece image; decorative, since the square's name says what stands there. */
export function PieceImage(props: { piece: Piece; class?: string }) {
  return (
    <img
      class={props.class ?? 'chess-piece'}
      src={pieceSrc(props.piece)}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export interface BoardGridProps {
  squares: readonly SquareView[];
  /** False when the viewer may not move now: the squares stay focusable but do nothing. */
  interactive: boolean;
  /** The one square in the tab order (roving tabindex). */
  tabSquare: string;
  /** Squares whose piece the viewer may pick up now. */
  movable: ReadonlySet<string>;
  /** The square whose piece is being dragged (shown faded), or null. */
  dragFrom: string | null;
  onSquare: (square: string) => void;
  onKeyDown?: (square: string, e: KeyboardEvent) => void;
  onFocusSquare?: (square: string) => void;
  onPointerDown?: (square: string, e: PointerEvent) => void;
}

/** The 64 squares, without state: pieces, highlights, target marks and the edge coordinates. */
export function BoardGrid(props: BoardGridProps) {
  return (
    <fieldset class="chess-board-set">
      <legend class="sr-only">Board</legend>
      <div class={props.interactive ? 'chess-board' : 'chess-board locked'}>
        {props.squares.map((sq) => {
          const cls = [
            'chess-sq',
            sq.dark ? 'dark' : 'light',
            sq.last ? 'last' : '',
            sq.check ? 'check' : '',
            sq.selected ? 'selected' : '',
            sq.target === null ? '' : `target-${sq.target}`,
            props.movable.has(sq.square) ? 'movable' : '',
            sq.square === props.dragFrom ? 'dragging' : '',
          ]
            .filter((c) => c !== '')
            .join(' ');
          return (
            <button
              key={sq.square}
              type="button"
              class={cls}
              aria-label={sq.label}
              aria-pressed={sq.selected}
              tabIndex={sq.square === props.tabSquare ? 0 : -1}
              data-square={sq.square}
              onClick={() => props.onSquare(sq.square)}
              onKeyDown={(e) => props.onKeyDown?.(sq.square, e)}
              onFocus={() => props.onFocusSquare?.(sq.square)}
              onPointerDown={(e) => props.onPointerDown?.(sq.square, e)}
            >
              {sq.piece !== null && <PieceImage piece={sq.piece} />}
              {sq.target !== null && <span class={`chess-mark ${sq.target}`} aria-hidden="true" />}
              {sq.rankHint !== null && (
                <span class="chess-coord rank" aria-hidden="true">
                  {sq.rankHint}
                </span>
              )}
              {sq.fileHint !== null && (
                <span class="chess-coord file" aria-hidden="true">
                  {sq.fileHint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface Drag {
  from: string;
  piece: Piece;
  pointerId: number;
  x0: number;
  y0: number;
  active: boolean;
}

/** Pixels a press must travel before it becomes a drag (a shorter one is a click). */
const DRAG_START = 6;

/**
 * The interactive board: focus moves with the arrow keys, and a piece the viewer may move can be dragged with a
 * pointer (mouse, pen or touch) as well as clicked.
 */
export function ChessBoard(props: {
  squares: readonly SquareView[];
  flipped: boolean;
  interactive: boolean;
  movable: ReadonlySet<string>;
  onSquare: (square: string) => void;
  /** A drag began on `from`: select it. */
  onPick: (from: string) => void;
  /** A drag ended on `to` (null: off the board). */
  onDrop: (from: string, to: string | null) => void;
  onEscape: () => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // A click that follows a drag is the drag's own; it is ignored once.
  const swallowClick = useRef(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ piece: Piece; x: number; y: number; size: number } | null>(null);

  const selected = props.squares.find((s) => s.selected)?.square ?? null;
  const fallback = props.flipped ? 'e7' : 'e2';
  const tabSquare = focused ?? selected ?? fallback;

  const squareAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-square]');
    return el instanceof HTMLElement && boardRef.current?.contains(el) ? (el.dataset.square ?? null) : null;
  };

  const onPointerDown = (square: string, e: PointerEvent) => {
    swallowClick.current = false;
    if (e.button !== 0 || !props.movable.has(square)) return;
    const piece = props.squares.find((s) => s.square === square)?.piece ?? null;
    if (piece === null) return;
    drag.current = {
      from: square,
      piece,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      active: false,
    };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_START) return;
      d.active = true;
      // Captured only once it is a drag, so a plain click still lands on its square's button.
      boardRef.current?.setPointerCapture(e.pointerId);
      props.onPick(d.from);
    }
    const size = (boardRef.current?.getBoundingClientRect().width ?? 400) / 8;
    setGhost({ piece: d.piece, x: e.clientX, y: e.clientY, size });
  };
  const endDrag = (e: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setGhost(null);
    if (boardRef.current?.hasPointerCapture(e.pointerId)) boardRef.current.releasePointerCapture(e.pointerId);
    if (!d.active) return;
    swallowClick.current = true;
    if (!cancelled) props.onDrop(d.from, squareAt(e.clientX, e.clientY));
  };

  const onKeyDown = (square: string, e: KeyboardEvent) => {
    swallowClick.current = false;
    if (e.key === 'Escape') {
      props.onEscape();
      return;
    }
    // Leave modified keys (Alt+Left is "back", Cmd/Ctrl+arrows scroll or switch) to the browser.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const next = stepSquare(square, e.key, props.flipped);
    if (next === null) return;
    e.preventDefault();
    setFocused(next);
    boardRef.current?.querySelector<HTMLElement>(`[data-square="${next}"]`)?.focus();
  };

  return (
    <div
      ref={boardRef}
      class="chess-board-wrap"
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
    >
      <BoardGrid
        squares={props.squares}
        interactive={props.interactive}
        tabSquare={tabSquare}
        movable={props.movable}
        dragFrom={ghost === null ? null : (drag.current?.from ?? null)}
        onSquare={(sq) => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          props.onSquare(sq);
        }}
        onKeyDown={onKeyDown}
        onFocusSquare={setFocused}
        onPointerDown={onPointerDown}
      />
      {ghost !== null && (
        <img
          class="chess-ghost"
          src={pieceSrc(ghost.piece)}
          alt=""
          aria-hidden="true"
          style={{
            width: `${ghost.size}px`,
            height: `${ghost.size}px`,
            left: `${ghost.x - ghost.size / 2}px`,
            top: `${ghost.y - ghost.size / 2}px`,
          }}
        />
      )}
    </div>
  );
}

/** The promotion picker: a modal dialog with the four pieces. Escape or Cancel keeps the pawn where it is. */
export function PromotionDialog(props: {
  seat: number;
  open: boolean;
  onPick: (letter: PromotionLetter) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d === null) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      class="dialog chess-promotion"
      aria-labelledby="chess-promotion-h"
      onClose={props.onCancel}
      onPointerDown={(e) => {
        if (e.target === ref.current) props.onCancel();
      }}
    >
      {props.open && (
        <div class="dialog-body">
          <h2 id="chess-promotion-h">Promote the pawn to</h2>
          <div class="chess-promotion-choices">
            {PROMOTIONS.map((p) => (
              <button key={p} type="button" class="chess-promotion-choice" onClick={() => props.onPick(p)}>
                <PieceImage piece={promotionPiece(props.seat, p)} class="chess-promotion-piece" />
                <span>{promotionName(p)}</span>
              </button>
            ))}
          </div>
          <div class="row">
            <button type="button" class="btn btn-small" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export function ChessGame(props: GameViewProps) {
  const state = props.view.state as ChessState;
  const { mySeat, names } = props;
  const legal = props.legal as readonly ChessAction[];
  const flipped = mySeat === 1;
  const seq = state.history.length;
  const [from, setFrom] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<{ from: string; to: string } | null>(null);
  const [offer, setOffer] = useState(false);
  // The move count a move was sent at: no second move until the state moves on or the send fails.
  const [sentAt, setSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (!props.busy) setSentAt(null);
  }, [props.busy]);
  useEffect(() => {
    setFrom(null);
    setPromoting(null);
    setOffer(false);
  }, [seq]);

  const myTurn = props.canAct && legal.length > 0 && mySeat !== null && !props.busy && sentAt !== seq;
  const squares = squareViews(state, flipped, from);
  const movable = new Set(
    myTurn
      ? squares.filter((s) => s.piece !== null && pieceSeat(s.piece) === mySeat).map((s) => s.square)
      : [],
  );
  const result = resultView(state, props.view.outcome, names, props.view.resigned, props.view.forfeits);
  const draw = drawNotice(state, names, mySeat);

  const send = (action: ChessAction) => {
    // Only an action the controller lists as legal is sent, in case the view and the list ever drift apart.
    if (!isLegal(legal, action)) return;
    setSentAt(seq);
    props.onAct(action).catch(() => setSentAt(null));
  };
  /** Move `a` → `b` if legal (asking for the promotion piece first); false when it is not a move. */
  const tryMove = (a: string, b: string): boolean => {
    if (mySeat === null) return false;
    const moves = movesTo(state, a, b);
    if (moves.length === 0) return false;
    if (moves.length > 1) {
      setFrom(a);
      setPromoting({ from: a, to: b });
      return true;
    }
    const action = moveAction(state, mySeat, a, b, 'q', offer);
    if (action === null) return false;
    send(action);
    return true;
  };
  const onSquare = (square: string) => {
    if (!myTurn) return;
    if (from !== null && from !== square && tryMove(from, square)) return;
    setFrom(square === from || !movable.has(square) ? null : square);
  };
  const onDrop = (a: string, b: string | null) => {
    if (!myTurn) return;
    if (b !== null && b !== a && tryMove(a, b)) return;
    setFrom(a);
  };
  const promote = (letter: PromotionLetter) => {
    const p = promoting;
    setPromoting(null);
    if (p === null || mySeat === null) return;
    const action = moveAction(state, mySeat, p.from, p.to, letter, offer);
    if (action !== null) send(action);
  };

  const top = flipped ? 0 : 1;
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
        <PlayerBar seat={top} {...props} />
        <ChessBoard
          squares={squares}
          flipped={flipped}
          interactive={myTurn}
          movable={movable}
          onSquare={onSquare}
          onPick={setFrom}
          onDrop={onDrop}
          onEscape={() => setFrom(null)}
        />
        <PlayerBar seat={1 - top} {...props} />
      </section>
      {/* One live region for the life of the screen: the opponent's moves, check and the result. */}
      <p class="sr-only" aria-live="polite" data-testid="chess-live">
        {liveAnnouncement(state, names, mySeat, result)}
      </p>
      <div class="chess-side">
        {result !== null ? (
          <section class="panel chess-result" aria-labelledby="chess-result-h">
            <h2 id="chess-result-h">Game over</h2>
            <p class="chess-score">
              <span class="sr-only">Score: </span>
              <span>{result.score}</span>
            </p>
            <p class="chess-result-text">{result.headline}</p>
            {result.detail !== '' && <p class="muted chess-result-detail">{result.detail}</p>}
          </section>
        ) : (
          <section class="panel chess-status" aria-label="Status">
            <p class={myTurn ? 'chess-status-line mine' : 'chess-status-line'}>
              {statusLine(state, names, mySeat)}
            </p>
            {props.deadline !== undefined && <p class="muted chess-deadline">{props.deadline}</p>}
            {props.notice !== undefined && <p class="muted">{props.notice}</p>}
            {draw !== null && (
              <div
                class={`chess-draw-offer ${draw.kind}`}
                role={draw.kind === 'incoming' ? 'alert' : undefined}
              >
                <p>
                  <span class="chess-draw-icon" aria-hidden="true">
                    ½
                  </span>{' '}
                  {draw.text}
                </p>
                {myTurn && canAcceptDraw(legal) && (
                  <button
                    type="button"
                    class="btn btn-small btn-primary"
                    onClick={() => send({ type: 'acceptDraw', actor: mySeat as number })}
                  >
                    Accept draw
                  </button>
                )}
              </div>
            )}
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
                    ? 'Pick one of your pieces, then the square to move it to. You can also drag it.'
                    : `Moving from ${from}: pick a square, or the piece again to put it back.`}
                </p>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={offer}
                    onChange={(e) => setOffer(e.currentTarget.checked)}
                  />
                  Offer a draw with this move
                </label>
              </div>
            )}
          </section>
        )}
        <MoveList history={state.history} />
      </div>
      {mySeat !== null && (
        <PromotionDialog
          seat={mySeat}
          open={promoting !== null}
          onPick={promote}
          onCancel={() => setPromoting(null)}
        />
      )}
    </div>
  );
}

/** The moves in SAN, numbered and paired; the latest is marked current and kept in view. */
function MoveList(props: { history: ChessState['history'] }) {
  const rows = moveRows(props.history);
  const current = props.history.length - 1;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [current]);
  const cell = (c: MoveCell | null, empty: string) =>
    c === null ? (
      <span class="chess-san">{empty}</span>
    ) : (
      <span
        class={c.ply === current ? 'chess-san current' : 'chess-san'}
        aria-current={c.ply === current ? 'step' : undefined}
      >
        {c.san}
        {c.offer && (
          <>
            <span class="sr-only">, draw offered</span>
            <span class="chess-offer-mark" aria-hidden="true">
              {' '}
              (=)
            </span>
          </>
        )}
      </span>
    );
  return (
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
        <ol class="chess-move-list" ref={listRef}>
          {rows.map((r) => (
            <li key={r.n} value={r.n}>
              <span class="chess-move-n">{r.n}.</span>
              {cell(r.white, '…')}
              {cell(r.black, '')}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A player above or below the board: avatar, name, colour, the pieces they captured and their material lead. */
function PlayerBar(props: GameViewProps & { seat: number }) {
  const state = props.view.state as ChessState;
  const toMove = state.result === null && (state.turn === 'w' ? 0 : 1) === props.seat && !props.ended;
  const mat = materialViews(state)[props.seat];
  const king: Piece = props.seat === 0 ? 'K' : 'k';
  return (
    <div class={toMove ? 'chess-player to-move' : 'chess-player'}>
      <span class="chess-player-avatar">{props.avatars[props.seat]}</span>
      <div class="chess-player-info">
        <span class="chess-player-name">
          <PieceImage piece={king} class="chess-player-color" />
          <bdi>{props.names[props.seat] ?? `Seat ${props.seat + 1}`}</bdi> ({colorName(props.seat)})
          {props.mySeat === props.seat ? ', you' : ''}
        </span>
        {mat !== undefined && (
          <span class="chess-captured">
            <span class="sr-only">
              Captured {capturedText(mat.captured)}
              {mat.lead > 0 ? `; ahead by ${mat.lead}` : ''}.
            </span>
            <span aria-hidden="true" class="chess-captured-pieces">
              {mat.captured.map((p, i) => (
                <PieceImage key={`${p}${i}`} piece={p} class="chess-captured-piece" />
              ))}
            </span>
            {mat.lead > 0 && (
              <span class="chess-lead" aria-hidden="true">
                +{mat.lead}
              </span>
            )}
          </span>
        )}
      </div>
      {toMove && <span class="chip chess-to-move">to move</span>}
    </div>
  );
}
