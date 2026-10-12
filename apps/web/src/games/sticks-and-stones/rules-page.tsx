/*
 * The player-facing Sticks & Stones rules (#/rules/sticks-and-stones), after docs/games/sticks-and-stones/RULES.md.
 * Names come from the theme; the cards, tiles, tokens and spots are the same drawings the table uses.
 */
import { CAMP_DECK, DECK_ID, type SticksState, sticksAndStones } from '@bored-games/sticks-and-stones';
import { STICKS_THEME as THEME } from '@bored-games/sticks-and-stones/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { Die, DiscoveryCard, GoodIcon, MonumentTile, SticksCover, ToolIcon } from './art.tsx';
import { Board } from './board.tsx';
import { ClanMat } from './mats.tsx';
import { STICKS_META } from './meta.ts';
import { choicesOf, goodName, playerRows, spotName } from './model.ts';
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

/** A camp at the start of a 4-player game, its cards turned up, for the pictures of the board and a mat. */
function sampleCamp(): SticksState | null {
  const order = Array.from({ length: CAMP_DECK.size }, (_, i) => i);
  const r = sticksAndStones.setup({
    rules: sticksAndStones.defaultRules(),
    seats: 4,
    mode: 'full',
    deckOrders: { [DECK_ID]: order },
  });
  if (!r.ok) return null;
  let s = r.value;
  for (let p = sticksAndStones.pending(s); p.type === 'reveal'; p = sticksAndStones.pending(s))
    for (const pos of p.positions) {
      const next = sticksAndStones.apply(s, {
        type: 'reveal',
        actor: 'deck',
        deck: DECK_ID,
        pos,
        card: order[pos],
      });
      if (!next.ok) return null;
      s = next.state;
    }
  return sticksAndStones.view(s, null);
}

const SAMPLE = sampleCamp();
const NO_CHOICES = choicesOf([]);

/** A clan part-way through a game, for the picture of a mat. */
const SAMPLE_MAT: SticksState | null =
  SAMPLE === null
    ? null
    : {
        ...SAMPLE,
        clans: SAMPLE.clans.map((c, i) =>
          i === 0
            ? {
                ...c,
                people: 7,
                food: 9,
                field: 3,
                tools: [2, 1, 1],
                used: [false, true, false],
                goods: [2, 1, 0, 1],
                spares: [3],
                choices: 1,
                score: 24,
              }
            : c,
        ),
        home: SAMPLE.home.map((n, i) => (i === 0 ? 7 : n)),
      };

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
          From the first player, take turns sending one or more of your people to <strong>one</strong> place.
          Go round until everyone has placed everybody: every person must be placed somewhere legal. You can
          never return to a spot you already used this round.
        </p>
        {SAMPLE !== null && (
          <figure class="ss-rules-board">
            <Board state={SAMPLE} choices={NO_CHOICES} enabled={false} selected={null} onSpot={undefined} />
            <figcaption>
              The camp. Each place shows what it gives and a ring for each person it can take; the score track
              runs round the edge. During a game the places you can use now are lit.
            </figcaption>
          </figure>
        )}
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
        {SAMPLE_MAT !== null && (
          <figure class="ss-rules-mat">
            <ClanMat
              s={SAMPLE_MAT}
              row={playerRows(SAMPLE_MAT, ['Your clan'])[0] as never}
              me={0}
              avatar={null}
              full
            />
            <figcaption>
              A clan mat: its people, food, harvest, its three tool places (here 2, 1 and 1, the middle one
              used this round), a one-use tool of 3, its goods, the two-goods card still face up, and its
              score.
            </figcaption>
          </figure>
        )}
      </Section>

      <Section id="discoveries">
        <p>
          Pay the price of its place (1 to 4 goods, any mix, never food) and take the card; or, if you cannot
          or do not want to pay, take your person home and leave the card. A card has a top, used when you
          take it, and a bottom, which scores at the end.
        </p>
        <h3>The tops</h3>
        <ul>
          <li>
            <strong>{THEME.words.gift}</strong> (10 cards): roll a die for each player. Starting with you and
            going round the table, everyone takes one die: 1 a wood, 2 a clay, 3 a stone, 4 an amber, 5 a tool
            step, 6 a harvest step. Tools cannot change these dice.
          </li>
          <li>
            <strong>Food</strong> (7 cards): 1, 2, 3, 3, 4, 5 or 7 food.
          </li>
          <li>
            <strong>Goods</strong> (5 cards): 2 stone; 1 stone (two cards); 1 amber; 1 clay.
          </li>
          <li>
            <strong>A roll for a good</strong> (3 cards): roll two dice and gather as if two people were
            there, one card each for wood (1 per 3), stone (1 per 5) and amber (1 per 6). Unused tools may be
            added.
          </li>
          <li>
            <strong>Points</strong> (3 cards): 3 points at once.
          </li>
          <li>
            <strong>A tool step</strong> (1 card), as at Knapper's Rock; <strong>a harvest step</strong> (2
            cards), as at the Furrows.
          </li>
          <li>
            <strong>A one-use tool</strong> (3 cards: 4, 3 and 2): the card stays face up beside your mat
            until you add it to one roll, alone or with your tools; then it is spent (it still scores its
            bottom).
          </li>
          <li>
            <strong>Two goods of your choice</strong> (1 card): the card stays face up beside your mat. Once,
            immediately or later, take any two goods: two alike or two different. Here you use it from your
            mat at any of your decisions; if you never do, it counts as two goods at the end.
          </li>
          <li>
            <strong>A face-down discovery</strong> (1 card): take the top card of the pile, look at it and
            keep it face down. Only its bottom counts, at the end; nobody else sees it until then.
          </li>
        </ul>
        <h3>The bottoms</h3>
        <p>
          Culture cards (green) show one of eight symbols, two cards each:{' '}
          {Object.values(THEME.symbols).join(', ')}. Figure cards (sand) show 1 to 3 figures:{' '}
          {Object.entries(THEME.figures)
            .map(([k, v]) => `${v}s (× your ${THEME.figureCounts[k as keyof typeof THEME.figureCounts]})`)
            .join(', ')}
          .
        </p>
        <h3>All 36 discoveries</h3>
        <div class="ss-rules-row ss-rules-cards">
          {Array.from({ length: 36 }, (_, card) => (
            <DiscoveryCard key={card} card={card} small />
          ))}
        </div>
      </Section>

      <Section id="monuments">
        <p>
          Pay the goods shown and score the points at once; the next tile of the stack turns up. Some
          monuments let you choose the goods: four or five of an exact number of kinds, or one to seven of
          anything. They score what you paid: {goodName(0).toLowerCase()} 3, {goodName(1).toLowerCase()} 4,{' '}
          {goodName(2).toLowerCase()} 5, {goodName(3).toLowerCase()} 6. If you cannot or do not want to pay,
          take your person home and leave the tile.
        </p>
        <h3>All 28 monuments</h3>
        <div class="ss-rules-row ss-rules-cards">
          {Array.from({ length: 28 }, (_, m) => (
            <MonumentTile key={m} monument={m} small />
          ))}
        </div>
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
