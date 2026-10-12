/*
 * Every user-facing name of Hazard (docs/games/hazard/RULES.md, "Names"), and its brand pack (D046). The engine
 * never imports this file: it knows provinces, realms and charter kinds only by their ids.
 */
import type { BrandNames } from '@bored-games/game-kit';
import type { ProvinceId, RealmId } from './map.ts';

/** The trademark-safe brand pack, word for word as RULES.md gives it. */
export const HAZARD_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Hazard',
  tagline: 'Six realms. Forty-two provinces. Every roll a hazard.',
  summary:
    'Claim provinces across the six realms of the Meridian, muster troops, and march on your neighbours with dice ' +
    'in hand: three for the attacker, two for the defender, ties to the defender. Hold a whole realm for extra ' +
    'troops, cash in sets of charters for more, and take the charters of every rival you wipe from the map. The ' +
    'last commander standing holds the world. For three to six players.',
  aliases: ['conquest', 'world conquest', 'armies', 'map', 'dice war', 'territory', 'domination'],
};

export const HAZARD_THEME = {
  title: HAZARD_BRAND.gameTitle,
  tagline: HAZARD_BRAND.tagline,
  world: 'the Meridian',
  realms: {
    a: 'Hollowpine',
    b: 'Verdance',
    c: 'the Old Crowns',
    d: 'Sunscorch',
    e: 'the Vast',
    f: 'Farshore',
  } satisfies Record<RealmId, string>,
  provinces: {
    a1: 'Wolfsgate',
    a2: 'Longwinter',
    a3: 'Rimeholm',
    a4: 'Elkridge',
    a5: 'Heartwood',
    a6: 'Fogmere',
    a7: 'Sunder Plains',
    a8: 'Lanternshore',
    a9: "Serpent's Neck",
    b1: 'Orchid Coast',
    b2: 'Greatcanopy',
    b3: 'Condor Heights',
    b4: 'Windtail',
    c1: 'Ashfall Isle',
    c2: 'Fenhallow',
    c3: 'Fjordmark',
    c4: 'Gildmoor',
    c5: "Vintner's Reach",
    c6: 'Marblecoast',
    c7: 'Ryegate Steppe',
    d1: 'Dunesea',
    d2: 'Reedmouth',
    d3: 'Rift Highlands',
    d4: 'Deepgreen',
    d5: 'Cape Ember',
    d6: 'Spice Isle',
    e1: 'Ironspine',
    e2: 'Whitewaste',
    e3: 'Frostfang',
    e4: 'Smoke Cape',
    e5: 'Lakehold',
    e6: 'Horsewind',
    e7: 'Cherrystone Isles',
    e8: 'Highpass',
    e9: 'Jade Basin',
    e10: 'Caravan Gate',
    e11: 'Monsoon Coast',
    e12: 'Tigerfen',
    f1: 'Steppingstones',
    f2: 'Birdwing',
    f3: 'Redsand',
    f4: 'Coralrun',
  } satisfies Record<ProvinceId, string>,
  kinds: { spear: 'Spear', horse: 'Horse', cannon: 'Cannon', crown: 'Crown' },
  words: {
    province: 'province',
    provinces: 'provinces',
    troop: 'troop',
    troops: 'troops',
    realm: 'realm',
    charter: 'charter',
    charters: 'charters',
    muster: 'Muster',
    cash: 'Cash in',
    attack: 'Attack',
    defend: 'Defend',
    advance: 'Move in',
    march: 'March',
    endAttack: 'Stop attacking',
    endTurn: 'End turn',
  },
} as const;
