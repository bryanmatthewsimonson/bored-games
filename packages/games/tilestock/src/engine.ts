import type { ApplyResult, EngineError, Result, Seat, SetupInput } from '@bored-games/game-kit';
import { activeChains, chainSizes, classifyTile, endCondition, flood, isPlayable } from './board.ts';
import { bonusPayouts, sharePrice } from './pricing.ts';
import { chainId, type TilestockRules, validateRules } from './rules.ts';
import { compareCloseness, TILE_COUNT, tileId } from './tiles.ts';
import {
  type Cell,
  type HandSlot,
  LOOSE,
  type MergerState,
  PENDING,
  type Phase,
  type PlayerState,
  type TilestockEvent,
  type TilestockState,
  type TurnState,
} from './types.ts';
import { type ParsedAction, parseAction } from './validate.ts';

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

type Draft = DeepMutable<TilestockState>;
type Events = TilestockEvent[];

const err = (code: string, message: string): EngineError => ({ code, message });

/**
 * Copies every part a handler may mutate. `rules` and `deck.order` are never
 * mutated, so they are shared with the input. Key order is preserved so that
 * equal states serialize identically.
 */
function clone(s: TilestockState): Draft {
  const phase = s.phase;
  return {
    ...s,
    deck: { order: s.deck.order, next: s.deck.next },
    setupTiles: s.setupTiles.slice(),
    board: s.board.slice(),
    players: s.players.map((p) => ({
      cash: p.cash,
      shares: p.shares.slice(),
      hand: p.hand.map((h) => ({ pos: h.pos, tile: h.tile })),
    })),
    bank: s.bank.slice(),
    discard: s.discard.slice(),
    turn: s.turn ? { ...s.turn } : null,
    phase:
      phase.kind === 'merger'
        ? {
            kind: 'merger',
            merger: {
              ...phase.merger,
              chains: phase.merger.chains.slice(),
              sizes: phase.merger.sizes.slice(),
              defuncts: phase.merger.defuncts ? phase.merger.defuncts.slice() : null,
              holders: phase.merger.holders ? phase.merger.holders.slice() : null,
            },
          }
        : { ...phase },
  } as Draft;
}

// ---------------------------------------------------------------- setup

export function setupGame(input: SetupInput<TilestockRules>): Result<TilestockState> {
  const r = validateRules(input.rules);
  if (!r.ok) return r;
  const rules = r.value;
  if (!Number.isInteger(input.seats) || input.seats < rules.minPlayers || input.seats > rules.maxPlayers) {
    return {
      ok: false,
      error: err('seats', `seats must be within ${rules.minPlayers}..${rules.maxPlayers}`),
    };
  }
  let order: number[] | null = null;
  if (input.mode === 'full') {
    const o = input.deckOrders.tiles;
    if (!Array.isArray(o) || o.length !== TILE_COUNT || new Set(o).size !== TILE_COUNT) {
      return { ok: false, error: err('deck', 'tiles deck order must be a permutation of 108 tiles') };
    }
    if (!o.every((t) => Number.isInteger(t) && t >= 0 && t < TILE_COUNT)) {
      return { ok: false, error: err('deck', 'tile out of range') };
    }
    order = o.slice();
  } else if (
    input.viewer !== null &&
    !(Number.isInteger(input.viewer) && input.viewer >= 0 && input.viewer < input.seats)
  ) {
    return { ok: false, error: err('viewer', 'viewer must be a seat or null') };
  }
  const players: PlayerState[] = [];
  for (let s = 0; s < input.seats; s++) {
    players.push({ cash: rules.startingCash, shares: rules.chains.map(() => 0), hand: [] });
  }
  return {
    ok: true,
    value: {
      game: 'tilestock',
      rules,
      seats: input.seats,
      mode: input.mode,
      viewer: input.mode === 'full' ? null : input.viewer,
      // Positions 0..seats-1 are the setup tiles, revealed publicly in seat order.
      deck: { order, next: input.seats },
      setupTiles: players.map(() => null),
      board: new Array<Cell>(TILE_COUNT).fill(null),
      players,
      bank: rules.chains.map(() => rules.sharesPerChain),
      discard: [],
      firstPlayer: null,
      turn: null,
      phase: { kind: 'setup' },
      stall: 0,
      result: null,
      seq: 0,
    },
  };
}

// ---------------------------------------------------------------- helpers

function sizesOf(d: Draft | TilestockState): number[] {
  return chainSizes(d.board, d.rules.chains.length);
}

/** True when `tile` already has a known location (board, discard, or a known hand slot other than `except`). */
function tileKnownElsewhere(
  d: Draft | TilestockState,
  tile: number,
  except: { seat: Seat; pos: number } | null,
): boolean {
  if (d.board[tile] !== null || d.discard.includes(tile)) return true;
  for (let s = 0; s < d.players.length; s++) {
    for (const slot of d.players[s]?.hand ?? []) {
      if (slot.tile === tile && !(except && except.seat === s && except.pos === slot.pos)) return true;
    }
  }
  return false;
}

function drawTo(d: Draft, seat: Seat, count: number): number[] {
  const player = d.players[seat] as DeepMutable<PlayerState>;
  const positions: number[] = [];
  for (let i = 0; i < count && d.deck.next < TILE_COUNT; i++) {
    const pos = d.deck.next++;
    player.hand.push({ pos, tile: d.deck.order ? (d.deck.order[pos] as number) : null });
    positions.push(pos);
  }
  return positions;
}

function startTurn(d: Draft, seat: Seat, number: number, events: Events): void {
  d.turn = { seat, number, placed: false, endCondition: endCondition(d.board, d.rules) };
  d.phase = { kind: 'place' };
  events.push({ type: 'turnStarted', seat, turn: number });
}

function enterBuy(d: Draft): void {
  d.phase = { kind: 'buy' };
  const turn = d.turn as DeepMutable<TurnState>;
  if (turn.endCondition === null) turn.endCondition = endCondition(d.board, d.rules);
}

function holdersFrom(d: Draft, start: Seat, chain: number): Seat[] {
  const out: Seat[] = [];
  for (let k = 0; k < d.seats; k++) {
    const seat = (start + k) % d.seats;
    if ((d.players[seat]?.shares[chain] ?? 0) > 0) out.push(seat);
  }
  return out;
}

function payBonuses(d: Draft, chain: number, price: number, final: boolean, events: Events): void {
  const holdings = d.players.map((p) => p.shares[chain] ?? 0);
  const payouts = bonusPayouts(d.rules, holdings, price);
  if (payouts.length === 0) events.push({ type: 'noBonus', chain: chainId(d.rules, chain), final });
  for (const p of payouts) {
    (d.players[p.seat] as DeepMutable<PlayerState>).cash += p.amount;
    events.push({
      type: 'bonusPaid',
      chain: chainId(d.rules, chain),
      seat: p.seat,
      amount: p.amount,
      role: p.role,
      final,
    });
  }
}

function finalScore(d: Draft, reason: 'declared' | 'stall', events: Events): void {
  const sizes = sizesOf(d);
  const active = activeChains(sizes);
  for (const c of active) payBonuses(d, c, sharePrice(d.rules, c, sizes[c] ?? 0), true, events);
  for (let seat = 0; seat < d.seats; seat++) {
    const player = d.players[seat] as DeepMutable<PlayerState>;
    for (const c of active) {
      const count = player.shares[c] ?? 0;
      if (count === 0) continue;
      const amount = count * sharePrice(d.rules, c, sizes[c] ?? 0);
      player.cash += amount;
      player.shares[c] = 0;
      d.bank[c] = (d.bank[c] ?? 0) + count;
      events.push({ type: 'finalSale', seat, chain: chainId(d.rules, c), count, amount });
    }
  }
  const cash = d.players.map((p) => p.cash);
  const places = cash.map((v) => 1 + cash.filter((o) => o > v).length);
  d.result = { reason, cash, places };
  d.phase = { kind: 'over' };
  events.push({ type: 'gameEnded', reason, cash, places });
}

// ---------------------------------------------------------------- automatic steps

function completeMerger(d: Draft, m: DeepMutable<MergerState>, events: Events): void {
  const survivor = m.survivor as number;
  const involved = new Set(m.chains);
  const tiles = flood(
    d.board,
    m.tile,
    (cell) => cell === LOOSE || cell === PENDING || (cell !== null && involved.has(cell)),
  );
  for (const t of tiles) d.board[t] = survivor;
  events.push({
    type: 'mergerCompleted',
    survivor: chainId(d.rules, survivor),
    size: sizesOf(d)[survivor] ?? 0,
  });
  enterBuy(d);
}

/** Advances a merger until it needs a decision. Returns false when nothing more is automatic. */
function stepMerger(d: Draft, events: Events): boolean {
  const phase = d.phase as Extract<DeepMutable<Phase>, { kind: 'merger' }>;
  const m = phase.merger;
  const sizeOf = (c: number): number => m.sizes[m.chains.indexOf(c)] ?? 0;
  if (m.survivor === null) {
    const max = Math.max(...m.sizes);
    const candidates = m.chains.filter((c) => sizeOf(c) === max);
    if (candidates.length > 1) return false;
    m.survivor = candidates[0] as number;
    events.push({ type: 'survivorChosen', chain: chainId(d.rules, m.survivor), tied: false });
    return true;
  }
  if (m.defuncts === null) {
    const rest = defunctCandidates(m);
    if (hasSizeTie(rest, sizeOf)) return false;
    m.defuncts = rest;
    events.push({ type: 'defunctOrder', order: rest.map((c) => chainId(d.rules, c)), tied: false });
    return true;
  }
  const head = m.defuncts[0];
  if (head === undefined) {
    completeMerger(d, m, events);
    return false;
  }
  if (m.holders === null) {
    payBonuses(d, head, sharePrice(d.rules, head, sizeOf(head)), false, events);
    m.holders = holdersFrom(d, m.mergemaker, head);
    return true;
  }
  if (m.holders.length === 0) {
    events.push({ type: 'chainDefunct', chain: chainId(d.rules, head) });
    m.defuncts.shift();
    m.holders = null;
    return true;
  }
  return false;
}

export function defunctCandidates(m: Pick<MergerState, 'chains' | 'sizes' | 'survivor'>): number[] {
  const sizeOf = (c: number): number => m.sizes[m.chains.indexOf(c)] ?? 0;
  return m.chains.filter((c) => c !== m.survivor).sort((a, b) => sizeOf(b) - sizeOf(a) || a - b);
}

function hasSizeTie(chains: readonly number[], sizeOf: (c: number) => number): boolean {
  for (let i = 1; i < chains.length; i++)
    if (sizeOf(chains[i] as number) === sizeOf(chains[i - 1] as number)) return true;
  return false;
}

function advance(d: Draft, events: Events): void {
  for (let guard = 0; guard < 1000; guard++) {
    if (d.phase.kind === 'setup' && d.setupTiles.every((t) => t !== null)) {
      const tiles = d.setupTiles as number[];
      let first = 0;
      for (let s = 1; s < d.seats; s++) {
        if (compareCloseness(d.rules.firstPlayerOrder, tiles[s] as number, tiles[first] as number) < 0)
          first = s;
      }
      d.firstPlayer = first;
      events.push({ type: 'firstPlayer', seat: first });
      for (let k = 0; k < d.seats; k++) {
        const seat = (first + k) % d.seats;
        events.push({ type: 'tilesDealt', seat, positions: drawTo(d, seat, d.rules.handSize) });
      }
      startTurn(d, first, 1, events);
      continue;
    }
    if (d.phase.kind === 'merger' && stepMerger(d, events)) continue;
    return;
  }
  throw new Error('advance() exceeded its step budget');
}

// ---------------------------------------------------------------- handlers

function handle(d: Draft, a: ParsedAction, events: Events): EngineError | null {
  const turn = d.turn as DeepMutable<TurnState> | null;
  const phase = d.phase;
  const isTurnSeat = (actor: Seat): boolean => turn !== null && turn.seat === actor;

  switch (a.type) {
    case 'reveal': {
      if (phase.kind !== 'setup') return err('phase', 'no reveal is pending');
      const expected = d.setupTiles.indexOf(null);
      if (a.pos !== expected) return err('reveal', `expected a reveal of position ${expected}`);
      if (d.deck.order && d.deck.order[a.pos] !== a.card)
        return err('reveal', 'card does not match the deck');
      if (tileKnownElsewhere(d, a.card, null))
        return err('conflict', `${tileId(a.card)} is already accounted for`);
      d.setupTiles[a.pos] = a.card;
      d.board[a.card] = LOOSE;
      events.push({ type: 'setupTileRevealed', seat: a.pos, tile: tileId(a.card) });
      return null;
    }

    case 'place': {
      if (phase.kind !== 'place' || !turn) return err('phase', 'not time to place a tile');
      if (!isTurnSeat(a.actor)) return err('actor', 'not your turn');
      const player = d.players[a.actor] as DeepMutable<PlayerState>;
      const idx = player.hand.findIndex((h) => h.pos === a.pos);
      const slot = player.hand[idx];
      if (!slot) return err('hand', 'that position is not in your hand');
      if (slot.tile !== null && slot.tile !== a.tile) return err('hand', 'tile does not match that position');
      if (slot.tile === null && tileKnownElsewhere(d, a.tile, null)) {
        return err('conflict', `${tileId(a.tile)} is already accounted for`);
      }
      if (d.board[a.tile] !== null) return err('conflict', 'that space is occupied');
      const cls = classifyTile(d.board, d.rules, a.tile);
      if (!isPlayable(cls)) return err('unplayable', `${tileId(a.tile)} is ${cls.kind}`);
      player.hand.splice(idx, 1);
      turn.placed = true;
      events.push({ type: 'tilePlaced', seat: a.actor, tile: tileId(a.tile), kind: cls.kind as 'lone' });
      if (cls.kind === 'lone') {
        d.board[a.tile] = LOOSE;
        enterBuy(d);
      } else if (cls.kind === 'grow') {
        d.board[a.tile] = cls.chain;
        for (const t of flood(d.board, a.tile, (cell) => cell === LOOSE)) d.board[t] = cls.chain;
        const size = sizesOf(d)[cls.chain] ?? 0;
        events.push({
          type: 'chainGrew',
          chain: chainId(d.rules, cls.chain),
          size,
          safe: size >= d.rules.safeSize,
        });
        enterBuy(d);
      } else if (cls.kind === 'found') {
        d.board[a.tile] = PENDING;
        d.phase = { kind: 'found', tile: a.tile };
      } else if (cls.kind === 'merge') {
        const all = sizesOf(d);
        const sizes = cls.chains.map((c) => all[c] ?? 0);
        d.board[a.tile] = PENDING;
        d.phase = {
          kind: 'merger',
          merger: {
            tile: a.tile,
            mergemaker: a.actor,
            chains: [...cls.chains],
            sizes,
            survivor: null,
            defuncts: null,
            holders: null,
          },
        };
        events.push({
          type: 'mergerStarted',
          seat: a.actor,
          tile: tileId(a.tile),
          chains: cls.chains.map((c) => chainId(d.rules, c)),
          sizes,
          safeChains: sizes.filter((s) => s >= d.rules.safeSize).length,
        });
      }
      return null;
    }

    case 'skipPlace': {
      if (phase.kind !== 'place' || !turn) return err('phase', 'not time to place a tile');
      if (!isTurnSeat(a.actor)) return err('actor', 'not your turn');
      const hand = d.players[a.actor]?.hand ?? [];
      // With unknown tiles (an opponent in a live view), honesty is verified by the post-game audit.
      if (hand.every((h) => h.tile !== null)) {
        if (hand.some((h) => isPlayable(classifyTile(d.board, d.rules, h.tile as number)))) {
          return err('playable', 'you hold a playable tile');
        }
      }
      events.push({ type: 'placementSkipped', seat: a.actor });
      enterBuy(d);
      return null;
    }

    case 'foundChain': {
      if (phase.kind !== 'found' || !turn) return err('phase', 'no chain is being founded');
      if (!isTurnSeat(a.actor)) return err('actor', 'not your turn');
      if ((sizesOf(d)[a.chain] ?? 0) > 0) return err('chain', 'that chain is already on the board');
      const tiles = flood(d.board, phase.tile, (cell) => cell === LOOSE || cell === PENDING);
      for (const t of tiles) d.board[t] = a.chain;
      const keptShares = d.players.reduce((sum, p) => sum + (p.shares[a.chain] ?? 0), 0);
      const id = chainId(d.rules, a.chain);
      events.push({ type: 'chainFounded', seat: a.actor, chain: id, size: tiles.length, keptShares });
      const grant = Math.min(d.rules.founderShares, d.bank[a.chain] ?? 0);
      const player = d.players[a.actor] as DeepMutable<PlayerState>;
      player.shares[a.chain] = (player.shares[a.chain] ?? 0) + grant;
      d.bank[a.chain] = (d.bank[a.chain] ?? 0) - grant;
      events.push({ type: 'founderShare', seat: a.actor, chain: id, granted: grant > 0 });
      enterBuy(d);
      return null;
    }

    case 'chooseSurvivor': {
      if (phase.kind !== 'merger' || phase.merger.survivor !== null)
        return err('phase', 'no survivor choice pending');
      const m = phase.merger;
      if (a.actor !== m.mergemaker) return err('actor', 'only the mergemaker chooses the survivor');
      const max = Math.max(...m.sizes);
      const candidates = m.chains.filter((_, i) => m.sizes[i] === max);
      if (!candidates.includes(a.chain)) return err('chain', 'survivor must be one of the largest chains');
      m.survivor = a.chain;
      events.push({ type: 'survivorChosen', chain: chainId(d.rules, a.chain), tied: true });
      return null;
    }

    case 'orderDefunct': {
      if (phase.kind !== 'merger' || phase.merger.survivor === null || phase.merger.defuncts !== null) {
        return err('phase', 'no defunct order pending');
      }
      const m = phase.merger;
      if (a.actor !== m.mergemaker) return err('actor', 'only the mergemaker orders defunct chains');
      const rest = defunctCandidates(m);
      const sizeOf = (c: number): number => m.sizes[m.chains.indexOf(c)] ?? 0;
      if (a.order.length !== rest.length || !rest.every((c) => a.order.includes(c))) {
        return err('order', 'order must list every defunct chain once');
      }
      for (let i = 1; i < a.order.length; i++) {
        if (sizeOf(a.order[i] as number) > sizeOf(a.order[i - 1] as number)) {
          return err('order', 'larger defunct chains resolve first');
        }
      }
      m.defuncts = [...a.order];
      events.push({ type: 'defunctOrder', order: a.order.map((c) => chainId(d.rules, c)), tied: true });
      return null;
    }

    case 'dispose': {
      if (phase.kind !== 'merger') return err('phase', 'no disposal pending');
      const m = phase.merger;
      const head = m.defuncts?.[0];
      if (!m.holders || m.holders.length === 0 || head === undefined)
        return err('phase', 'no disposal pending');
      if (a.actor !== m.holders[0]) return err('actor', 'not your disposal decision');
      if (a.chain !== head) return err('chain', 'dispose of the chain being resolved');
      const survivor = m.survivor as number;
      const player = d.players[a.actor] as DeepMutable<PlayerState>;
      const held = player.shares[head] ?? 0;
      if (a.trade % 2 !== 0) return err('trade', 'trades are two defunct shares for one survivor share');
      if (a.sell + a.trade > held) return err('shares', 'you do not hold that many shares');
      const bankSurvivor = d.bank[survivor] ?? 0;
      if (a.trade / 2 > bankSurvivor) return err('trade', 'not enough survivor shares in the bank');
      const price = sharePrice(d.rules, head, m.sizes[m.chains.indexOf(head)] ?? 0);
      const proceeds = a.sell * price;
      player.cash += proceeds;
      player.shares[head] = held - a.sell - a.trade;
      player.shares[survivor] = (player.shares[survivor] ?? 0) + a.trade / 2;
      d.bank[head] = (d.bank[head] ?? 0) + a.sell + a.trade;
      d.bank[survivor] = bankSurvivor - a.trade / 2;
      m.holders.shift();
      events.push({
        type: 'sharesDisposed',
        seat: a.actor,
        chain: chainId(d.rules, head),
        sell: a.sell,
        trade: a.trade,
        keep: held - a.sell - a.trade,
        proceeds,
        tradeCapped: Math.floor(held / 2) > bankSurvivor,
      });
      return null;
    }

    case 'endTurn': {
      if (phase.kind !== 'buy' || !turn) return err('phase', 'not time to end the turn');
      if (!isTurnSeat(a.actor)) return err('actor', 'not your turn');
      const player = d.players[a.actor] as DeepMutable<PlayerState>;
      const sizes = sizesOf(d);

      if (a.buy.length > d.rules.maxBuyPerTurn)
        return err('buy', `at most ${d.rules.maxBuyPerTurn} shares per turn`);
      let cost = 0;
      for (const c of a.buy) {
        if ((sizes[c] ?? 0) === 0) return err('buy', `${chainId(d.rules, c)} is not on the board`);
        cost += sharePrice(d.rules, c, sizes[c] ?? 0);
      }
      for (const c of new Set(a.buy)) {
        if (a.buy.filter((x) => x === c).length > (d.bank[c] ?? 0))
          return err('buy', 'not enough shares in the bank');
      }
      if (cost > player.cash) return err('buy', 'not enough cash');
      if (a.declareEnd && turn.endCondition === null)
        return err('declare', 'no end condition has been met this turn');

      for (const entry of a.discard) {
        const slot = player.hand.find((h) => h.pos === entry.pos);
        if (!slot) return err('discard', 'that position is not in your hand');
        if (slot.tile !== null && slot.tile !== entry.tile)
          return err('discard', 'tile does not match that position');
        if (slot.tile === null && tileKnownElsewhere(d, entry.tile, null)) {
          return err('conflict', `${tileId(entry.tile)} is already accounted for`);
        }
        if (classifyTile(d.board, d.rules, entry.tile).kind !== 'dead')
          return err('discard', `${tileId(entry.tile)} is not dead`);
      }
      if (new Set(a.discard.map((e) => e.tile)).size !== a.discard.length)
        return err('discard', 'duplicate tile');
      if (player.hand.every((h) => h.tile !== null)) {
        const dead = player.hand.filter(
          (h) => classifyTile(d.board, d.rules, h.tile as number).kind === 'dead',
        );
        if (dead.length !== a.discard.length) return err('discard', 'every dead tile held must be discarded');
      }

      // Buy, then (at the end of the turn) replace dead tiles and draw.
      if (a.buy.length > 0) {
        player.cash -= cost;
        for (const c of a.buy) {
          player.shares[c] = (player.shares[c] ?? 0) + 1;
          d.bank[c] = (d.bank[c] ?? 0) - 1;
        }
        events.push({
          type: 'sharesBought',
          seat: a.actor,
          shares: a.buy.map((c) => chainId(d.rules, c)),
          cost,
        });
      }
      if (a.declareEnd)
        events.push({ type: 'endDeclared', seat: a.actor, condition: turn.endCondition as 'endSize' });
      if (a.discard.length > 0) {
        const positions = new Set(a.discard.map((e) => e.pos));
        player.hand = player.hand.filter((h) => !positions.has(h.pos));
        for (const e of a.discard) d.discard.push(e.tile);
        d.discard.sort((x, y) => x - y);
        events.push({ type: 'tilesDiscarded', seat: a.actor, tiles: a.discard.map((e) => tileId(e.tile)) });
      }
      if (a.declareEnd) {
        finalScore(d, 'declared', events);
        return null;
      }
      const drawn = drawTo(d, a.actor, d.rules.handSize - player.hand.length);
      if (drawn.length > 0) events.push({ type: 'tilesDealt', seat: a.actor, positions: drawn });
      d.stall = turn.placed ? 0 : d.stall + 1;
      if (d.rules.stallRule === 'emptyBagFullRound' && d.deck.next >= TILE_COUNT && d.stall >= d.seats) {
        finalScore(d, 'stall', events);
        return null;
      }
      startTurn(d, (a.actor + 1) % d.seats, turn.number + 1, events);
      return null;
    }
  }
}

export function applyAction(s: TilestockState, raw: unknown): ApplyResult<TilestockState, TilestockEvent> {
  if (s.phase.kind === 'over') return { ok: false, error: err('over', 'the game is over') };
  const parsed = parseAction(s.rules, s.seats, raw);
  if (!parsed.ok) return parsed;
  const d = clone(s);
  const events: Events = [];
  const problem = handle(d, parsed.action, events);
  if (problem) return { ok: false, error: problem };
  advance(d, events);
  d.seq++;
  return { ok: true, state: d as TilestockState, events };
}

// ---------------------------------------------------------------- private knowledge

export function learnTile(
  s: TilestockState,
  learn: { deck: string; pos: number; card: number },
): ApplyResult<TilestockState, TilestockEvent> {
  if (s.mode !== 'view' || s.viewer === null)
    return { ok: false, error: err('learn', 'only a player view can learn') };
  if (learn.deck !== 'tiles' || !Number.isInteger(learn.card) || learn.card < 0 || learn.card >= TILE_COUNT) {
    return { ok: false, error: err('learn', 'bad learn record') };
  }
  const viewer = s.viewer;
  const slot = s.players[viewer]?.hand.find((h) => h.pos === learn.pos);
  if (!slot) return { ok: false, error: err('learn', 'that position is not in your hand') };
  if (slot.tile === learn.card) return { ok: true, state: s, events: [] };
  if (slot.tile !== null) return { ok: false, error: err('learn', 'conflicting card for that position') };
  if (tileKnownElsewhere(s, learn.card, null))
    return { ok: false, error: err('conflict', 'tile already accounted for') };
  const d = clone(s);
  const hand = (d.players[viewer] as DeepMutable<PlayerState>).hand as DeepMutable<HandSlot>[];
  for (const h of hand) if (h.pos === learn.pos) h.tile = learn.card;
  return { ok: true, state: d as TilestockState, events: [] };
}
