/*
 * Room for Doubt's cover and thumbnail: the CC0 art in `docs/games/room-for-doubt/art/` (D074), rendered by
 * `scripts/room-for-doubt/cli.ts`. The thumbnail is the cover's scene cropped square, without the lettering.
 */
const COVER = new URL('../../../../../docs/games/room-for-doubt/art/cover.svg', import.meta.url).href;
const THUMB = new URL('../../../../../docs/games/room-for-doubt/art/thumb.svg', import.meta.url).href;

export function RoomForDoubtCover(props: { thumb?: boolean }) {
  return (
    <img
      class="game-cover"
      src={props.thumb ? THUMB : COVER}
      alt="Room for Doubt artwork: the assize courts at night, in the rain"
    />
  );
}
