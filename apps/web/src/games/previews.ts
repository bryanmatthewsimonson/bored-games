/*
 * Screenshots of each game in progress, for its page in the catalog (D086). `pnpm previews` makes the pictures in
 * public/previews/ from real games: the game's engine and its fuzz players, drawn by its own screen as seat 0 sees it.
 * The captions say what each picture shows; rerun the script and check them after a game's screen changes.
 */

export interface GamePreview {
  /** The file in public/previews/. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly caption: string;
}

export const GAME_PREVIEWS: Readonly<Record<string, readonly GamePreview[]>> = {
  'chain-reaction': [
    {
      file: 'chain-reaction-1.jpg',
      width: 1280,
      height: 860,
      caption: 'Early on: three small chains on the board, and your tiles marked merge, found or playable.',
    },
    {
      file: 'chain-reaction-2.jpg',
      width: 1280,
      height: 860,
      caption: 'Mid-game: one chain sprawls across the board while you place a tile.',
    },
    {
      file: 'chain-reaction-3.jpg',
      width: 1280,
      height: 860,
      caption: 'Late in the game: a safe chain of 37 tiles, and your turn to buy shares.',
    },
  ],
  chess: [
    { file: 'chess-1.jpg', width: 1180, height: 814, caption: 'The opening, with White to move.' },
    {
      file: 'chess-2.jpg',
      width: 1180,
      height: 815,
      caption: 'The middlegame, with the move list beside the board.',
    },
    { file: 'chess-3.jpg', width: 1180, height: 815, caption: 'Later on: rooks and queens in open play.' },
  ],
  bank: [
    {
      file: 'bank-1.jpg',
      width: 980,
      height: 860,
      caption: 'Round 3: the pot stands at 33, and the table shows what the next roll can do.',
    },
    { file: 'bank-2.jpg', width: 980, height: 860, caption: 'Round 6: bank 53 now, or stay in for more.' },
    {
      file: 'bank-3.jpg',
      width: 980,
      height: 860,
      caption: 'Round 9: the scores are close, so bank or roll?',
    },
  ],
  luster: [
    {
      file: 'luster-1.jpg',
      width: 1280,
      height: 860,
      caption: 'Take gems from the bank, or reserve or buy a development.',
    },
    {
      file: 'luster-2.jpg',
      width: 1280,
      height: 860,
      caption: 'Over ten tokens: return gems before the turn ends.',
    },
    {
      file: 'luster-3.jpg',
      width: 1280,
      height: 860,
      caption: 'Later on: your developments give discounts, and the nobles wait.',
    },
  ],
  'right-of-way': [
    {
      file: 'right-of-way-1.jpg',
      width: 1280,
      height: 860,
      caption: 'Early routes across Ferrovia, with the freight market below the map.',
    },
    {
      file: 'right-of-way-2.jpg',
      width: 1280,
      height: 860,
      caption: 'Midway: lines spread across the map and the scores climb.',
    },
    {
      file: 'right-of-way-3.jpg',
      width: 1280,
      height: 860,
      caption: 'Near the end: long lines, and the freight pile reshuffled.',
    },
  ],
  driftwrights: [
    {
      file: 'driftwrights-1.jpg',
      width: 960,
      height: 860,
      caption: 'Your turn opens with the dice, on the island map.',
    },
    {
      file: 'driftwrights-2.jpg',
      width: 960,
      height: 860,
      caption: 'Links and havens spread across the islands.',
    },
    {
      file: 'driftwrights-3.jpg',
      width: 960,
      height: 860,
      caption: 'Trading late in the game, with prestige climbing.',
    },
  ],
  holler: [
    { file: 'holler-1.jpg', width: 980, height: 779, caption: 'You drew a card: play it now or keep it.' },
    {
      file: 'holler-2.jpg',
      width: 980,
      height: 727,
      caption: 'Your turn: a Pull on the discard, and your playable cards raised.',
    },
    {
      file: 'holler-3.jpg',
      width: 980,
      height: 779,
      caption: 'Later in the match, with the scores climbing toward 500.',
    },
  ],
  'room-for-doubt': [
    {
      file: 'room-for-doubt-1.jpg',
      width: 1180,
      height: 860,
      caption: 'In the Press Gallery: name a party and an exhibit to submit.',
    },
    { file: 'room-for-doubt-2.jpg', width: 1180, height: 860, caption: 'Your turn: roll the dice to move.' },
    {
      file: 'room-for-doubt-3.jpg',
      width: 1180,
      height: 860,
      caption: 'Moving your pawn: the squares you can reach are highlighted.',
    },
  ],
  'quill-and-quarry': [
    {
      file: 'quill-and-quarry-1.jpg',
      width: 1280,
      height: 860,
      caption: 'Words branch out from the centre of the field.',
    },
    {
      file: 'quill-and-quarry-2.jpg',
      width: 1280,
      height: 860,
      caption: 'The bag runs low as the board fills.',
    },
    {
      file: 'quill-and-quarry-3.jpg',
      width: 1280,
      height: 860,
      caption: 'The last tiles: the bag is empty.',
    },
  ],
  'gilt-and-guile': [
    { file: 'gilt-and-guile-1.jpg', width: 1280, height: 860, caption: 'Buying from the company supply.' },
    { file: 'gilt-and-guile-2.jpg', width: 1280, height: 860, caption: 'Playing actions from your hand.' },
    {
      file: 'gilt-and-guile-3.jpg',
      width: 1280,
      height: 860,
      caption: 'Playing treasures to collect coins.',
    },
  ],
};

/** The URL of a preview picture, relative to the page, so it works from any sub-path (base './'). */
export const previewSrc = (p: GamePreview): string => `previews/${p.file}`;
