import type { Result } from '@bored-games/game-kit';
import type { FirstPlayerOrder } from './tiles.ts';

export type Tier = 'budget' | 'standard' | 'premium';

export interface ChainDef {
  /** Permanent neutral id (appears in network events); display names live in theme.ts. */
  readonly id: string;
  readonly tier: Tier;
}

/**
 * Everything configurable about a Tilestock game. Values marked OPEN in
 * docs/games/tilestock/RULES.md are options here with documented defaults.
 */
export interface TilestockRules {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly handSize: number;
  readonly startingCash: number;
  readonly sharesPerChain: number;
  readonly maxBuyPerTurn: number;
  /** A chain this size or larger is safe: it can never be absorbed. */
  readonly safeSize: number;
  /** A chain this size or larger lets the current player declare the end. */
  readonly endSize: number;
  readonly founderShares: number;
  readonly majorityMultiplier: number;
  readonly minorityMultiplier: number;
  readonly chains: readonly ChainDef[];
  /** Minimum chain size of each price bracket, ascending (first must be 2). */
  readonly priceBrackets: readonly number[];
  /** Share price per bracket for each tier. */
  readonly tierPrices: Readonly<Record<Tier, readonly number[]>>;
  readonly firstPlayerOrder: FirstPlayerOrder;
  /** Each split portion of a tied bonus rounds up to the next multiple of $100. */
  readonly bonusSplitRounding: 'up100';
  /** Dead tiles held during a turn are discarded at its end and replaced, once per turn. */
  readonly deadTiles: 'endOfTurnOncePerTurn';
  /** With no playable tile, skip placement but still buy. */
  readonly noPlayableTile: 'skipPlacement';
  /** The declaring player finishes their turn before final scoring. */
  readonly endDeclaration: 'finishTurn';
  /** House rule: bag empty and a full round without a placed tile ends the game. */
  readonly stallRule: 'emptyBagFullRound' | 'off';
}

export const DEFAULT_RULES: TilestockRules = {
  minPlayers: 3,
  maxPlayers: 6,
  handSize: 6,
  startingCash: 6000,
  sharesPerChain: 25,
  maxBuyPerTurn: 3,
  safeSize: 11,
  endSize: 41,
  founderShares: 1,
  majorityMultiplier: 10,
  minorityMultiplier: 5,
  chains: [
    { id: 'b1', tier: 'budget' },
    { id: 'b2', tier: 'budget' },
    { id: 's1', tier: 'standard' },
    { id: 's2', tier: 'standard' },
    { id: 's3', tier: 'standard' },
    { id: 'p1', tier: 'premium' },
    { id: 'p2', tier: 'premium' },
  ],
  priceBrackets: [2, 3, 4, 5, 6, 11, 21, 31, 41],
  tierPrices: {
    budget: [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    standard: [300, 400, 500, 600, 700, 800, 900, 1000, 1100],
    premium: [400, 500, 600, 700, 800, 900, 1000, 1100, 1200],
  },
  firstPlayerOrder: 'rowThenColumn',
  bonusSplitRounding: 'up100',
  deadTiles: 'endOfTurnOncePerTurn',
  noPlayableTile: 'skipPlacement',
  endDeclaration: 'finishTurn',
  stallRule: 'emptyBagFullRound',
};

const fail = (message: string): Result<TilestockRules> => ({ ok: false, error: { code: 'rules', message } });

const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

const KEYS: readonly (keyof TilestockRules)[] = Object.keys(DEFAULT_RULES) as (keyof TilestockRules)[];

export function validateRules(input: unknown): Result<TilestockRules> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return fail('rules must be an object');
  const r = input as Record<string, unknown>;
  for (const key of Object.keys(r))
    if (!KEYS.includes(key as keyof TilestockRules)) return fail(`unknown key ${key}`);
  for (const key of KEYS) if (!(key in r)) return fail(`missing key ${key}`);
  const rules = r as unknown as TilestockRules;
  // 2-player play is OPEN (some editions add special rules); not supported yet.
  if (!isInt(rules.minPlayers, 3, 6) || !isInt(rules.maxPlayers, rules.minPlayers, 6)) {
    return fail('players must be within 3..6');
  }
  if (!isInt(rules.handSize, 1, 12)) return fail('handSize');
  if (!isInt(rules.startingCash, 0) || rules.startingCash % 100 !== 0) return fail('startingCash');
  if (!isInt(rules.sharesPerChain, 1, 1000)) return fail('sharesPerChain');
  if (!isInt(rules.maxBuyPerTurn, 0, 10)) return fail('maxBuyPerTurn');
  if (!isInt(rules.safeSize, 2, 108) || !isInt(rules.endSize, 2, 108)) return fail('safeSize/endSize');
  if (!isInt(rules.founderShares, 0, 5)) return fail('founderShares');
  if (!isInt(rules.majorityMultiplier, 0, 100) || !isInt(rules.minorityMultiplier, 0, 100)) {
    return fail('bonus multipliers');
  }
  if (!Array.isArray(rules.chains) || rules.chains.length < 1 || rules.chains.length > 26)
    return fail('chains');
  const seen = new Set<string>();
  for (const c of rules.chains) {
    if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9]{0,7}$/.test(c.id) || seen.has(c.id)) {
      return fail('chain ids must be unique lowercase ids');
    }
    if (c.tier !== 'budget' && c.tier !== 'standard' && c.tier !== 'premium') return fail(`tier of ${c.id}`);
    seen.add(c.id);
  }
  const b = rules.priceBrackets;
  if (!Array.isArray(b) || b.length < 1 || b[0] !== 2) return fail('priceBrackets must start at 2');
  for (let i = 1; i < b.length; i++) {
    if (!isInt(b[i], 3) || (b[i] as number) <= (b[i - 1] as number)) return fail('priceBrackets ascending');
  }
  for (const tier of ['budget', 'standard', 'premium'] as const) {
    const p = rules.tierPrices?.[tier];
    if (!Array.isArray(p) || p.length !== b.length || !p.every((v) => isInt(v, 0) && v % 100 === 0)) {
      return fail(`tierPrices.${tier}`);
    }
  }
  if (rules.firstPlayerOrder !== 'rowThenColumn' && rules.firstPlayerOrder !== 'columnThenRow') {
    return fail('firstPlayerOrder');
  }
  if (rules.bonusSplitRounding !== 'up100') return fail('bonusSplitRounding');
  if (rules.deadTiles !== 'endOfTurnOncePerTurn') return fail('deadTiles');
  if (rules.noPlayableTile !== 'skipPlacement') return fail('noPlayableTile');
  if (rules.endDeclaration !== 'finishTurn') return fail('endDeclaration');
  if (rules.stallRule !== 'emptyBagFullRound' && rules.stallRule !== 'off') return fail('stallRule');
  return { ok: true, value: rules };
}

export function chainIndex(rules: TilestockRules, id: unknown): number | null {
  if (typeof id !== 'string') return null;
  const i = rules.chains.findIndex((c) => c.id === id);
  return i < 0 ? null : i;
}

export function chainId(rules: TilestockRules, index: number): string {
  return rules.chains[index]?.id ?? '?';
}
