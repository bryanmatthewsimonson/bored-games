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
  type TileClass,
  tileId,
  tileIndex,
} from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME, type ChainTheme } from '@bored-games/chain-reaction/theme';
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

const THEMED: Readonly<Record<string, ChainTheme>> = CHAIN_REACTION_THEME.chains;

export function chainView(rules: ChainReactionRules, index: number): ChainView {
  const id = rules.chains[index]?.id ?? '?';
  const t = THEMED[id];
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

function chainNamed(rules: ChainReactionRules, id: string): ChainView {
  return chainView(rules, chainIndex(rules, id) ?? -1);
}

function nameOfChainId(id: string): string {
  return THEMED[id]?.name ?? 'a chain';
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
export function boardCells(s: ChainReactionState, lastTile: number | null = null): BoardCell[] {
  const last = pendingTile(s) ?? lastTile;
  return s.board.map((v, index) => {
    const kind: CellKind =
      v === null ? 'empty' : v === LOOSE ? 'loose' : v === PENDING ? 'pending' : v >= 0 ? 'chain' : 'loose';
    return {
      index,
      id: tileId(index),
      kind,
      chain: kind === 'chain' ? chainView(s.rules, v as number) : null,
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

function previewOf(rules: ChainReactionRules, cls: TileClass): string {
  switch (cls.kind) {
    case 'lone':
      return 'Stays unincorporated';
    case 'found':
      return 'Founds a new chain';
    case 'grow':
      return `Grows ${chainView(rules, cls.chain).name}`;
    case 'merge':
      return `Merges ${listText(cls.chains.map((c) => chainView(rules, c).name))}`;
    case 'dead':
      return 'Dead: it would merge two safe chains';
    case 'blocked':
      return 'Blocked: every chain is on the board';
  }
}

/** The seat's hand in deck-position order, each known tile classified against the current board. */
export function handTiles(s: ChainReactionState, seat: number): HandTile[] {
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
      preview: previewOf(s.rules, cls),
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

export function chainRows(s: ChainReactionState, mySeat: number | null): ChainRow[] {
  const sizes = chainSizes(s.board, s.rules.chains.length);
  return s.rules.chains.map((_, c) => {
    const size = sizes[c] ?? 0;
    return {
      chain: chainView(s.rules, c),
      size,
      price: sharePrice(s.rules, c, size),
      safe: size >= s.rules.safeSize,
      active: size > 0,
      bank: s.bank[c] ?? 0,
      mine: mySeat === null ? null : (s.players[mySeat]?.shares[c] ?? 0),
    };
  });
}

export interface PlayerRow {
  readonly seat: number;
  readonly name: string;
  readonly cash: number;
  /** Shares per chain index (public). */
  readonly shares: readonly number[];
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

export function playerRows(
  s: ChainReactionState,
  names: readonly string[],
  mySeat: number | null,
): PlayerRow[] {
  const acting = actingSeat(s);
  const over = s.phase.kind === 'over';
  return s.players.map((p, seat) => ({
    seat,
    name: seatName(names, seat),
    cash: p.cash,
    shares: p.shares,
    handSize: p.hand.length,
    turn: !over && s.turn?.seat === seat,
    acting: acting === seat,
    me: seat === mySeat,
  }));
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
export function decisionFor(s: ChainReactionState, legal: readonly ChainReactionAction[]): Decision {
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
          a.type === 'foundChain' ? [{ chain: chainNamed(rules, a.chain), action: a }] : [],
        ),
      };
    case 'chooseSurvivor': {
      const m = s.phase.kind === 'merger' ? s.phase.merger : null;
      return {
        kind: 'survivor',
        involved: (m?.chains ?? []).map((c, i) => ({ chain: chainView(rules, c), size: m?.sizes[i] ?? 0 })),
        options: legal.flatMap((a) =>
          a.type === 'chooseSurvivor' ? [{ chain: chainNamed(rules, a.chain), action: a }] : [],
        ),
      };
    }
    case 'orderDefunct':
      return {
        kind: 'order',
        options: legal.flatMap((a) =>
          a.type === 'orderDefunct'
            ? [{ chains: a.order.map((id) => chainNamed(rules, id)), action: a }]
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
        chain: chainView(rules, c),
        survivor: chainView(rules, m?.survivor ?? -1),
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
          chain: chainView(rules, c),
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

function decisionText(s: ChainReactionState, decision: string): string {
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
      return `sell, trade or keep ${head === undefined ? '' : `${chainView(s.rules, head).name} `}shares`;
    }
    case 'endTurn':
      return 'buy shares and end the turn';
    default:
      return 'decide';
  }
}

/** One line on whose decision it is. */
export function statusLine(s: ChainReactionState, names: readonly string[], mySeat: number | null): string {
  const p = chainReaction.pending(s);
  if (p.type === 'over') return 'The game is over.';
  if (p.type === 'reveal') return 'Revealing setup tiles…';
  const what = decisionText(s, p.decision);
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

/** One log line per engine event, with seat names and themed chain names. */
export function describeEvent(e: ChainReactionEvent, names: readonly string[]): string {
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
      return `${who(e.seat)} founded ${nameOfChainId(e.chain)} with ${plural(e.size, 'tile')}${
        e.keptShares > 0 ? ` (${plural(e.keptShares, 'old share')} still held)` : ''
      }.`;
    case 'founderShare':
      return e.granted
        ? `${who(e.seat)} received a free ${nameOfChainId(e.chain)} share.`
        : `No ${nameOfChainId(e.chain)} share was left for the founder.`;
    case 'chainGrew':
      return `${nameOfChainId(e.chain)} grew to ${plural(e.size, 'tile')}${e.safe ? ' and is safe' : ''}.`;
    case 'mergerStarted':
      return `${who(e.seat)} merged ${listText(
        e.chains.map((c, i) => `${nameOfChainId(c)} (${e.sizes[i] ?? 0})`),
      )} at ${e.tile}.`;
    case 'survivorChosen':
      return `${nameOfChainId(e.chain)} survives${e.tied ? ', chosen from a tie' : ''}.`;
    case 'defunctOrder':
      return `Defunct chains resolve in this order: ${e.order.map(nameOfChainId).join(', ')}.`;
    case 'bonusPaid':
      return `${who(e.seat)} received ${formatMoney(e.amount)}, ${ROLE[e.role] ?? 'a'} bonus${
        e.role === 'sole' ? 'es' : ''
      } for ${nameOfChainId(e.chain)}${e.final ? ' at final scoring' : ''}.`;
    case 'noBonus':
      return `Nobody holds ${nameOfChainId(e.chain)}, so no bonus is paid.`;
    case 'sharesDisposed': {
      const parts = [
        e.sell > 0 ? `sold ${e.sell} for ${formatMoney(e.proceeds)}` : null,
        e.trade > 0 ? `traded ${e.trade}${e.tradeCapped ? ' (limited by the bank)' : ''}` : null,
        e.keep > 0 ? `kept ${e.keep}` : null,
      ].filter((x): x is string => x !== null);
      return `${who(e.seat)} ${listText(parts) || 'kept nothing'} of ${nameOfChainId(e.chain)}.`;
    }
    case 'chainDefunct':
      return `${nameOfChainId(e.chain)} is defunct and can be founded again.`;
    case 'mergerCompleted':
      return `The merger is complete: ${nameOfChainId(e.survivor)} has ${plural(e.size, 'tile')}.`;
    case 'sharesBought': {
      if (e.shares.length === 0) return `${who(e.seat)} bought no shares.`;
      const counts = new Map<string, number>();
      for (const c of e.shares) counts.set(c, (counts.get(c) ?? 0) + 1);
      const bought = [...counts].map(([c, n]) => `${n} ${nameOfChainId(c)}`);
      return `${who(e.seat)} bought ${listText(bought)} for ${formatMoney(e.cost)}.`;
    }
    case 'endDeclared':
      return `${who(e.seat)} declared the end: ${
        e.condition === 'endSize' ? 'a chain is large enough' : 'every chain on the board is safe'
      }.`;
    case 'tilesDiscarded':
      return `${who(e.seat)} discarded dead ${e.tiles.length === 1 ? 'tile' : 'tiles'} ${listText(e.tiles)}.`;
    case 'finalSale':
      return `${who(e.seat)} sold ${plural(e.count, `${nameOfChainId(e.chain)} share`)} for ${formatMoney(e.amount)}.`;
    case 'gameEnded': {
      const winners = e.places.flatMap((p, seat) => (p === 1 ? [who(seat)] : []));
      return `The game is over. ${winners.length > 1 ? 'Winners' : 'Winner'}: ${listText(winners)}.`;
    }
  }
}
