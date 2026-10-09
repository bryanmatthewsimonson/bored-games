import { INVENTORY } from '@bored-games/quill-and-quarry';
import { QUILL_THEME } from '@bored-games/quill-and-quarry/theme';
import { useEffect } from 'preact/hooks';
import { QuarryArt } from './art.tsx';
import '../chain-reaction/rules.css';
import './quill.css';
export function QuillRulesContent() {
  return (
    <article class="rules-page">
      <header class="rules-head">
        <h1>How to play {QUILL_THEME.title}</h1>
        <p class="lede">Seven letters. A field of possibilities.</p>
      </header>
      <figure class="qq-rules-art">
        <QuarryArt />
      </figure>
      <nav class="rules-toc" aria-label="Rules sections">
        <a href="#/rules/quill-and-quarry/start">Getting started</a> ·{' '}
        <a href="#/rules/quill-and-quarry/play">Making a word</a> ·{' '}
        <a href="#/rules/quill-and-quarry/score">Scoring</a> ·{' '}
        <a href="#/rules/quill-and-quarry/challenge">Challenges</a> ·{' '}
        <a href="#/rules/quill-and-quarry/end">The final tally</a>
      </nav>
      <section class="rules-section">
        <h2 id="rules-start" tabIndex={-1}>
          A table, a bag, a beginning
        </h2>
        <p>
          Two to four players build words on a 15 × 15 field. The bag holds 100 tiles, including two blanks.
          Aim for the highest score when the last word has been played.
        </p>
        <p>
          Before starting, agree on an English dictionary and edition. Proper names, abbreviations, words
          requiring a hyphen or apostrophe, and standalone prefixes and suffixes are excluded. Other
          dictionary entries, including inflections and archaic words, are allowed. This app uses
          table-checked vocabulary and the double-challenge rule below.
        </p>
        <p>
          Each player draws a tile. The letter nearest the beginning of the alphabet goes first; a blank comes
          before A. Tied players draw again. All starting tiles return to the bag, which is mixed again.
          Everyone receives seven private tiles. Turns follow the table’s seat order.
        </p>
      </section>
      <section class="rules-section">
        <h2 id="rules-play" tabIndex={-1}>
          Make your mark
        </h2>
        <p>
          On your turn, place one or more tiles in a single row or column. Read words from left to right or
          from top to bottom. The first word needs at least two tiles and must cover the center star.
        </p>
        <p>
          Every later play must connect to the existing words. You may extend a word, cross it, or place
          alongside it. There can be no empty space inside your new word, though letters already on the board
          may fill the gaps. Every new horizontal or vertical run of two or more letters must be a valid word.
          Existing tiles stay where they are.
        </p>
        <p>
          Choose a rack tile and then a square, or drag the tile into place. Click a staged tile to return it.
          The board supports arrow-key navigation. Recall clears your draft. Play word submits it for the
          table’s review; afterward, draw back up to seven tiles while the bag lasts.
        </p>
        <p>
          A blank can be any letter. Choose its letter before placing it. Once the play stands, that letter is
          fixed for the rest of the game. The blank always scores zero.
        </p>
        <h3>Or take another route</h3>
        <p>
          <strong>Exchange:</strong> if at least seven tiles remain in the bag, set aside any number of your
          tiles, draw the same number, then return the old ones and mix the bag. You cannot draw back your own
          returned tiles in that exchange. Exchanging uses your turn and scores zero.
        </p>
        <p>
          <strong>Pass:</strong> keep your rack and score zero this turn, even if you could have played.
        </p>
      </section>
      <section class="rules-section">
        <h2 id="rules-score" tabIndex={-1}>
          Every letter counts
        </h2>
        <p>
          Add the face values in each word you form. A tile played on a 2L or 3L square has twice or three
          times its letter value. A 2W or 3W square multiplies the entire word by two or three. Apply letter
          bonuses before word bonuses; multiple word bonuses multiply together. The center star is a 2W
          square.
        </p>
        <p>
          Premiums count only on the turn a tile first covers them. An old tile contributes its ordinary value
          on later turns. When your new tile belongs to two words, count it and its fresh premium in both. A
          blank on a word premium still multiplies the word, even though the blank itself contributes zero.
        </p>
        <p>
          Using all seven rack tiles in one play earns an extra <strong>50 points</strong>, added after all
          word scores. Using every tile from a shorter rack does not earn the bonus.
        </p>
        <div class="qq-rules-values">
          {INVENTORY.map(([letter, count, value]) => (
            <div key={letter}>
              <strong>{letter || '◇'}</strong>
              <span>
                {value} point{value === 1 ? '' : 's'}
                <br />
                {count} in the bag
              </span>
            </div>
          ))}
        </div>
      </section>
      <section class="rules-section">
        <h2 id="rules-challenge" tabIndex={-1}>
          A word in question
        </h2>
        <p>
          Before the player refills their rack, every opponent may accept or challenge the newly formed words.
          The app asks in seat order. Choose carefully: an unsuccessful challenge costs your next turn.
        </p>
        <p>
          For a challenge, consult the dictionary your table agreed on. The challenger records whether every
          new word is valid. If any is invalid, remove all tiles from that play, return them to the player,
          and cancel the score. That player’s turn is used. If every word is valid, the play stands and the
          challenger loses their next turn. There is no extra point penalty.
        </p>
        <p>
          The app verifies placement, tile ownership and arithmetic.{' '}
          <strong>It does not contain a word list or independently verify a dictionary ruling.</strong> Play
          with people you trust to report the lookup accurately. Accepting a word lets it stand, even if a
          later lookup finds it invalid.
        </p>
      </section>
      <section class="rules-section">
        <h2 id="rules-end" tabIndex={-1}>
          The final tally
        </h2>
        <p>
          The game ends after an accepted play empties a rack while the bag is empty. It also ends after six
          consecutive scoreless turns, including passes, exchanges, successful challenges against a play, and
          turns lost to an unsuccessful challenge. A positive-scoring accepted play resets that count. After
          the sixth scoreless turn, choose Finalize scores.
        </p>
        <p>
          Reveal every remaining rack and subtract its face-value total from its owner’s score. If someone
          went out, that player also receives the sum deducted from all the other racks. A blank deducts zero.
          Highest final score wins; equal scores share the place.
        </p>
      </section>
      <section class="rules-section">
        <h2 id="rules-online" tabIndex={-1}>
          At this online table
        </h2>
        <p>
          Your rack stays private. The players’ apps mix the bag together, prove tile ownership when a word is
          played, and reveal the remaining racks for scoring. Exchanges trigger another encrypted mix. Keep
          the game open while other players need your app’s tile shares. A missed deadline can end the game
          through the platform’s timeout controls.
        </p>
        <p>
          Resigning early is disabled because revealing a deck key could expose tiles returned to the bag. The
          final audit checks tile ownership and mechanical rules; it cannot audit the table’s external
          dictionary decisions.
        </p>
      </section>
    </article>
  );
}
export function QuillRulesPage(props: { section: string | null }) {
  useEffect(() => {
    if (props.section === null) {
      window.scrollTo(0, 0);
      return;
    }
    const heading = document.getElementById(`rules-${props.section}`);
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, [props.section]);
  return <QuillRulesContent />;
}
