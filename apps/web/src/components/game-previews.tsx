/*
 * "See it in play" on a game's page (D086): screenshots of a game in progress, each opening full size.
 * Hook-free, so it is render-tested.
 */
import { GAME_PREVIEWS, previewSrc } from '../games/previews.ts';

export function GamePreviews(props: { game: string; title: string }) {
  const previews = GAME_PREVIEWS[props.game] ?? [];
  if (previews.length === 0) return null;
  return (
    <section class="panel" aria-labelledby="gp-previews-h">
      <h2 id="gp-previews-h">See it in play</h2>
      <p class="hint">Screens from {props.title} games in progress, as one player sees them on their turn.</p>
      <ul class="game-previews">
        {previews.map((p) => (
          <li key={p.file}>
            <figure>
              <a href={previewSrc(p)} target="_blank" rel="noopener">
                <img
                  src={previewSrc(p)}
                  width={p.width}
                  height={p.height}
                  loading="lazy"
                  decoding="async"
                  alt={`${props.title} in progress: ${p.caption}`}
                />
                <span class="sr-only"> (opens full size in a new tab)</span>
              </a>
              <figcaption>{p.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
