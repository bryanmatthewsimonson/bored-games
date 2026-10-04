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
          Build glass workshops and complete patron commissions to earn radiance. Reach 15 to start the final
          round. Two to four glassmakers share a market, but keep their own collections.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-setup" tabIndex={-1}>
          Setup
        </h2>
        <p>
          The market contains four workshops from each of three separately shuffled tiers: 40 Study cards, 30
          Studio cards and 20 Atelier cards. Each workshop provides one permanent color discount and its
          printed radiance. Reveal one more patron than there are players from ten commissions. Unused patrons
          stay out of play.
        </p>
        <p>
          Light comes in Ivory, Azure, Moss, Rose and Ink, plus wild Prisms. For two players use four tokens
          of each regular color, for three use five, and for four use seven. Always use five Prisms; the full
          set has 40 tokens. Everyone begins with an empty collection. A starting player is chosen at random
          during setup. Play follows table order from that player and wraps around to the beginning.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-turn" tabIndex={-1}>
          Your turn
        </h2>
        <p>Choose one main action:</p>
        <ul>
          <li>
            <strong>Gather light:</strong> take one token in each of up to three different regular colors.
            Alternatively, take two tokens of one color if at least four of that color are in the supply
            beforehand. You may take fewer different colors. Prisms cannot be gathered.
          </li>
          <li>
            <strong>Reserve a workshop:</strong> take an exposed card or the unseen top card of a tier. Keep
            at most three reservations, which cannot be discarded. Receive one Prism if available; reserving
            is allowed when there are none. Blind reservations are private. Exposed reservations remain
            visible. Reserved workshops give no discounts or radiance.
          </li>
          <li>
            <strong>Purchase a workshop:</strong> buy an exposed card or a reservation. Reduce each color's
            price by your purchased workshops of that color, stopping at zero. Pay the rest with colored light
            and/or Prisms, choosing your payment. You can use Prisms even when you have enough colored light.
            Return the payment to the supply. Add the purchased workshop to your collection; its discount
            applies from your next turn. A free purchase still uses your main action.
          </li>
        </ul>
        <p>
          A card taken from the market is replaced immediately from its own tier, while a blind reservation
          leaves the exposed market unchanged. Exhausted tiers leave empty spaces. After your action, return
          light of your choice until you hold at most ten tokens, counting Prisms. You can return tokens you
          just took.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-patrons" tabIndex={-1}>
          Patron commissions
        </h2>
        <p>
          At the end of every turn, check whether your permanent workshop discounts meet any visible
          commission. Tokens do not count. An eligible patron must join you, costing no tokens and adding
          three radiance. If several qualify, choose exactly one. Patrons grant no color discount, and their
          visit does not use your main action.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-ending" tabIndex={-1}>
          The final round
        </h2>
        <p>
          When any player reaches at least 15 radiance, finish the round through the player immediately before
          the starting player. Everyone receives the same number of turns, and the score can exceed 15. The
          highest score wins; equal scores favor fewer purchased workshops. Patrons and reservations do not
          count as workshops. Players tied on both score and workshop count share their place.
        </p>
      </section>
      <section>
        <h2 id="luster-rules-online" tabIndex={-1}>
          Playing online
        </h2>
        <p>
          Use the light controls to choose a gathering or return. Select Purchase on a workshop, choose a
          payment, then confirm. Reserve on a visible card keeps its identity public; Reserve blind draws
          privately from that tier. The game offers a patron choice when more than one qualifies. Colors also
          have distinct symbols and names.
        </p>
        <p>
          Signed moves travel over NOSTR. Encrypted decks protect unseen cards, and buying a blind reservation
          reveals its identity for the final audit. Watching a game shows all public information. Moves can
          take time to arrive; controls unlock when it is your decision and the game has synced. A failed send
          can be retried. The table's deadline applies to turns. Resigning is currently unavailable for this
          game.
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
