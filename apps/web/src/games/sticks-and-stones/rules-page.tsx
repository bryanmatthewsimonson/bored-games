/*
 * The player-facing Sticks & Stones rules (#/rules/sticks-and-stones), after docs/games/sticks-and-stones/RULES.md.
 * Names come from the theme; the cards, tiles, tokens and spots are the same drawings the table uses.
 */
import { sticksAndStones } from '@bored-games/sticks-and-stones';
import { STICKS_THEME as THEME } from '@bored-games/sticks-and-stones/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { Die, DiscoveryCard, GoodIcon, MonumentTile, SpotArt, SticksCover, ToolIcon } from './art.tsx';
import { STICKS_META } from './meta.ts';
import { goodName, spotName } from './model.ts';
import '../chain-reaction/rules.css';
import './sticks-and-stones.css';

export const STICKS_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'setup', title: 'Setting up' },
  { id: 'place', title: '1. Sending people out' },
  { id: 'resolve', title: '2. Bringing them home' },
  { id: 'discoveries', title: 'Discoveries' },
  { id: 'monuments', title: 'Monuments' },
  { id: 'feed', title: '3. Feeding the clan' },
  { id: 'end', title: 'The end and the final count' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = STICKS_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

const G = (props: { good: number }) => <GoodIcon good={props.good} size={18} />;

export function SticksRulesContent() {
  const seats = sticksAndStones.seatRange(sticksAndStones.defaultRules());
  const deadlines = DEADLINE_CHOICES.map((c) => c.label);
  const deadlineList = `${deadlines.slice(0, -1).join(', ')} or ${deadlines.at(-1)}`;
  return (
    <article class="rules-page ss-rules">
      <header class="rules-head">
        <h1>How to play {THEME.title}</h1>
        <p class="lede">{THEME.tagline}</p>
      </header>
      <figure class="rules-cover">
        <SticksCover />
      </figure>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {STICKS_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(STICKS_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          {seats.min} to {seats.max} players, each leading a clan. Every round has three phases: send your
          people out, bring them home with what they found, and feed them. Points come from monuments, from
          discoveries and from a few cards along the way; most of them come at the end, from the cards you
          collected. The highest score wins. Best with 4.
        </p>
      </Section>

      <Section id="setup">
        <ul>
          <li>
            Each clan starts with 5 {THEME.words.people}, 12 food, no harvest and no tools. Food and goods
            never run out.
          </li>
          <li>
            Four {THEME.words.discoveries} lie face up in a row. From the right, they cost 1, 2, 3 and 4
            goods.
          </li>
          <li>
            The {THEME.words.monuments} are shuffled into stacks of seven, one stack per player, with the top
            tile face up.
          </li>
          <li>The first player is drawn at random; it passes to the left each round.</li>
        </ul>
      </Section>

      <Section id="place">
        <p>
          From the first player, take turns sending one or more of your people to <strong>one</strong> spot.
          Go round until everyone has placed everybody. You can never return to a spot you already used this
          round.
        </p>
        <div class="ss-rules-row">
          {(['hunt', 'wood', 'brick', 'stone', 'gold', 'tools', 'hut', 'field'] as const).map((spot) => (
            <figure key={spot} class="ss-spot">
              <SpotArt spot={spot} width={128} height={72} />
              <figcaption class="ss-spot-name">{spotName(spot)}</figcaption>
            </figure>
          ))}
        </div>
        <ul>
          <li>
            <strong>{spotName('hunt')}</strong> take any number of people, from every clan.
          </li>
          <li>
            <strong>
              {spotName('wood')}, {spotName('brick')}, {spotName('stone')} and {spotName('gold')}
            </strong>{' '}
            hold seven people in all. With three players only two clans may share one; with two players, one.
          </li>
          <li>
            <strong>{spotName('tools')}</strong> and <strong>{spotName('field')}</strong> take one person;{' '}
            <strong>{spotName('hut')}</strong> takes exactly two of yours. With two or three players only two
            of these three are used each round.
          </li>
          <li>Each discovery and each monument site takes one person.</li>
        </ul>
      </Section>

      <Section id="resolve">
        <p>
          From the first player, each clan brings home <strong>all</strong> its people, spot by spot, in any
          order it likes. What you gain at one spot you can spend at the next.
        </p>
        <ul>
          <li>
            <strong>Gathering:</strong> roll a die for each person and add them up. Divide by 2 for food{' '}
            <G good={-1} />, 3 for {goodName(0).toLowerCase()} <G good={0} />, 4 for{' '}
            {goodName(1).toLowerCase()} <G good={1} />, 5 for {goodName(2).toLowerCase()} <G good={2} /> or 6
            for {goodName(3).toLowerCase()} <G good={3} />, rounding down.
          </li>
          <li>
            <strong>Tools</strong> <ToolIcon value={2} size={20} /> add their value to a roll, after you see
            the dice. Each tool works once a round; you may add several to one roll. The first three are worth
            1, then each new step raises one to 2, 3 and 4.
          </li>
          <li>
            <strong>{spotName('tools')}</strong>: a tool step. <strong>{spotName('hut')}</strong>: a new
            person (up to 10), who eats from this round. <strong>{spotName('field')}</strong>: one step of
            harvest (up to 10).
          </li>
        </ul>
        <div class="ss-dice-row">
          <Die value={5} size={30} />
          <Die value={4} size={30} />
          <Die value={2} size={30} />
          <span>
            Three people in the {spotName('stone').toLowerCase()}: 11, plus a tool of 2 makes 13 → 2 stone.
          </span>
        </div>
      </Section>

      <Section id="discoveries">
        <div class="ss-rules-row">
          <DiscoveryCard card={4} />
          <DiscoveryCard card={25} />
          <DiscoveryCard card={33} />
        </div>
        <p>
          Pay the price of its place (1 to 4 goods, any mix, never food) and take the card, or pass it up. Its
          top happens at once: food, goods, points, a tool, harvest, a one-use tool, two goods of your choice
          for later, a roll of two dice for a good, a card drawn face down that only scores, or{' '}
          <strong>{THEME.words.gift}</strong>: roll a die for each player; from you, round the table, everyone
          takes one: 1–4 a good, 5 a tool step, 6 a harvest step.
        </p>
        <p>
          Its bottom scores at the end. Culture cards (green) show one of eight symbols:{' '}
          {Object.values(THEME.symbols).join(', ')}. Figure cards (sand) show{' '}
          {Object.entries(THEME.figures)
            .map(([k, v]) => `${v}s (× ${THEME.figureCounts[k as keyof typeof THEME.figureCounts]})`)
            .join(', ')}
          .
        </p>
      </Section>

      <Section id="monuments">
        <div class="ss-rules-row">
          <MonumentTile monument={0} />
          <MonumentTile monument={18} />
          <MonumentTile monument={25} />
        </div>
        <p>
          Pay the goods shown and score the points at once; the next tile of the stack turns up. Some
          monuments let you choose the goods: four or five of a set number of kinds, or one to seven of
          anything. They score what you paid: {goodName(0).toLowerCase()} 3, {goodName(1).toLowerCase()} 4,{' '}
          {goodName(2).toLowerCase()} 5, {goodName(3).toLowerCase()} 6. You may pass a monument up.
        </p>
      </Section>

      <Section id="feed">
        <p>
          Every clan takes food equal to its harvest, then eats one food per person; what is left keeps. Short
          of food? All your food goes, and then you either pay the whole rest in goods, one per food, or go
          hungry and lose 10 points. Scores can drop below zero.
        </p>
        <p>
          Then the first player passes to the left, the discoveries left slide to the cheap end and the row is
          filled up again, and used tools are ready again.
        </p>
      </Section>

      <Section id="end">
        <p>
          The game ends when the row of discoveries cannot be filled at the start of a round (at once), or
          when a monument stack has run out (after that round's feeding). Then add:
        </p>
        <ul>
          <li>
            <strong>Culture:</strong> the number of different symbols you hold, squared (8 different: 64).
            Second copies of symbols make a second set, scored the same way.
          </li>
          <li>
            <strong>Figures:</strong> {THEME.figures.farmer}s × your harvest, {THEME.figures.toolmaker}s ×
            your tools' total value, {THEME.figures.builder}s × your monuments, {THEME.figures.shaman}s × your
            people.
          </li>
          <li>
            <strong>Goods:</strong> one point for each good left. Food scores nothing.
          </li>
        </ul>
        <p>Ties go to the clan with the most harvest, tool value and people together.</p>
      </Section>

      <Section id="online">
        <ul>
          <li>
            The discoveries and monuments are shuffled and signed by every player before the game starts;
            every card turns up for everyone at once, so nobody sees one early.
          </li>
          <li>
            Every roll is made by all the players' apps together after the move that needs it, so nobody can
            know it in advance. Keep the page open: your app adds its share to every roll and every card.
          </li>
          <li>A face-down discovery is seen by its owner alone until the final count.</li>
          <li>
            The table chooses how second copies of a symbol score: {THEME.duplicates.squared.toLowerCase()}{' '}
            (the default), or {THEME.duplicates.ones.toLowerCase()}.
          </li>
          <li>
            <strong>Timeouts:</strong> each move has a deadline ({deadlineList}, chosen with the table).{' '}
            <strong>Resign</strong> is not offered in this game.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function SticksRulesPage(props: { section: string | null }) {
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
  return <SticksRulesContent />;
}
