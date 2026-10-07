/*
 * The player-facing Holler rules (#/rules/holler), after docs/games/holler/RULES.md.
 * Names come from the theme. Sample cards are the same SVG the table uses.
 */
import { actionCard, holler, numberCard } from '@bored-games/holler';
import { HOLLER_THEME } from '@bored-games/holler/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { ActiveSuit, CardBack, CardFace } from './cards.tsx';
import { HOLLER_META } from './meta.ts';
import { cardLabel, suitLabel, suitLook } from './model.ts';
import '../chain-reaction/rules.css';
import './holler.css';

export const HOLLER_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'suits', title: 'Suits' },
  { id: 'play', title: 'A turn' },
  { id: 'actions', title: 'Actions' },
  { id: 'holler', title: 'Holler' },
  { id: 'score', title: 'Score' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = HOLLER_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

function Sample(props: { card: number }) {
  const face = cardLabel(HOLLER_THEME, props.card);
  return (
    <figure class="holler-sample">
      <CardFace theme={HOLLER_THEME} card={props.card} />
      <figcaption>{face}</figcaption>
    </figure>
  );
}

export function HollerRulesContent() {
  const seats = holler.seatRange(holler.defaultRules());
  const deadlines = DEADLINE_CHOICES.map((c) => c.label);
  const deadlineList = `${deadlines.slice(0, -1).join(', ')} or ${deadlines.at(-1)}`;
  const tide = suitLook(HOLLER_THEME, 1);
  return (
    <article class="rules-page holler-rules">
      <header class="rules-head">
        <h1>How to play {HOLLER_THEME.title}</h1>
        <p class="lede">{HOLLER_THEME.tagline}</p>
      </header>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {HOLLER_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(HOLLER_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          {seats.min} to {seats.max} players. Deal seven cards each. Match the discard by suit, by rank, or by
          action, and get rid of your hand. The player who goes out scores the cards everyone else is holding.
          First to 500 wins. Best with 4 to 6 players.
        </p>
      </Section>

      <Section id="suits">
        <p>
          Four suits. Each one has a hue and a pattern, so color is never the only signal. The active suit is
          this control, not a strip of color.
        </p>
        {tide !== null && <ActiveSuit theme={HOLLER_THEME} suit={tide.index} label={suitLabel(tide)} />}
        <div class="holler-samples">
          <Sample card={numberCard(0, 7, 0)} />
          <Sample card={numberCard(1, 7, 0)} />
          <Sample card={numberCard(2, 3, 0)} />
          <Sample card={numberCard(3, 5, 0)} />
        </div>
        <p>Each suit has one 0, two of every rank from 1 to 9, two Halts, two Swings, and two Pulls.</p>
      </Section>

      <Section id="play">
        <p>
          On your turn, play one card that matches the discard, or draw one when nothing matches. A drawn card
          may be played at once when it matches, and it may be kept even when it matches. When it does not
          match, it is kept. A draw is one card. Every other player presses Seen, in seat order, before you
          decide. You are not offered a draw while a card can be played.
        </p>
        <p>The draw pile is face down. The top of the discard stays face up.</p>
        <div class="holler-samples">
          <figure class="holler-sample">
            <CardBack theme={HOLLER_THEME} />
            <figcaption>Draw pile</figcaption>
          </figure>
        </div>
      </Section>

      <Section id="actions">
        <div class="holler-samples">
          <Sample card={actionCard(1, 0, 0)} />
          <Sample card={actionCard(2, 1, 0)} />
          <Sample card={actionCard(3, 2, 0)} />
          <Sample card={100} />
          <Sample card={104} />
        </div>
        <ul>
          <li>
            <strong>{HOLLER_THEME.actions.halt}</strong> skips the next player. Direction stays.
          </li>
          <li>
            <strong>{HOLLER_THEME.actions.swing}</strong> at three or more players reverses direction, then
            play passes one step that way. At two players it skips, and direction stays.
          </li>
          <li>
            <strong>{HOLLER_THEME.actions.pull}</strong> makes the next player draw two, and skips them.
          </li>
          <li>
            <strong>{HOLLER_THEME.actions.mark}</strong> and <strong>{HOLLER_THEME.actions.levy}</strong> may
            be played on anything. The play names the suit that follows. There are four of each, and they have
            no suit of their own. Their frame is ink, not a suit hue.
          </li>
          <li>
            A {HOLLER_THEME.actions.levy} is legal only when your hand has no card of the suit that was
            active. A {HOLLER_THEME.actions.mark} does not count as that suit. An off-suit card of the same
            rank or kind does not count either.
          </li>
          <li>
            The next player may accept a {HOLLER_THEME.actions.levy}, draw four, and miss, or challenge it
            first. A clean challenge makes the challenger draw six and miss. An unclean one makes the player
            who laid the {HOLLER_THEME.actions.levy} draw four, and the challenger plays. The claim does not
            show the hand.
          </li>
        </ul>
        <p>
          The first card of a round is the starter. A number starts play with that suit. A Halt skips the
          first player. A Swing at three or more players reverses direction. A Pull makes the first player
          draw two. A Mark asks the first player to name the suit. A Levy is set aside, out of the draw, and
          the next card is turned. At most four Levies are set aside. They return when the next round shuffles
          the whole deck.
        </p>
      </Section>

      <Section id="holler">
        <p>
          When you play down to one card, you may say <strong>{HOLLER_THEME.declaration}</strong> on that
          play. The call is recorded before the card takes effect. If the effect gives you cards again, the
          call is cleared.
        </p>
        <p>
          Leaving the call off opens a catch. The other players are asked in seat order, starting after you.
          Direction does not matter. The first catch makes you draw two, and later players are not asked. If
          everyone passes, there is no penalty, and the call stands, so the last card can be played later.
        </p>
        <p>
          The last card carries no call. It is legal only after one was recorded. The round ends when that
          card's effect leaves your hand empty. A Pull still makes the next player draw before the score. A
          Levy still offers accept or challenge.
        </p>
      </Section>

      <Section id="score">
        <p>
          The player who went out scores every card left in the other hands. A rank scores its face. Halt,
          Swing, and Pull score 20. Mark and Levy score 50. Nobody else scores that round. The hands are shown
          before the total is added.
        </p>
        <p>
          The match continues while every score is under 500. The round that reaches 500 ends it. Tied scores
          share a place and the next place is skipped, so two equal winning scores finish 1, 1, 3.
        </p>
        <p>
          When a draw needs more cards than the pile holds, and at least one card sits under the top of the
          discard, the discard under that top is shuffled and the draw finishes from the new pile. The top
          card stays. When nothing sits under the top, the draw takes what remains, even if that is nothing.
        </p>
      </Section>

      <Section id="online">
        <ul>
          <li>Shuffling the deck and dealing the cards are signed by every player before the first turn.</li>
          <li>
            A drawn card stays face down until every other player has pressed Seen. Then you play it or keep
            it.
          </li>
          <li>
            Press a card to play it. A Mark or a Levy then asks which suit follows. Press{' '}
            {HOLLER_THEME.declaration} on the play that leaves you one card.
          </li>
          <li>
            <strong>Resigning:</strong> at two players the table refuses Resign. At three or more, Resign ends
            the game unrated and you come last.
          </li>
          <li>
            <strong>Timeouts:</strong> each turn has a deadline ({deadlineList}, chosen with the table). There
            is no shot clock.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function HollerRulesPage(props: { section: string | null }) {
  useEffect(() => {
    if (props.section === null) {
      window.scrollTo(0, 0);
      return;
    }
    const heading = document.getElementById(headingId(props.section));
    if (heading === null) return;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  }, [props.section]);
  return <HollerRulesContent />;
}
