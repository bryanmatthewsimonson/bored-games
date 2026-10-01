import type { DeckSpec, FuzzPolicy, Rng } from '@bored-games/game-kit';
import {
  classifyTile,
  NEIGHBORS,
  TILE_COUNT,
  type TilestockAction,
  type TilestockState,
  tileColumn,
  tileIndex,
  tileRow,
} from '@bored-games/tilestock';

/**
 * Fuzzing policies for Tilestock. These are test drivers that bias random
 * play toward rare rule paths (multi-way mergers, safe chains, dead and
 * blocked tiles, supply limits, the bag running out). They are never players.
 */

type Weigh = (state: TilestockState, action: TilestockAction) => number;

interface Style {
  readonly name: string;
  /** Probability of declaring the end when allowed. */
  readonly declare: number;
  readonly place?: Weigh;
  readonly dispose?: Weigh;
  readonly buy?: Weigh;
}

function weighted<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T {
  const ws = items.map((i) => Math.max(0, weight(i)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return rng.pick(items);
  let x = rng.float() * total;
  for (let i = 0; i < items.length; i++) {
    x -= ws[i] as number;
    if (x < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

function placeKind(state: TilestockState, action: TilestockAction): string {
  if (action.type !== 'place') return action.type;
  return classifyTile(state.board, state.rules, tileIndex(action.tile) as number).kind;
}

function mergeWidth(state: TilestockState, action: TilestockAction): number {
  if (action.type !== 'place') return 0;
  const cls = classifyTile(state.board, state.rules, tileIndex(action.tile) as number);
  return cls.kind === 'merge' ? cls.chains.length : 0;
}

function makePolicy(style: Style): FuzzPolicy<TilestockState> {
  return {
    name: style.name,
    choose(state, _seat, legal, rng) {
      const actions = legal as TilestockAction[];
      const first = actions[0];
      if (!first) throw new Error('no legal actions');
      if (first.type === 'place' && style.place)
        return weighted(actions, (a) => style.place?.(state, a) ?? 1, rng);
      if (first.type === 'dispose' && style.dispose)
        return weighted(actions, (a) => style.dispose?.(state, a) ?? 1, rng);
      if (first.type === 'endTurn') {
        // With the bag empty no new tile can ever arrive, so a real player ends the
        // game rather than declining an available end forever (the game would never end).
        const bagEmpty = state.deck.next >= TILE_COUNT;
        const wantDeclare = bagEmpty || rng.float() < style.declare;
        const pool = actions.filter((a) => a.type === 'endTurn' && a.declareEnd === wantDeclare);
        const options = pool.length > 0 ? pool : actions;
        return style.buy ? weighted(options, (a) => style.buy?.(state, a) ?? 1, rng) : rng.pick(options);
      }
      return rng.pick(actions);
    },
  };
}

const buyCount = (a: TilestockAction): number => (a.type === 'endTurn' ? a.buy.length : 0);

export const TILESTOCK_POLICIES: readonly FuzzPolicy<TilestockState>[] = [
  makePolicy({ name: 'uniform', declare: 0.5 }),
  makePolicy({
    name: 'mergerSeeker',
    declare: 0.05,
    place: (s, a) => 1 + 20 * mergeWidth(s, a) ** 2 + (placeKind(s, a) === 'found' ? 5 : 0),
    dispose: (_s, a) => (a.type === 'dispose' ? 1 + a.trade : 1),
  }),
  makePolicy({
    name: 'isolator',
    declare: 0,
    place: (s, a) => (placeKind(s, a) === 'lone' ? 30 : 1),
    buy: (_s, a) => (buyCount(a) === 0 ? 10 : 1),
  }),
  makePolicy({
    name: 'hoarder',
    declare: 0.02,
    dispose: (_s, a) => (a.type === 'dispose' && a.sell === 0 && a.trade === 0 ? 50 : 1),
    buy: (_s, a) => (a.type === 'endTurn' && a.buy.length === 3 && new Set(a.buy).size === 1 ? 30 : 1),
  }),
  makePolicy({
    name: 'trader',
    declare: 0.05,
    dispose: (_s, a) => (a.type === 'dispose' ? 1 + 5 * a.trade : 1),
    buy: (_s, a) => 1 + 3 * buyCount(a),
  }),
  makePolicy({
    name: 'seller',
    declare: 0.05,
    dispose: (_s, a) => (a.type === 'dispose' ? 1 + 5 * a.sell : 1),
  }),
  makePolicy({ name: 'bigBuyer', declare: 0.1, buy: (_s, a) => 1 + 10 * buyCount(a) }),
];

/**
 * Deck orders that make rare situations common:
 * - uniform: a fair shuffle.
 * - clustered: tiles near a random centre come first (dense boards, huge chains, 41+).
 * - parity: all tiles of one checkerboard colour first. None of them touch, so
 *   the board fills with loose tiles; the second colour then founds and merges
 *   massively (4-way mergers, 8th-chain blocks, dead tiles).
 */
export function tilestockDeckOrder(_deck: DeckSpec, rng: Rng): number[] {
  const tiles = Array.from({ length: TILE_COUNT }, (_, i) => i);
  const mode = rng.pick(['uniform', 'uniform', 'clustered', 'parity'] as const);
  const noise = tiles.map(() => rng.float());
  if (mode === 'uniform') return tiles.sort((a, b) => (noise[a] as number) - (noise[b] as number));
  if (mode === 'clustered') {
    const cr = rng.int(9);
    const cc = rng.int(12) + 1;
    const key = (t: number): number =>
      Math.abs(tileRow(t) - cr) + Math.abs(tileColumn(t) - cc) + 6 * (noise[t] as number);
    return tiles.sort((a, b) => key(a) - key(b));
  }
  const key = (t: number): number => ((tileRow(t) + tileColumn(t)) % 2) + 0.9 * (noise[t] as number);
  return tiles.sort((a, b) => key(a) - key(b));
}

/** Tags every rare path the fuzzer should reach; the CLI reports any that stay at zero. */
export const TILESTOCK_EXPECTED_COVERAGE: readonly string[] = [
  'merger:2way',
  'merger:3way',
  'merger:4way',
  'merger:survivorTie',
  'merger:defunctTie',
  'merger:safeAbsorbsUnsafe',
  'bonus:sole',
  'bonus:majority',
  'bonus:minority',
  'bonus:majorityTie',
  'bonus:minorityTie',
  'bonus:majority:final',
  'bonus:majorityTie:final',
  'bonus:minorityTie:final',
  'dispose:tradeCappedBySupply',
  'dispose:sellTradeKeep',
  'found:noBankShare',
  'found:refoundedWithKeptShares',
  'found:multiTileGroup',
  'grow:safeChain',
  'turn:noPlayableTile',
  'turn:deadTileDiscarded',
  'hand:deadTileHeld',
  'hand:blockedTileHeld',
  'declare:endSize',
  'declare:allSafe',
  'deck:bagEmptied',
  'end:declared',
];

export { NEIGHBORS };
