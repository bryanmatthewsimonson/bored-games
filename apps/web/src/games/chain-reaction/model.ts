/*
 * The Chain Reaction screen's view model: pure functions from an engine state (full or view mode) and the
 * seat's legal actions to what the components render. Every action a form submits is an element of the
 * `legal` list it was built from; the forms never assemble an action of their own.
 */
import {
  type ChainReactionAction,
  type ChainReactionEvent,
  type ChainReactionRules,
  type ChainReactionState,
  chainIndex,
  chainReaction,
  chainSizes,
  classifyTile,
  type DiscardEntry,
  LOOSE,
  PENDING,
  sharePrice,
  type Tier,
  type TileClass,
  tileId,
  tileIndex,
} from '@bored-games/chain-reaction';
import type { ChainReactionTheme, ChainTheme } from '@bored-games/chain-reaction/theme';
import { canonicalJson } from '@bored-games/game-kit';

// ---------------------------------------------------------------- chains

export type ChainPattern = ChainTheme['pattern'];

/** A chain as the screen shows it: engine id and index, themed name, label, color and pattern. */
export interface ChainView {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly label: string;
  readonly color: string;
  readonly pattern: ChainPattern;
}

/** The theme's chain of engine id `id`, if it names one. */
function themed(theme: ChainReactionTheme, id: string): ChainTheme | undefined {
  return (theme.chains as Readonly<Record<string, ChainTheme | undefined>>)[id];
}

/**
 * Chain `index` of `rules` as `theme` shows it. Every function here that names a chain takes the theme first:
 * the names come from the brand pack in effect (D046), so nothing reads a theme of its own.
 */
export function chainView(theme: ChainReactionTheme, rules: ChainReactionRules, index: number): ChainView {
  const id = rules.chains[index]?.id ?? '?';
  const t = themed(theme, id);
  if (t) return { id, index, name: t.name, label: t.label, color: t.color, pattern: t.pattern };
  // A chain the theme does not name (custom rules): still labelled, never a bare color.
  return {
    id,
    index,
    name: `Chain ${index + 1}`,
    label: String(index + 1),
    color: '#777777',
    pattern: 'solid',
  };
}

function chainNamed(theme: ChainReactionTheme, rules: ChainReactionRules, id: string): ChainView {
  return chainView(theme, rules, chainIndex(rules, id) ?? -1);
}

/** The theme's name for chain id `id`, or "a chain". */
export function nameOfChainId(theme: ChainReactionTheme, id: string): string {
  return themed(theme, id)?.name ?? 'a chain';
}

// ---------------------------------------------------------------- money and names

/** "$6,000"; money is always an integer number of dollars. */
export function formatMoney(n: number): string {
  const digits = String(Math.abs(Math.trunc(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return `${n < 0 ? '-' : ''}$${out}`;
}

export function seatName(names: readonly string[], seat: number): string {
  const n = names[seat];
  return n !== undefined && n !== '' ? n : `Seat ${seat + 1}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------- board

export type CellKind = 'empty' | 'loose' | 'pending' | 'chain';

export interface BoardCell {
  readonly index: number;
  /** Printed tile id, e.g. "7C". */
  readonly id: string;
  readonly kind: CellKind;
  readonly chain: ChainView | null;
  /** The most recently placed tile. */
  readonly last: boolean;
}

/** The tile index of the last `tilePlaced` event, or null when there is none. */
export function lastPlacedTile(events: readonly ChainReactionEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as ChainReactionEvent;
    if (e.type === 'tilePlaced') return tileIndex(e.tile);
  }
  return null;
}

/**
 * The tile that `next` adds to the board of `prev`, when exactly one cell went from empty to filled; null
 * otherwise (no change, the setup reveals, or unrelated states). Used where no event log is at hand.
 */
export function newlyPlacedTile(prev: ChainReactionState | null, next: ChainReactionState): number | null {
  if (prev === null || prev.board.length !== next.board.length) return null;
  let found: number | null = null;
  for (let i = 0; i < next.board.length; i++) {
    if (prev.board[i] === null && next.board[i] !== null) {
      if (found !== null) return null;
      found = i;
    }
  }
  return found;
}

/** The tile awaiting a founding or a merger, if any. */
function pendingTile(s: ChainReactionState): number | null {
  if (s.phase.kind === 'found') return s.phase.tile;
  if (s.phase.kind === 'merger') return s.phase.merger.tile;
  return null;
}

/**
 * All 108 cells in reading order (1A, 2A … 12I). `lastTile` comes from the event log; while a placement is
 * still resolving, its pending tile is the last one regardless.
 */
export function boardCells(
  theme: ChainReactionTheme,
  s: ChainReactionState,
  lastTile: number | null = null,
): BoardCell[] {
  const last = pendingTile(s) ?? lastTile;
  return s.board.map((v, index) => {
    const kind: CellKind =
      v === null ? 'empty' : v === LOOSE ? 'loose' : v === PENDING ? 'pending' : v >= 0 ? 'chain' : 'loose';
    return {
      index,
      id: tileId(index),
      kind,
      chain: kind === 'chain' ? chainView(theme, s.rules, v as number) : null,
      last: index === last,
    };
  });
}

// ---------------------------------------------------------------- hand

export type HandBadge = 'playable' | 'found' | 'merge' | 'dead' | 'blocked';

export interface HandTile {
  readonly pos: number;
  /** Null when this state does not know the tile (another seat's hand in a view). */
  readonly tile: number | null;
  readonly id: string | null;
  readonly cls: TileClass | null;
  readonly badge: HandBadge | null;
  /** What placing it would do, in words. */
  readonly preview: string;
}

export function badgeOf(cls: TileClass): HandBadge {
  return cls.kind === 'lone' || cls.kind === 'grow' ? 'playable' : cls.kind;
}

function previewOf(theme: ChainReactionTheme, rules: ChainReactionRules, cls: TileClass): string {
  switch (cls.kind) {
    case 'lone':
      return 'Stays unincorporated';
    case 'found':
      return 'Founds a new chain';
    case 'grow':
      return `Grows ${chainView(theme, rules, cls.chain).name}`;
    case 'merge':
      return `Merges ${listText(cls.chains.map((c) => chainView(theme, rules, c).name))}`;
    case 'dead':
      return 'Dead: it would merge two safe chains';
    case 'blocked':
      return 'Blocked: every chain is on the board';
  }
}

/** The seat's hand in deck-position order, each known tile classified against the current board. */
export function handTiles(theme: ChainReactionTheme, s: ChainReactionState, seat: number): HandTile[] {
  return (s.players[seat]?.hand ?? []).map((h) => {
    if (h.tile === null)
      return { pos: h.pos, tile: null, id: null, cls: null, badge: null, preview: 'Hidden tile' };
    const cls = classifyTile(s.board, s.rules, h.tile);
    return {
      pos: h.pos,
      tile: h.tile,
      id: tileId(h.tile),
      cls,
      badge: badgeOf(cls),
      preview: previewOf(theme, s.rules, cls),
    };
  });
}

// ---------------------------------------------------------------- panels

export interface ChainRow {
  readonly chain: ChainView;
  readonly size: number;
  /** Current share price; 0 when the chain is not on the board. */
  readonly price: number;
  readonly safe: boolean;
  readonly active: boolean;
  /** Shares left in the bank. */
  readonly bank: number;
  /** Shares the viewer holds; null for a spectator. */
  readonly mine: number | null;
}

export function chainRows(
  theme: ChainReactionTheme,
  s: ChainReactionState,
  mySeat: number | null,
): ChainRow[] {
  const sizes = chainSizes(s.board, s.rules.chains.length);
  return s.rules.chains.map((_, c) => {
    const size = sizes[c] ?? 0;
    return {
      chain: chainView(theme, s.rules, c),
      size,
      price: sharePrice(s.rules, c, size),
      safe: size >= s.rules.safeSize,
      active: size > 0,
      bank: s.bank[c] ?? 0,
      mine: mySeat === null ? null : (s.players[mySeat]?.shares[c] ?? 0),
    };
  });
}

// ---------------------------------------------------------------- price card

/** One tier's numbers at one size bracket. */
export interface PriceCell {
  readonly price: number;
  readonly majority: number;
  readonly minority: number;
}

/** A price tier as the card heads it: its themed name and its chains. */
export interface PriceTier {
  readonly tier: Tier;
  readonly name: string;
  readonly chains: readonly ChainView[];
}

/** One size bracket: "2", "6–10", "41+", with each tier's numbers in `PriceCardModel.tiers` order. */
export interface PriceRow {
  readonly label: string;
  readonly min: number;
  /** The largest size in the bracket; null for the open last bracket. */
  readonly max: number | null;
  readonly cells: readonly PriceCell[];
}

export interface PriceCardModel {
  readonly tiers: readonly PriceTier[];
  readonly rows: readonly PriceRow[];
}

const TIER_ORDER: readonly Tier[] = ['budget', 'standard', 'premium'];

/**
 * The stock price and bonus card for `rules`: one row per price bracket, one column group per tier that has a
 * chain. Prices come from `sharePrice`; bonuses are the rules' majority and minority multiples of the price.
 */
export function priceCard(theme: ChainReactionTheme, rules: ChainReactionRules): PriceCardModel {
  const tiers = TIER_ORDER.flatMap((tier) => {
    const chains = rules.chains.flatMap((c, i) => (c.tier === tier ? [chainView(theme, rules, i)] : []));
    return chains.length === 0 ? [] : [{ tier, name: theme.tiers[tier], chains }];
  });
  const b = rules.priceBrackets;
  const rows = b.map((min, i) => {
    const next = b[i + 1];
    const max = next === undefined ? null : next - 1;
    const label = max === null ? `${min}+` : max === min ? `${min}` : `${min}–${max}`;
    const cells = tiers.map((t) => {
      const price = sharePrice(rules, t.chains[0]?.index ?? -1, min);
      return {
        price,
        majority: price * rules.majorityMultiplier,
        minority: price * rules.minorityMultiplier,
      };
    });
    return { label, min, max, cells };
  });
  return { tiers, rows };
}

/** The index of the price card row a chain of `size` tiles is priced at; null when it is not on the board. */
export function priceRowOf(rules: ChainReactionRules, size: number): number | null {
  let row: number | null = null;
  rules.priceBrackets.forEach((min, i) => {
    if (size >= min) row = i;
  });
  return row;
}

/** A chain a player holds shares in; the count is null when this viewer may not see it. */
export interface Holding {
  readonly chain: ChainView;
  readonly count: number | null;
}

/**
 * A player as the viewer may see them (RULES "Assets"): their own cash and holdings exactly; for anyone else
 * only which chains they hold and whether they have any cash; everything exactly once the game is over. Hidden
 * numbers are not carried at all, so no component can show them by accident.
 */
export interface PlayerRow {
  readonly seat: number;
  readonly name: string;
  /** True when `cash` and every holding count are exact (my own row, or the game is over). */
  readonly exact: boolean;
  /** Exact cash, or null when hidden from this viewer. */
  readonly cash: number | null;
  /** Whether the player has any cash at all. */
  readonly hasCash: boolean;
  /** The chains the player holds shares in, in chain order. */
  readonly shares: readonly Holding[];
  readonly handSize: number;
  /** Whose turn it is. */
  readonly turn: boolean;
  /** Who must decide now (differs from the turn during a merger's disposals). */
  readonly acting: boolean;
  readonly me: boolean;
}

function actingSeat(s: ChainReactionState): number | null {
  const p = chainReaction.pending(s);
  return p.type === 'player' ? p.seat : null;
}

/** The players panel's rows for `mySeat` (null for a spectator, who sees every row hidden). */
export function playerRows(
  theme: ChainReactionTheme,
  s: ChainReactionState,
  names: readonly string[],
  mySeat: number | null,
): PlayerRow[] {
  const acting = actingSeat(s);
  const over = s.phase.kind === 'over';
  return s.players.map((p, seat) => {
    const exact = over || seat === mySeat;
    return {
      seat,
      name: seatName(names, seat),
      exact,
      cash: exact ? p.cash : null,
      hasCash: p.cash > 0,
      shares: p.shares.flatMap((n, c) =>
        n > 0 ? [{ chain: chainView(theme, s.rules, c), count: exact ? n : null }] : [],
      ),
      handSize: p.hand.length,
      turn: !over && s.turn?.seat === seat,
      acting: acting === seat,
      me: seat === mySeat,
    };
  });
}

/** One chain the viewer holds shares in, valued at its current price. */
export interface MyHolding {
  readonly chain: ChainView;
  readonly count: number;
  /** False when the chain is not on the board: its shares have no price and are worth $0 for now. */
  readonly onBoard: boolean;
  /** The current share price; 0 when the chain is not on the board. */
  readonly price: number;
  /** `count × price`. */
  readonly value: number;
}

/** The "Your cash and shares" panel: the viewer's own cash and shares, valued at today's prices. */
export interface MyHoldings {
  readonly cash: number;
  /** One line per chain held, in chain order. */
  readonly lines: readonly MyHolding[];
  /** The sum of the lines' values. */
  readonly shareValue: number;
  /** Cash plus share value (majority and minority bonuses not included). */
  readonly netWorth: number;
}

/**
 * The viewer's own cash and shares (D043), built from their exact `playerRows` row and the `chainRows` prices,
 * so it shows nothing the Players and Chains panels do not. Null for a spectator.
 */
export function myHoldings(
  theme: ChainReactionTheme,
  s: ChainReactionState,
  mySeat: number | null,
): MyHoldings | null {
  if (mySeat === null) return null;
  const me = playerRows(theme, s, [], mySeat).find((r) => r.me);
  if (me === undefined || me.cash === null) return null;
  const chains = chainRows(theme, s, mySeat);
  const lines = me.shares.map((h) => {
    const row = chains[h.chain.index];
    const count = h.count ?? 0;
    const onBoard = row?.active === true;
    const price = onBoard ? (row?.price ?? 0) : 0;
    return { chain: h.chain, count, onBoard, price, value: count * price };
  });
  const shareValue = lines.reduce((sum, l) => sum + l.value, 0);
  return { cash: me.cash, lines, shareValue, netWorth: me.cash + shareValue };
}

export interface ResultRow {
  readonly seat: number;
  readonly name: string;
  /** 1-based; tied seats share a place. */
  readonly place: number;
  readonly cash: number;
}

/** Final places and cash, best first; empty until the game is over. */
export function resultRows(s: ChainReactionState, names: readonly string[]): ResultRow[] {
  const r = s.result;
  if (!r) return [];
  return r.places
    .map((place, seat) => ({ seat, name: seatName(names, seat), place, cash: r.cash[seat] ?? 0 }))
    .sort((a, b) => a.place - b.place || a.seat - b.seat);
}

/** The places and scores of a session outcome: what `outcomeRows` reads. */
export interface OutcomeLike {
  readonly places: readonly number[];
  readonly scores: readonly number[];
}

/**
 * Places and cash, best first, for a game that ended outside its rules (a resign or a timeout, PROTOCOL §8.2–§8.3):
 * the platform's places, with the forfeiting seats last, and its scores, which for Chain Reaction are each seat's
 * cash as if the game ended now (`standings`: bonuses paid and every share sold). Empty without an outcome.
 */
export function outcomeRows(outcome: OutcomeLike | null, names: readonly string[]): ResultRow[] {
  if (outcome === null) return [];
  return outcome.places
    .map((place, seat) => ({ seat, name: seatName(names, seat), place, cash: outcome.scores[seat] ?? 0 }))
    .sort((a, b) => a.place - b.place || a.seat - b.seat);
}

// ---------------------------------------------------------------- decisions

export interface ChainOption {
  readonly chain: ChainView;
  readonly action: ChainReactionAction;
}

export interface BuyLine {
  readonly chain: ChainView;
  readonly price: number;
  readonly bank: number;
  /** The most shares of this chain any legal purchase holds (cash, bank and the turn limit). */
  readonly max: number;
}

export type Decision =
  /** Nothing for this seat to decide now. */
  | { readonly kind: 'wait' }
  | {
      readonly kind: 'place';
      readonly options: readonly {
        readonly tile: number;
        readonly id: string;
        readonly action: ChainReactionAction;
      }[];
    }
  | { readonly kind: 'skip'; readonly action: ChainReactionAction }
  | { readonly kind: 'found'; readonly options: readonly ChainOption[] }
  | {
      readonly kind: 'survivor';
      /** Every chain in the merger with its pre-merger size. */
      readonly involved: readonly { readonly chain: ChainView; readonly size: number }[];
      readonly options: readonly ChainOption[];
    }
  | {
      readonly kind: 'order';
      readonly options: readonly {
        readonly chains: readonly ChainView[];
        readonly action: ChainReactionAction;
      }[];
    }
  | {
      readonly kind: 'dispose';
      readonly actor: number;
      readonly chain: ChainView;
      readonly survivor: ChainView;
      readonly held: number;
      /** The defunct chain's pre-merger share price. */
      readonly price: number;
      /** Most shares tradable (even), limited by holdings and the survivor's bank supply. */
      readonly maxTrade: number;
      readonly actions: readonly ChainReactionAction[];
    }
  | {
      readonly kind: 'endTurn';
      readonly actor: number;
      readonly cash: number;
      readonly maxTotal: number;
      /** The chains on the board, in chain order. */
      readonly chains: readonly BuyLine[];
      /** Dead tiles that will be discarded and replaced. */
      readonly discard: readonly DiscardEntry[];
      readonly canDeclare: boolean;
      readonly condition: 'endSize' | 'allSafe' | null;
      readonly actions: readonly ChainReactionAction[];
    };

const key = (a: unknown): string => canonicalJson(a);

function lookup(actions: readonly ChainReactionAction[], candidate: unknown): ChainReactionAction | null {
  const k = key(candidate);
  return actions.find((a) => key(a) === k) ?? null;
}

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

/** Maps the seat's legal actions to the decision the screen asks for. */
/**
 * Whether the hand shows each tile's badge ("playable", "merge", "dead"…) and preview text: only while this
 * viewer is placing (or must skip placing). On anyone else's turn the badges would read as advice for a turn that
 * is not theirs, and while a founding or merger resolves the pending tile makes the classification unreliable.
 */
export function handBadgesShown(decision: Decision): boolean {
  return decision.kind === 'place' || decision.kind === 'skip';
}

export function decisionFor(
  theme: ChainReactionTheme,
  s: ChainReactionState,
  legal: readonly ChainReactionAction[],
): Decision {
  const first = legal[0];
  if (!first) return { kind: 'wait' };
  const rules = s.rules;
  switch (first.type) {
    case 'place':
      return {
        kind: 'place',
        options: legal.flatMap((a) =>
          a.type === 'place' ? [{ tile: tileIndex(a.tile) as number, id: a.tile, action: a }] : [],
        ),
      };
    case 'skipPlace':
      return { kind: 'skip', action: first };
    case 'foundChain':
      return {
        kind: 'found',
        options: legal.flatMap((a) =>
          a.type === 'foundChain' ? [{ chain: chainNamed(theme, rules, a.chain), action: a }] : [],
        ),
      };
    case 'chooseSurvivor': {
      const m = s.phase.kind === 'merger' ? s.phase.merger : null;
      return {
        kind: 'survivor',
        involved: (m?.chains ?? []).map((c, i) => ({
          chain: chainView(theme, rules, c),
          size: m?.sizes[i] ?? 0,
        })),
        options: legal.flatMap((a) =>
          a.type === 'chooseSurvivor' ? [{ chain: chainNamed(theme, rules, a.chain), action: a }] : [],
        ),
      };
    }
    case 'orderDefunct':
      return {
        kind: 'order',
        options: legal.flatMap((a) =>
          a.type === 'orderDefunct'
            ? [{ chains: a.order.map((id) => chainNamed(theme, rules, id)), action: a }]
            : [],
        ),
      };
    case 'dispose': {
      const c = chainIndex(rules, first.chain) ?? -1;
      const m = s.phase.kind === 'merger' ? s.phase.merger : null;
      const preSize = m ? (m.sizes[m.chains.indexOf(c)] ?? 0) : 0;
      return {
        kind: 'dispose',
        actor: first.actor,
        chain: chainView(theme, rules, c),
        survivor: chainView(theme, rules, m?.survivor ?? -1),
        held: s.players[first.actor]?.shares[c] ?? 0,
        price: sharePrice(rules, c, preSize),
        maxTrade: Math.max(0, ...legal.map((a) => (a.type === 'dispose' ? a.trade : 0))),
        actions: legal,
      };
    }
    case 'endTurn': {
      const sizes = chainSizes(s.board, rules.chains.length);
      const chains: BuyLine[] = [];
      for (let c = 0; c < rules.chains.length; c++) {
        const size = sizes[c] ?? 0;
        if (size === 0) continue;
        const id = rules.chains[c]?.id;
        const max = Math.max(
          0,
          ...legal.map((a) => (a.type === 'endTurn' ? a.buy.filter((x) => x === id).length : 0)),
        );
        chains.push({
          chain: chainView(theme, rules, c),
          price: sharePrice(rules, c, size),
          bank: s.bank[c] ?? 0,
          max,
        });
      }
      return {
        kind: 'endTurn',
        actor: first.actor,
        cash: s.players[first.actor]?.cash ?? 0,
        maxTotal: rules.maxBuyPerTurn,
        chains,
        discard: first.discard,
        canDeclare: legal.some((a) => a.type === 'endTurn' && a.declareEnd),
        condition: s.turn?.endCondition ?? null,
        actions: legal,
      };
    }
    default:
      return { kind: 'wait' };
  }
}

/** The legal disposal selling `sell` and trading `trade` shares, or null when there is none. */
export function findDispose(
  d: Extract<Decision, { kind: 'dispose' }>,
  sell: number,
  trade: number,
): ChainReactionAction | null {
  if (!isCount(sell) || !isCount(trade)) return null;
  return lookup(d.actions, { type: 'dispose', actor: d.actor, chain: d.chain.id, sell, trade });
}

/**
 * The legal end of turn buying `counts[i]` shares of `d.chains[i]`, declaring the end or not, or null when
 * no legal action matches (over the limit, unaffordable, not in the bank, or no end condition).
 */
export function findEndTurn(
  d: Extract<Decision, { kind: 'endTurn' }>,
  counts: readonly number[],
  declareEnd: boolean,
): ChainReactionAction | null {
  if (counts.length !== d.chains.length || !counts.every(isCount)) return null;
  const buy = d.chains.flatMap((line, i) => new Array<string>(counts[i] ?? 0).fill(line.chain.id));
  if (buy.length > d.maxTotal) return null;
  const discard = d.actions[0]?.type === 'endTurn' ? d.actions[0].discard : [];
  return lookup(d.actions, { type: 'endTurn', actor: d.actor, buy, declareEnd, discard });
}

/** Total cost of buying `counts[i]` shares of `d.chains[i]` at current prices. */
export function buyCost(d: Extract<Decision, { kind: 'endTurn' }>, counts: readonly number[]): number {
  return d.chains.reduce((sum, line, i) => sum + line.price * (counts[i] ?? 0), 0);
}

// ---------------------------------------------------------------- status

function decisionText(theme: ChainReactionTheme, s: ChainReactionState, decision: string): string {
  switch (decision) {
    case 'place':
      return 'place a tile';
    case 'foundChain':
      return 'found a chain';
    case 'chooseSurvivor':
      return 'choose the surviving chain';
    case 'orderDefunct':
      return 'order the defunct chains';
    case 'dispose': {
      const m = s.phase.kind === 'merger' ? s.phase.merger : null;
      const head = m?.defuncts?.[0];
      return `sell, trade or keep ${head === undefined ? '' : `${chainView(theme, s.rules, head).name} `}shares`;
    }
    case 'endTurn':
      return 'buy shares and end the turn';
    default:
      return 'decide';
  }
}

/** One line on whose decision it is. */
export function statusLine(
  theme: ChainReactionTheme,
  s: ChainReactionState,
  names: readonly string[],
  mySeat: number | null,
): string {
  const p = chainReaction.pending(s);
  if (p.type === 'over') return 'The game is over.';
  if (p.type === 'reveal') return 'Revealing setup tiles…';
  // Chain Reaction never pends a dice beacon. The pending type is shared with games that do (D058).
  if (p.type !== 'player') return 'The game is over.';
  const what = decisionText(theme, s, p.decision);
  if (p.seat === mySeat) return `Your move: ${what}.`;
  return `Waiting for ${seatName(names, p.seat)} to ${what}.`;
}

// ---------------------------------------------------------------- event log

const ROLE: Record<string, string> = {
  majority: 'the majority',
  minority: 'the minority',
  sole: 'both',
  majorityTie: 'a share of the pooled',
  minorityTie: 'a share of the minority',
};

/**
 * One exact log line per engine event, with seat names and themed chain names. The line carries every count and
 * amount, so it is never for display about other players: the log goes through `logLines`, which hides what the
 * viewer may not see (RULES "Assets").
 */
export function describeEvent(
  theme: ChainReactionTheme,
  e: ChainReactionEvent,
  names: readonly string[],
): string {
  const who = (seat: number): string => seatName(names, seat);
  switch (e.type) {
    case 'setupTileRevealed':
      return `${who(e.seat)} drew ${e.tile} as a setup tile.`;
    case 'firstPlayer':
      return `${who(e.seat)} goes first.`;
    case 'tilesDealt':
      return `${who(e.seat)} drew ${plural(e.positions.length, 'tile')}.`;
    case 'turnStarted':
      return `Turn ${e.turn}: ${who(e.seat)}.`;
    case 'tilePlaced': {
      const what = {
        lone: '',
        found: ', founding a chain',
        grow: ', growing a chain',
        merge: ', causing a merger',
      }[e.kind];
      return `${who(e.seat)} placed ${e.tile}${what}.`;
    }
    case 'placementSkipped':
      return `${who(e.seat)} had no playable tile and skipped placing.`;
    case 'chainFounded':
      return `${who(e.seat)} founded ${nameOfChainId(theme, e.chain)} with ${plural(e.size, 'tile')}${
        e.keptShares > 0 ? ` (${plural(e.keptShares, 'old share')} still held)` : ''
      }.`;
    case 'founderShare':
      return e.granted
        ? `${who(e.seat)} received a free ${nameOfChainId(theme, e.chain)} share.`
        : `No ${nameOfChainId(theme, e.chain)} share was left for the founder.`;
    case 'chainGrew':
      return `${nameOfChainId(theme, e.chain)} grew to ${plural(e.size, 'tile')}${e.safe ? ' and is safe' : ''}.`;
    case 'mergerStarted':
      return `${who(e.seat)} merged ${listText(
        e.chains.map((c, i) => `${nameOfChainId(theme, c)} (${e.sizes[i] ?? 0})`),
      )} at ${e.tile}.`;
    case 'survivorChosen':
      return `${nameOfChainId(theme, e.chain)} survives${e.tied ? ', chosen from a tie' : ''}.`;
    case 'defunctOrder':
      return `Defunct chains resolve in this order: ${e.order.map((c) => nameOfChainId(theme, c)).join(', ')}.`;
    case 'bonusPaid':
      return `${who(e.seat)} received ${formatMoney(e.amount)}, ${ROLE[e.role] ?? 'a'} bonus${
        e.role === 'sole' ? 'es' : ''
      } for ${nameOfChainId(theme, e.chain)}${e.final ? ' at final scoring' : ''}.`;
    case 'noBonus':
      return `Nobody holds ${nameOfChainId(theme, e.chain)}, so no bonus is paid.`;
    case 'sharesDisposed': {
      const parts = [
        e.sell > 0 ? `sold ${e.sell} for ${formatMoney(e.proceeds)}` : null,
        e.trade > 0 ? `traded ${e.trade}${e.tradeCapped ? ' (limited by the bank)' : ''}` : null,
        e.keep > 0 ? `kept ${e.keep}` : null,
      ].filter((x): x is string => x !== null);
      return `${who(e.seat)} ${listText(parts) || 'kept nothing'} of ${nameOfChainId(theme, e.chain)}.`;
    }
    case 'chainDefunct':
      return `${nameOfChainId(theme, e.chain)} is defunct and can be founded again.`;
    case 'mergerCompleted':
      return `The merger is complete: ${nameOfChainId(theme, e.survivor)} has ${plural(e.size, 'tile')}.`;
    case 'sharesBought': {
      if (e.shares.length === 0) return `${who(e.seat)} bought no shares.`;
      const counts = new Map<string, number>();
      for (const c of e.shares) counts.set(c, (counts.get(c) ?? 0) + 1);
      const bought = [...counts].map(([c, n]) => `${n} ${nameOfChainId(theme, c)}`);
      return `${who(e.seat)} bought ${listText(bought)} for ${formatMoney(e.cost)}.`;
    }
    case 'endDeclared':
      return `${who(e.seat)} declared the end: ${
        e.condition === 'endSize' ? 'a chain is large enough' : 'every chain on the board is safe'
      }.`;
    case 'tilesDiscarded':
      return `${who(e.seat)} discarded dead ${e.tiles.length === 1 ? 'tile' : 'tiles'} ${listText(e.tiles)}.`;
    case 'finalSale':
      return `${who(e.seat)} sold ${plural(e.count, `${nameOfChainId(theme, e.chain)} share`)} for ${formatMoney(e.amount)}.`;
    case 'gameEnded': {
      const winners = e.places.flatMap((p, seat) => (p === 1 ? [who(seat)] : []));
      return `The game is over. ${winners.length > 1 ? 'Winners' : 'Winner'}: ${listText(winners)}.`;
    }
  }
}

/**
 * The line for an event older than the current and previous turn, without the counts and amounts the viewer may
 * not see (RULES "Assets"), or null when the exact line hides nothing from them. `survivor` is the current
 * merger's surviving chain id, for trades.
 *
 * Final scoring needs no case: its bonuses and sales happen in the game's last turn, right before it ends, so
 * they are always within the window or after the game is over.
 */
function olderLine(
  theme: ChainReactionTheme,
  e: ChainReactionEvent,
  names: readonly string[],
  survivor: string | null,
  mySeat: number | null,
): string | null {
  const who = (seat: number): string => seatName(names, seat);
  // The founding line's share total sums every player's holdings, so even the founder gets it without.
  if (e.type === 'chainFounded')
    return `${who(e.seat)} founded ${nameOfChainId(theme, e.chain)} with ${plural(e.size, 'tile')}.`;
  if (!('seat' in e) || e.seat === mySeat) return null;
  switch (e.type) {
    case 'sharesBought': {
      if (e.shares.length === 0) return null;
      const chains = [...new Set(e.shares)].map((c) => nameOfChainId(theme, c));
      return `${who(e.seat)} bought ${listText(chains)} shares.`;
    }
    case 'sharesDisposed': {
      const chain = nameOfChainId(theme, e.chain);
      const forSurvivor = survivor === null ? '' : ` for ${nameOfChainId(theme, survivor)}`;
      const sold = e.sell > 0;
      const traded = e.trade > 0;
      const kept = e.keep > 0;
      if (!sold && !traded && !kept) return null;
      if (!traded && !kept) return `${who(e.seat)} sold some ${chain} shares.`;
      if (!sold && !kept) return `${who(e.seat)} traded ${chain} shares${forSurvivor}.`;
      if (!sold && !traded) return `${who(e.seat)} kept their ${chain} shares.`;
      const parts = [
        sold ? 'sold some' : null,
        traded ? `traded some${forSurvivor}` : null,
        kept ? 'kept the rest' : null,
      ].filter((x): x is string => x !== null);
      return `${who(e.seat)} ${listText(parts)} of their ${chain} shares.`;
    }
    case 'bonusPaid':
      return `${who(e.seat)} received a bonus for ${nameOfChainId(theme, e.chain)}.`;
    default:
      return null;
  }
}

/**
 * Who reads the log: their seat (null for a spectator), whether the game is over, the seat names, and the theme
 * that names the chains.
 */
export interface LogViewer {
  readonly theme: ChainReactionTheme;
  readonly mySeat: number | null;
  readonly over: boolean;
  readonly names: readonly string[];
}

/** The most log lines the Game screen shows. */
export const LOG_LINES = 100;

/** An engine event as the session reports it (`view().events` is typed `unknown[]`). */
function isEvent(e: unknown): e is ChainReactionEvent {
  return typeof e === 'object' && e !== null && typeof (e as { type?: unknown }).type === 'string';
}

/**
 * The game log from the session's module events (oldest first): one line per event, newest last, at most `max`
 * (the newest ones). Anything that is not an engine event is skipped.
 *
 * Lines about another player's shares and money keep their numbers only for events of the current and the
 * previous turn; older ones say what happened without counts or amounts (RULES "Assets"). The viewer's own
 * lines stay exact, except that an older founding line drops its share total for every viewer, since that total
 * sums every player's holdings. Every line is exact once the game is over. An event belongs to the turn of the last
 * `turnStarted` before it, so a merger's bonuses and disposals belong to the turn that caused the merger.
 */
export function logLines(events: readonly unknown[], viewer: LogViewer, max = LOG_LINES): string[] {
  const { theme, mySeat, over, names } = viewer;
  const known = events.filter(isEvent);
  let current = 0;
  for (const e of known) if (e.type === 'turnStarted') current = e.turn;
  const out: string[] = [];
  let turn = 0;
  let survivor: string | null = null;
  for (const e of known) {
    if (e.type === 'turnStarted') turn = e.turn;
    if (e.type === 'survivorChosen') survivor = e.chain;
    const recent = over || turn >= current - 1;
    const line =
      (recent ? null : olderLine(theme, e, names, survivor, mySeat)) ?? describeEvent(theme, e, names);
    if (typeof line === 'string') out.push(line);
  }
  return out.slice(Math.max(0, out.length - max));
}

/** `lastPlacedTile` over the session's module events. */
export function lastTileOf(events: readonly unknown[]): number | null {
  return lastPlacedTile(events.filter(isEvent));
}
