/*
 * The player-facing Fever Pitch rules (#/rules/fever-pitch), after docs/games/fever-pitch/RULES.md, written for this
 * site. Names come from the theme; the cards, tokens and chart are the same drawings the table uses.
 */
import { feverPitch, RELIEFS, ROLES, SPREAD_RATES, SURGE_BASE } from '@bored-games/fever-pitch';
import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/fever-pitch/compare';
import { FEVER_THEME as THEME } from '@bored-games/fever-pitch/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { CaseToken, ClinicMark, FeverCover, FieldCard, RoleBadge, StrainMark } from './art.tsx';
import '../chain-reaction/rules.css';
import './fever-pitch.css';

export const FEVER_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'components', title: 'What is in the game' },
  { id: 'setup', title: 'Setting up' },
  { id: 'actions', title: '1. Four actions' },
  { id: 'draw', title: '2. Draw two field cards' },
  { id: 'spread', title: '3. The spread' },
  { id: 'surges', title: 'Surges' },
  { id: 'spillovers', title: 'Spillovers' },
  { id: 'roles', title: 'The roles' },
  { id: 'reliefs', title: 'Relief cards' },
  { id: 'end', title: 'Winning and losing' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = FEVER_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

export function FeverRulesContent() {
  const seats = feverPitch.seatRange(feverPitch.defaultRules());
  const deadlines = DEADLINE_CHOICES.map((c) => c.label);
  const deadlineList = `${deadlines.slice(0, -1).join(', ')} or ${deadlines.at(-1)}`;
  return (
    <article class="rules-page fp-rules">
      <header class="rules-head">
        <h1>How to play {THEME.title}</h1>
        <p class="lede">{THEME.tagline}</p>
        <p>
          <a
            href={`https://boardgamegeek.com/boardgame/${COMPARE_BGG_ID}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {COMPARE_PHRASE} ↗
          </a>
        </p>
      </header>
      <figure class="rules-cover">
        <FeverCover />
      </figure>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {FEVER_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref('fever-pitch', s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          {seats.min} to {seats.max} players work together as one team of specialists. Four strains,{' '}
          {THEME.strains.map((name, k) => (
            <span key={k}>
              <StrainMark strain={k} size={16} /> {name}
              {k < 2 ? ', ' : k === 2 ? ' and ' : ''}
            </span>
          ))}
          , are loose across {THEME.world}. Find a cure for all four and everyone wins. Run out of time,
          tokens or luck and everyone loses. There is no single winner.
        </p>
      </Section>

      <Section id="components">
        <ul>
          <li>
            A chart of {THEME.world}: 48 cities in four regions of twelve ({THEME.regions.join(', ')}), joined
            by 93 routes. The world wraps around, so a few routes run off one edge of the chart and come back
            on the other. Every city belongs to its region's strain.
          </li>
          <li>
            The <strong>field deck</strong>: a card for every city, five relief cards and the surges.
            <span class="fp-rules-cards">
              <FieldCard card={4} width={52} />
              <FieldCard card={19} width={52} />
              <FieldCard card={48 + 1} width={52} />
              <FieldCard card={SURGE_BASE} width={52} />
            </span>
          </li>
          <li>
            The <strong>spread deck</strong>: one card per city, which decides where the strains appear.
          </li>
          <li>
            24 <CaseToken strain={0} size={14} /> case tokens of each strain, six <ClinicMark size={14} />{' '}
            clinics, a spillover track that runs to eight, and the spread-rate track{' '}
            {SPREAD_RATES.join(' – ')}.
          </li>
          <li>Seven role cards: each player gets one, and it changes how they play.</li>
        </ul>
      </Section>

      <Section id="setup">
        <ol>
          <li>
            Everyone's pawn, and the first clinic, start in {THEME.cities[4]}. Each player is dealt a role.
          </li>
          <li>
            Nine spread cards are turned up: the first three cities get three cases each, the next three get
            two, the last three get one. Those cards start the spent pile.
          </li>
          <li>
            The city and relief cards are shuffled and dealt out: four each with two players, three each with
            three, two each with four.
          </li>
          <li>
            The rest is split into one pile per surge (four Gentle, five Standard, six Brutal: chosen with the
            table), a surge is shuffled into each pile, and the piles are stacked with the smaller ones
            underneath. A surge can turn up anywhere in its pile, but each pile has exactly one.
          </li>
          <li>Whoever holds the city card with the biggest population starts. Turns go in seat order.</li>
        </ol>
      </Section>

      <Section id="actions">
        <p>On your turn you get four actions, in any mix. You may repeat an action or stop early.</p>
        <ul>
          <li>
            <strong>Travel</strong> along a route to a neighbouring city.
          </li>
          <li>
            <strong>Fly</strong> straight to a city by discarding that city's card.
          </li>
          <li>
            <strong>Charter</strong> to any city by discarding the card of the city you are leaving.
          </li>
          <li>
            <strong>Shuttle</strong> from one clinic to any other clinic.
          </li>
          <li>
            <strong>Open a clinic</strong> where you stand by discarding that city's card. Only six exist:
            when all are out, the new one is moved from somewhere else.
          </li>
          <li>
            <strong>Treat</strong>: take one case off your city. Once its strain is cured, take them all.
          </li>
          <li>
            <strong>Hand over</strong>: when you share a city with a teammate, the card of that city may pass
            between you, either way.
          </li>
          <li>
            <strong>Find a cure</strong>: at any clinic, discard five city cards of one strain.
          </li>
        </ul>
        <p>
          A cured strain whose last case leaves the board is <strong>stamped out</strong>: its spread cards
          place nothing from then on.
        </p>
      </Section>

      <Section id="draw">
        <p>
          After your actions, draw two field cards together. Resolve any surge among them first. Then, if you
          hold more than seven field cards, discard (or play relief cards) down to seven. This limit applies
          to everyone, at every moment: a card handed to you can force a discard too. If you cannot draw two
          cards because the deck is nearly empty, the team loses.
        </p>
      </Section>

      <Section id="spread">
        <p>
          Finally turn up as many spread cards as the spread rate, one at a time. Each puts one case of its
          city's strain on that city. The cards go to the spent pile.
        </p>
      </Section>

      <Section id="surges">
        <p>A surge happens in three steps, and the card leaves the game (draw nothing in its place):</p>
        <ol>
          <li>
            <strong>Rise</strong>: the spread rate moves one step along {SPREAD_RATES.join(', ')}.
          </li>
          <li>
            <strong>Strike</strong>: the card at the bottom of the spread deck is turned up and its city gets
            three cases. If it already had some of that strain, it is filled to three and then spills over.
          </li>
          <li>
            <strong>Restack</strong>: the spent pile is shuffled and put back on top of the spread deck, so
            the cities that just suffered are the next to suffer again.
          </li>
        </ol>
        <p>Two surges in one draw are resolved one after the other.</p>
      </Section>

      <Section id="spillovers">
        <p>
          A city never holds more than three cases of one strain. When it would get a fourth, it{' '}
          <strong>spills over</strong> instead: the spillover track moves up, and every neighbouring city gets
          one case of that strain. A neighbour pushed past three spills over in turn, but within one chain
          each city spills at most once.
        </p>
      </Section>

      <Section id="roles">
        <ul class="fp-rules-roles">
          {ROLES.map((role) => (
            <li key={role}>
              <RoleBadge role={role} size={26} /> <strong>{THEME.roles[role]}</strong>: {THEME.roleText[role]}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="reliefs">
        <p>Playing a relief card takes no action. Each is used once and then discarded.</p>
        <ul>
          {RELIEFS.map((relief) => (
            <li key={relief}>
              <strong>{THEME.reliefs[relief]}</strong>: {THEME.reliefText[relief]}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="end">
        <p>
          The team wins the moment the fourth cure is found, no matter how many cases are still out. The team
          loses the moment the eighth spillover happens, a strain needs more case tokens than are left, or a
          player cannot draw their two field cards.
        </p>
      </Section>

      <Section id="online">
        <ul>
          <li>
            <strong>Open hands.</strong> Everyone can see every card. Talk it over and help each other; on
            your turn, the call is yours.
          </li>
          <li>
            <strong>Relief cards</strong> can be played at any of your own decisions. The game also stops at
            the moments that matter and asks everyone holding one, in turn order: before each spread, between
            two surges drawn together, and (Herd Immunity only) between a surge's strike and its restack.
          </li>
          <li>
            The deck is shuffled by every player's app before the game starts, so nobody knows its order;
            every card turns up for everyone at once. Keep the page open: your app adds its share to each card
            by itself.
          </li>
          <li>
            Moving a teammate's pawn or handing over a card would need a nod at the table; here the player
            whose turn it is decides.
          </li>
          <li>
            <strong>Timeouts:</strong> each move has a deadline ({deadlineList}, chosen with the table).{' '}
            <strong>Resign</strong> is always open, and ends the game as a loss for the whole team.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function FeverPitchRulesPage(props: { section: string | null }) {
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
  return <FeverRulesContent />;
}
