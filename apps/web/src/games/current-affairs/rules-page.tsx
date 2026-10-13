/*
 * The player-facing Current Affairs rules (#/rules/current-affairs), after docs/games/current-affairs/RULES.md. Names
 * come from the theme; the station cards, fuel tokens, yard and map are the same drawings the table uses.
 */
import {
  currentAffairs,
  FUEL_TOTAL,
  OPENING_YARD,
  PAYDAY,
  REGIONS,
  RESTOCK,
  START_MONEY,
  STATIONS,
  SUBSTATIONS,
  TABLES,
} from '@bored-games/current-affairs';
import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/current-affairs/compare';
import { CURRENT_THEME as THEME } from '@bored-games/current-affairs/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { CurrentCover, FuelToken, FuelYard, StationCard } from './art.tsx';
import { CommonwealthMap } from './map.tsx';
import { CURRENT_META } from './meta.ts';
import { fuelName, listText, regionName, stationText } from './model.ts';
import '../chain-reaction/rules.css';
import './current-affairs-game.css';

export const CURRENT_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'components', title: 'What is in the game' },
  { id: 'setup', title: 'Setting up' },
  { id: 'standings', title: '1. Standings' },
  { id: 'auction', title: '2. Auction' },
  { id: 'fuel', title: '3. Fuel' },
  { id: 'wiring', title: '4. Wiring' },
  { id: 'payday', title: '5. Payday' },
  { id: 'small', title: 'Small stations' },
  { id: 'eras', title: 'The three eras' },
  { id: 'end', title: 'The end of the game' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = CURRENT_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

const F = (props: { fuel: number }) => <FuelToken fuel={props.fuel} size={16} />;

const SEAT_COUNTS = [2, 3, 4, 5, 6] as const;
const ERAS = ['I', 'II', 'III'] as const;
const NO_HOUSES: readonly (readonly number[])[] = THEME.cities.map(() => []);
const ALL_REGIONS: readonly number[] = REGIONS.map((_, r) => r);

export function CurrentRulesContent() {
  const seats = currentAffairs.seatRange(currentAffairs.defaultRules());
  const deadlines = DEADLINE_CHOICES.map((c) => c.label);
  const deadlineList = `${deadlines.slice(0, -1).join(', ')} or ${deadlines.at(-1)}`;
  return (
    <article class="rules-page ca-rules">
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
        <CurrentCover />
      </figure>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {CURRENT_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(CURRENT_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          {seats.min} to {seats.max} players, each running a young power company in {THEME.land}. Every round
          you bid for {THEME.words.stations}, buy coal, oil, waste and uranium in a market whose prices climb
          as it empties, and wire cities into your network. Then you fire your stations and are paid for every
          city you light. When one network grows large enough, the company that can power the most cities
          wins. Best with 4 or 5.
        </p>
        <p>
          Every round has five phases: <strong>{THEME.phases.order}</strong> (the new order),{' '}
          <strong>{THEME.phases.auction}</strong> in player order, <strong>{THEME.phases.fuel}</strong> and{' '}
          <strong>{THEME.phases.build}</strong> in reverse order, and <strong>{THEME.phases.power}</strong> in
          player order. The leaders choose stations first but buy fuel and wire last, when the bargains are
          gone.
        </p>
      </Section>

      <Section id="components">
        <h3>{THEME.land.replace(/^the /, 'The ')}</h3>
        <p>
          The map has 42 cities in six regions of seven: {listText(ALL_REGIONS.map(regionName))}. Lines join
          them, each with a cost from $4 to $19: the Copper Range makes the lines inside Highcopper dear, and
          the Long Water, which divides the north from the south, adds to every line across it.
        </p>
        <figure class="ca-rules-map">
          <CommonwealthMap regions={ALL_REGIONS} houses={NO_HOUSES} names={THEME.cities} />
          <figcaption>
            The whole Commonwealth. A game uses only some of its regions (see Setting up).
          </figcaption>
        </figure>
        <h3>Money, substations and fuel</h3>
        <ul>
          <li>
            Money is in dollars. Each company starts with ${START_MONEY} and {SUBSTATIONS} substations, one
            for each city it may wire.
          </li>
          <li>
            Fuel: {FUEL_TOTAL[0]} coal <F fuel={0} />, {FUEL_TOTAL[1]} oil <F fuel={1} />, {FUEL_TOTAL[2]}{' '}
            waste <F fuel={2} /> and {FUEL_TOTAL[3]} uranium <F fuel={3} />. What is not in the yard or on a
            station is the supply.
          </li>
          <li>
            <strong>The {THEME.words.yard}:</strong> coal, oil and waste each have eight price spaces, $1 to
            $8, three units to a space; uranium has twelve spaces of one unit: $1 to $8, then $10, $12, $14
            and $16. Units fill a fuel's dearest spaces, and a buyer always takes the cheapest units first.
          </li>
        </ul>
        <figure class="ca-rules-yard">
          <FuelYard yard={OPENING_YARD} />
          <figcaption>
            The yard at the start: coal on every space, oil from $3, waste on $7 and $8, uranium on $14 and
            $16.
          </figcaption>
        </figure>
        <h3>The 42 {THEME.words.stations}</h3>
        <p>
          Each card shows its number (the lowest opening bid and its rank), its fuel, how much one firing
          burns and how many cities it powers. A station stores twice its burn of its own fuel. A{' '}
          <strong>coal-or-oil</strong> station burns and stores either, in any mix. A <strong>green</strong>{' '}
          station burns and stores nothing. The Era III card waits at the bottom of the stack.
        </p>
        <div class="ca-rules-cards">
          {STATIONS.map((st) => (
            <span key={st.n} class="ca-cardwrap" title={stationText(st.n)}>
              <StationCard n={st.n} size={76} />
            </span>
          ))}
          <span class="ca-cardwrap" title="The Era III card">
            <StationCard n="era" size={76} />
          </span>
        </div>
        <h3>The payday table</h3>
        <div class="ca-table-scroll">
          <table class="ca-rules-table">
            <caption>Dollars paid for the cities powered</caption>
            <tbody>
              <tr>
                <th scope="row">Cities</th>
                {PAYDAY.map((_, n) => (
                  <td key={n}>{n === PAYDAY.length - 1 ? `${n}+` : n}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Paid</th>
                {PAYDAY.map((pay, n) => (
                  <td key={n}>${pay}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <h3>By the number of players</h3>
        <div class="ca-table-scroll">
          <table class="ca-rules-table">
            <thead>
              <tr>
                <th scope="col">Players</th>
                <th scope="col">Regions</th>
                <th scope="col">Out unseen</th>
                <th scope="col">Station limit</th>
                <th scope="col">Era II at</th>
                <th scope="col">End at</th>
              </tr>
            </thead>
            <tbody>
              {SEAT_COUNTS.map((n) => {
                const t = TABLES[n];
                return t === undefined ? null : (
                  <tr key={n}>
                    <th scope="row">{n}</th>
                    <td>{t.regions}</td>
                    <td>{t.removed}</td>
                    <td>{t.maxStations}</td>
                    <td>{t.eraTwo} cities</td>
                    <td>{t.end} cities</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3>The restock</h3>
        <div class="ca-table-scroll">
          <table class="ca-rules-table">
            <caption>
              Units added after each payday: {listText([0, 1, 2, 3].map((r) => fuelName(r).toLowerCase()))}
            </caption>
            <thead>
              <tr>
                <th scope="col">Players</th>
                {ERAS.map((e) => (
                  <th key={e} scope="col">
                    Era {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SEAT_COUNTS.map((n) => (
                <tr key={n}>
                  <th scope="row">{n}</th>
                  {(RESTOCK[n] ?? []).map((v, e) => (
                    <td key={ERAS[e]}>{v.join(', ')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="setup">
        <ol>
          <li>
            Each company takes ${START_MONEY} and {SUBSTATIONS} substations.
          </li>
          <li>
            The regions in play are drawn: 3, 3, 4, 5 or 5 of them for 2 to 6 players, always touching as one
            block. Cities of the other regions take no part, and no line may pass through them.
          </li>
          <li>The order of the first round is drawn.</li>
          <li>
            Stations 3 to 10 form the market: 3 to 6 {THEME.words.onOffer}, 7 to 10 {THEME.words.comingUp}.
            The others but 13 make the stack; 8, 8, 4, 0 or 0 of them (for 2 to 6 players) are taken out
            unseen. Station 13 goes on top and the Era III card at the bottom.
          </li>
          <li>
            The yard holds coal on every space (24 units), oil from $3 (18), waste on $7 and $8 (6) and
            uranium on $14 and $16 (2).
          </li>
        </ol>
      </Section>

      <Section id="standings">
        <p>
          The company with the most cities goes first; among companies with as many cities, the one with the
          highest-numbered station. The others follow by the same rule. Round 1 keeps the drawn order for its
          auction, and the order is worked out again from the stations bought, before the fuel phase.
        </p>
      </Section>

      <Section id="auction">
        <ul>
          <li>
            In player order, a company may put up a station <strong>{THEME.words.onOffer}</strong> (the four
            lowest of the market in Eras I and II, all six in Era III) with an opening bid of at least its
            number, or pass. A company that passes takes no further part in this round's auction.{' '}
            <strong>In round 1 every company must buy</strong>, so nobody may pass.
          </li>
          <li>
            The others then bid clockwise round the table from the opener: each bids more than the last bid or
            folds out of this auction. Nobody bids more money than it has. When one company is left, it pays
            its bid and takes the station.
          </li>
          <li>
            Each company buys <strong>one station a round</strong> at most; after buying it bids no more this
            round. If the opener did not win, it puts up a station again (or passes). The last company to put
            up a station gets it at its opening bid.
          </li>
          <li>
            After each sale a replacement is drawn from the stack and the market is put in number order again.
          </li>
          <li>
            <strong>No sale.</strong> If no station was sold in a round (from round 2), the lowest station of
            the market leaves the game at the end of the auction, and a replacement is drawn.
          </li>
          <li>
            <strong>The station limit.</strong> A company that buys a station over its limit (3, or 4 with two
            players) scraps one of its other stations, never the new one. It may move that station's fuel to
            its other stations as far as they can hold it, and drop the rest, which goes back to the supply.
          </li>
        </ul>
      </Section>

      <Section id="fuel">
        <p>
          In <strong>reverse</strong> player order each company may buy fuel once, any mix, the cheapest units
          of each fuel first, only as much as its stations can hold, paying the yard's prices. A station holds
          twice its burn of its own fuel; a coal-or-oil station holds either, in any mix. A company may move
          its fuel between its stations at any time.
        </p>
        <p>
          For example, with the yard full of coal, three coal cost $1 + $1 + $1 and the fourth $2: the price
          rises as each space empties.
        </p>
      </Section>

      <Section id="wiring">
        <p>
          In reverse player order each company may wire any number of cities, one at a time, paying for each:
        </p>
        <ul>
          <li>
            <strong>the substation:</strong> $10 in an empty city, $15 as the second company in a city, $20 as
            the third;
          </li>
          <li>
            <strong>the lines:</strong> the cheapest route from any city already in its network (cities wired
            earlier this turn included), through any cities of the regions in play, wired by anyone or not.
            The first city needs no line.
          </li>
        </ul>
        <p>
          A city takes one company in Era I, two in Era II and three in Era III. A company is never wired
          twice to one city, and it has {SUBSTATIONS} substations. Nobody has to wire, in round 1 or later.
        </p>
      </Section>

      <Section id="payday">
        <p>
          In player order each company fires any of its stations: each burns exactly its fuel (a coal-or-oil
          station any mix of the two) and powers its cities, up to the cities the company has wired. The
          company is paid by the table for the cities it powers ($10 for none). Burnt fuel goes back to the
          supply. Then:
        </p>
        <ul>
          <li>
            <strong>Restock.</strong> The yard is refilled by the table for the era, each fuel from its
            dearest empty space, as far as the supply allows.
          </li>
          <li>
            <strong>The market moves on.</strong> In Eras I and II the highest station of the market goes face
            down under the stack (below the Era III card) and a replacement is drawn. In Era III the lowest
            station leaves the game and a replacement is drawn.
          </li>
        </ul>
      </Section>

      <Section id="small">
        <p>
          At any time, a station of the market numbered no higher than the city count of some company leaves
          the game at once and a replacement is drawn; a replacement that is small too leaves in turn.
          Stations a company owns are never affected.
        </p>
      </Section>

      <Section id="eras">
        <ul>
          <li>
            <strong>Era I</strong> is the start: one company a city.
          </li>
          <li>
            <strong>Era II</strong> begins after the wiring phase in which a company first has 10, 7, 7, 7 or
            6 cities (2 to 6 players): once, the lowest station of the market leaves the game and a
            replacement is drawn. From then on two companies may share a city, and the yard gets the Era II
            restock.
          </li>
          <li>
            <strong>The Era III card.</strong> When it is drawn, the stack is shuffled at once: it then holds
            the stations laid under it at paydays.
            <ul>
              <li>
                Drawn in the <strong>auction</strong>: it lies at the end of the market as the highest card
                and cannot be bought; replacements are drawn as usual. After the auction it leaves with the
                lowest station, without replacements. Era III begins with the fuel phase.
              </li>
              <li>
                Drawn while <strong>wiring</strong>: it leaves with the lowest station, without replacements.
                Era III begins with payday.
              </li>
              <li>
                Drawn at <strong>payday</strong>: it leaves with the lowest station, without replacements. Era
                III begins with the next round.
              </li>
            </ul>
          </li>
          <li>
            <strong>Era III:</strong> three companies a city, six stations in the market, all on offer, and
            the Era III restock. If the stack runs out, no replacement is drawn, and payday still takes the
            lowest station away: the market can shrink to nothing.
          </li>
        </ul>
        <p>
          If the Era III card comes up before any company reaches the Era II count, Era II's one-time removal
          never happens: the game goes straight to Era III.
        </p>
      </Section>

      <Section id="end">
        <p>
          After a wiring phase in which a company has 21, 17, 17, 15 or 14 cities (2 to 6 players) the game
          ends at once: nobody buys any more and no income is paid. Each company counts the cities it could
          power with its stations and the fuel on them. The most cities powered wins; a tie goes to the most
          money, then to the most cities wired; a tie there shares the place.
        </p>
      </Section>

      <Section id="online">
        <ul>
          <li>
            <strong>Everything is public:</strong> money, stations, fuel, the market and the stations still
            unseen. There are no hidden cards and no setup phase.
          </li>
          <li>
            <strong>Dice instead of shuffling.</strong> The regions in play, the first round's order and every
            unknown station drawn from the stack come from a roll made by all the players' apps together,
            after the move that needs it, so nobody can know it in advance. Each unknown station is picked
            evenly from the stations not yet seen, which deals them exactly as a shuffled stack would; the
            stations taken out unseen are never drawn. Keep the page open: your app adds its share to every
            roll by itself.
          </li>
          <li>
            <strong>Nothing to decide, nothing asked.</strong> A company that can afford no station on offer
            passes by itself; a bidder who cannot beat the bid folds by itself; a company that can buy no
            fuel, or wire no city, is passed over; a company with no city, or no station it can fire, is paid
            $10 by itself.
          </li>
          <li>
            <strong>One fuel purchase a turn:</strong> choose all the fuel you want, then buy it in one go (or
            buy nothing).
          </li>
          <li>
            The final count is worked out for you: the most cities each company's stations and fuel could
            power. During the game, the standings are the cities each company could power now.
          </li>
          <li>
            <strong>Timeouts:</strong> each move has a deadline ({deadlineList}, chosen with the table).{' '}
            <strong>Resign</strong> is always open: with two players you lose the game, with three or more the
            game ends for everyone, unrated, you come last and the others are placed by the cities they could
            power now.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function CurrentAffairsRulesPage(props: { section: string | null }) {
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
  return <CurrentRulesContent />;
}
