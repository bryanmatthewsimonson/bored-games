/*
 * Every user-facing name of Fever Pitch (docs/games/fever-pitch/RULES.md, "Names"), and its brand pack (D046).
 * The engine never imports this file: it knows cities, strains, roles and relief cards only by their indices.
 */
import type { BrandNames } from '@bored-games/game-kit';
import type { Relief, Role } from './data.ts';

/** The trademark-safe brand pack, word for word as RULES.md gives it. */
export const FEVER_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Fever Pitch',
  tagline: 'Four strains, one team, never enough hands. Find the cures before the world runs out of time.',
  summary:
    'Four strains are loose across the Wide World, and your team of specialists is all that stands in the way. ' +
    'Each turn you travel, treat the sick, open clinics and pool your cards, then watch the spread deck turn up ' +
    'new cases. Let a city pass three cases and it spills over into its neighbours, sometimes in chains. Every ' +
    'few turns a surge strikes and stirs the spent cards back on top. Find all four cures and the team wins ' +
    'together; let the spillovers, the case tokens or the field deck run out and the team loses together. A ' +
    'cooperative game for two to four players.',
  aliases: ['cooperative', 'co-op', 'outbreak', 'contagion', 'cure', 'disease', 'medicine', 'teamwork'],
};

export const FEVER_THEME = {
  title: FEVER_BRAND.gameTitle,
  tagline: FEVER_BRAND.tagline,
  world: 'the Wide World',
  /** The strains, by index, each native to the region of the same index. */
  strains: ['Tide', 'Ember', 'Dusk', 'Moss'] as readonly string[],
  regions: ['the Tidelands', 'the Sunward Reach', 'the Dusk Coast', 'the Mosslands'] as readonly string[],
  /** City names by city index (map.ts), twelve to a region in region order. */
  cities: [
    'Gullhaven',
    'Brackenford',
    'Frostmarch',
    'Harrowmere',
    'Glenhallow',
    'Ashcombe Cross',
    'Wexmoor',
    'Calderra',
    'Lanterne',
    'Ostrelund',
    'Mirebell',
    'Snowgrave',
    'Sunreach',
    'Tolvara',
    'Coralport',
    'Altamesa',
    'Quencalla',
    'Farstrand',
    'Riomar',
    'Verdanha',
    'Marisko',
    'Ubarra',
    'Goldkrans',
    'Sandhaven',
    'Corsabel',
    'Nilmara',
    'Twinbridge',
    'Ironvale',
    'Tigrel',
    'Dunecrest',
    'Zagreth',
    'Saffron Bay',
    'Rajmal',
    'Seven Isles',
    'Coromel',
    'Bengaro',
    'Jadehall',
    'Hanseo',
    'Eastmere',
    'Pearlmouth',
    'Harbor Nine',
    'Tallowcay',
    'Mizuhara',
    'Lotus Market',
    'Mekora',
    'Archipel',
    'Javarra',
    'Southwatch',
  ] as readonly string[],
  roles: {
    archivist: 'Archivist',
    coordinator: 'Coordinator',
    paramedic: 'Paramedic',
    engineer: 'Engineer',
    warden: 'Warden',
    courier: 'Courier',
    virologist: 'Virologist',
  } satisfies Record<Role, string>,
  /** What each role does, in one line (RULES.md C25–C31). */
  roleText: {
    archivist:
      'As an action, take a relief card back from the discard pile and keep it on your role card (one at a time; it is not in your hand). Played from there, it leaves the game.',
    coordinator:
      "Move other players' pawns as if they were your own, paying with your cards; or, as an action, move any pawn to a city where another pawn stands.",
    paramedic:
      'Treating removes every case of the strain. Wherever you stand, cases of a cured strain are cleared at once and cannot be placed.',
    engineer:
      'Open a clinic where you stand without a card. Once a turn, from a clinic, fly anywhere by discarding any city card.',
    warden: 'No case can be placed, and no spillover happens, in your city or any city linked to it.',
    courier:
      'When you hand over a card, it may be any city card. A player sharing with you on their turn may take any of your city cards.',
    virologist: 'You need only four city cards of one strain to find its cure.',
  } satisfies Record<Role, string>,
  reliefs: {
    medevac: 'Medevac',
    warning: 'Early Warning',
    permit: 'Field Permit',
    lull: 'Lull',
    immunity: 'Herd Immunity',
  } satisfies Record<Relief, string>,
  reliefText: {
    medevac: 'Move any pawn to any city.',
    warning: 'Look at the top six spread cards and put them back in any order.',
    permit: 'Open a clinic in any city, no card needed.',
    lull: 'Skip the next spread step.',
    immunity:
      'Take one spent spread card out of the game. May be played between the strike and the restack of a surge.',
  } satisfies Record<Relief, string>,
  surgeLevels: { 4: 'Gentle', 5: 'Standard', 6: 'Brutal' } as Readonly<Record<4 | 5 | 6, string>>,
  words: {
    case: 'case',
    cases: 'cases',
    clinic: 'clinic',
    clinics: 'clinics',
    spillover: 'spillover',
    spillovers: 'spillovers',
    surge: 'Surge',
    spreadDeck: 'spread deck',
    fieldDeck: 'field deck',
    spent: 'spent pile',
    rate: 'spread rate',
    cure: 'cure',
    stamped: 'stamped out',
  },
} as const;
