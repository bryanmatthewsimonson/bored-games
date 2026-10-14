/*
 * Every user-facing name of Current Affairs (docs/games/current-affairs/RULES.md, "Names"), and its brand pack (D046).
 * The engine never imports this file: it knows cities, regions, fuels and stations only by their ids and numbers.
 */
import type { BrandNames } from '@bored-games/game-kit';
import type { Fuel, Kind } from './data.ts';
import type { Region } from './map.ts';

/** The trademark-safe brand pack, word for word as RULES.md gives it. */
export const CURRENT_BRAND: BrandNames = {
  id: 'safe',
  gameTitle: 'Current Affairs',
  tagline: 'Bid for power stations, buy the fuel, wire the cities. Keep the lights on.',
  summary:
    'Run a young utility across the six regions of the Commonwealth. Each round, bid against your rivals for power ' +
    'stations, buy coal, oil, waste and uranium in a market where every unit bought raises the price, and wire ' +
    'cities into your network. Then fire your stations and get paid for every city you light. The leaders pay ' +
    'more and choose last; the stragglers get the bargains. When the network race ends, the company that can ' +
    'power the most cities wins. For two to six players.',
  aliases: ['economic', 'auction', 'network', 'electricity', 'power plants', 'utilities', 'energy', 'market'],
};

export const CURRENT_THEME = {
  title: CURRENT_BRAND.gameTitle,
  tagline: CURRENT_BRAND.tagline,
  land: 'the Commonwealth',
  regions: {
    frost: 'Frostmere',
    copper: 'Highcopper',
    amber: 'Ambergate',
    salt: 'Saltmarsh',
    heart: 'Heartfield',
    ember: 'Emberreach',
  } satisfies Record<Region, string>,
  /** City names by city index (map.ts), seven to a region in region order. */
  cities: [
    'Icebridge',
    'Glassmere',
    'Hoarfell',
    'Sleetford',
    'Pinehollow',
    'Wintervale',
    'Hoarstead',
    'Coppergate',
    'Anvilridge',
    'Slagby',
    'Bellhammer',
    'Oreford',
    'Kilnby',
    'Crucible',
    'Honeywell',
    'Resinport',
    'Goldmoor',
    'Lanternhill',
    'Waxford',
    'Brightwater',
    'Sapling Cross',
    'Brinehaven',
    'Gullcove',
    'Tidewick',
    'Rushmouth',
    'Kelpford',
    'Saltpan',
    'Marrowsands',
    'Millbrook',
    'Harrowby',
    'Sheafton',
    'Barleycross',
    'Plowmere',
    'Haymeadow',
    'Furrowfield',
    'Cinderfall',
    'Ashenford',
    'Kilnmouth',
    'Scorchmere',
    'Embermoor',
    'Slatepoint',
    'Flintwick',
  ] as readonly string[],
  fuels: { coal: 'Coal', oil: 'Oil', waste: 'Waste', uranium: 'Uranium' } satisfies Record<Fuel, string>,
  kinds: {
    coal: 'Coal',
    oil: 'Oil',
    hybrid: 'Coal or oil',
    waste: 'Waste',
    uranium: 'Uranium',
    green: 'Green',
  } satisfies Record<Kind, string>,
  phases: {
    order: 'Standings',
    auction: 'Auction',
    fuel: 'Fuel',
    build: 'Wiring',
    power: 'Payday',
  },
  words: {
    company: 'company',
    companies: 'companies',
    station: 'power station',
    stations: 'power stations',
    substation: 'substation',
    substations: 'substations',
    market: 'station market',
    onOffer: 'on offer',
    comingUp: 'coming up',
    yard: 'fuel yard',
    era: 'Era',
    eraCard: 'the Era III card',
    money: '$',
  },
} as const;
