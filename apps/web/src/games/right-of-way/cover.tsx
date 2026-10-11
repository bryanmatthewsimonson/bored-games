/*
 * Right of Way's cover and thumbnail: the CC0 art in `docs/games/right-of-way/art/` (D066). The thumbnail is the
 * cover cropped square round the train, without the title plaque or the box facts.
 */
const COVER = new URL('../../../../../docs/games/right-of-way/art/cover.svg', import.meta.url).href;
const THUMB = new URL('../../../../../docs/games/right-of-way/art/thumb.svg', import.meta.url).href;

export function RightOfWayCover(props: { thumb?: boolean }) {
  return (
    <img
      class="game-cover"
      src={props.thumb ? THUMB : COVER}
      alt="Right of Way artwork: a freight train crossing a viaduct at dawn"
    />
  );
}
