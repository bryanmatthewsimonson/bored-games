/*
 * The player-facing Bank rules (#/rules/bank), after docs/games/bank/RULES.md. Every number comes from the
 * default rules. `BankRulesContent` uses no hooks, so tests can expand it without a DOM.
 */
import { bank, DEFAULT_RULES } from '@bored-games/bank';
import { BANK_THEME } from '@bored-games/bank/theme';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { DEADLINE_CHOICES } from '../../lobby-model.ts';
import { rulesHref } from '../../router.ts';
import { DicePair } from './dice.tsx';
import { BANK_META } from './meta.ts';
import { SHOW_DICE } from './model.ts';
import '../chain-reaction/rules.css';
import './bank.css';

export const BANK_RULES_SECTIONS: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'goal', title: 'Goal' },
  { id: 'pot', title: 'The pot' },
  { id: 'safe', title: 'The first three rolls' },
  { id: 'unsafe', title: 'After three rolls' },
  { id: 'banking', title: 'Banking' },
  { id: 'round', title: 'How a round ends' },
  { id: 'end', title: 'How the game ends' },
  { id: 'online', title: 'Playing on this site' },
];

const headingId = (section: string): string => `rules-${section}`;

function Section(props: { id: string; children: ComponentChildren }) {
  const title = BANK_RULES_SECTIONS.find((s) => s.id === props.id)?.title ?? props.id;
  return (
    <section class="rules-section" aria-labelledby={headingId(props.id)}>
      <h2 id={headingId(props.id)} tabIndex={-1}>
        {title}
      </h2>
      {props.children}
    </section>
  );
}

export function BankRulesContent() {
  const seats = bank.seatRange(DEFAULT_RULES);
  const deadlines = DEADLINE_CHOICES.map((c) => c.label);
  const deadlineList = `${deadlines.slice(0, -1).join(', ')} or ${deadlines.at(-1)}`;
  const rounds = DEFAULT_RULES.rounds;
  const cap = DEFAULT_RULES.maxRollsPerRound;
  return (
    <article class="rules-page">
      <header class="rules-head">
        <h1>How to play {BANK_THEME.title}</h1>
        <p class="lede">{BANK_THEME.tagline}</p>
      </header>

      <nav class="rules-toc" aria-labelledby="rules-toc-h">
        <h2 id="rules-toc-h">Contents</h2>
        <ol>
          {BANK_RULES_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={rulesHref(BANK_META.id, s.id)}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="goal">
        <p>
          {seats.min} to {seats.max} players share one pot. Two dice add to it. You may <strong>bank</strong>{' '}
          the pot into your score and sit out the rest of the round, or let it ride. The highest score after{' '}
          {rounds} rounds wins. A table can also be set to 5 or 20 rounds. Best with 3 to 5 players.
        </p>
      </Section>

      <Section id="pot">
        <DicePair faces={[3, 4]} rollId={1} className="bank-die" />
        <ul>
          <li>
            Two dice, each showing 1 to 6. The pot starts at 0 every round. Scores start at 0 and carry on.
          </li>
          <li>The player who creates the table rolls first. After that, the dice pass to the left.</li>
          <li>A roll is safe while fewer than three rolls have been resolved this round.</li>
        </ul>
      </Section>

      <Section id="safe">
        <ul>
          <li>Add the two faces to the pot. A double is not special yet: double 1s add 2.</li>
          <li>
            A <strong>7</strong> on a safe roll adds <strong>70</strong>, not 7.
          </li>
        </ul>
      </Section>

      <Section id="unsafe">
        <p>From the fourth roll of the round, the pot can bust.</p>
        <ul>
          <li>
            A <strong>7</strong> busts the round. The pot becomes 0. Anyone who has not banked scores nothing
            more for this round. What they already banked stays. A 7 is never a double.
          </li>
          <li>
            <strong>Doubles</strong> replace the pot with twice the pot. The faces are not also added.
          </li>
          <li>Any other roll adds the faces, as before.</li>
        </ul>
      </Section>

      <Section id="banking">
        <p>
          Between rolls, the default is that everyone still in the round may bank. This site asks in seat
          order, starting with the player after the roller and ending with the roller. The pot does not change
          while people answer. A table can instead be set so only the roller may bank.
        </p>
        <ul>
          <li>
            <strong>Bank</strong> adds the current pot, even 0, to your score. You sit out the rest of the
            round. The pot stays for everyone else.
          </li>
          <li>
            <strong>Stay</strong> leaves the pot, your score, and who is in as they are. You are not asked
            again until the next roll.
          </li>
          <li>
            The roller chooses <strong>Bank</strong> or <strong>Roll</strong>. If they already stayed and then
            became the roller, they can only roll.
          </li>
        </ul>
      </Section>

      <Section id="round">
        <p>A round ends in one of three ways.</p>
        <ul>
          <li>A 7 after the third roll. Nobody still in is paid.</li>
          <li>Everyone still in has banked.</li>
          <li>
            After <strong>{cap} rolls</strong> in one round, if that roll was not a bust, everyone still in
            banks the pot and the round ends. If the {cap}th roll busts, the bust stands and a wiped pot is
            not banked. A round cannot go on forever.
          </li>
        </ul>
        <p>
          The next round starts at 0, with everyone back in. The first three rolls are safe again. The next
          roller is the player after whoever took the last action of the round.
        </p>
      </Section>

      <Section id="end">
        <p>
          After {rounds} rounds, the highest score wins. A tie shares the place: two players tied for first,
          and the next score is third.
        </p>
      </Section>

      <Section id="online">
        <ul>
          <li>
            <strong>Show the dice.</strong> After the roller rolls, each other player takes a turn.{' '}
            {SHOW_DICE} The screen does not show the faces first.
          </li>
          <li>
            The <strong>{cap}-roll cap</strong>, above, is this site's rule so a round of non-sevens cannot
            run without end.
          </li>
          <li>
            <strong>Resigning:</strong> press Resign and confirm. With two players the game is rated and you
            come last. With three or more the game is unrated and you come last. If nobody has rolled yet,
            resigning cancels the game without a result.
          </li>
          <li>
            <strong>Timeouts:</strong> each turn has a deadline ({deadlineList}, chosen with the table). Once
            it has passed, another player can claim it. The player who missed the turn comes last. Before the
            first roll, the game is cancelled instead. There is no one-minute timer and no secret banking.
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** The rules route: the content, scrolled to `section` with focus on its heading. */
export function BankRulesPage(props: { section: string | null }) {
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
  return <BankRulesContent />;
}
