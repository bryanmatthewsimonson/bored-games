/*
 * Room for Doubt's ids and the layout of its deck (docs/games/room-for-doubt/RULES.md, "Components", "Glossary" and
 * "Online play"). Engine ids are plain words, permanent once they appear in network events; display names belong to
 * the brand pack.
 */

/** The six Parties in turn order, which is also the clockwise order of their Entrances. */
export const PARTIES = ['ashdown', 'brine', 'reeve', 'crowther', 'faulk', 'quarrel'] as const;
export const EXHIBITS = ['gavel', 'scales', 'reports', 'carafe', 'manacles', 'clockhand'] as const;
/** The nine Scenes, which are also the nine rooms of the board. */
export const SCENES = [
  'courtroom',
  'chambers',
  'jury',
  'robing',
  'registry',
  'store',
  'cells',
  'belfry',
  'gallery',
] as const;

export type PartyId = (typeof PARTIES)[number];
export type ExhibitId = (typeof EXHIBITS)[number];
export type SceneId = (typeof SCENES)[number];

/**
 * The case deck holds 30 cards, numbered in four groups, each in list order: Parties 0-5, Exhibits 6-11, Scenes
 * 12-20 and the nine room cards 21-29. Room card `21 + r` names `SCENES[r]`: it is no Scene card but a marker for
 * a room where an Exhibit may start.
 */
export const DECK_ID = 'case';
export const DECK_SIZE = 30;

const FIRST_EXHIBIT = 6;
const FIRST_SCENE = 12;
const FIRST_ROOM = 21;

/** The id each card number carries, a room card the Scene it names. */
const CARD_NAMES: readonly (PartyId | ExhibitId | SceneId)[] = [
  ...PARTIES,
  ...EXHIBITS,
  ...SCENES,
  ...SCENES,
];

export type CardKind = 'party' | 'exhibit' | 'scene' | 'room';

/** The Party, Exhibit or Scene that card `n` is, or that room card `n` names. Throws `RangeError` when `n` is no card. */
export function cardName(n: number): PartyId | ExhibitId | SceneId {
  const name = Number.isInteger(n) ? CARD_NAMES[n] : undefined;
  if (name === undefined) throw new RangeError(`${n} is not a card of the case deck`);
  return name;
}

/** Which of the four groups card `n` belongs to. Throws `RangeError` when `n` is no card. */
export function kindOf(n: number): CardKind {
  if (!Number.isInteger(n) || n < 0 || n >= DECK_SIZE)
    throw new RangeError(`${n} is not a card of the case deck`);
  if (n < FIRST_EXHIBIT) return 'party';
  if (n < FIRST_SCENE) return 'exhibit';
  if (n < FIRST_ROOM) return 'scene';
  return 'room';
}

/** The Verdict: the first card of the Party, Exhibit and Scene groups. It is dealt to no seat until an indictment. */
export const VERDICT_POSITIONS: readonly number[] = [0, 6, 12];

/** The 18 other case cards, which the deal hands out in this order, starting with the first seat (P2). */
export const HAND_POSITIONS: readonly number[] = [
  1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20,
];

/** The room cards revealed at setup: Exhibit `e` starts in the room that position `21 + e` names (P3). */
export const ROOM_POSITIONS: readonly number[] = [21, 22, 23, 24, 25, 26];

/**
 * The Party each seat plays, as indices into `PARTIES`, in seat order (P1). The Parties are spread round the
 * building, so the Prosecutor (Party 0) is always played and goes first.
 */
export const SEAT_PARTIES: Readonly<Record<3 | 4 | 5 | 6, readonly number[]>> = {
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};
