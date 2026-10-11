/** The timber island from the original six-island board atlas, framed for a square thumbnail. */
const ATLAS = new URL('./island-atlas.png', import.meta.url).href;

export function DriftwrightsArt() {
  return (
    <svg class="drift-cover-art" width="100%" height="100%" viewBox="0 0 506 506" aria-hidden="true">
      <image href={ATLAS} width="1536" height="1024" />
    </svg>
  );
}
