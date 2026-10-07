import type { BrandNames } from '@bored-games/game-kit';

/** The trademark-safe brand pack (D046, D066): every user-facing name of the game. */
export const RIGHT_OF_WAY_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Right of Way',
  tagline: 'Lay claim. Lay track. Connect.',
  summary:
    'Collect freight cards and spend matching sets to lay track between the towns of Ferrovia. Score for every route, complete your secret railway charters and race for the longest unbroken line, for two to five players.',
  aliases: ['trains', 'railway', 'routes', 'tickets', 'map', 'charters'],
};

export const RIGHT_OF_WAY_THEME = {
  title: RIGHT_OF_WAY_BRAND.gameTitle,
  tagline: RIGHT_OF_WAY_BRAND.tagline,
  land: 'Ferrovia',
  /** Freight colours 0–7, then the Engine (index 8). */
  cargo: ['Brick', 'Copper', 'Grain', 'Timber', 'Ice', 'Plum', 'Wool', 'Coal', 'Engine'],
  colorWords: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white', 'black', 'wild'],
  unmarked: 'Unmarked',
  /** Town display names, in the order of map.ts TOWNS. */
  towns: [
    'Ashgrove',
    'Bellwether',
    'Brindlefield',
    'Cinderpass',
    'Clockhaven',
    'Copperhollow',
    'Duskwater',
    'Emberdune',
    'Fernvale',
    'Frostwick',
    'Glimmerford',
    'Granitefold',
    'Gullhaven',
    'Harrowcross',
    'Highspire',
    'Hollowmere',
    'Ironmoor',
    'Kelpmouth',
    'Kettleburn',
    'Lanternport',
    'Larchholm',
    'Marrowmarsh',
    'Millstone',
    'Mosswick',
    'Northwatch',
    'Owlgate',
    'Ravensgate',
    'Saltmere',
    'Starling Cove',
    'Sunreach',
    'Thistledown',
    'Tidewell',
    'Velvetdale',
    'Whistlestop',
    'Wrenford',
    'Yarrowfen',
  ],
  /** The five player colours, by seat. */
  players: ['Kestrel', 'Heron', 'Finch', 'Magpie', 'Parrot'],
  ribbon: 'the Iron Ribbon',
  charter: 'charter',
  track: 'track',
} as const;
