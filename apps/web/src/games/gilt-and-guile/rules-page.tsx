import { CARDS, KINDS, KINGDOM } from '@bored-games/gilt-and-guile';
import { COMPARE_BGG_ID, COMPARE_PHRASE } from '@bored-games/gilt-and-guile/compare';
import { CARD_NAMES, CARD_TEXT, GILT_AND_GUILE_THEME } from '@bored-games/gilt-and-guile/theme';
import { useState } from 'preact/hooks';
import { StageArt } from './art.tsx';
import { Card } from './cards.tsx';
import './gilt-and-guile.css';
export function GiltAndGuileRulesPage(_props: { section: string | null }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const cards = KINDS.filter(
    (k) =>
      (filter === 'all' || (filter === 'company' ? KINGDOM.includes(k) : CARDS[k].type === filter)) &&
      `${CARD_NAMES[k]} ${CARD_TEXT[k]}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <article class="gg-rules">
      <header class="gg-rules-lede">
        <div>
          <p class="gg-eyebrow">2–4 PRODUCERS · 30–45 MINUTES · 33 CARD TYPES</p>
          <h1>{GILT_AND_GUILE_THEME.title}</h1>
          <p>
            From a pocketful of pennies to the hottest ticket in town. Assemble a company, improve your deck,
            and collect the most acclaim before the curtain falls.
          </p>
          <a href="#/games/gilt-and-guile">Find a table →</a>
          {' · '}
          <a
            href={`https://boardgamegeek.com/boardgame/${COMPARE_BGG_ID}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {COMPARE_PHRASE} ↗
          </a>
        </div>
        <StageArt kind="grandstage" />
      </header>
      <div class="gg-rule-grid">
        <section>
          <h2>01 · Set the stage</h2>
          <p>
            Each player starts with 7 Pennies and 3 Playbills. Shuffle these ten cards, then draw five. Choose
            ten different company piles from the complete catalog of 26. The table creator can select a
            curated set or customize it.
          </p>
          <p>
            Include the seven basic piles in every game. Use 8 cards per victory pile with two players, or 12
            with three or four. Each action pile has 10 cards. Funding begins with 60 Pennies minus the
            starters, 40 Banknotes, and 30 Endowments. Set out 10 Scandals per opponent.
          </p>
        </section>
        <section>
          <h2>02 · Produce a turn</h2>
          <p>
            <strong>Actions:</strong> Begin with 1 action. Spend it to play an action card and finish its
            instructions in order. Extra actions allow more plays. You may stop whenever you wish.
          </p>
          <p>
            <strong>Treasures:</strong> Play any funding cards from your hand to collect coins. Move to buying
            when ready; you cannot go back.
          </p>
          <p>
            <strong>Buying:</strong> Begin with 1 buy. Spend a buy and the printed coin price to take a card
            from a nonempty supply pile. Extra buys permit extra purchases if you can afford them.
          </p>
        </section>
        <section>
          <h2>03 · Take another bow</h2>
          <p>
            Gained cards normally enter your discard pile. Gaining through a card effect spends neither coins
            nor buys. Cards you trash leave your company permanently.
          </p>
          <p>
            End your turn by discarding your hand and all cards in play. Draw five new cards. Unused actions,
            buys, and coins expire. When an effect needs cards from an empty deck, shuffle your discard to
            make a new deck. If you run out entirely, take as many as remain.
          </p>
        </section>
      </div>
      <section>
        <h2>The final curtain</h2>
        <p>
          Finish the current turn when the Grand Stage pile is empty, or any three active supply piles are
          empty. Count acclaim across every card you own: Playbill 1, Playhouse 3, Grand Stage 6, Scandal −1.
          Each Repertoire is worth one point per complete ten cards in your company, including itself. Most
          acclaim wins; a tied player with fewer turns wins the tie. If turns are also equal, share the win.
        </p>
      </section>
      <section>
        <h2>Timing & backstage details</h2>
        <p>
          Follow each card in order and do as much as possible. “You may” gives a choice. A gain with a price
          limit may take a cheaper card. You can buy or gain Scandals. Empty piles remain in the supply; cards
          not selected for this table do not count as empty piles.
        </p>
        <p>
          <strong>Attacks:</strong> Resolve opponents in seating order. Each can reveal an Understudy already
          in their hand to ignore that attack, keeping the Understudy. Opening Night is not an attack. For
          Headliner, the affected player chooses the treasure to trash when there is more than one eligible
          card. Booking Office requires a victory card if one is present; Repertoire is a victory card too.
        </p>
        <p>
          <strong>Repeat plays:</strong> Double Bill spends no additional action to play its chosen card
          twice. Finish the first play, including gains and all opponents’ responses, before starting the
          second. Repeated Double Bills can choose a separate action for each play. Each Impresario play adds
          its own bonus to the first Banknote of the turn.
        </p>
        <p>
          <strong>Private inspection:</strong> Reading Room lets you decline newly drawn actions one at a
          time; set them aside until drawing is finished, then discard them. Stage Door’s two inspected cards
          stay private unless discarded or trashed. Resolve its trash step, then discard step, then return the
          rest. The interface asks for the bottom card first; the last returned card will be drawn first.
        </p>
        <p>
          <strong>Deck placement:</strong> Costumier gains into your hand before you choose a hand card to
          place privately onto your deck. Encore may return any card in your discard. Neither effect shuffles
          the deck first. Busker’s revealed card is discarded unless you choose to play it as an action.
        </p>
      </section>
      <section class="gg-game" style={{ padding: '20px' }}>
        <h2>The complete card catalog</h2>
        <p>
          26 company cards and 7 basic cards. Current base edition; expansion and retired edition cards are
          outside this catalog.
        </p>
        <div class="gg-rules-filter">
          <label>
            Find a card{' '}
            <input
              type="search"
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Name or effect…"
            />
          </label>
          <label for="gg-catalog-filter">Show</label>
          <select id="gg-catalog-filter" value={filter} onChange={(e) => setFilter(e.currentTarget.value)}>
            <option value="all">All 33 cards</option>
            <option value="company">26 company cards</option>
            <option value="action">Actions</option>
            <option value="treasure">Funding</option>
            <option value="victory">Victory</option>
            <option value="curse">Penalties</option>
          </select>
          <span>{cards.length} cards</span>
        </div>
        <div class="gg-rule-cards">
          {cards.map((kind) => (
            <Card key={kind} kind={kind} />
          ))}
        </div>
        {!cards.length && <p>No matching cards.</p>}
      </section>
      <p class="gg-muted">
        Original names, vector illustrations, and independently written rules. Not affiliated with or endorsed
        by the makers of the comparison game.
      </p>
    </article>
  );
}
