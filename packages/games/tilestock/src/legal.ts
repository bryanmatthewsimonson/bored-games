import type { Pending, Seat } from '@bored-games/game-kit';
import { activeChains, chainSizes, classifyTile, isPlayable } from './board.ts';
import { defunctCandidates } from './engine.ts';
import { sharePrice } from './pricing.ts';
import { chainId } from './rules.ts';
import { tileId } from './tiles.ts';
import type { TilestockAction, TilestockState } from './types.ts';

export function pendingDecision(s: TilestockState): Pending {
  const phase = s.phase;
  switch (phase.kind) {
    case 'over':
      return { type: 'over' };
    case 'setup': {
      const positions = s.setupTiles.flatMap((t, pos) => (t === null ? [pos] : []));
      return { type: 'reveal', deck: 'tiles', positions };
    }
    case 'merger': {
      const m = phase.merger;
      if (m.survivor === null) return { type: 'player', seat: m.mergemaker, decision: 'chooseSurvivor' };
      if (m.defuncts === null) return { type: 'player', seat: m.mergemaker, decision: 'orderDefunct' };
      return { type: 'player', seat: m.holders?.[0] ?? m.mergemaker, decision: 'dispose' };
    }
    case 'place':
      return { type: 'player', seat: s.turn?.seat ?? 0, decision: 'place' };
    case 'found':
      return { type: 'player', seat: s.turn?.seat ?? 0, decision: 'foundChain' };
    case 'buy':
      return { type: 'player', seat: s.turn?.seat ?? 0, decision: 'endTurn' };
  }
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) out.push([item, ...rest]);
  });
  return out;
}

/** Every share purchase (as chain indices in chain order) affordable from the bank and cash. */
export function buyOptions(s: TilestockState, seat: Seat): number[][] {
  const sizes = chainSizes(s.board, s.rules.chains.length);
  const active = activeChains(sizes);
  const price = (c: number): number => sharePrice(s.rules, c, sizes[c] ?? 0);
  const cash = s.players[seat]?.cash ?? 0;
  const out: number[][] = [];
  const walk = (from: number, picked: number[], spent: number): void => {
    out.push(picked.slice());
    if (picked.length >= s.rules.maxBuyPerTurn) return;
    for (let i = from; i < active.length; i++) {
      const c = active[i] as number;
      const already = picked.filter((x) => x === c).length;
      if (already >= (s.bank[c] ?? 0) || spent + price(c) > cash) continue;
      picked.push(c);
      walk(i, picked, spent + price(c));
      picked.pop();
    }
  };
  walk(0, [], 0);
  return out;
}

/**
 * Every legal action for `seat`. Exact when the seat's hand is known to the
 * state (always in full mode); empty while a needed tile is still unknown.
 */
export function legalActions(s: TilestockState, seat: Seat): TilestockAction[] {
  const pending = pendingDecision(s);
  if (pending.type !== 'player' || pending.seat !== seat) return [];
  const hand = s.players[seat]?.hand ?? [];
  const phase = s.phase;
  const id = (c: number): string => chainId(s.rules, c);
  switch (phase.kind) {
    case 'place': {
      if (hand.some((h) => h.tile === null)) return [];
      const playable = hand.filter((h) => isPlayable(classifyTile(s.board, s.rules, h.tile as number)));
      if (playable.length === 0) return [{ type: 'skipPlace', actor: seat }];
      return playable.map((h) => ({
        type: 'place',
        actor: seat,
        pos: h.pos,
        tile: tileId(h.tile as number),
      }));
    }
    case 'found': {
      const sizes = chainSizes(s.board, s.rules.chains.length);
      return s.rules.chains.flatMap((_, c) =>
        (sizes[c] ?? 0) === 0 ? [{ type: 'foundChain', actor: seat, chain: id(c) }] : [],
      );
    }
    case 'merger': {
      const m = phase.merger;
      const sizeOf = (c: number): number => m.sizes[m.chains.indexOf(c)] ?? 0;
      if (m.survivor === null) {
        const max = Math.max(...m.sizes);
        return m.chains
          .filter((c) => sizeOf(c) === max)
          .map((c) => ({ type: 'chooseSurvivor', actor: seat, chain: id(c) }));
      }
      if (m.defuncts === null) {
        const rest = defunctCandidates(m);
        const groups: number[][] = [];
        for (const c of rest) {
          const last = groups[groups.length - 1];
          if (last && sizeOf(last[0] as number) === sizeOf(c)) last.push(c);
          else groups.push([c]);
        }
        let orders: number[][] = [[]];
        for (const g of groups) orders = orders.flatMap((o) => permutations(g).map((p) => [...o, ...p]));
        return orders.map((o) => ({ type: 'orderDefunct', actor: seat, order: o.map(id) }));
      }
      const head = m.defuncts[0] as number;
      const held = s.players[seat]?.shares[head] ?? 0;
      const maxPairs = Math.min(Math.floor(held / 2), s.bank[m.survivor] ?? 0);
      const out: TilestockAction[] = [];
      for (let pairs = 0; pairs <= maxPairs; pairs++) {
        for (let sell = 0; sell + 2 * pairs <= held; sell++) {
          out.push({ type: 'dispose', actor: seat, chain: id(head), sell, trade: 2 * pairs });
        }
      }
      return out;
    }
    case 'buy': {
      if (hand.some((h) => h.tile === null)) return [];
      const discard = hand
        .filter((h) => classifyTile(s.board, s.rules, h.tile as number).kind === 'dead')
        .map((h) => ({ pos: h.pos, tile: tileId(h.tile as number) }));
      const declares = s.turn?.endCondition ? [false, true] : [false];
      return buyOptions(s, seat).flatMap((buy) =>
        declares.map((declareEnd) => ({
          type: 'endTurn',
          actor: seat,
          buy: buy.map(id),
          declareEnd,
          discard,
        })),
      );
    }
    default:
      return [];
  }
}
