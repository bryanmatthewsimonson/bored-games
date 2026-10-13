/*
 * Every user-facing name of Sticks & Stones (docs/games/sticks-and-stones/RULES.md, "Names"), and its brand pack
 * (D046). The engine never imports this file: it knows spots, goods, symbols and figures only by their ids.
 */
import type { BrandNames } from '@bored-games/game-kit';
import type { CultureSymbol, Figure, Good } from './data.ts';
import type { Spot } from './types.ts';

/** The trademark-safe brand pack, word for word as RULES.md gives it. */
export const STICKS_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Sticks & Stones',
  tagline: 'Gather sticks and stones, feed the clan, and leave a mark that lasts.',
  summary:
    'Lead a clan at the dawn of the world. Each round, send your people out: to hunt, to cut wood, dig clay, ' +
    'break stone and pan amber, to the knapper for tools, to the hearth for a new mouth to feed, to the furrows ' +
    'for a better harvest. Then roll for what they bring home, trade it for discoveries and raise monuments, and ' +
    'feed everyone before winter bites. The richest legacy wins. For two to four players.',
  aliases: ['worker placement', 'workers', 'prehistory', 'tribe', 'clan', 'dice', 'village', 'cave'],
};

export const STICKS_THEME = {
  title: STICKS_BRAND.gameTitle,
  tagline: STICKS_BRAND.tagline,
  spots: {
    hunt: 'Hunting Grounds',
    wood: 'Birch Wood',
    brick: 'Clay Bank',
    stone: 'Rockfall',
    gold: 'Amber Creek',
    tools: 'Knapper’s Rock',
    hut: 'Hearth',
    field: 'Furrows',
    card0: 'Discovery (1 good)',
    card1: 'Discovery (2 goods)',
    card2: 'Discovery (3 goods)',
    card3: 'Discovery (4 goods)',
    stack0: 'First monument site',
    stack1: 'Second monument site',
    stack2: 'Third monument site',
    stack3: 'Fourth monument site',
  } satisfies Record<Spot, string>,
  goods: { wood: 'Wood', brick: 'Clay', stone: 'Stone', gold: 'Amber' } satisfies Record<Good, string>,
  symbols: {
    writing: 'Glyphs',
    medicine: 'Healing Herbs',
    pottery: 'Pottery',
    art: 'Cave Painting',
    music: 'Bone Flute',
    weaving: 'Weaving',
    calendar: 'Star Calendar',
    transport: 'Sledge',
  } satisfies Record<CultureSymbol, string>,
  figures: { farmer: 'Grower', toolmaker: 'Knapper', builder: 'Builder', shaman: 'Elder' } satisfies Record<
    Figure,
    string
  >,
  /** What each figure multiplies. */
  figureCounts: {
    farmer: 'harvest',
    toolmaker: 'tool value',
    builder: 'monuments',
    shaman: 'people',
  } satisfies Record<Figure, string>,
  words: {
    person: 'person',
    people: 'people',
    food: 'Food',
    harvest: 'Harvest',
    tools: 'Tools',
    spare: 'one-use tool',
    discovery: 'discovery',
    discoveries: 'discoveries',
    monument: 'monument',
    monuments: 'monuments',
    gift: 'Gifts of the dice',
    choose: 'two goods of your choice',
    extra: 'a face-down discovery',
    hungry: 'went hungry',
  },
  /** The duplicates rule option's labels (New table form, rules page; RULES.md C27). */
  duplicates: {
    squared: 'A second set, scored like the first (the publisher’s ruling)',
    ones: 'One point for each duplicate (the first printing)',
  },
} as const;
