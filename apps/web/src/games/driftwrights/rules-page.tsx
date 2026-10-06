import { DRIFTWRIGHTS_THEME } from '@bored-games/driftwrights/theme';
import { useEffect } from 'preact/hooks';
export function DriftwrightsRulesPage({ section }: { section: string | null }) {
  useEffect(() => {
    if (section) document.getElementById(`drift-rules-${section}`)?.focus();
  }, [section]);
  return (
    <article class="drift-rules">
      <h1>How to play {DRIFTWRIGHTS_THEME.title}</h1>
      <p>{DRIFTWRIGHTS_THEME.tagline}</p>
      <h2 id="drift-rules-goal" tabIndex={-1}>
        Ten prestige wins
      </h2>
      <p>
        Three or four guilds build on nineteen floating islands. A hearth earns one prestige; a hub earns two.
        Grand Span and Stormwatch each earn two. Each landmark venture adds one private prestige. Declare
        victory as soon as you have ten on your own turn, including unplayed landmarks.
      </p>
      <h2 id="drift-rules-setup" tabIndex={-1}>
        Establish your havens
      </h2>
      <p>
        Everyone rolls two dice; the highest total starts. Tied leaders roll again. Place one hearth and an
        adjoining link in clockwise order, then a second pair in reverse order. Hearths must leave at least
        one empty site between them, regardless of owner. Your second hearth collects one supply from each
        adjoining productive island. Each guild has five hearths, four hubs and fifteen links. The bank holds
        nineteen of each supply.
      </p>
      <h2 id="drift-rules-turn" tabIndex={-1}>
        A guild’s turn
      </h2>
      <p>
        Roll two dice. Each island matching the total produces one of its supply for every adjoining hearth,
        or two for a hub. The Squall’s island produces nothing. If the bank cannot satisfy everyone for one
        kind, nobody receives that kind; a sole receiving guild takes what remains. On seven, everyone with
        more than seven supplies returns half, rounded down. The active guild then moves the Squall and takes
        one random supply from an eligible neighboring rival.
      </p>
      <p>
        Trade, then build, in any quantity you can afford. Offer exchanges to another guild; only the active
        guild may trade with rivals. Give four identical supplies to the bank for one different supply. A
        hearth or hub at a general mooring improves this to three for one; a named mooring trades two of that
        kind for one. End your turn to pass clockwise.
      </p>
      <h2 id="drift-rules-building" tabIndex={-1}>
        Build costs and connections
      </h2>
      <ul>
        <li>
          Sky link: one Timber and one Clay. Extend your links or buildings; a rival building blocks
          continuation.
        </li>
        <li>
          Hearth: one each of Timber, Clay, Fiber and Grain. Connect it to your link network and respect the
          empty-site gap.
        </li>
        <li>Hub: two Grain and three Metal. Replace one of your hearths, returning it to your stock.</li>
        <li>Venture: one Fiber, one Grain and one Metal. Draw privately from the twenty-five-card deck.</li>
      </ul>
      <h2 id="drift-rules-ventures" tabIndex={-1}>
        Ventures and honors
      </h2>
      <p>
        You may play one action venture per turn, before or after rolling, from those bought on an earlier
        turn. Landmarks never count against that limit and may win immediately after purchase.
      </p>
      <ul>
        <li>Fourteen Gale Guides move the Squall and take a random neighboring supply.</li>
        <li>Two Twin Links place up to two free links, within your stock and the normal connection rules.</li>
        <li>
          Two Supply Windfalls take two supplies of your choice from the bank. When the entire bank holds
          fewer than two, the default takes what remains; a table can instead require two available supplies.
        </li>
        <li>
          Two Guild Requisitions name one kind of supply; every rival transfers all of that kind to you.
        </li>
        <li>Five unique landmarks each earn one private prestige.</li>
      </ul>
      <p>
        Grand Span goes to the first unbroken trail of five links. Count each link at most once; branches
        cannot reuse a link and rival buildings divide a trail. A longer trail takes the honor. The incumbent
        keeps it on a tie; without an incumbent, tied leaders leave it unclaimed. Stormwatch uses the same tie
        rule, starting at three played Guides.
      </p>
      <h2 id="drift-rules-online" tabIndex={-1}>
        Playing online
      </h2>
      <p>
        Your supplies and ventures stay private; rivals see their counts and public prestige. Keep your game
        open to deliver card and dice contributions. Theft requires the victim to deliver its encrypted
        selection. Every guild checks the full history when the game ends, after releasing the deck keys. A
        result is final when the audit passes. The deadline applies to outstanding duties; resignation is
        unavailable for this game.
      </p>
    </article>
  );
}
