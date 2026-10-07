import type { BrandNames } from '@bored-games/game-kit';

/** The trademark-safe brand pack (D046, D074): RULES.md "Brand pack (for the build)", word for word. */
export const ROOM_FOR_DOUBT_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Room for Doubt',
  tagline: 'Leave no room for doubt.',
  summary:
    'Six people are trapped in the Aldermoor Assize Courts the night its judge is murdered. Move through nine rooms, make submissions, rebut with the cards you hold, and indict the party, the exhibit and the scene before anyone else, for three to six players.',
  aliases: ['mystery', 'whodunit', 'murder', 'detective', 'deduction', 'courthouse'],
};

/**
 * Every user-facing name of the game (RULES.md "Components" and "The board"). Indexes follow the engine's lists:
 * `parties` by `PARTIES`, `exhibits` by `EXHIBITS`, `scenes` by `SCENES`. A Party's `emblem` and `accent` are the
 * art's ids (the glyph and the palette colour, scripts/room-for-doubt/data.ts); `door` names its Entrance.
 */
export const ROOM_FOR_DOUBT_THEME = {
  title: ROOM_FOR_DOUBT_BRAND.gameTitle,
  tagline: ROOM_FOR_DOUBT_BRAND.tagline,
  parties: [
    {
      name: 'Rosalind Ashdown',
      role: 'Crown prosecutor',
      monogram: 'RA',
      emblem: 'wig',
      accent: 'oxblood',
      door: "Counsel's Door",
    },
    {
      name: 'Hartley Brine',
      role: 'jury foreman, a grocer',
      monogram: 'HB',
      emblem: 'bowler',
      accent: 'umber',
      door: "Jurors' Door",
    },
    {
      name: 'Octavia Reeve',
      role: 'court physician',
      monogram: 'OR',
      emblem: 'pincenez',
      accent: 'ivory',
      door: 'Infirmary Door',
    },
    {
      name: 'Barnaby Crowther',
      role: 'chief bailiff',
      monogram: 'BC',
      emblem: 'whistle',
      accent: 'slate',
      door: 'Staff Door',
    },
    {
      name: 'Lucian Faulk',
      role: 'the defendant',
      monogram: 'LF',
      emblem: 'broadarrow',
      accent: 'ochre',
      door: "Prisoners' Door",
    },
    {
      name: 'Delphine Quarrel',
      role: 'court reporter',
      monogram: 'DQ',
      emblem: 'quill',
      accent: 'teal',
      door: 'Press Door',
    },
  ],
  exhibits: ['Gavel', 'Brass Scales', 'Law Reports', 'Water Carafe', 'Manacles', 'Clock Hand'],
  scenes: [
    'Courtroom',
    "Judge's Chambers",
    'Jury Room',
    'Robing Room',
    'Registry',
    'Evidence Store',
    'Holding Cells',
    'Belfry',
    'Press Gallery',
  ],
  verdict: 'the Verdict',
  passage: 'Old Gaol Passage',
} as const;
