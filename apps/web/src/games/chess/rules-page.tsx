/*
 * The player-facing Chess rules (#/rules/chess), after docs/games/chess/RULES.md, the source of truth: the FIDE
 * Laws as this site plays them, with the automatic draws, the asynchronous draw offer, resigning and timeouts.
 * Names (pieces, colours, endings), piece values and the start position come from the engine; the deadlines from
 * the lobby. `ChessRulesContent` uses no hooks, so tests can expand it without a DOM.
 */
import { chess, DEFAULT_RULES, fromFen, PIECE_VALUES, type Piece, START_FEN } from '@bored-games/chess';
import { CHESS_THEME } from '@bored-games/chess/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { PieceImage } from './game.tsx';
import { CHESS_META } from './meta.ts';
import { boardSquares, isDark } from './model.ts';
// The rules pages share one layout; it lives with the first game's page for now.
import '../chain-reaction/rules.css';
import './chess.css';

export const CHESS_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'board', title: 'The board and pieces' },
  { id: 'moves', title: 'How the pieces move' },
  { id: 'special', title: 'Special moves' },
  { id: 'check', title: 'Check and checkmate' },
  { id: 'draws', title: 'Draws' },
  { id: 'offers', title: 'Offering a draw' },
  { id: 'resign', title: 'Resigning and timeouts' },
  { id: 'results', title: 'Results' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = CHESS_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

/** The engine's start position as a small picture (one image, described in words). */
function StartDiagram() {
  const start = fromFen(START_FEN, DEFAULT_RULES);
  const board = start.ok ? start.value.board : [];
  const at = (sq: string): Piece | null => {
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq[1]) - 1;
    return board[rank * 8 + file] ?? null;
  };
  return (
    <figure class="chess-diagram">
      <div
        class="chess-diagram-board"
        role="img"
        aria-label={`The starting position: ${CHESS_THEME.colors.w} on ranks 1 and 2, ${CHESS_THEME.colors.b} on ranks 7 and 8.`}
      >
        {boardSquares(false).map((sq) => {
          const p = at(sq);
          return (
            <span key={sq} class={isDark(sq) ? 'chess-diagram-sq dark' : 'chess-diagram-sq light'}>
              {p !== null && <PieceImage piece={p} />}
            </span>
          );
        })}
      </div>
      <figcaption class="muted">The starting position. {CHESS_THEME.colors.w} moves first.</figcaption>
    </figure>
  );
}

const PIECE_ORDER: readonly Piece[] = ['K', 'Q', 'R', 'B', 'N', 'P'];

const pieceTitle = (p: Piece): string => {
  const n = CHESS_THEME.pieces[p.toLowerCase() as keyof typeof CHESS_THEME.pieces];
  return n.charAt(0).toUpperCase() + n.slice(1);
};

export function ChessRulesContent() {
  const r = CHESS_THEME.reasons;
  const { w, b } = CHESS_THEME.colors;
  const seats = chess.seatRange(DEFAULT_RULES);
  const deadlines = DEADLINE_CHOICES.map((c) => c.label);
  const deadlineList = `${deadlines.slice(0, -1).join(', ')} or ${deadlines.at(-1)}`;
  return (
    <article class="rules-page">
      <header class="rules-head">
        <h1>How to play {CHESS_THEME.title}</h1>
        <p class="lede">{CHESS_THEME.tagline}</p>
      </header>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {CHESS_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(CHESS_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          {seats.min === seats.max ? `${seats.min} players` : `${seats.min} to ${seats.max} players`}, {w} and{' '}
          {b}, take turns moving one piece each. You win by <strong>checkmating</strong> the other king:
          attacking it so that no move can save it. The rules are the FIDE Laws of Chess; where an online game
          has no arbiter, this site decides as described below.
        </p>
      </Section>

      <Section id="board">
        <StartDiagram />
        <ul>
          <li>
            An 8×8 board with a light square in each player's right-hand corner. Files are lettered a to h,
            ranks numbered 1 to 8 from {w}'s side, so every square has a name such as e4.
          </li>
          <li>
            The player who creates the table plays {w} and moves first; the player who joins plays {b}. The
            board is turned so that your own pieces are at the bottom.
          </li>
          <li>
            Each side has a king, a queen, two rooks, two bishops, two knights and eight pawns. The usual
            piece values, which the game shows as the material lead beside each player, are:
          </li>
        </ul>
        <table class="chess-values">
          <caption class="sr-only">Piece values in pawns</caption>
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {PIECE_ORDER.map((p) => (
              <tr key={p}>
                <th scope="row">
                  <PieceImage piece={p} class="chess-values-piece" /> {pieceTitle(p)}
                </th>
                <td>{p === 'K' ? '—' : PIECE_VALUES[p.toLowerCase()]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="moves">
        <ul>
          <li>
            <strong>{pieceTitle('K')}:</strong> one square in any direction.
          </li>
          <li>
            <strong>{pieceTitle('Q')}:</strong> any distance along a rank, a file or a diagonal.
          </li>
          <li>
            <strong>{pieceTitle('R')}:</strong> any distance along a rank or a file.
          </li>
          <li>
            <strong>{pieceTitle('B')}:</strong> any distance along a diagonal.
          </li>
          <li>
            <strong>{pieceTitle('N')}:</strong> an L-shaped jump, two squares one way and one to the side. It
            is the only piece that jumps over others.
          </li>
          <li>
            <strong>{pieceTitle('P')}:</strong> one square straight forward, or two from its starting square
            if both are empty. It captures one square diagonally forward.
          </li>
          <li>
            A piece captures by moving onto an opponent's piece, which leaves the board. No move may leave
            your own king attacked.
          </li>
        </ul>
      </Section>

      <Section id="special">
        <ul>
          <li>
            <strong>Castling:</strong> the king moves two squares toward a rook, and that rook jumps to the
            square the king crossed. It is not allowed if the king or that rook has already moved, if any
            square between them is occupied, or if the king is in check, would cross an attacked square or
            would land on one. To castle here, move the king two squares.
          </li>
          <li>
            <strong>En passant:</strong> right after an opponent's pawn moves two squares and lands beside one
            of your pawns, your pawn may capture it as if it had moved only one square. You must do it at
            once, on your next move, or the chance is gone.
          </li>
          <li>
            <strong>Promotion:</strong> a pawn that reaches the last rank must become a queen, rook, bishop or
            knight of your colour, whatever pieces are already on the board. The game asks which one.
          </li>
        </ul>
      </Section>

      <Section id="check">
        <ul>
          <li>
            A king that is attacked is <strong>in check</strong>. The player in check must get out of it: move
            the king, capture the attacker, or put a piece in between. The game marks a king in check.
          </li>
          <li>
            <strong>{r.checkmate}:</strong> in check with no move that gets out of it. The player who
            checkmates wins.
          </li>
        </ul>
      </Section>

      <Section id="draws">
        <p>
          These draws happen <strong>automatically</strong>, the moment they arise. Nobody has to claim them,
          as on most chess sites (FIDE lets a player claim the repetition and fifty-move draws instead).
        </p>
        <ul>
          <li>
            <strong>{r.stalemate}:</strong> the player to move has no legal move but is not in check.
          </li>
          <li>
            <strong>{r.repetition}:</strong> the same position for the third time, with the same player to
            move and the same castling and en passant possibilities. The repeats need not be in a row.
          </li>
          <li>
            <strong>{r['fifty-move']}:</strong> fifty moves by each player in a row without a capture or a
            pawn move.
          </li>
          <li>
            <strong>{r.material}:</strong> neither side can ever checkmate: king against king, king and bishop
            against king, king and knight against king, or kings and bishops only, with every bishop on
            squares of one colour.
          </li>
        </ul>
      </Section>

      <Section id="offers">
        <ul>
          <li>
            Games here are played at your own pace, so a draw offer travels <strong>with a move</strong>: tick
            "Offer a draw with this move" before you move.
          </li>
          <li>
            Your opponent sees the offer on their turn and can press <strong>Accept draw</strong> (
            {r.agreement}
            ), or decline it simply by making their move, which may carry an offer of its own.
          </li>
          <li>
            An offer lasts only for that one turn. An offer made with a move that ends the game is void.
          </li>
        </ul>
      </Section>

      <Section id="resign">
        <ul>
          <li>
            <strong>Resigning:</strong> press Resign on the game screen and confirm. You lose the game. If no
            move has been played yet, resigning cancels the game without a result instead.
          </li>
          <li>
            <strong>Timeouts:</strong> each turn has a deadline ({deadlineList}, chosen with the table). Once
            it has passed, the opponent can claim a timeout and the player who missed it forfeits and loses
            (before the first move, the game is cancelled instead).
          </li>
          <li>
            A timeout is a loss even when the opponent has too little material to checkmate. FIDE would score
            that as a draw; this site's timeout rule is the same for every game.
          </li>
        </ul>
      </Section>

      <Section id="results">
        <ul>
          <li>
            A win is written <strong>1–0</strong> ({w} wins) or <strong>0–1</strong> ({b} wins), and a draw{' '}
            <strong>½–½</strong>. The game screen shows the result and the reason: checkmate, one of the draws
            above, an agreed draw, a resignation or a timeout.
          </li>
          <li>For the platform's scores a win counts 2 points and a loss 0; a draw is 1 point each.</li>
          <li>
            When the game ends, both players' apps check every move and sign the result, so it cannot be
            changed afterwards.
          </li>
        </ul>
      </Section>

      <Section id="online">
        <ul>
          <li>
            <strong>Moving:</strong> click or tap one of your pieces, then its target. Dots mark the empty
            squares it can move to and rings the pieces it can capture. You can also drag a piece. Click the
            piece again to put it back.
          </li>
          <li>
            <strong>With the keyboard:</strong> the board is a grid of buttons. The arrow keys move between
            the squares, Enter or Space picks a piece and then its target, and Escape drops the piece. A
            screen reader reads each square, for example "e4, white knight", with its state: selected, legal
            move, capture, last move or in check.
          </li>
          <li>
            Chess has no hidden information, so there is no shuffling or dealing: the game starts as soon as
            the table creator starts it.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function ChessRulesPage(props: { section: string | null }) {
  useEffect(() => {
    if (props.section === null) {
      window.scrollTo(0, 0);
      return;
    }
    const h = document.getElementById(headingId(props.section));
    if (h === null) return;
    h.scrollIntoView({ block: 'start' });
    h.focus({ preventScroll: true });
  }, [props.section]);
  return <ChessRulesContent />;
}
