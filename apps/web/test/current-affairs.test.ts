/*
 * The Current Affairs game screen (D091), without a browser: the decision of each phase (putting a station up,
 * bidding, buying fuel, wiring, firing), the status and history lines, the companies, the final count, the rules
 * page and the registration. States come from the engine, with chosen dice, so every case is a reachable position.
 */
import {
  type CurrentAction,
  type CurrentState,
  currentAffairs,
  legalActions,
  pendingOf,
} from '@bored-games/current-affairs';
import { COMPARE_PHRASE } from '@bored-games/current-affairs/compare';
import { h } from 'preact';
import { describe, expect, it } from 'vitest';
import {
  CurrentAffairsGame,
  CurrentTable,
  EMPTY_UI,
  type TableProps,
  type Ui,
} from '../src/games/current-affairs/game.tsx';
import {
  basketOf,
  bestFiring,
  companyRows,
  logLine,
  offersOf,
  refuelBasket,
  stackText,
  statusLine,
} from '../src/games/current-affairs/model.ts';
import { CurrentAffairsRulesPage, CurrentRulesContent } from '../src/games/current-affairs/rules-page.tsx';
import { webGame } from '../src/games/registry.ts';
import { findAll, renderTree, textOf } from './render-tree.ts';

const NAMES = ['Ada', 'Bo', 'Cy'];

function applied(s: CurrentState, a: unknown): CurrentState {
  const r = currentAffairs.apply(s, a);
  if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error.message}`);
  return r.state;
}

/** Every share and roll the dice owe, each die showing `face` (the first face picks the first choice). */
function rollAll(s0: CurrentState, face = 1): CurrentState {
  let s = s0;
  for (let p = pendingOf(s); ; p = pendingOf(s)) {
    if (p.type === 'player' && p.decision === 'contribute')
      s = applied(s, { type: 'contribute', actor: p.seat, id: s.roll?.id });
    else if (p.type === 'beacon')
      s = applied(s, {
        type: 'rolled',
        actor: 'beacon',
        id: p.id,
        dice: Array(s.roll?.count ?? 1).fill(face),
      });
    else return s;
  }
}

const act = (s: CurrentState, a: CurrentAction): CurrentState => rollAll(applied(s, a));

function started(seats = 3): CurrentState {
  const r = currentAffairs.setup({
    rules: currentAffairs.defaultRules(),
    seats,
    mode: 'full',
    deckOrders: {},
  });
  if (!r.ok) throw new Error(r.error.message);
  return rollAll(r.value);
}

const seatOf = (s: CurrentState): number => {
  const p = pendingOf(s);
  if (p.type !== 'player') throw new Error('no decision');
  return p.seat;
};

/** Round 1's auction: each company in turn puts up the lowest station on offer and the others fold. */
function afterAuction(seats = 3): CurrentState {
  let s = started(seats);
  while (s.phase === 'auction') {
    const seat = seatOf(s);
    if (s.lot === null) {
      const station = legalActions(s, seat).find((a) => a.type === 'open');
      if (station === undefined) throw new Error('nothing to open');
      s = act(s, station);
    } else s = act(s, { type: 'fold', actor: seat });
  }
  return s;
}

const table = (s: CurrentState, me: number | null, ui: Partial<Ui> = {}, extra: Partial<TableProps> = {}) =>
  renderTree(
    h(CurrentTable, {
      state: s,
      me,
      names: NAMES,
      avatars: [],
      legal: me === null ? [] : legalActions(s, me),
      enabled: true,
      ui: { ...EMPTY_UI, ...ui },
      onUi: () => {},
      onSend: () => {},
      ...extra,
    }),
  );

const actions = (tree: ReturnType<typeof renderTree>) =>
  findAll(
    tree,
    (el) => el.tag === 'button' && el.attrs['data-action'] !== undefined && el.attrs.disabled !== true,
  ).map((b) => JSON.parse(String(b.attrs['data-action'])) as CurrentAction);

describe('the auction', () => {
  it('opens round 1 with the regions and the order drawn, and the lowest four stations on offer', () => {
    const s = started();
    expect(s.phase).toBe('auction');
    expect(s.regions).toHaveLength(3);
    const first = seatOf(s);
    const offers = offersOf(s, first, legalActions(s, first));
    expect(offers.opens).toEqual([3, 4, 5, 6]);
    expect(offers.pass).toBe(false);
    expect(statusLine(s, NAMES, first)).toBe('You put a station up for auction.');
    expect(statusLine(s, NAMES, null)).toBe(`${NAMES[first]} puts a station up for auction.`);
    expect(stackText(s)).toBe('Stack: 26 to draw, then the Era III card (8 out unseen).');
    // Four cards to pick from; no bid until one is picked; then the opening bid at its number.
    const tree = table(s, first);
    expect(findAll(tree, (el) => el.attrs['data-station'] !== undefined)).toHaveLength(4);
    expect(actions(tree).filter((a) => a.type === 'open')).toEqual([]);
    expect(textOf(tree)).toMatch(/every company buys one in the first round/);
    expect(actions(table(s, first, { station: 5, bid: 9 }))).toContainEqual({
      type: 'open',
      actor: first,
      station: 5,
      bid: 9,
    });
    // A bid above the company's money is held at its money.
    expect(actions(table(s, first, { station: 5, bid: 900 }))).toContainEqual({
      type: 'open',
      actor: first,
      station: 5,
      bid: 50,
    });
    // Nobody else may act.
    const other = (first + 1) % 3;
    expect(actions(table(s, other))).toEqual([]);
  });

  it('bidding: the raises, any other raise, and a fold', () => {
    const s0 = started();
    const opener = seatOf(s0);
    const s = act(s0, { type: 'open', actor: opener, station: 4, bid: 4 });
    const bidder = seatOf(s);
    expect(s.lot?.station).toBe(4);
    expect(statusLine(s, NAMES, bidder)).toBe(`Station 4: ${NAMES[opener]} leads at $4; you raise or fold.`);
    const sent = actions(table(s, bidder, { raise: 12 }));
    expect(sent).toEqual([
      { type: 'bid', actor: bidder, amount: 5 },
      { type: 'bid', actor: bidder, amount: 9 },
      { type: 'bid', actor: bidder, amount: 14 },
      { type: 'bid', actor: bidder, amount: 12 },
      { type: 'fold', actor: bidder },
    ]);
    // A raise the list does not offer is still accepted by the engine.
    expect(currentAffairs.validateIntent?.(s, bidder, { type: 'bid', actor: bidder, amount: 12 }).ok).toBe(
      true,
    );
    // Everyone sees who is still in.
    expect(textOf(table(s, null))).toMatch(/Still bidding|to bid/);
  });
});

describe('fuel, wiring and payday', () => {
  it('fuel: the basket defaults to enough to fire every station, and its cost is the cheapest units', () => {
    const s = afterAuction();
    expect(s.phase).toBe('fuel');
    const seat = seatOf(s);
    const c = s.companies[seat];
    expect(c?.stations).toHaveLength(1);
    const refuel = refuelBasket(s, seat);
    expect(refuel).not.toBeNull();
    const sent = actions(table(s, seat));
    const buy = sent.find((a) => a.type === 'fuel');
    expect(buy).toEqual({ type: 'fuel', actor: seat, buy: refuel });
    expect(sent).toContainEqual({ type: 'done', actor: seat });
    expect(basketOf(s, seat, [0, 0, 0, 0]).problem).toMatch(/Choose fuel/);
    expect(basketOf(s, seat, [0, 0, 9, 9]).problem).not.toBeNull();
    // A purchase the list does not spell out goes through validateIntent.
    const one = [0, 0, 0, 0];
    const st = c?.stations[0] ?? 3;
    one[st === 3 ? 1 : 0] = 1;
    if (basketOf(s, seat, one).problem === null)
      expect(currentAffairs.validateIntent?.(s, seat, { type: 'fuel', actor: seat, buy: one }).ok).toBe(true);
    expect(statusLine(s, NAMES, seat)).toBe('You buy fuel.');
  });

  it('wiring: the cheapest cities as buttons, and done', () => {
    let s = afterAuction();
    while (s.phase === 'fuel') s = act(s, { type: 'done', actor: seatOf(s) });
    expect(s.phase).toBe('build');
    const seat = seatOf(s);
    const offers = offersOf(s, seat, legalActions(s, seat));
    // Every city in play costs $10 for a first substation.
    expect(offers.builds.size).toBe(21);
    expect([...offers.builds.values()].every((cost) => cost === 10)).toBe(true);
    const sent = actions(table(s, seat));
    expect(sent.filter((a) => a.type === 'build')).toHaveLength(8);
    expect(sent).toContainEqual({ type: 'done', actor: seat });
    expect(statusLine(s, NAMES, null)).toBe(`${NAMES[seat]} wires cities.`);
    const city = [...offers.builds.keys()][0] as number;
    const t = act(s, { type: 'build', actor: seat, city });
    expect(logLine(t.history.at(-1) as never, NAMES)).toMatch(
      new RegExp(`^${NAMES[seat]} wires .+ for \\$10\\.$`),
    );
    // The second city costs its line too.
    const next = offersOf(t, seat, legalActions(t, seat));
    expect([...next.builds.values()].every((cost) => cost > 10)).toBe(true);
  });

  it('payday: the best firing first, and the pay', () => {
    let s = afterAuction();
    // Everyone buys the fuel to fire, then wires one city.
    while (s.phase === 'fuel') {
      const seat = seatOf(s);
      const refuel = refuelBasket(s, seat);
      s = act(
        s,
        refuel === null ? { type: 'done', actor: seat } : { type: 'fuel', actor: seat, buy: refuel },
      );
    }
    while (s.phase === 'build') {
      const seat = seatOf(s);
      const c = s.companies[seat];
      const build = legalActions(s, seat).find((a) => a.type === 'build');
      s = act(s, (c?.cities.length ?? 0) === 0 && build ? build : { type: 'done', actor: seat });
    }
    expect(s.phase).toBe('power');
    const seat = seatOf(s);
    const c = s.companies[seat];
    if (c === undefined) throw new Error('no company');
    const best = bestFiring(c);
    expect(best.stations).toEqual(c.stations);
    const sent = actions(table(s, seat));
    expect(sent).toEqual([
      { type: 'power', actor: seat, stations: [...c.stations], hybridCoal: best.hybridCoal },
    ]);
    expect(textOf(table(s, seat))).toMatch(/Powers\s+1\s+city.*paid\s*\$22/);
    // Firing nothing is offered when the stations are untoggled.
    expect(actions(table(s, seat, { fire: [] }))).toEqual([
      { type: 'power', actor: seat, stations: [], hybridCoal: 0 },
    ]);
    expect(statusLine(s, NAMES, seat)).toBe('Payday: you fire your stations.');
    const paid = act(s, sent[0] as CurrentAction);
    expect(paid.history.some((e) => e.kind === 'power' && e.seat === seat && e.paid === 22)).toBe(true);
  });
});

describe('the companies, the history and the end', () => {
  it('counts each company and writes the history in plain words', () => {
    const s = afterAuction();
    const rows = companyRows(s, NAMES);
    expect(rows.map((r) => [r.cities, r.left, r.stations.length])).toEqual([
      [0, 22, 1],
      [0, 22, 1],
      [0, 22, 1],
    ]);
    expect(rows.map((r) => r.position).sort()).toEqual([1, 2, 3]);
    expect(logLine({ kind: 'won', seat: 1, station: 13, price: 15 }, NAMES)).toBe(
      'Bo buys station 13 for $15.',
    );
    expect(logLine({ kind: 'fuel', seat: 0, bought: [2, 1, 0, 0], cost: 7 }, NAMES)).toBe(
      'Ada buys 2 coal, 1 oil for $7.',
    );
    expect(logLine({ kind: 'built', seat: 2, city: 0, cost: 10 }, NAMES)).toBe('Cy wires Icebridge for $10.');
    expect(logLine({ kind: 'power', seat: 0, powered: 3, paid: 44 }, NAMES)).toBe(
      'Ada powers 3 cities and is paid $44.',
    );
    expect(logLine({ kind: 'regions', regions: [0, 1, 4] }, NAMES)).toBe(
      'The regions in play: Frostmere, Highcopper and Heartfield.',
    );
    expect(logLine({ kind: 'era', era: 2 }, NAMES)).toBe('Era II begins.');
    expect(logLine({ kind: 'scrap', seat: 1, station: 4, lost: [2, 0, 0, 0] }, NAMES)).toBe(
      'Bo scraps station 4, dropping 2 coal.',
    );
    expect(logLine({ kind: 'restock', added: [5, 3, 2, 1] }, NAMES)).toBe(
      'The fuel yard is restocked with 5 coal, 3 oil, 2 waste, 1 uranium.',
    );
    // The table shows every company and the history.
    const text = textOf(table(s, 0));
    for (const name of NAMES.slice(1)) expect(text).toContain(name);
    expect(text).toMatch(/What happened/);
    expect(text).toMatch(/buys station/);
  });

  it('shows the final count when the game is over', () => {
    const s0 = afterAuction();
    const s: CurrentState = {
      ...s0,
      phase: 'over',
      queue: [],
      result: { places: [2, 1, 3], scores: [5, 7, 2], reason: 'cities' },
    };
    expect(statusLine(s, NAMES, 1)).toBe('Game over. You win, powering 7 cities.');
    expect(statusLine(s, NAMES, 0)).toBe('Game over. Bo wins, powering 7 cities.');
    const text = textOf(table(s, 0));
    expect(text).toMatch(/The final count/);
    expect(actions(table(s, 0))).toEqual([]);
  });
});

describe('the rules page and the registration', () => {
  it('writes the rules with every station and the compare link', () => {
    const tree = renderTree(h(CurrentRulesContent, {}));
    const text = textOf(tree);
    expect(text).toContain(COMPARE_PHRASE);
    for (const heading of [
      '1. Standings',
      '2. Auction',
      '3. Fuel',
      '4. Wiring',
      '5. Payday',
      'The three eras',
    ])
      expect(text).toContain(heading);
    expect(text).toMatch(/Resign\s+is always open/);
  });

  it('registers the game without a setup phase or an automatic move', () => {
    const game = webGame('current-affairs');
    expect(game?.Component).toBe(CurrentAffairsGame);
    expect(game?.RulesPage).toBe(CurrentAffairsRulesPage);
    expect(game?.setupCopy(false)).toBeNull();
    expect(game?.autoMove).toBeUndefined();
  });
});
