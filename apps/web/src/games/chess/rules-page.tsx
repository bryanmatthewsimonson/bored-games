/*
 * The player-facing Chess rules (#/rules/chess), a minimal page after docs/games/chess/RULES.md, the source of
 * truth. Phase D2 polishes it. `ChessRulesContent` uses no hooks, so tests can expand it without a DOM.
 */
import { CHESS_THEME } from '@bored-games/chess/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import { CHESS_META } from './meta.ts';
// The rules pages share one layout; it lives with the first game's page for now.
import '../chain-reaction/rules.css';

export const CHESS_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'board', title: 'The board and pieces' },
  { id: 'moves', title: 'How the pieces move' },
  { id: 'special', title: 'Special moves' },
  { id: 'ending', title: 'Ending the game' },
  { id: 'online', title: 'Playing online' },
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

export function ChessRulesContent() {
  const r = CHESS_THEME.reasons;
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
          Two players, {CHESS_THEME.colors.w} and {CHESS_THEME.colors.b}, take turns moving one piece each.
          You win by checkmating the other king: attacking it so that no move can save it. The rules are the
          FIDE Laws of Chess.
        </p>
      </Section>

      <Section id="board">
        <ul>
          <li>
            An 8×8 board of squares a1 to h8. The player who creates the table plays {CHESS_THEME.colors.w}{' '}
            and moves first.
          </li>
          <li>
            Each side has a king, a queen, two rooks, two bishops, two knights and eight pawns, in the
            standard starting position.
          </li>
        </ul>
      </Section>

      <Section id="moves">
        <ul>
          <li>The king moves one square in any direction.</li>
          <li>The queen moves any distance in a straight line or along a diagonal.</li>
          <li>
            The rook moves any distance along a rank or a file; the bishop, any distance along a diagonal.
          </li>
          <li>The knight jumps in an L: two squares one way and one square to the side.</li>
          <li>
            A pawn moves one square forward (two from its starting square) and captures one square diagonally
            forward.
          </li>
          <li>No piece but the knight may jump over others, and no move may leave your own king in check.</li>
        </ul>
      </Section>

      <Section id="special">
        <ul>
          <li>
            <strong>Castling:</strong> the king moves two squares toward a rook, and that rook jumps over it.
            Not allowed if the king or that rook has moved, a square between them is occupied, or the king is
            in check, passes an attacked square or lands on one. To castle, move the king two squares.
          </li>
          <li>
            <strong>En passant:</strong> right after an enemy pawn moves two squares past one of your pawns,
            your pawn may capture it as if it had moved one square, on that move only.
          </li>
          <li>
            <strong>Promotion:</strong> a pawn reaching the last rank becomes a queen, rook, bishop or knight
            of your choice.
          </li>
        </ul>
      </Section>

      <Section id="ending">
        <ul>
          <li>
            <strong>{r.checkmate}:</strong> the side in check with no legal move loses.
          </li>
          <li>
            These draws happen at once, without a claim: <strong>stalemate</strong> (no legal move, not in
            check), the same position for the <strong>third time</strong>, <strong>fifty moves</strong> by
            each side without a capture or a pawn move, and <strong>insufficient material</strong> (king
            against king, or king and one minor piece against king, or bishops all on one square colour).
          </li>
          <li>
            <strong>Draw offers:</strong> tick "Offer a draw with this move" when you move. Your opponent may
            accept on their turn; moving instead declines it.
          </li>
          <li>
            <strong>Resigning:</strong> you may resign at any time from the game screen. You lose; a
            resignation before the first move cancels the game instead.
          </li>
          <li>A win scores 2 to 0, a draw 1 each.</li>
        </ul>
      </Section>

      <Section id="online">
        <ul>
          <li>
            Games are played at your own pace. Each move has a deadline (1, 3 or 7 days, set at the table).
            After it passes, your opponent can claim a timeout: you forfeit and lose (if no move was played
            yet, the game is cancelled).
          </li>
          <li>
            Chess has no hidden information, so there is no shuffling or dealing: the game starts as soon as
            the table creator starts it. At the end both players' apps check the whole game and sign the
            result.
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
