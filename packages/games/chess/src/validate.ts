import type { EngineError, Seat } from '@bored-games/game-kit';

/** An action after shape validation. */
export type ParsedAction =
  | { readonly type: 'move'; readonly actor: Seat; readonly uci: string; readonly offerDraw: boolean }
  | { readonly type: 'acceptDraw'; readonly actor: Seat };

type Parse = { ok: true; action: ParsedAction } | { ok: false; error: EngineError };

const bad = (message: string): Parse => ({ ok: false, error: { code: 'malformed', message } });

/** UCI long algebraic: from, to, and a lowercase promotion letter when promoting. */
export const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

/**
 * Validates shape and canonical form only; legality is the engine's job. Every
 * move has exactly one accepted encoding: exact key sets, an integer seat,
 * lowercase UCI, and `offerDraw` present only as `true`.
 */
export function parseAction(raw: unknown): Parse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return bad('action must be an object');
  const a = raw as Record<string, unknown>;
  const actorOk = a.actor === 0 || a.actor === 1;
  switch (a.type) {
    case 'move': {
      const offer = Object.hasOwn(a, 'offerDraw');
      if (!hasExactKeys(a, offer ? ['type', 'actor', 'uci', 'offerDraw'] : ['type', 'actor', 'uci']))
        return bad('move keys are type, actor, uci and optionally offerDraw');
      if (!actorOk) return bad('actor must be seat 0 or 1');
      if (offer && a.offerDraw !== true) return bad('offerDraw is present only as true');
      if (typeof a.uci !== 'string' || !UCI_PATTERN.test(a.uci)) return bad('uci must be long algebraic');
      return { ok: true, action: { type: 'move', actor: a.actor as Seat, uci: a.uci, offerDraw: offer } };
    }
    case 'acceptDraw': {
      if (!hasExactKeys(a, ['type', 'actor'])) return bad('acceptDraw keys are type and actor');
      if (!actorOk) return bad('actor must be seat 0 or 1');
      return { ok: true, action: { type: 'acceptDraw', actor: a.actor as Seat } };
    }
    default:
      return bad('unknown action type');
  }
}
