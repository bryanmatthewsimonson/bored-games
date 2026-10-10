import type { DeckSpec } from '@bored-games/game-kit';
export const KINDS = [
  'penny',
  'banknote',
  'endowment',
  'playbill',
  'playhouse',
  'grandstage',
  'scandal',
  'rehearsal',
  'arcade',
  'impresario',
  'rivalry',
  'investor',
  'understudy',
  'renovation',
  'scriptroom',
  'ensemble',
  'propmaker',
  'costumier',
  'headliner',
  'booking',
  'cuttingroom',
  'openingnight',
  'gala',
  'repertoire',
  'encore',
  'duet',
  'readingroom',
  'cashbox',
  'audition',
  'stagedoor',
  'doublebill',
  'busker',
  'critic',
] as const;
export type Kind = (typeof KINDS)[number];
export interface CardSpec {
  cost: number;
  coins: number;
  points: number;
  draw: number;
  actions: number;
  buys: number;
  type: 'treasure' | 'victory' | 'curse' | 'action';
}
const spec = (
  cost: number,
  type: CardSpec['type'],
  coins = 0,
  points = 0,
  draw = 0,
  actions = 0,
  buys = 0,
): CardSpec => ({ cost, type, coins, points, draw, actions, buys });
export const CARDS: Record<Kind, CardSpec> = {
  penny: spec(0, 'treasure', 1),
  banknote: spec(3, 'treasure', 2),
  endowment: spec(6, 'treasure', 3),
  playbill: spec(2, 'victory', 0, 1),
  playhouse: spec(5, 'victory', 0, 3),
  grandstage: spec(8, 'victory', 0, 6),
  scandal: spec(0, 'curse', 0, -1),
  rehearsal: spec(2, 'action', 0, 0, 0, 1),
  arcade: spec(5, 'action', 1, 0, 1, 1, 1),
  impresario: spec(3, 'action', 0, 0, 1, 1),
  rivalry: spec(4, 'action', 2),
  investor: spec(5, 'action'),
  understudy: spec(2, 'action', 0, 0, 2),
  renovation: spec(4, 'action'),
  scriptroom: spec(4, 'action', 0, 0, 3),
  ensemble: spec(3, 'action', 0, 0, 1, 2),
  propmaker: spec(3, 'action'),
  costumier: spec(6, 'action'),
  headliner: spec(5, 'action'),
  booking: spec(4, 'action'),
  cuttingroom: spec(2, 'action'),
  openingnight: spec(5, 'action', 0, 0, 4, 0, 1),
  gala: spec(5, 'action', 2, 0, 0, 2, 1),
  repertoire: spec(4, 'victory'),
  encore: spec(3, 'action', 0, 0, 1, 1),
  duet: spec(5, 'action', 0, 0, 2, 1),
  readingroom: spec(5, 'action'),
  cashbox: spec(4, 'action'),
  audition: spec(4, 'action', 1, 0, 1, 1),
  stagedoor: spec(5, 'action', 0, 0, 1, 1),
  doublebill: spec(4, 'action'),
  busker: spec(3, 'action', 2),
  critic: spec(5, 'action', 0, 0, 2),
};
export const BASE = KINDS.slice(0, 7);
export const KINGDOM = KINDS.slice(7);
export const INTRO = KINGDOM.slice(0, 10);
export const PRESETS: { name: string; cards: Kind[] }[] = [
  { name: 'First Performance', cards: INTRO },
  {
    name: 'Backstage Intrigue',
    cards: [
      'costumier',
      'headliner',
      'booking',
      'cuttingroom',
      'openingnight',
      'gala',
      'repertoire',
      'understudy',
      'ensemble',
      'investor',
    ],
  },
  {
    name: 'The Long Run',
    cards: [
      'encore',
      'duet',
      'readingroom',
      'cashbox',
      'audition',
      'stagedoor',
      'doublebill',
      'busker',
      'critic',
      'understudy',
    ],
  },
];
const sizes = KINDS.map((k, i) => (i < 7 ? [60, 40, 30, 12, 12, 12, 30][i]! : k === 'repertoire' ? 12 : 10));
export const OFFSETS: Record<string, number> = {};
let offset = 40;
const supplyPartitions = KINDS.map((id, i) => {
  OFFSETS[id] = offset;
  const size = sizes[i] as number;
  offset += size;
  return { id, size };
});
export const DECK: DeckSpec = {
  id: 'pile',
  size: offset,
  promptShares: true,
  partitions: [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `starter-${i}`, size: 10 })),
    ...supplyPartitions,
  ],
};
export const STRIDE = 2 ** Math.ceil(Math.log2(DECK.size));
export function kindOf(card: number): Kind {
  if (card < 40) return card % 10 < 7 ? 'penny' : 'playbill';
  return (
    KINDS.find(
      (k, i) => card >= (OFFSETS[k] as number) && card < (OFFSETS[k] as number) + (sizes[i] as number),
    ) ?? 'scandal'
  );
}
export function validCard(card: unknown): card is number {
  return (
    Number.isSafeInteger(card) &&
    !Object.is(card, -0) &&
    (card as number) >= 0 &&
    (card as number) < DECK.size
  );
}
