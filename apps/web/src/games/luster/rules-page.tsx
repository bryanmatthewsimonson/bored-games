import { LUSTER_THEME } from '@bored-games/luster/theme';
import { useEffect } from 'preact/hooks';
import { rulesHref } from '../../router.ts';
import './luster.css';

export function LusterRulesContent() {
  return (
    <article class="luster-rules">
      <h1>How to play {LUSTER_THEME.title}</h1>
      <p class="lede">{LUSTER_THEME.tagline}</p>
      <nav aria-label="Rules sections">
        {['goal', 'setup', 'turn', 'patrons', 'ending', 'online'].map((id) => (
          <a key={id} href={rulesHref('luster', id)}>
            {id.charAt(0).toUpperCase() + id.slice(1)}
          </a>
        ))}
      </nav>
      <section>
        <h2 id="luster-rules-goal" tabIndex={-1}>
          Goal
        </h2>
        <p>
          Buy developments and earn the favor of nobles to gain prestige. Reach 15 to start the final round.
          Two to four merchants share a market, but keep their own collections.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-setup" tabIndex={-1}>
          Setup
        </h2>
        <p>
          The market contains four developments from each of three separately shuffled tiers: 40 Mines cards,
          30 Workshops cards and 20 Guilds cards. Each development provides one permanent gem discount and its
          printed prestige. Reveal one more noble than there are players from ten nobles. Unused nobles stay
          out of play.
        </p>
        <p>
          Gems come in Diamond, Sapphire, Emerald, Ruby and Onyx, plus wild Gold. For two players use four
          tokens of each regular color, for three use five, and for four use seven. Always use five Gold
          tokens; the full set has 40 tokens. Everyone begins with an empty collection. A starting player is
          chosen at random during setup. Play follows table order from that player and wraps around to the
          beginning.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-turn" tabIndex={-1}>
          Your turn
        </h2>
        <p>Choose one main action:</p>
        <ul>
          <li>
            <strong>Take gems:</strong> take one token in each of up to three different regular colors.
            Alternatively, take two tokens of one color if at least four of that color are in the supply
            beforehand. You may take fewer different colors. Gold cannot be taken this way.
          </li>
          <li>
            <strong>Reserve a card:</strong> take an exposed card or the unseen top card of a tier. Keep at
            most three reservations, which cannot be discarded. Receive one Gold token if available; reserving
            is allowed when there are none. Blind reservations are private. Exposed reservations remain
            visible. Reserved cards give no discounts or prestige.
          </li>
          <li>
            <strong>Buy a development:</strong> buy an exposed card or a reservation. Reduce each color's
            price by your purchased developments of that color, stopping at zero. Pay the rest with colored
            gems and/or Gold, choosing your payment. You can use Gold even when you have enough colored gems.
            Return the payment to the supply. Add the purchased development to your collection; its discount
            applies from your next turn. A free purchase still uses your main action.
          </li>
        </ul>
        <p>
          A card taken from the market is replaced immediately from its own tier, while a blind reservation
          leaves the exposed market unchanged. Exhausted tiers leave empty spaces. After your action, return
          gems of your choice until you hold at most ten tokens, counting Gold. You can return tokens you just
          took.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-patrons" tabIndex={-1}>
          Nobles
        </h2>
        <p>
          At the end of every turn, check whether your permanent development discounts meet any visible
          noble's requirements. Tokens do not count. An eligible noble must join you, costing no tokens and
          adding three prestige. If several qualify, choose exactly one. Nobles grant no gem discount, and
          their visit does not use your main action.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-ending" tabIndex={-1}>
          The final round
        </h2>
        <p>
          When any player reaches at least 15 prestige, finish the round through the player immediately before
          the starting player. Everyone receives the same number of turns, and the score can exceed 15. The
          highest score wins; equal scores favor fewer purchased developments. Nobles and reservations do not
          count as developments. Players tied on both score and development count share their place.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-online" tabIndex={-1}>
          Playing online
        </h2>
        <p>
          Click the gem stacks to select gems, then choose Take gems. Click the same stack twice for a legal
          pair. Click a gem in your selection tray to remove it, or Clear to start again. When returning
          excess tokens, the stacks show your hand instead of the bank. Click a development to buy or reserve
          it. The card panel shows its price after discounts; click payment gems to swap between their color
          and Gold. Click a tier's deck to reserve an unseen card. Click an eligible noble to choose it. Every
          gem also has a written name and a distinct shape.
        </p>
        <p>
          Signed moves travel over NOSTR. Encrypted decks protect unseen cards, and buying a blind reservation
          reveals its identity for the final audit. Your hand shows your reserved cards. Opponents and
          spectators see them face down, with their tier and count. A card taken from the market can still be
          remembered from the earlier public move. The desktop sidebar shows scores and resources; on smaller
          screens the player panels sit below the board. Moves can take time to arrive; controls unlock when
          it is your decision and the game has synced. A failed send can be retried. The table's deadline
          applies to turns. Resigning is currently unavailable for this game.
        </p>
      </section>
    </article>
  );
}
export function LusterRulesPage(props: { section: string | null }) {
  useEffect(() => {
    if (props.section === null) {
      window.scrollTo(0, 0);
      return;
    }
    const h = document.getElementById(`luster-rules-${props.section}`);
    h?.scrollIntoView({ block: 'start' });
    h?.focus({ preventScroll: true });
  }, [props.section]);
  return <LusterRulesContent />;
}
