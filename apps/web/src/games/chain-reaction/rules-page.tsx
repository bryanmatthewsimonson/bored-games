/*
 * The player-facing rules (#/rules), section by section after docs/games/chain-reaction/RULES.md, the source of
 * truth. Every number comes from the engine's default rules and prices, and every chain name from the theme.
 * `RulesContent` uses no hooks, so tests can expand it without a DOM; `RulesPage` adds the scrolling.
 */
import {
  bonusPayouts,
  type ChainReactionRules,
  COLS,
  DEFAULT_RULES,
  ROWS,
  sharePrice,
  TILE_COUNT,
  tileId,
} from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { Swatch } from './board.tsx';
import { formatMoney, priceCard } from './model.ts';
import { PriceCard } from './price-card.tsx';
import './rules.css';

/** The page's sections, in order: the contents list, the headings and the `#/rules/<id>` links. */
export const RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'components', title: 'Components' },
  { id: 'setup', title: 'Setup' },
  { id: 'turn', title: 'Your turn' },
  { id: 'placing', title: 'Placing a tile' },
  { id: 'mergers', title: 'Mergers' },
  { id: 'buying', title: 'Buying shares' },
  { id: 'ending', title: 'Ending the game' },
  { id: 'price-card', title: 'Price card' },
  { id: 'seeing', title: 'What you can see' },
  { id: 'online', title: 'Playing online' },
];

const headingId = (section: string): string => `rules-${section}`;

function listText(items: readonly string[], last = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}

const tiles = (n: number): string => `${n} ${n === 1 ? 'tile' : 'tiles'}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

/** The bonus a seat receives from `bonusPayouts`, or 0. */
function payout(rules: ChainReactionRules, holdings: readonly number[], price: number, seat: number): number {
  return bonusPayouts(rules, holdings, price).find((p) => p.seat === seat)?.amount ?? 0;
}

export function RulesContent(props: { rules?: ChainReactionRules }) {
  const r = props.rules ?? DEFAULT_RULES;
  const card = priceCard(r);
  const chainCount = r.chains.length;
  const firstTile = tileId(0);
  const lastTile = tileId(TILE_COUNT - 1);
  const lastRow = lastTile.slice(-1);
  const exampleTile = tileId(2 * COLS + 6);
  const [exampleCol, exampleRow] = [exampleTile.slice(0, -1), exampleTile.slice(-1)];

  // Worked examples, priced and paid by the engine itself.
  const budget = card.tiers.find((t) => t.tier === 'budget') ?? card.tiers[0];
  const ex = budget?.chains[0];
  const exIndex = ex?.index ?? 0;
  const exName = ex?.name ?? 'A chain';
  const exSize = 3;
  const exPrice = sharePrice(r, exIndex, exSize);
  const exMajority = exPrice * r.majorityMultiplier;
  const exMinority = exPrice * r.minorityMultiplier;
  const plainSplit = [3, 2, 0];
  const majorityTie = [2, 2, 0];
  const minorityTie = [5, 2, 2];
  const tiedPool = exMajority + exMinority;
  const olderLogChains = (budget?.chains ?? []).map((c) => c.name);

  return (
    <article class="rules-page">
      <header class="rules-head">
        <h1>How to play {CHAIN_REACTION_THEME.title}</h1>
        <p class="lede">{CHAIN_REACTION_THEME.tagline}</p>
      </header>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          Place tiles to found chains, buy shares in them, and collect bonuses when they are taken over. When
          the game ends, every share is sold. The player with the most cash wins; tied players share the
          place.
        </p>
      </Section>

      <Section id="components">
        <ul>
          <li>
            A board of {COLS} columns (1–{COLS}) by {ROWS} rows (A–{lastRow}): {TILE_COUNT} spaces, and one
            tile for each, named like {exampleTile} (column {exampleCol}, row {exampleRow}). Tiles touch only
            side by side or above and below, never diagonally.
          </li>
          <li>
            {chainCount} chains in {card.tiers.length} price tiers, each with {r.sharesPerChain} shares in the
            bank:
            <ul class="rules-tiers">
              {card.tiers.map((t) => (
                <li key={t.tier}>
                  <strong>{t.name}:</strong>{' '}
                  {t.chains.map((c, i) => (
                    <span key={c.id} class="cr-chain-name">
                      <Swatch chain={c} />
                      {c.name}
                      {i < t.chains.length - 1 ? ',' : ''}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </li>
          <li>
            Each player starts with {formatMoney(r.startingCash)}. All money comes in multiples of{' '}
            {formatMoney(100)}, and nobody can borrow.
          </li>
          <li>
            {r.minPlayers} to {r.maxPlayers} players.
          </li>
        </ul>
      </Section>

      <Section id="setup">
        <ol>
          <li>
            Each player draws one tile, which is placed face up on its space. These starting tiles never form
            a chain, even when they touch. They stay on the board as loose tiles and can later become part of
            a chain.
          </li>
          <li>
            The player whose starting tile is closest to {firstTile} goes first: the earlier row letter wins,
            then the lower column, so 9A beats 1B. Play then follows seat order.
          </li>
          <li>Each player is dealt a hidden hand of {tiles(r.handSize)}.</li>
        </ol>
      </Section>

      <Section id="turn">
        <ol>
          <li>
            <strong>Place</strong> one tile from your hand on its space. If none of your tiles can be played,
            skip this step.
          </li>
          <li>
            <strong>Buy</strong> up to {r.maxBuyPerTurn} shares, in any mix of chains on the board (see{' '}
            <a href={rulesHref('buying')}>Buying shares</a>). Buying is optional.
          </li>
          <li>
            <strong>End your turn.</strong> Dead tiles you held during the turn are discarded and replaced,
            then you draw back up to {tiles(r.handSize)} while the bag lasts. Play passes to the next seat.
          </li>
        </ol>
        <p>
          You place before you buy. You cannot sell shares on your turn: shares are sold only in a merger or
          at the end of the game.
        </p>
      </Section>

      <Section id="placing">
        <p>What a tile does depends on its neighbors.</p>
        <dl class="rules-terms">
          <dt>Lone</dt>
          <dd>It touches nothing. The tile sits on the board as a loose tile, in no chain.</dd>
          <dt>Found</dt>
          <dd>
            It touches only loose tiles. You found a chain: pick any chain that is not on the board. The chain
            is your tile plus every loose tile connected to it. You get {r.founderShares} free share
            {r.founderShares === 1 ? '' : 's'} of it if the bank has {r.founderShares === 1 ? 'one' : 'them'}.
          </dd>
          <dt>Grow</dt>
          <dd>
            It touches exactly one chain, on any number of sides. The chain takes in your tile and every loose
            tile connected to it.
          </dd>
          <dt>Merge</dt>
          <dd>
            It touches two or more chains: see <a href={rulesHref('mergers')}>Mergers</a>.
          </dd>
        </dl>
        <h3>Safe, dead and blocked tiles</h3>
        <ul>
          <li>
            A chain of <strong>{r.safeSize} or more tiles is safe</strong>. It can never be taken over, but it
            can still grow and take over smaller chains.
          </li>
          <li>
            A tile that would merge two or more safe chains is <strong>dead</strong>: it can never be played.
            At the end of your turn, every dead tile you held during the turn is shown, discarded and
            replaced. This happens once per turn: if a replacement is dead too, it waits until the end of your
            next turn.
          </li>
          <li>
            A tile that would found a new chain while all {chainCount} chains are on the board is{' '}
            <strong>blocked</strong>. It is not dead: it stays in your hand until a merger frees a chain.
          </li>
          <li>If you hold no playable tile, you skip placing and still buy.</li>
        </ul>
      </Section>

      <Section id="mergers">
        <p>
          The player who placed the merging tile is the <strong>mergemaker</strong>.
        </p>
        <ol>
          <li>
            <strong>Survivor.</strong> The largest chain survives. Sizes are counted before the merger: the
            merging tile does not count. If chains tie for largest, the mergemaker chooses the survivor. A
            safe chain is always larger than an unsafe one, so it survives.
          </li>
          <li>
            <strong>Defunct chains.</strong> Every other chain in the merger is defunct. They are settled one
            at a time, largest first. When defunct chains are the same size, the mergemaker chooses their
            order at the start.
          </li>
          <li>
            <strong>For each defunct chain, in that order:</strong>
            <ol type="a">
              <li>
                <strong>Bonuses</strong> are paid at the chain's price before the merger. The majority holder
                (most shares) gets {r.majorityMultiplier}× the share price; the minority holder (second most)
                gets {r.minorityMultiplier}×. A sole holder gets both.
              </li>
              <li>
                <strong>Sell, trade or keep.</strong> Starting with the mergemaker and going on in seat order,
                each player with shares of the defunct chain chooses how many to:
                <ul>
                  <li>
                    <strong>sell</strong> at the price before the merger;
                  </li>
                  <li>
                    <strong>trade</strong> 2 for 1 for shares of the survivor. You trade an even number, and
                    you get only as many survivor shares as the bank has left at that moment;
                  </li>
                  <li>
                    <strong>keep.</strong> Kept shares are worth something again if the chain is founded
                    again.
                  </li>
                </ul>
              </li>
            </ol>
          </li>
          <li>
            <strong>Completion.</strong> The defunct chains, the merging tile and any loose tiles connected to
            it all join the survivor. The defunct chains can be founded again.
          </li>
        </ol>
        <h3>Ties for bonuses</h3>
        <ul>
          <li>
            <strong>Majority tie:</strong> both bonuses are pooled and split evenly among the tied holders. No
            minority bonus is paid.
          </li>
          <li>
            <strong>Minority tie:</strong> the minority bonus is split evenly among the tied holders.
          </li>
          <li>Every split portion rounds up to the next {formatMoney(100)}.</li>
        </ul>
        <p>
          For example, {exName} is taken over at {tiles(exSize)}, so its price is {formatMoney(exPrice)}: the
          majority bonus is {formatMoney(exMajority)} and the minority bonus {formatMoney(exMinority)}.
        </p>
        <ul>
          <li>
            Holdings {plainSplit.slice(0, 2).join(' and ')}: the first player gets{' '}
            {formatMoney(payout(r, plainSplit, exPrice, 0))}, the second{' '}
            {formatMoney(payout(r, plainSplit, exPrice, 1))}.
          </li>
          <li>
            Holdings {majorityTie.slice(0, 2).join(' and ')}: a majority tie. The pool of{' '}
            {formatMoney(tiedPool)} splits as {formatMoney(tiedPool / 2)}, rounded up to{' '}
            {formatMoney(payout(r, majorityTie, exPrice, 0))} each. Nobody gets a minority bonus.
          </li>
          <li>
            Holdings {minorityTie.join(', ')}: the first player gets{' '}
            {formatMoney(payout(r, minorityTie, exPrice, 0))}. The two tied for minority split{' '}
            {formatMoney(exMinority)} as {formatMoney(exMinority / 2)}, rounded up to{' '}
            {formatMoney(payout(r, minorityTie, exPrice, 1))} each.
          </li>
        </ul>
      </Section>

      <Section id="buying">
        <ul>
          <li>
            After placing, you may buy up to {r.maxBuyPerTurn} shares in total, in any mix of the chains on
            the board.
          </li>
          <li>
            Each share costs its chain's current price (see the{' '}
            <a href={rulesHref('price-card')}>price card</a>
            ). You are limited by the bank's supply and by your cash.
          </li>
          <li>A chain founded this turn can be bought this turn.</li>
          <li>Shares of a chain that is not on the board cannot be bought.</li>
        </ul>
      </Section>

      <Section id="ending">
        <p>
          On your turn you <em>may</em> declare the end of the game if, at the start of your turn or after
          your tile is placed and resolved, either:
        </p>
        <ul>
          <li>any chain has {r.endSize} or more tiles, or</li>
          <li>every chain on the board (at least one) is safe.</li>
        </ul>
        <p>
          You finish your turn, buying shares as usual, and then the game is scored. Declaring is the only way
          the game ends: players who cannot place a tile still take their turns and buy shares until someone
          declares.
        </p>
        <h3>Final scoring</h3>
        <ol>
          <li>
            Each chain on the board pays its majority and minority bonuses at its current size, with the same
            tie rules.
          </li>
          <li>Every share of a chain on the board is sold at its current price.</li>
          <li>Shares of chains not on the board are worthless.</li>
        </ol>
        <p>The most cash wins. Tied players share the place.</p>
      </Section>

      <Section id="price-card">
        <p>
          The share price depends on the chain's tier and its size in tiles. In a game, the{' '}
          <strong>Price card</strong> button shows this card with each chain on the board marked.
        </p>
        <PriceCard rules={r} />
      </Section>

      <Section id="seeing">
        <ul>
          <li>
            Your tiles are hidden from the other players, and theirs from you. So is the order of the bag.
          </li>
          <li>
            You see your own cash and shares exactly. Of another player you see only which chains they hold
            shares in, as chain chips without counts, and whether they have any cash: "has cash" or "no cash".
            As at a real table, you can watch their purchases and remember them.
          </li>
          <li>
            The board, each chain's size and price, the bank's shares and the number of tiles in each hand are
            shown exactly.
          </li>
          <li>
            The game log shows other players' counts and amounts only for the current and the previous turn.
            Older lines say what happened without numbers, such as "Ann bought {listText(olderLogChains)}{' '}
            shares."
          </li>
          <li>When the game ends, everything is shown.</li>
        </ul>
      </Section>

      <Section id="online">
        <ul>
          <li>
            <strong>Turns are asynchronous.</strong> Nothing hurries you: your turn may come hours later.
            Close the tab whenever you like and come back from Home, under Your games.
          </li>
          <li>
            <strong>The shuffle and deal take a moment.</strong> When the game starts, every player's browser
            shuffles the tiles, proves its shuffle, and then deals. With three players this takes about 15–30
            seconds, and every player needs the game open for it to finish.
          </li>
          <li>
            <strong>A new tile can show "?" for a while.</strong> Each other player's next move carries what
            you need to read it, so it shows "?" until every other player has moved once. It is always known
            before you need it.
          </li>
          <li>
            <strong>Merger decisions can come to you out of turn.</strong> When a chain you hold shares in is
            taken over, you are asked to sell, trade or keep, even when it is not your turn.
          </li>
          <li>
            <strong>Timeouts.</strong> Each move has a deadline,{' '}
            {listText(
              DEADLINE_CHOICES.map((c) => c.label),
              'or',
            )}
            , chosen when the table is created. Once a player's deadline has passed, the others get a Claim
            timeout button. Claiming it makes that player forfeit: the game ends at once, they are ranked
            last, and the others are ranked by their cash. If no move has been played yet, the game is
            cancelled instead. Nothing is claimed automatically.
          </li>
          <li>
            <strong>The end-of-game audit.</strong> When the game ends, every browser reveals its secrets and
            checks the hidden moves, such as "I have no playable tile". The results then say "Audit passed",
            or name who failed.
          </li>
          <li>
            <strong>Stay on one browser.</strong> Your player key and each game's secrets are stored in this
            browser, under this profile. Keep using it for the whole game: clearing the site's data loses your
            seat.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` (from `#/rules/<section>`) with focus on its heading. */
export function RulesPage(props: { section: string | null }) {
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
  return <RulesContent />;
}
