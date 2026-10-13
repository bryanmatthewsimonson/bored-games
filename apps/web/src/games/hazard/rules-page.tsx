/*
 * The player-facing Hazard rules (#/rules/hazard), after docs/games/hazard/RULES.md. Names come from the theme; the
 * map, the charters and the dice are the same drawings the table uses.
 */
import { hazard, PROVINCES, REALMS, setValue } from '@bored-games/hazard';
import { HAZARD_THEME as THEME } from '@bored-games/hazard/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { Atlas } from './atlas.tsx';
import { CharterFace } from './charters.tsx';
import { HazardCover } from './cover.tsx';
import { Die } from './dice.tsx';
import { HAZARD_META } from './meta.ts';
import { realmName } from './model.ts';
import '../chain-reaction/rules.css';
import './hazard.css';

export const HAZARD_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'map', title: 'The Meridian' },
  { id: 'setup', title: 'Setting up' },
  { id: 'muster', title: '1. Muster' },
  { id: 'attack', title: '2. Attack' },
  { id: 'march', title: '3. March' },
  { id: 'charters', title: 'Charters' },
  { id: 'elimination', title: 'Wiping out a rival' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = HAZARD_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

/** An empty map for the rules: every province unclaimed, nothing to click. */
const BLANK = hazard.setup({ rules: hazard.defaultRules(), seats: 3, mode: 'view', viewer: null });

export function HazardRulesContent() {
  const seats = hazard.seatRange(hazard.defaultRules());
  const deadlines = DEADLINE_CHOICES.map((c) => c.label);
  const deadlineList = `${deadlines.slice(0, -1).join(', ')} or ${deadlines.at(-1)}`;
  const values = [0, 1, 2, 3, 4, 5, 6, 7].map(setValue);
  return (
    <article class="rules-page hz-rules">
      <header class="rules-head">
        <h1>How to play {THEME.title}</h1>
        <p class="lede">{THEME.tagline}</p>
      </header>
      <figure class="rules-cover">
        <HazardCover />
      </figure>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {HAZARD_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(HAZARD_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          {seats.min} to {seats.max} players. Hold every one of the {PROVINCES.length} provinces of{' '}
          {THEME.world}. A player whose last province falls is out; the last commander standing wins. Best
          with 4 or 5 players.
        </p>
      </Section>

      <Section id="map">
        <p>
          Six realms, each its own land. Provinces that share a border are linked, and so are the provinces at
          the two ends of each dotted sea lane; the lane that leaves the western edge comes back on the
          eastern one. Holding a whole realm when your turn starts brings extra troops:
        </p>
        <ul>
          {REALMS.map((r) => (
            <li key={r.id}>
              <strong>{realmName(r.id)}</strong>: {r.provinces.length} provinces, {r.bonus} troops
            </li>
          ))}
        </ul>
        {BLANK.ok && (
          <figure class="hz-rules-map">
            <Atlas
              state={BLANK.value}
              names={[]}
              mode={{ kind: 'none', single: [], pick: [], target: [] }}
              selected={null}
              prefix="hz-rules"
            />
          </figure>
        )}
      </Section>

      <Section id="setup">
        <ol>
          <li>Each player takes 35, 30, 25 or 20 troops for 3, 4, 5 or 6 players.</li>
          <li>
            Everyone rolls one die. The highest claims first; players tied on the highest roll again, alone.
          </li>
          <li>
            Taking turns from the first claimer, each player puts one troop on an empty province, until all
            are held.
          </li>
          <li>
            Still taking turns, each puts one more troop on a province of their own, until every troop is out.
          </li>
          <li>The first claimer takes the first turn.</li>
        </ol>
      </Section>

      <Section id="muster">
        <p>
          Count your provinces and divide by three, rounding down: that many troops, and never fewer than 3.
          Add the bonus of every realm you hold whole. You may also cash in a set of charters for more (see
          below); with five or more charters you must. Place every troop on your own provinces, in any split.
        </p>
      </Section>

      <Section id="attack">
        <p>
          Attack as often as you like, from a province with at least two troops into a linked enemy province.
          Choose 1, 2 or 3 dice, always fewer than the troops attacking. The defender then chooses 1 or 2 dice
          (2 needs two troops there). Both roll.
        </p>
        <div class="hz-rules-dice">
          <Die value={6} side="attack" />
          <Die value={3} side="attack" />
          <Die value={1} side="attack" />
          <span>against</span>
          <Die value={3} side="defend" />
          <Die value={3} side="defend" />
        </div>
        <p>
          Compare the highest dice: the lower loses a troop, and a tie goes to the defender. Then compare the
          second-highest pair the same way. Above, 6 beats 3 and 3 ties 3: each side loses one.
        </p>
        <p>
          Take the last troop out of a province and it is yours: move in at least as many troops as the dice
          you just rolled, leaving one behind. Stop whenever you like. A turn with at least one capture earns
          one charter.
        </p>
      </Section>

      <Section id="march">
        <p>
          To end your turn you may march once: move any number of troops from one of your provinces into one
          linked province of your own, leaving at least one behind.
        </p>
      </Section>

      <Section id="charters">
        <div class="hz-hand">
          <CharterFace card={15} />
          <CharterFace card={1} />
          <CharterFace card={20} />
          <CharterFace card={42} />
          <CharterFace card={null} />
        </div>
        <p>
          There are {PROVINCES.length} province charters, each a {THEME.kinds.spear}, a {THEME.kinds.horse} or
          a {THEME.kinds.cannon}, and two {THEME.kinds.crown}s that stand for any design. A set is three of a
          design, one of each, or any two with a {THEME.kinds.crown}.
        </p>
        <p>
          Sets pay {values.slice(0, 6).join(', ')} troops for the first six sets cashed in the game, by
          anyone, then {values.slice(6).join(', ')} and five more each time. If a cashed charter shows a
          province you hold, two extra troops go straight there, once a turn. When the pile runs out, the
          cashed charters are shuffled into a new one.
        </p>
      </Section>

      <Section id="elimination">
        <p>
          Take a player’s last province and they are out: their charters are yours. With six or more, cash
          sets at once until you hold four or fewer, place those troops, and carry on attacking. With fewer,
          they wait for your next turn.
        </p>
      </Section>

      <Section id="online">
        <ul>
          <li>
            The charters are shuffled and signed by every player before the first claim. A charter you draw is
            seen by you alone.
          </li>
          <li>
            Every die is rolled by all the players’ apps together, after both sides have chosen their dice, so
            nobody can know a roll before it is fixed. Cashing in turns the three charters face up for
            everyone first.
          </li>
          <li>
            <strong>When you are out, keep the page open</strong> until the game ends: every roll and every
            reshuffle needs a share from your app.
          </li>
          <li>
            The table chooses whether defenders pick their dice (the classic rule) or always roll the most
            they may, which keeps a game by correspondence moving.
          </li>
          <li>
            <strong>Timeouts:</strong> each move has a deadline ({deadlineList}, chosen with the table).{' '}
            <strong>Resign</strong> ends the game for everyone: it is unrated, the others are placed as if the
            game ended now, and you come last. Before the first move it cancels the game.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function HazardRulesPage(props: { section: string | null }) {
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
  return <HazardRulesContent />;
}
