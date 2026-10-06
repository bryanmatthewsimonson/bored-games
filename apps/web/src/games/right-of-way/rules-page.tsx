/*
 * The player-facing Right of Way rules (#/rules/right-of-way), after docs/games/right-of-way/RULES.md.
 * `RightOfWayRulesContent` uses no hooks, so tests can expand it without a DOM.
 */
import { CHARTERS, ROUTE_POINTS, ROUTES, TRACK } from '@bored-games/right-of-way';
import { RIGHT_OF_WAY_THEME } from '@bored-games/right-of-way/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import { FreightCard } from './art.tsx';
import { RIGHT_OF_WAY_META } from './meta.ts';
import '../chain-reaction/rules.css';
import './right-of-way.css';

export const RIGHT_OF_WAY_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'setup', title: 'Setup' },
  { id: 'freight', title: 'Draw freight' },
  { id: 'track', title: 'Lay track' },
  { id: 'charters', title: 'Draw charters' },
  { id: 'end', title: 'The end' },
  { id: 'scoring', title: 'Scoring' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = RIGHT_OF_WAY_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

export function RightOfWayRulesContent() {
  const t = RIGHT_OF_WAY_THEME;
  const cargo = t.cargo.slice(0, 8).join(', ');
  return (
    <article class="rules-page">
      <header class="rules-head">
        <h1>How to play {t.title}</h1>
        <p class="lede">{t.tagline}</p>
      </header>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {RIGHT_OF_WAY_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(RIGHT_OF_WAY_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          Two to five rival railways lay track across {t.land}, an invented land of{' '}
          {RIGHT_OF_WAY_THEME.towns.length} towns and {ROUTES.length} routes. Spend sets of matching freight
          cards to claim routes, connect the towns on your secret charters and build the longest unbroken
          line. The most points wins.
        </p>
      </Section>

      <Section id="setup">
        <p>
          There are 110 freight cards: 12 each of {cargo}, and 14 wild Engines. Every card shows its cargo
          symbol, so you never need to tell colours apart.
        </p>
        <p class="row-rules-cards" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
            <FreightCard key={c} color={c} />
          ))}
        </p>
        <p>
          Each player gets {TRACK} pieces of track, 4 freight cards and 3 of the {CHARTERS.length} charters.
          Five freight cards are turned face up: the yard. A random player goes first. In turn, each player
          keeps at least 2 of their 3 charters and puts the rest at the bottom of the charter pile.
        </p>
      </Section>

      <Section id="freight">
        <p>
          On your turn, do exactly one of three things. The first: take two freight cards, one at a time, each
          from the yard or blind from the pile.
        </p>
        <ul>
          <li>
            A face-up Engine taken as your first card is your whole draw. You can never take one as your
            second card.
          </li>
          <li>An Engine drawn blind counts as one card.</li>
          <li>A card taken from the yard is replaced at once, before you choose your second card.</li>
          <li>
            Whenever three or more face-up cards are Engines, all five are discarded and replaced (at most
            three times in a row).
          </li>
          <li>
            When the pile runs out, the discards are shuffled to make a new one. There is no hand limit.
          </li>
        </ul>
      </Section>

      <Section id="track">
        <p>
          The second: claim one open route. Pay as many cards as it is long, all of the route's colour (any
          one colour for an unmarked gray route); Engines are wild. Place that many pieces of track and score
          at once:
        </p>
        <table class="rules-table">
          <thead>
            <tr>
              <th>Length</th>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <th key={n}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Points</th>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <td key={n}>{ROUTE_POINTS[n]}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <p>
          A route need not join your other track. Some towns are joined by twin routes: one player can never
          hold both sides, and with two or three players only one side may be used at all.
        </p>
      </Section>

      <Section id="charters">
        <p>
          The third: draw three charters (fewer if fewer are left). Keep at least one and return the rest to
          the bottom of the pile. Keep your charters secret: at the end each one you completed adds its value,
          and each one you did not subtracts it.
        </p>
      </Section>

      <Section id="end">
        <p>
          When a player ends a turn with two or fewer pieces of track, everyone, that player included, takes
          one more turn. If nobody can do anything at all, players pass; when everyone passes in a row the
          game ends too.
        </p>
      </Section>

      <Section id="scoring">
        <ul>
          <li>Route points are scored as you lay track.</li>
          <li>Every charter is revealed: completed ones add their value, open ones subtract it.</li>
          <li>
            The longest unbroken line of your own track earns {t.ribbon} (10 points); a line may loop and pass
            a town twice, but never use a route twice. Tied players all score it.
          </li>
          <li>Most points wins; ties go to the most completed charters, then to {t.ribbon}.</li>
        </ul>
      </Section>

      <Section id="online">
        <ul>
          <li>
            Your freight cards and charters are dealt with cryptography: nobody, not even this site, can see
            them. The other players' open apps unlock your blind draws and the face-up cards for you, so a
            draw may take a moment.
          </li>
          <li>
            Highlighted routes on the board are the ones you can claim now; pick one to choose how to pay.
          </li>
          <li>
            Each turn has a deadline chosen with the table. Once it has passed, another player can claim it.
          </li>
          <li>At the end every player's app reveals their charters, and the whole deck is checked.</li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function RightOfWayRulesPage(props: { section: string | null }) {
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
  return <RightOfWayRulesContent />;
}
