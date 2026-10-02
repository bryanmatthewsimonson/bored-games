/*
 * The Credits route (#/credits), linked from the footer: third-party art the app ships, with each copyright
 * notice and license text (D048). Uses no hooks, so tests can expand it without a DOM.
 */
import { BRAND } from '@bored-games/brand';
import { PieceImage } from '../games/chess/game.tsx';
import { CBURNETT_CREDIT } from '../games/chess/pieces/credit.ts';
import { homeHref } from '../router.ts';

export function CreditsScreen() {
  const c = CBURNETT_CREDIT;
  return (
    <article class="credits-page">
      <section class="panel" aria-labelledby="credits-h">
        <h1 id="credits-h">Credits</h1>
        <p>
          {BRAND.name} is built on open standards and open work by others. This page lists the third-party art
          the site uses, with its copyright notice and license.
        </p>
      </section>
      <section class="panel credits-item" aria-labelledby="credits-pieces-h">
        <h2 id="credits-pieces-h">{c.title}</h2>
        <p class="credits-sample" aria-hidden="true">
          {(['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'] as const).map((p) => (
            <PieceImage key={p} piece={p} class="credits-piece" />
          ))}
        </p>
        <p>
          {c.work} by <strong>{c.author}</strong>. {c.note}{' '}
          <a href={c.source} target="_blank" rel="noopener noreferrer">
            Source on Wikimedia Commons<span class="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
        <h3>{c.license}</h3>
        <div class="credits-license">
          <p>{c.copyright}</p>
          {c.text.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
      </section>
      <p>
        <a href={homeHref()}>Back to the start</a>
      </p>
    </article>
  );
}
