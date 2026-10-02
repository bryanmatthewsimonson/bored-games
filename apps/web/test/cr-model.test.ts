import {
  type ChainReactionAction,
  type ChainReactionEvent,
  type ChainReactionState,
  chainIndex,
  chainReaction,
  chainSizes,
  classifyTile,
  DEFAULT_RULES,
  sharePrice,
  tileId,
  viewFor,
} from '@bored-games/chain-reaction';
import { CHAIN_REACTION_THEME } from '@bored-games/chain-reaction/theme';
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  firstLegal,
  newGame,
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
  handBadgesShown,
  handTiles,
  LOG_LINES,
  lastPlacedTile,
  lastTileOf,
  logLines,
  myHoldings,
  newlyPlacedTile,
  playerRows,
  priceCard,
  priceRowOf,
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
        return legal.length > 0 && decisionFor(CHAIN_REACTION_THEME, g.state, legal).kind === kind;
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
    expect(decisionFor(CHAIN_REACTION_THEME, g.state, []).kind).toBe('wait');
  });

  for (const kind of KINDS) {
    it(`maps a real ${kind} decision, and its view-mode state, to the same kind`, () => {
      const g = get(kind);
      const legal = legalFor(g.state);
      expect(decisionFor(CHAIN_REACTION_THEME, g.state, legal).kind).toBe(kind);
      const seat = actor(g.state) as number;
      expect(decisionFor(CHAIN_REACTION_THEME, viewFor(g.state, seat), legal).kind).toBe(kind);
    });
  }

  it('place: one option per legal placement, each in legal', () => {
    const g = get('place');
    const legal = legalFor(g.state);
    const d = decisionFor(CHAIN_REACTION_THEME, g.state, legal);
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
    const d = decisionFor(CHAIN_REACTION_THEME, g.state, legal);
    if (d.kind !== 'skip') throw new Error('not skip');
    expect(inLegal(legal, d.action)).toBe(true);
  });

  for (const kind of ['found', 'survivor'] as const) {
    it(`${kind}: one chain option per legal action, named from the theme`, () => {
      const g = get(kind);
      const legal = legalFor(g.state);
      const d = decisionFor(CHAIN_REACTION_THEME, g.state, legal);
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
    const d = decisionFor(CHAIN_REACTION_THEME, g.state, legal);
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
    const d = decisionFor(CHAIN_REACTION_THEME, g.state, legal);
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
        const d = legal.length > 0 ? decisionFor(CHAIN_REACTION_THEME, g.state, legal) : null;
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
    const d = decisionFor(CHAIN_REACTION_THEME, g.state, legal);
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
        const hand = handTiles(CHAIN_REACTION_THEME, s, seat);
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
    const other = handTiles(CHAIN_REACTION_THEME, view, 1);
    expect(other.length).toBe(g.state.players[1]?.hand.length);
    for (const h of other) {
      expect(h.tile).toBeNull();
      expect(h.id).toBeNull();
      expect(h.badge).toBeNull();
    }
    expect(handTiles(CHAIN_REACTION_THEME, view, 0).every((h) => h.tile !== null)).toBe(true);
  });
});

describe('chainRows', () => {
  it("matches the engine's sizes, pricing, safety and bank, with my holdings", () => {
    for (const g of samples('c1', 4, 25)) {
      const s = g.state;
      const sizes = chainSizes(s.board, s.rules.chains.length);
      const rows = chainRows(CHAIN_REACTION_THEME, s, 2);
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
      expect(chainRows(CHAIN_REACTION_THEME, s, null).every((r) => r.mine === null)).toBe(true);
    }
  });

  it('takes names, labels, colors and patterns from the theme', () => {
    const s = get('place').state;
    for (const r of chainRows(CHAIN_REACTION_THEME, s, null)) {
      const t = (
        CHAIN_REACTION_THEME.chains as Record<
          string,
          { name: string; label: string; color: string; pattern: string }
        >
      )[r.chain.id];
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
    const cells = boardCells(CHAIN_REACTION_THEME, s, g.lastTile);
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
    const cells = boardCells(CHAIN_REACTION_THEME, g.state, null);
    expect(cells[p.merger.tile]?.kind).toBe('pending');
    expect(cells[p.merger.tile]?.last).toBe(true);
  });
});

describe('playerRows', () => {
  /** States from scripted games where some seat holds shares: the hidden fields must matter. */
  const holdingStates = (): ChainReactionState[] =>
    [...samples('p1', 4, 9), ...samples('p2', 5, 11)]
      .map((g) => g.state)
      .filter((s) => s.phase.kind !== 'over' && s.players.some((p) => p.shares.some((n) => n > 0)));

  /** The chain ids a seat holds, in chain order. */
  const heldIds = (s: ChainReactionState, seat: number): string[] =>
    (s.players[seat]?.shares ?? []).flatMap((n, c) => (n > 0 ? [s.rules.chains[c]?.id ?? '?'] : []));

  it('shows hand sizes, the turn and the acting seat', () => {
    const g = get('dispose');
    const s = g.state;
    const rows = playerRows(CHAIN_REACTION_THEME, s, NAMES, 1);
    expect(rows.map((r) => r.name)).toEqual(NAMES.slice(0, s.seats));
    rows.forEach((r, seat) => {
      expect(r.handSize).toBe(s.players[seat]?.hand.length);
      expect(r.turn).toBe(s.turn?.seat === seat);
      expect(r.acting).toBe(actor(s) === seat);
      expect(r.me).toBe(seat === 1);
    });
  });

  it('shows my cash and holdings exactly, and only which chains others hold and whether they have cash', () => {
    const states = holdingStates();
    expect(states.length).toBeGreaterThan(10);
    let hiddenHoldings = 0;
    for (const s of states) {
      const mySeat = 1;
      const rows = playerRows(CHAIN_REACTION_THEME, viewFor(s, mySeat), NAMES, mySeat);
      rows.forEach((r, seat) => {
        const p = s.players[seat];
        if (!p) throw new Error('no player');
        expect(r.hasCash).toBe(p.cash > 0);
        expect(r.shares.map((h) => h.chain.id)).toEqual(heldIds(s, seat));
        if (seat === mySeat) {
          expect(r.exact).toBe(true);
          expect(r.cash).toBe(p.cash);
          expect(r.shares.map((h) => h.count)).toEqual(p.shares.filter((n) => n > 0));
        } else {
          expect(r.exact).toBe(false);
          expect(r.cash).toBeNull();
          for (const h of r.shares) expect(h.count).toBeNull();
          hiddenHoldings += r.shares.length;
        }
      });
    }
    expect(hiddenHoldings).toBeGreaterThan(0);
  });

  it('hides every row from a spectator', () => {
    for (const s of holdingStates()) {
      for (const r of playerRows(CHAIN_REACTION_THEME, s, NAMES, null)) {
        expect(r.exact).toBe(false);
        expect(r.cash).toBeNull();
        expect(r.shares.every((h) => h.count === null)).toBe(true);
        expect(r.hasCash).toBe((s.players[r.seat]?.cash ?? 0) > 0);
      }
    }
  });

  it('shows everything exactly once the game is over, to players and spectators', () => {
    const g = playUntil('p-over', 4, randomLegal, (g) => g.state.phase.kind === 'over', 5000);
    if (!g) throw new Error('no finished game');
    const s = g.state;
    for (const mySeat of [null, 0, 2]) {
      playerRows(CHAIN_REACTION_THEME, s, NAMES, mySeat).forEach((r, seat) => {
        const p = s.players[seat];
        expect(r.exact).toBe(true);
        expect(r.cash).toBe(p?.cash);
        expect(r.shares.map((h) => h.count)).toEqual(p?.shares.filter((n) => n > 0));
      });
    }
  });

  it('falls back to a seat name when none is given', () => {
    const rows = playerRows(CHAIN_REACTION_THEME, get('place').state, [], null);
    expect(rows[0]?.name).toBe('Seat 1');
  });
});

describe('handBadgesShown', () => {
  it("is on only for the viewer's own place or skip decision, never on another seat's turn", () => {
    let others = 0;
    for (const g of samples('badges', 4, 3)) {
      const s = g.state;
      const acting = actor(s);
      for (let seat = 0; seat < s.seats; seat++) {
        const legal = seat === acting ? legalFor(s) : [];
        const d = decisionFor(CHAIN_REACTION_THEME, s, legal);
        expect(handBadgesShown(d)).toBe(d.kind === 'place' || d.kind === 'skip');
        if (s.phase.kind === 'place' && seat !== acting) {
          expect(handBadgesShown(d)).toBe(false);
          others++;
        }
        if (s.phase.kind === 'place' && seat === acting) expect(handBadgesShown(d)).toBe(true);
      }
    }
    expect(others).toBeGreaterThan(10);
  });
});

describe('myHoldings', () => {
  it('values my shares at the current prices, with cash, share value and net worth', () => {
    let lines = 0;
    for (const g of [...samples('h1', 4, 9), ...samples('h2', 5, 11)]) {
      const full = g.state;
      if (full.phase.kind === 'over') continue;
      for (const mySeat of [0, 2]) {
        const s = viewFor(full, mySeat);
        const h = myHoldings(CHAIN_REACTION_THEME, s, mySeat);
        if (h === null) throw new Error('no holdings');
        const p = full.players[mySeat];
        if (!p) throw new Error('no player');
        const sizes = chainSizes(s.board, s.rules.chains.length);
        expect(h.cash).toBe(p.cash);
        expect(h.lines.map((l) => l.chain.index)).toEqual(p.shares.flatMap((n, c) => (n > 0 ? [c] : [])));
        for (const l of h.lines) {
          const size = sizes[l.chain.index] ?? 0;
          expect(l.count).toBe(p.shares[l.chain.index]);
          expect(l.onBoard).toBe(size > 0);
          expect(l.price).toBe(size > 0 ? sharePrice(s.rules, l.chain.index, size) : 0);
          expect(l.value).toBe(l.count * l.price);
          lines++;
        }
        const shareValue = h.lines.reduce((sum, l) => sum + l.value, 0);
        expect(h.shareValue).toBe(shareValue);
        expect(h.netWorth).toBe(p.cash + shareValue);
      }
    }
    expect(lines).toBeGreaterThan(10);
  });

  it('lists a chain that is not on the board at $0', () => {
    // A state with one chain on the board and another not.
    const s = samples('h3', 4, 5)
      .map((g) => g.state)
      .find((x) => {
        const n = chainSizes(x.board, x.rules.chains.length);
        return n.some((k) => k === 0) && n.some((k) => k > 0);
      });
    if (!s) throw new Error('no state');
    const sizes = chainSizes(s.board, s.rules.chains.length);
    const off = sizes.indexOf(0);
    const on = sizes.findIndex((n) => n > 0);
    const shares = s.rules.chains.map((_, c) => (c === off ? 3 : c === on ? 2 : 0));
    const mine = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, cash: 1234, shares } : p)) };
    const h = myHoldings(CHAIN_REACTION_THEME, mine, 0);
    const price = sharePrice(s.rules, on, sizes[on] ?? 0);
    expect(h?.lines.map((l) => [l.chain.index, l.count, l.onBoard, l.price, l.value])).toEqual(
      [
        [off, 3, false, 0, 0],
        [on, 2, true, price, 2 * price],
      ].sort((a, b) => (a[0] as number) - (b[0] as number)),
    );
    expect(h?.shareValue).toBe(2 * price);
    expect(h?.netWorth).toBe(1234 + 2 * price);
  });

  it('is empty of lines without shares, and null for a spectator', () => {
    const s = newGame('holdings-start', 4).state;
    const h = myHoldings(CHAIN_REACTION_THEME, s, 1);
    expect(h?.lines).toEqual([]);
    expect(h?.shareValue).toBe(0);
    expect(h?.netWorth).toBe(h?.cash);
    expect(myHoldings(CHAIN_REACTION_THEME, s, null)).toBeNull();
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
    expect(statusLine(CHAIN_REACTION_THEME, g.state, NAMES, 0)).toMatch(/over/i);
  });

  it('says whose decision it is', () => {
    const g = get('dispose');
    const seat = actor(g.state) as number;
    expect(statusLine(CHAIN_REACTION_THEME, g.state, NAMES, seat)).toMatch(/^Your /);
    expect(statusLine(CHAIN_REACTION_THEME, g.state, NAMES, (seat + 1) % g.state.seats)).toContain(
      NAMES[seat],
    );
  });
});

describe('describeEvent', () => {
  it('writes one themed line per event of a whole game, never a raw chain id', () => {
    const g = playUntil('log', 4, randomLegal, (g) => g.state.phase.kind === 'over', 5000);
    if (!g) throw new Error('no finished game');
    const types = new Set<string>();
    for (const e of g.events) {
      const line = describeEvent(CHAIN_REACTION_THEME, e, NAMES);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/\b[bsp][1-3]\b/);
      expect(line).not.toContain('\n');
      types.add(e.type);
    }
    expect(types.size).toBeGreaterThan(10);
  });
});

describe('logLines', () => {
  const game = () => {
    const g = playUntil('loglines', 3, firstLegal, (g) => g.state.seq > 30);
    if (!g) throw new Error('no game');
    return g;
  };
  const exact = (mySeat: number | null = null) => ({
    theme: CHAIN_REACTION_THEME,
    mySeat,
    over: true,
    names: NAMES,
  });

  it('describes the session events in order, newest last', () => {
    const g = game();
    const events: readonly unknown[] = g.events;
    expect(logLines(events, exact())).toEqual(
      g.events.slice(-LOG_LINES).map((e) => describeEvent(CHAIN_REACTION_THEME, e, NAMES)),
    );
    expect(logLines([], exact())).toEqual([]);
  });

  it('keeps only the newest lines', () => {
    const g = game();
    expect(g.events.length).toBeGreaterThan(5);
    const lines = logLines(g.events, exact(), 5);
    expect(lines).toEqual(g.events.slice(-5).map((e) => describeEvent(CHAIN_REACTION_THEME, e, NAMES)));
    const many = Array.from({ length: 250 }, (_, i) => ({ type: 'turnStarted', seat: 0, turn: i + 1 }));
    const capped = logLines(many, exact());
    expect(capped).toHaveLength(LOG_LINES);
    expect(capped.at(-1)).toBe('Turn 250: Ann.');
    expect(capped[0]).toBe('Turn 151: Ann.');
  });

  it('skips anything that is not an engine event', () => {
    const lines = logLines(
      [null, 7, { no: 'type' }, { type: 'mystery' }, { type: 'firstPlayer', seat: 1 }],
      exact(),
    );
    expect(lines).toEqual(['Bo goes first.']);
  });

  it('finds the last placed tile in the session events', () => {
    const g = game();
    expect(lastTileOf(g.events)).toBe(g.lastTile);
    expect(lastTileOf([null, { type: 'firstPlayer', seat: 0 }])).toBeNull();
  });

  describe("hides others' amounts outside the last two turns", () => {
    const turn = (n: number, seat: number) => ({ type: 'turnStarted', seat, turn: n });
    const disposed = (seat: number, sell: number, trade: number, keep: number, capped = false) => ({
      type: 'sharesDisposed',
      seat,
      chain: 's1',
      sell,
      trade,
      keep,
      proceeds: sell * 300,
      tradeCapped: capped,
    });
    // Turn 1 (Ann): a purchase. Turn 2 (Bo): a merger. Turn 3 (Cy): a purchase. Turn 4 (Ann): a purchase.
    const events = [
      turn(1, 0),
      { type: 'sharesBought', seat: 0, shares: ['b1', 'b1', 'b2'], cost: 1100 },
      turn(2, 1),
      { type: 'survivorChosen', chain: 'b1', tied: false },
      { type: 'bonusPaid', chain: 's1', seat: 1, amount: 3000, role: 'majority', final: false },
      { type: 'bonusPaid', chain: 's1', seat: 2, amount: 1500, role: 'minority', final: false },
      disposed(1, 2, 0, 0),
      disposed(2, 0, 2, 0),
      disposed(0, 1, 2, 1, true),
      disposed(0, 0, 0, 3),
      { type: 'sharesBought', seat: 1, shares: [], cost: 0 },
      turn(3, 2),
      { type: 'sharesBought', seat: 2, shares: ['s2'], cost: 400 },
      turn(4, 0),
      { type: 'sharesBought', seat: 0, shares: ['s2', 's2'], cost: 800 },
    ];

    it('as a spectator, at turn 4: turns 1 and 2 lose their amounts, turns 3 and 4 keep them', () => {
      expect(
        logLines(events, { theme: CHAIN_REACTION_THEME, mySeat: null, over: false, names: NAMES }),
      ).toEqual([
        'Turn 1: Ann.',
        'Ann bought Jade and Lapis shares.',
        'Turn 2: Bo.',
        'Jade survives.',
        'Bo received a bonus for Onyx.',
        'Cy received a bonus for Onyx.',
        'Bo sold some Onyx shares.',
        'Cy traded Onyx shares for Jade.',
        'Ann sold some, traded some for Jade and kept the rest of their Onyx shares.',
        'Ann kept their Onyx shares.',
        'Bo bought no shares.',
        'Turn 3: Cy.',
        'Cy bought 1 Quartz for $400.',
        'Turn 4: Ann.',
        'Ann bought 2 Quartz for $800.',
      ]);
    });

    it('my own lines stay exact forever', () => {
      const lines = logLines(events, { theme: CHAIN_REACTION_THEME, mySeat: 0, over: false, names: NAMES });
      expect(lines[1]).toBe('Ann bought 2 Jade and 1 Lapis for $1,100.');
      expect(lines[8]).toBe('Ann sold 1 for $300, traded 2 (limited by the bank) and kept 1 of Onyx.');
      expect(lines[9]).toBe('Ann kept 3 of Onyx.');
      expect(lines[4]).toBe('Bo received a bonus for Onyx.');
      expect(lines[6]).toBe('Bo sold some Onyx shares.');
    });

    it('a merger belongs to the turn it happens in', () => {
      // At turn 3, turn 2 is the previous turn: its merger lines keep their amounts; turn 1 does not.
      const lines = logLines(events.slice(0, -2), {
        theme: CHAIN_REACTION_THEME,
        mySeat: null,
        over: false,
        names: NAMES,
      });
      expect(lines[1]).toBe('Ann bought Jade and Lapis shares.');
      expect(lines[4]).toBe('Bo received $3,000, the majority bonus for Onyx.');
      expect(lines[6]).toBe('Bo sold 2 for $600 of Onyx.');
      expect(lines[7]).toBe('Cy traded 2 of Onyx.');
    });

    it('everything is exact once the game is over', () => {
      expect(
        logLines(events, { theme: CHAIN_REACTION_THEME, mySeat: null, over: true, names: NAMES }),
      ).toEqual(events.map((e) => describeEvent(CHAIN_REACTION_THEME, e as ChainReactionEvent, NAMES)));
    });

    it("drops a founding line's share total on older turns, for every viewer", () => {
      // keptShares sums every player's shares of the chain, so it is hidden even from the founder.
      const founded = [
        turn(1, 0),
        { type: 'chainFounded', seat: 0, chain: 'p1', size: 2, keptShares: 3 },
        turn(2, 1),
        { type: 'chainFounded', seat: 1, chain: 'p2', size: 3, keptShares: 4 },
        turn(3, 2),
      ];
      for (const mySeat of [null, 0, 1]) {
        expect(logLines(founded, { theme: CHAIN_REACTION_THEME, mySeat, over: false, names: NAMES })).toEqual(
          [
            'Turn 1: Ann.',
            'Ann founded Sapphire with 2 tiles.',
            'Turn 2: Bo.',
            'Bo founded Topaz with 3 tiles (4 old shares still held).',
            'Turn 3: Cy.',
          ],
        );
        expect(logLines(founded, { theme: CHAIN_REACTION_THEME, mySeat, over: true, names: NAMES })[1]).toBe(
          'Ann founded Sapphire with 2 tiles (3 old shares still held).',
        );
      }
    });
  });

  it('in a real game, keeps exact lines for the last two turns and mine, and no digits in older lines of others', () => {
    const g = playUntil('loglines-hide', 4, randomLegal, (g) => (g.state.turn?.number ?? 0) >= 40, 5000);
    if (!g) throw new Error('no game');
    const mySeat = 1;
    const lines = logLines(
      g.events,
      { theme: CHAIN_REACTION_THEME, mySeat, over: false, names: NAMES },
      Number.POSITIVE_INFINITY,
    );
    expect(lines).toHaveLength(g.events.length);
    const current = g.state.turn?.number ?? 0;
    let t = 0;
    const seen = { hidden: 0, recent: 0, mine: 0 };
    const AMOUNTS = new Set(['sharesBought', 'sharesDisposed', 'bonusPaid', 'finalSale']);
    g.events.forEach((e, i) => {
      if (e.type === 'turnStarted') t = e.turn;
      const line = lines[i] as string;
      const seat = 'seat' in e ? e.seat : null;
      if (e.type === 'chainFounded' && t < current - 1) {
        expect(line).toBe(
          describeEvent(CHAIN_REACTION_THEME, e, NAMES).replace(/ \(\d+ old shares? still held\)/, ''),
        );
        expect(line).not.toContain('old share');
        return;
      }
      if (!AMOUNTS.has(e.type) || t >= current - 1 || seat === mySeat) {
        expect(line).toBe(describeEvent(CHAIN_REACTION_THEME, e, NAMES));
        if (AMOUNTS.has(e.type) && t >= current - 1) seen.recent++;
        if (AMOUNTS.has(e.type) && seat === mySeat) seen.mine++;
      } else {
        expect(line).not.toMatch(/\d|\$/);
        if (line !== describeEvent(CHAIN_REACTION_THEME, e, NAMES)) seen.hidden++;
      }
    });
    expect(seen.hidden).toBeGreaterThan(10);
    expect(seen.recent).toBeGreaterThan(0);
    expect(seen.mine).toBeGreaterThan(0);
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

describe('newlyPlacedTile', () => {
  it('finds the one cell a step fills, and nothing for no change or several', () => {
    const g = playUntil('placed', 3, firstLegal, (x) => (x.state.turn?.number ?? 0) >= 3);
    if (!g) throw new Error('no game');
    const s = g.state;
    const empty = s.board.indexOf(null);
    const next = { ...s, board: s.board.map((c, i) => (i === empty ? -1 : c)) } as ChainReactionState;
    expect(newlyPlacedTile(s, next)).toBe(empty);
    expect(newlyPlacedTile(s, s)).toBeNull();
    expect(newlyPlacedTile(null, s)).toBeNull();
    const two = { ...s, board: s.board.map((c) => (c === null ? -1 : c)) } as ChainReactionState;
    expect(newlyPlacedTile(s, two)).toBeNull();
  });
});

describe('priceCard', () => {
  // The share price table of docs/games/chain-reaction/RULES.md, by tier, one entry per size bracket.
  const LABELS = ['2', '3', '4', '5', '6–10', '11–20', '21–30', '31–40', '41+'];
  const TABLE = {
    budget: [200, 300, 400, 500, 600, 700, 800, 900, 1000],
    standard: [300, 400, 500, 600, 700, 800, 900, 1000, 1100],
    premium: [400, 500, 600, 700, 800, 900, 1000, 1100, 1200],
  };
  const card = priceCard(CHAIN_REACTION_THEME, DEFAULT_RULES);
  const theme = CHAIN_REACTION_THEME.chains as Record<string, { name: string }>;

  it('has one row per size bracket, with exact labels', () => {
    expect(card.rows.map((r) => r.label)).toEqual(LABELS);
    expect(card.rows[0]).toMatchObject({ min: 2, max: 2 });
    expect(card.rows[4]).toMatchObject({ min: 6, max: 10 });
    expect(card.rows[8]).toMatchObject({ min: 41, max: null });
  });

  it('heads three tiers with their themed chains, in rules order', () => {
    expect(card.tiers.map((t) => t.tier)).toEqual(['budget', 'standard', 'premium']);
    expect(card.tiers.map((t) => t.name)).toEqual(['Budget', 'Standard', 'Premium']);
    expect(card.tiers.map((t) => t.chains.map((c) => c.id))).toEqual([
      ['b1', 'b2'],
      ['s1', 's2', 's3'],
      ['p1', 'p2'],
    ]);
    for (const t of card.tiers) for (const c of t.chains) expect(c.name).toBe(theme[c.id]?.name);
  });

  it('matches the RULES.md price table in every bracket and tier, with 10× and 5× bonuses', () => {
    card.tiers.forEach((t, ti) => {
      card.rows.forEach((row, ri) => {
        const price = TABLE[t.tier][ri] as number;
        expect(row.cells[ti], `${t.tier} ${row.label}`).toEqual({
          price,
          majority: 10 * price,
          minority: 5 * price,
        });
        // The card agrees with the engine for every size in the bracket.
        for (let size = row.min; size <= (row.max ?? row.min + 10); size++)
          expect(sharePrice(DEFAULT_RULES, t.chains[0]?.index ?? -1, size)).toBe(price);
      });
    });
    // Spot checks: rows 2, 6–10 and 41+.
    expect(card.rows[0]?.cells.map((c) => c.price)).toEqual([200, 300, 400]);
    expect(card.rows[4]?.cells).toEqual([
      { price: 600, majority: 6000, minority: 3000 },
      { price: 700, majority: 7000, minority: 3500 },
      { price: 800, majority: 8000, minority: 4000 },
    ]);
    expect(card.rows[8]?.cells.map((c) => [c.majority, c.minority])).toEqual([
      [10000, 5000],
      [11000, 5500],
      [12000, 6000],
    ]);
  });

  it('follows the rules multipliers', () => {
    const r = { ...DEFAULT_RULES, majorityMultiplier: 7, minorityMultiplier: 3 };
    expect(priceCard(CHAIN_REACTION_THEME, r).rows[0]?.cells[0]).toEqual({
      price: 200,
      majority: 1400,
      minority: 600,
    });
  });

  it('finds the row a chain size is priced at', () => {
    expect([0, 1].map((n) => priceRowOf(DEFAULT_RULES, n))).toEqual([null, null]);
    expect([2, 5, 6, 10, 11, 40, 41, 108].map((n) => priceRowOf(DEFAULT_RULES, n))).toEqual([
      0, 3, 4, 4, 5, 7, 8, 8,
    ]);
  });
});
