import {
  type ChainReactionAction,
  type ChainReactionState,
  chainIndex,
  chainReaction,
  chainSizes,
  classifyTile,
  sharePrice,
  tileId,
  viewFor,
} from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  firstLegal,
  playUntil,
  randomLegal,
  type ScriptedGame,
} from '../src/games/chain-reaction/fixture.ts';
import {
  boardCells,
  chainRows,
  type Decision,
  decisionFor,
  describeEvent,
  findDispose,
  findEndTurn,
  formatMoney,
  handTiles,
  lastPlacedTile,
  playerRows,
  resultRows,
  statusLine,
} from '../src/games/chain-reaction/model.ts';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'];

type Kind = Decision['kind'];

/** The seat that must decide now, or null during reveals and after the game. */
function actor(s: ChainReactionState): number | null {
  const p = chainReaction.pending(s);
  return p.type === 'player' ? p.seat : null;
}

function legalFor(s: ChainReactionState): ChainReactionAction[] {
  const seat = actor(s);
  return seat === null ? [] : (chainReaction.legalActions(s, seat) as ChainReactionAction[]);
}

/** A state from a scripted random game where the acting seat faces decision `kind`. */
function findDecision(kind: Kind): ScriptedGame {
  for (let i = 0; i < 200; i++) {
    for (const seats of [3, 4, 6]) {
      const g = playUntil(`k${i}`, seats, randomLegal, (g) => {
        const legal = legalFor(g.state);
        return legal.length > 0 && decisionFor(g.state, legal).kind === kind;
      });
      if (g) return g;
    }
  }
  throw new Error(`no ${kind} decision found`);
}

/** A sequence of states from one scripted game, every `every` steps. */
function samples(seed: string, seats: number, every = 7, max = 400): ScriptedGame[] {
  const out: ScriptedGame[] = [];
  playUntil(seed, seats, randomLegal, (g) => {
    if (g.state.seq % every === 0) out.push(g);
    return g.state.seq >= max;
  });
  return out;
}

const key = (a: unknown): string => canonicalJson(a);
const inLegal = (legal: readonly ChainReactionAction[], a: unknown): boolean =>
  legal.some((l) => key(l) === key(a));

const KINDS: Kind[] = ['place', 'skip', 'found', 'survivor', 'order', 'dispose', 'endTurn'];
const found = new Map(KINDS.map((k) => [k, findDecision(k)]));
const get = (k: Kind): ScriptedGame => found.get(k) as ScriptedGame;

describe('decisionFor', () => {
  it('is a wait when the seat has no legal action', () => {
    const g = get('place');
    expect(decisionFor(g.state, []).kind).toBe('wait');
  });

  for (const kind of KINDS) {
    it(`maps a real ${kind} decision, and its view-mode state, to the same kind`, () => {
      const g = get(kind);
      const legal = legalFor(g.state);
      expect(decisionFor(g.state, legal).kind).toBe(kind);
      const seat = actor(g.state) as number;
      expect(decisionFor(viewFor(g.state, seat), legal).kind).toBe(kind);
    });
  }

  it('place: one option per legal placement, each in legal', () => {
    const g = get('place');
    const legal = legalFor(g.state);
    const d = decisionFor(g.state, legal);
    if (d.kind !== 'place') throw new Error('not place');
    expect(d.options.length).toBe(legal.length);
    for (const o of d.options) {
      expect(inLegal(legal, o.action)).toBe(true);
      expect(o.id).toBe(tileId(o.tile));
    }
  });

  it('skip: submits the legal skip', () => {
    const g = get('skip');
    const legal = legalFor(g.state);
    const d = decisionFor(g.state, legal);
    if (d.kind !== 'skip') throw new Error('not skip');
    expect(inLegal(legal, d.action)).toBe(true);
  });

  for (const kind of ['found', 'survivor'] as const) {
    it(`${kind}: one chain option per legal action, named from the theme`, () => {
      const g = get(kind);
      const legal = legalFor(g.state);
      const d = decisionFor(g.state, legal);
      if (d.kind !== kind) throw new Error(`not ${kind}`);
      expect(d.options.length).toBe(legal.length);
      for (const o of d.options) {
        expect(inLegal(legal, o.action)).toBe(true);
        const themed = (CHAIN_REACTION_THEME.chains as Record<string, { name: string }>)[o.chain.id];
        expect(o.chain.name).toBe(themed?.name);
      }
    });
  }

  it('order: one option per legal defunct order', () => {
    const g = get('order');
    const legal = legalFor(g.state);
    const d = decisionFor(g.state, legal);
    if (d.kind !== 'order') throw new Error('not order');
    expect(d.options.length).toBe(legal.length);
    for (const o of d.options) {
      expect(inLegal(legal, o.action)).toBe(true);
      expect(o.action.type === 'orderDefunct' && o.action.order).toEqual(o.chains.map((c) => c.id));
    }
  });

  it('dispose: every legal (sell, trade) is found exactly; anything else is not', () => {
    const g = get('dispose');
    const legal = legalFor(g.state);
    const d = decisionFor(g.state, legal);
    if (d.kind !== 'dispose') throw new Error('not dispose');
    const seat = actor(g.state) as number;
    const c = chainIndex(g.state.rules, d.chain.id) as number;
    expect(d.held).toBe(g.state.players[seat]?.shares[c]);
    for (const a of legal) {
      if (a.type !== 'dispose') throw new Error('not dispose');
      expect(key(findDispose(d, a.sell, a.trade))).toBe(key(a));
    }
    for (let sell = -1; sell <= d.held + 1; sell++) {
      for (let trade = -1; trade <= d.held + 1; trade++) {
        const a = findDispose(d, sell, trade);
        if (a) expect(inLegal(legal, a)).toBe(true);
        else
          expect(legal.some((l) => l.type === 'dispose' && l.sell === sell && l.trade === trade)).toBe(false);
      }
    }
    expect(findDispose(d, 0.5, 0)).toBeNull();
  });

  it('endTurn: every legal action is found from its counts and declare flag; over-limit buys are not', () => {
    // Many endTurn states, so that buys, declarations and dead-tile discards all show up.
    const seen = { buy: 0, declare: 0, discard: 0 };
    for (const seed of ['e1', 'e2', 'e3']) {
      for (const g of samples(seed, 4, 1, 300)) {
        const legal = legalFor(g.state);
        const d = legal.length > 0 ? decisionFor(g.state, legal) : null;
        if (d?.kind !== 'endTurn') continue;
        for (const a of legal) {
          if (a.type !== 'endTurn') throw new Error('not endTurn');
          const counts = d.chains.map((c) => a.buy.filter((x) => x === c.chain.id).length);
          expect(key(findEndTurn(d, counts, a.declareEnd))).toBe(key(a));
          if (a.buy.length > 0) seen.buy++;
          if (a.declareEnd) seen.declare++;
          if (a.discard.length > 0) seen.discard++;
        }
        expect(d.discard).toEqual((legal[0] as { discard: unknown }).discard);
        const tooMany = d.chains.map(() => g.state.rules.maxBuyPerTurn + 1);
        if (d.chains.length > 0) expect(findEndTurn(d, tooMany, false)).toBeNull();
        expect(findEndTurn(d, [...d.chains.map(() => 0), 0], false)).toBeNull();
        if (!d.canDeclare)
          expect(
            findEndTurn(
              d,
              d.chains.map(() => 0),
              true,
            ),
          ).toBeNull();
      }
    }
    expect(seen.buy).toBeGreaterThan(0);
    expect(seen.declare).toBeGreaterThan(0);
  });

  it('endTurn: a buy limited by cash or bank is reported per chain', () => {
    const g = get('endTurn');
    const legal = legalFor(g.state);
    const d = decisionFor(g.state, legal);
    if (d.kind !== 'endTurn') throw new Error('not endTurn');
    for (const c of d.chains) {
      const most = Math.max(
        0,
        ...legal.map((a) => (a.type === 'endTurn' ? a.buy : []).filter((x) => x === c.chain.id).length),
      );
      expect(c.max).toBe(most);
      const sizes = chainSizes(g.state.board, g.state.rules.chains.length);
      expect(c.price).toBe(sharePrice(g.state.rules, c.chain.index, sizes[c.chain.index] ?? 0));
    }
  });
});

describe('handTiles', () => {
  it('classifies every known tile exactly as classifyTile does, across scripted games', () => {
    let checked = 0;
    for (const g of [...samples('h1', 3), ...samples('h2', 5)]) {
      const s = g.state;
      for (let seat = 0; seat < s.seats; seat++) {
        const hand = handTiles(s, seat);
        expect(hand.map((h) => h.pos)).toEqual(s.players[seat]?.hand.map((h) => h.pos));
        for (const h of hand) {
          if (h.tile === null) continue;
          const cls = classifyTile(s.board, s.rules, h.tile);
          expect(h.cls).toEqual(cls);
          const badge = cls.kind === 'lone' || cls.kind === 'grow' ? 'playable' : cls.kind;
          expect(h.badge).toBe(badge);
          expect(h.id).toBe(tileId(h.tile));
          expect(h.preview.length).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("shows another seat's hidden tiles as unknown in a view", () => {
    const g = get('endTurn');
    const view = viewFor(g.state, 0);
    const other = handTiles(view, 1);
    expect(other.length).toBe(g.state.players[1]?.hand.length);
    for (const h of other) {
      expect(h.tile).toBeNull();
      expect(h.id).toBeNull();
      expect(h.badge).toBeNull();
    }
    expect(handTiles(view, 0).every((h) => h.tile !== null)).toBe(true);
  });
});

describe('chainRows', () => {
  it("matches the engine's sizes, pricing, safety and bank, with my holdings", () => {
    for (const g of samples('c1', 4, 25)) {
      const s = g.state;
      const sizes = chainSizes(s.board, s.rules.chains.length);
      const rows = chainRows(s, 2);
      expect(rows.length).toBe(s.rules.chains.length);
      rows.forEach((r, c) => {
        expect(r.chain.index).toBe(c);
        expect(r.size).toBe(sizes[c]);
        expect(r.price).toBe(sharePrice(s.rules, c, sizes[c] ?? 0));
        expect(r.safe).toBe((sizes[c] ?? 0) >= s.rules.safeSize);
        expect(r.active).toBe((sizes[c] ?? 0) > 0);
        expect(r.bank).toBe(s.bank[c]);
        expect(r.mine).toBe(s.players[2]?.shares[c]);
      });
      expect(chainRows(s, null).every((r) => r.mine === null)).toBe(true);
    }
  });

  it('takes names, labels, colors and patterns from the theme', () => {
    const s = get('place').state;
    for (const r of chainRows(s, null)) {
      const t = (CHAIN_REACTION_THEME.chains as Record<string, Record<string, string>>)[r.chain.id];
      expect([r.chain.name, r.chain.label, r.chain.color, r.chain.pattern]).toEqual([
        t?.name,
        t?.label,
        t?.color,
        t?.pattern,
      ]);
    }
  });
});

describe('boardCells', () => {
  it('describes all 108 cells by kind and chain, and marks the last placed tile', () => {
    const g = get('endTurn');
    const s = g.state;
    const cells = boardCells(s, g.lastTile);
    expect(cells.length).toBe(108);
    cells.forEach((cell, i) => {
      expect(cell.index).toBe(i);
      expect(cell.id).toBe(tileId(i));
      const v = s.board[i];
      if (v === null) expect(cell.kind).toBe('empty');
      else if (v === -1) expect(cell.kind).toBe('loose');
      else if (v !== undefined && v >= 0) {
        expect(cell.kind).toBe('chain');
        expect(cell.chain?.index).toBe(v);
      }
      expect(cell.last).toBe(i === g.lastTile);
    });
    expect(g.lastTile).not.toBeNull();
    expect(cells.filter((c) => c.last).length).toBe(1);
  });

  it('marks the pending tile of a merger as last and pending', () => {
    const g = get('dispose');
    const p = g.state.phase;
    if (p.kind !== 'merger') throw new Error('not a merger');
    const cells = boardCells(g.state, null);
    expect(cells[p.merger.tile]?.kind).toBe('pending');
    expect(cells[p.merger.tile]?.last).toBe(true);
  });
});

describe('playerRows', () => {
  it('shows public cash, shares and hand sizes, the turn and the acting seat', () => {
    const g = get('dispose');
    const s = g.state;
    const rows = playerRows(s, NAMES, 1);
    expect(rows.map((r) => r.name)).toEqual(NAMES.slice(0, s.seats));
    rows.forEach((r, seat) => {
      const p = s.players[seat];
      expect([r.cash, r.shares, r.handSize]).toEqual([p?.cash, p?.shares, p?.hand.length]);
      expect(r.turn).toBe(s.turn?.seat === seat);
      expect(r.acting).toBe(actor(s) === seat);
      expect(r.me).toBe(seat === 1);
    });
  });

  it('falls back to a seat name when none is given', () => {
    const rows = playerRows(get('place').state, [], null);
    expect(rows[0]?.name).toBe('Seat 1');
  });
});

describe('results and status', () => {
  it('lists places and final cash in place order', () => {
    const g = playUntil('over', 3, randomLegal, (g) => g.state.phase.kind === 'over', 5000);
    if (!g?.state.result) throw new Error('no finished game');
    const rows = resultRows(g.state, NAMES);
    expect(rows.map((r) => r.place)).toEqual([...rows.map((r) => r.place)].sort((a, b) => a - b));
    for (const r of rows) {
      expect(r.cash).toBe(g.state.result.cash[r.seat]);
      expect(r.place).toBe(g.state.result.places[r.seat]);
    }
    expect(statusLine(g.state, NAMES, 0)).toMatch(/over/i);
  });

  it('says whose decision it is', () => {
    const g = get('dispose');
    const seat = actor(g.state) as number;
    expect(statusLine(g.state, NAMES, seat)).toMatch(/^Your /);
    expect(statusLine(g.state, NAMES, (seat + 1) % g.state.seats)).toContain(NAMES[seat]);
  });
});

describe('describeEvent', () => {
  it('writes one themed line per event of a whole game, never a raw chain id', () => {
    const g = playUntil('log', 4, randomLegal, (g) => g.state.phase.kind === 'over', 5000);
    if (!g) throw new Error('no finished game');
    const types = new Set<string>();
    for (const e of g.events) {
      const line = describeEvent(e, NAMES);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/\b[bsp][1-3]\b/);
      expect(line).not.toContain('\n');
      types.add(e.type);
    }
    expect(types.size).toBeGreaterThan(10);
  });
});

describe('helpers', () => {
  it('finds the last placed tile in an event list', () => {
    const g = playUntil('last', 3, firstLegal, (g) => g.state.seq > 30);
    expect(g?.lastTile).toBe(lastPlacedTile(g?.events ?? []));
    expect(lastPlacedTile([])).toBeNull();
  });

  it('formats money with thousands separators', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(6000)).toBe('$6,000');
    expect(formatMoney(1234500)).toBe('$1,234,500');
    expect(formatMoney(-300)).toBe('-$300');
  });
});
