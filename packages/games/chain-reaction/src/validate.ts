import type { EngineError, Seat } from '@bored-games/game-kit';
import { type ChainReactionRules, chainIndex } from './rules.ts';
import { TILE_COUNT, tileIndex } from './tiles.ts';

/** An action after shape validation, with ids resolved to indices. */
export type ParsedAction =
  | { readonly type: 'reveal'; readonly pos: number; readonly card: number }
  | { readonly type: 'place'; readonly actor: Seat; readonly pos: number; readonly tile: number }
  | { readonly type: 'skipPlace'; readonly actor: Seat }
  | { readonly type: 'foundChain'; readonly actor: Seat; readonly chain: number }
  | { readonly type: 'chooseSurvivor'; readonly actor: Seat; readonly chain: number }
  | { readonly type: 'orderDefunct'; readonly actor: Seat; readonly order: readonly number[] }
  | {
      readonly type: 'dispose';
      readonly actor: Seat;
      readonly chain: number;
      readonly sell: number;
      readonly trade: number;
    }
  | {
      readonly type: 'endTurn';
      readonly actor: Seat;
      readonly buy: readonly number[];
      readonly declareEnd: boolean;
      readonly discard: readonly { readonly pos: number; readonly tile: number }[];
    };

type Parse = { ok: true; action: ParsedAction } | { ok: false; error: EngineError };

const bad = (message: string): Parse => ({ ok: false, error: { code: 'malformed', message } });

const isNat = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

/**
 * Validates shape and canonical form only (rules of play are checked by the
 * engine). Each move has exactly one accepted encoding: exact key sets,
 * integer fields, known ids, buys in chain order, discards by position.
 */
export function parseAction(rules: ChainReactionRules, seats: number, raw: unknown): Parse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bad('action must be an object');
  const a = raw as Record<string, unknown>;
  const actorOk = isNat(a.actor, seats - 1);
  const chain = (v: unknown): number | null => chainIndex(rules, v);
  switch (a.type) {
    case 'reveal': {
      if (!hasExactKeys(a, ['type', 'actor', 'deck', 'pos', 'card'])) return bad('reveal keys');
      if (a.actor !== 'deck' || a.deck !== 'tiles') return bad('reveal must come from the tiles deck');
      if (!isNat(a.pos, TILE_COUNT - 1) || !isNat(a.card, TILE_COUNT - 1)) return bad('reveal pos/card');
      return { ok: true, action: { type: 'reveal', pos: a.pos, card: a.card } };
    }
    case 'place': {
      if (!hasExactKeys(a, ['type', 'actor', 'pos', 'tile']) || !actorOk) return bad('place keys/actor');
      const tile = tileIndex(a.tile);
      if (tile === null || !isNat(a.pos, TILE_COUNT - 1)) return bad('place pos/tile');
      return { ok: true, action: { type: 'place', actor: a.actor as Seat, pos: a.pos, tile } };
    }
    case 'skipPlace': {
      if (!hasExactKeys(a, ['type', 'actor']) || !actorOk) return bad('skipPlace keys/actor');
      return { ok: true, action: { type: 'skipPlace', actor: a.actor as Seat } };
    }
    case 'foundChain':
    case 'chooseSurvivor': {
      if (!hasExactKeys(a, ['type', 'actor', 'chain']) || !actorOk) return bad(`${a.type} keys/actor`);
      const c = chain(a.chain);
      if (c === null) return bad('unknown chain');
      return { ok: true, action: { type: a.type, actor: a.actor as Seat, chain: c } };
    }
    case 'orderDefunct': {
      if (!hasExactKeys(a, ['type', 'actor', 'order']) || !actorOk || !Array.isArray(a.order)) {
        return bad('orderDefunct keys/actor');
      }
      const order: number[] = [];
      for (const id of a.order) {
        const c = chain(id);
        if (c === null || order.includes(c)) return bad('order must list distinct known chains');
        order.push(c);
      }
      return { ok: true, action: { type: 'orderDefunct', actor: a.actor as Seat, order } };
    }
    case 'dispose': {
      if (!hasExactKeys(a, ['type', 'actor', 'chain', 'sell', 'trade']) || !actorOk)
        return bad('dispose keys');
      const c = chain(a.chain);
      if (c === null || !isNat(a.sell, 1000) || !isNat(a.trade, 1000)) return bad('dispose fields');
      return {
        ok: true,
        action: { type: 'dispose', actor: a.actor as Seat, chain: c, sell: a.sell, trade: a.trade },
      };
    }
    case 'endTurn': {
      if (!hasExactKeys(a, ['type', 'actor', 'buy', 'declareEnd', 'discard']) || !actorOk)
        return bad('endTurn keys');
      if (typeof a.declareEnd !== 'boolean' || !Array.isArray(a.buy) || !Array.isArray(a.discard)) {
        return bad('endTurn fields');
      }
      const buy: number[] = [];
      for (const id of a.buy) {
        const c = chain(id);
        if (c === null) return bad('unknown chain in buy');
        if (buy.length > 0 && c < (buy[buy.length - 1] as number)) return bad('buy must be in chain order');
        buy.push(c);
      }
      const discard: { pos: number; tile: number }[] = [];
      for (const d of a.discard) {
        if (
          d === null ||
          typeof d !== 'object' ||
          !hasExactKeys(d as Record<string, unknown>, ['pos', 'tile'])
        ) {
          return bad('discard entry keys');
        }
        const e = d as Record<string, unknown>;
        const tile = tileIndex(e.tile);
        if (tile === null || !isNat(e.pos, TILE_COUNT - 1)) return bad('discard entry fields');
        if (discard.length > 0 && e.pos <= (discard[discard.length - 1] as { pos: number }).pos) {
          return bad('discard must be ascending by position');
        }
        discard.push({ pos: e.pos, tile });
      }
      return {
        ok: true,
        action: { type: 'endTurn', actor: a.actor as Seat, buy, declareEnd: a.declareEnd, discard },
      };
    }
    default:
      return bad('unknown action type');
  }
}
