import type {
  ApplyResult,
  GameModule,
  Learn,
  Outcome,
  Pending,
  Result,
  SetupInput,
} from '@bored-games/game-kit';
import { canonicalJson as canonical, packetOrderFits } from '@bored-games/game-kit';
import type { Kind } from './cards.ts';
import { BASE, CARDS, DECK, INTRO, KINDS, KINGDOM, kindOf, OFFSETS, STRIDE, validCard } from './cards.ts';
import type { GiltAction, GiltEvent, GiltState, Rules, Slot, Task } from './types.ts';

const err = (message: string) => ({ code: 'illegal', message });
const no = (message: string) => ({ ok: false as const, error: err(message) });
const yes = (s: GiltState): ApplyResult<GiltState, GiltEvent> => ({ ok: true, state: s, events: [] });
const clone = (s: GiltState): GiltState => JSON.parse(JSON.stringify(s));
const keys = (a: Record<string, unknown>, names: string[]) =>
  Object.keys(a).sort().join(',') === names.sort().join(',');
function at(s: GiltState, pos: number): number | null {
  return s.orders[Math.floor(pos / STRIDE)]?.[pos % STRIDE] ?? null;
}
export function scores(s: GiltState): number[] {
  return s.players.map((p) =>
    KINDS.reduce(
      (n, k) =>
        n +
        p.owned[k] *
          (k === 'repertoire'
            ? Math.floor(KINDS.reduce((n, id) => n + p.owned[id], 0) / 10)
            : CARDS[k].points),
      0,
    ),
  );
}
function result(s: GiltState): Outcome {
  const points = scores(s);
  return {
    scores: points,
    places: points.map(
      (n, i) =>
        1 + points.filter((v, j) => v > n || (v === n && s.players[j]!.turns < s.players[i]!.turns)).length,
    ),
    reason: 'supply',
  };
}
function log(s: GiltState, seat: number, text: string, kind: Kind | null = null) {
  s.log.push({ seat, text, kind });
  if (s.log.length > 30) s.log.shift();
}
function remember(s: GiltState, slot: Slot) {
  if (slot.card !== null) {
    s.revealed[slot.pos] = slot.card;
    if (!s.publicCards.includes(slot.pos)) s.publicCards.push(slot.pos);
  }
}
function emptyPiles(s: GiltState) {
  return [...BASE, ...s.kingdom].filter((k) => s.supply[k].length === 0).length;
}
function drawSlot(s: GiltState, seat: number, pos: number, peek = false) {
  const p = s.players[seat]!;
  const card = s.mode === 'full' ? at(s, pos) : (s.revealed[pos] ?? p.known[pos] ?? null);
  (peek ? p.peek : p.hand).push({ pos, card });
  if (card !== null && (s.mode === 'full' || s.viewer === seat)) p.known[pos] = card;
  if (!s.dealt.some((d) => d.pos === pos)) s.dealt.push({ deck: 'pile', pos, to: seat });
}
function effect(s: GiltState, kind: Kind) {
  const c = CARDS[kind];
  s.actions += c.actions;
  s.buys += c.buys;
  s.coins += c.coins;
  const tasks: Task[] = [];
  if (c.draw) tasks.push({ type: 'draw', seat: s.turn, count: c.draw });
  if (kind === 'impresario') s.couriers++;
  if (kind === 'rehearsal') tasks.push({ type: 'rehearsal', count: 0 });
  if (['investor', 'renovation', 'cuttingroom', 'cashbox'].includes(kind))
    tasks.push({ type: 'trash', mode: kind as 'investor', count: 0 });
  if (kind === 'propmaker' || kind === 'costumier')
    tasks.push({
      type: 'gain',
      max: kind === 'costumier' ? 5 : 4,
      treasure: false,
      hand: kind === 'costumier',
    });
  if (kind === 'costumier') tasks.push({ type: 'top', source: 'hand' });
  if (kind === 'encore') tasks.push({ type: 'top', source: 'discard' });
  if (kind === 'doublebill') tasks.push({ type: 'repeat' });
  if (kind === 'headliner' || kind === 'booking')
    tasks.push({
      type: 'fixedgain',
      kind: kind === 'headliner' ? 'endowment' : 'banknote',
      seat: s.turn,
      destination: kind === 'headliner' ? 'discard' : 'draw',
    });
  if (['rivalry', 'headliner', 'booking', 'critic'].includes(kind))
    for (let n = 1; n < s.seats; n++)
      tasks.push({ type: 'attack', seat: (s.turn + n) % s.seats, attack: kind as 'rivalry' });
  if (kind === 'openingnight')
    for (let n = 1; n < s.seats; n++) tasks.push({ type: 'draw', seat: (s.turn + n) % s.seats, count: 1 });
  if (kind === 'audition') tasks.push({ type: 'discard', seat: s.turn, remaining: emptyPiles(s) });
  if (kind === 'stagedoor')
    tasks.push({ type: 'draw', seat: s.turn, count: 2, peek: true }, { type: 'stagedoor', phase: 'trash' });
  if (kind === 'busker')
    tasks.push(
      { type: 'draw', seat: s.turn, count: 1, peek: true },
      { type: 'expose', seat: s.turn, source: 'peek' },
      { type: 'busker' },
    );
  if (kind === 'readingroom') tasks.push({ type: 'readingroom' });
  s.tasks.unshift(...tasks);
}
function settle(s: GiltState) {
  while (s.tasks.length && !s.shuffle && !s.gaining && !s.result) {
    const t = s.tasks[0]!;
    const p = s.players['seat' in t ? t.seat : s.turn]!;
    if (t.type === 'draw') {
      if (t.count <= 0) {
        s.tasks.shift();
        continue;
      }
      const pos = p.draw.shift();
      if (pos !== undefined) {
        drawSlot(s, t.seat, pos, t.peek);
        t.count--;
        continue;
      }
      if (p.discard.length) {
        s.shuffle = { seat: t.seat, from: p.discard.map((c) => c.pos) };
        break;
      }
      s.tasks.shift();
      continue;
    }
    if (t.type === 'effect') {
      s.tasks.shift();
      effect(s, t.kind);
      continue;
    }
    if (t.type === 'fixedgain') {
      s.tasks.shift();
      gain(s, t.kind, t.destination === 'hand', t.seat, t.destination);
      continue;
    }
    if (t.type === 'expose') {
      for (const card of p[t.source]) {
        if (!(card.pos in s.revealed) && !s.dealt.some((d) => d.pos === card.pos && d.to === null)) {
          s.dealt.push({ deck: 'pile', pos: card.pos, to: null });
        }
      }
      if (p[t.source].some((c) => !(c.pos in s.revealed))) break;
      s.tasks.shift();
      continue;
    }
    if (t.type === 'cleanup') {
      s.tasks.shift();
      p.discard.push(...p.played, ...p.hand);
      p.hand = [];
      p.played = [];
      s.tasks.unshift({ type: 'draw', seat: t.seat, count: 5 }, { type: 'finish' });
      continue;
    }
    if (t.type === 'finish') {
      s.tasks.shift();
      if (!s.supply.grandstage.length || emptyPiles(s) >= 3) {
        s.result = result(s);
        continue;
      }
      s.turn = (s.turn + 1) % s.seats;
      s.phase = 'action';
      s.actions = 1;
      s.buys = 1;
      s.coins = 0;
      s.couriers = 0;
      s.glintPlayed = false;
      continue;
    }
    if (t.type === 'readingroom') {
      s.tasks.shift();
      if (p.hand.length >= 7 || (!p.draw.length && !p.discard.length))
        s.tasks.unshift({ type: 'expose', seat: s.turn, source: 'aside' }, { type: 'readfinish' });
      else s.tasks.unshift({ type: 'draw', seat: s.turn, count: 1, peek: true }, { type: 'readchoice' });
      continue;
    }
    if (t.type === 'readfinish') {
      s.tasks.shift();
      p.discard.push(...p.aside);
      p.aside = [];
      continue;
    }
    if (t.type === 'stagedoor' && !p.peek.length) {
      s.tasks.shift();
      continue;
    }
    if (
      t.type === 'headliner' &&
      !p.peek.some(
        (c) => c.card !== null && CARDS[kindOf(c.card)].type === 'treasure' && kindOf(c.card) !== 'penny',
      )
    ) {
      s.tasks.shift();
      p.discard.push(...p.peek);
      p.peek = [];
      continue;
    }
    if (
      t.type === 'busker' &&
      (!p.peek.length || (p.peek[0]!.card !== null && CARDS[kindOf(p.peek[0]!.card!)].type !== 'action'))
    ) {
      s.tasks.shift();
      p.discard.push(...p.peek);
      p.peek = [];
      continue;
    }
    if (t.type === 'discard' && t.remaining !== undefined) {
      t.target = Math.max(0, p.hand.length - t.remaining);
      delete t.remaining;
    }
    if (t.type === 'discard' && p.hand.length <= (t.target ?? 3)) {
      s.tasks.shift();
      continue;
    }
    if (t.type === 'trash' && (!p.hand.length || (t.mode === 'cuttingroom' && t.count === 4))) {
      s.tasks.shift();
      continue;
    }
    if (t.type === 'top' && !p[t.source].length) {
      s.tasks.shift();
      continue;
    }
    if (
      t.type === 'gain' &&
      !KINDS.some(
        (k) => s.supply[k].length && CARDS[k].cost <= t.max && (!t.treasure || CARDS[k].type === 'treasure'),
      )
    ) {
      s.tasks.shift();
      continue;
    }
    break;
  }
}
export function setup(input: SetupInput<Rules>): Result<GiltState> {
  if (!Number.isInteger(input.seats) || input.seats < 2 || input.seats > 4)
    return no('Choose two to four players.');
  if (!validateRules(input.rules).ok) return no('Invalid rules.');
  if (input.mode === 'full' && !packetOrderFits(DECK, input.deckOrders.pile ?? []))
    return no('Invalid opening deck.');
  if (
    input.mode === 'view' &&
    input.viewer !== null &&
    (!Number.isInteger(input.viewer) || input.viewer < 0 || input.viewer >= input.seats)
  )
    return no('Invalid viewer.');
  const s: GiltState = {
    game: 'gilt-and-guile',
    seats: input.seats,
    kingdom: [...(input.rules.kingdom ?? INTRO)],
    revealed: {},
    mode: input.mode,
    viewer: input.mode === 'view' ? input.viewer : null,
    players: [],
    supply: {} as Record<Kind, number[]>,
    turn: 0,
    phase: 'action',
    actions: 1,
    buys: 1,
    coins: 0,
    couriers: 0,
    glintPlayed: false,
    tasks: [],
    epoch: 0,
    orders: [input.mode === 'full' ? [...input.deckOrders.pile!] : null],
    shuffle: null,
    gaining: null,
    publicCards: [],
    dealt: [],
    trash: [],
    result: null,
    log: [],
  };
  for (let i = 0; i < input.seats; i++) {
    const owned = Object.fromEntries(
      KINDS.map((k) => [k, k === 'penny' ? 7 : k === 'playbill' ? 3 : 0]),
    ) as Record<Kind, number>;
    s.players.push({
      hand: [],
      peek: [],
      aside: [],
      known: {},
      draw: Array.from({ length: 10 }, (_, j) => i * 10 + j),
      discard: [],
      played: [],
      owned,
      turns: 0,
    });
    s.tasks.push({ type: 'draw', seat: i, count: 5 });
  }
  for (const k of KINDS) {
    const count =
      k === 'penny'
        ? 60 - 7 * s.seats
        : k === 'banknote'
          ? 40
          : k === 'endowment'
            ? 30
            : k === 'scandal'
              ? 10 * (s.seats - 1)
              : CARDS[k].type === 'victory'
                ? s.seats === 2
                  ? 8
                  : 12
                : 10;
    s.supply[k] = Array.from(
      { length: BASE.includes(k) || s.kingdom.includes(k) ? count : 0 },
      (_, i) => OFFSETS[k]! + i,
    );
  }
  settle(s);
  return { ok: true, value: s };
}
export function validateRules(raw: unknown): Result<Rules> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Object.prototype
  )
    return no('Invalid rules.');
  const r = raw as Record<string, unknown>;
  if (!Object.keys(r).length) return { ok: true, value: {} };
  if (
    Object.keys(r).join() !== 'kingdom' ||
    !Array.isArray(r.kingdom) ||
    r.kingdom.length !== 10 ||
    new Set(r.kingdom).size !== 10 ||
    r.kingdom.some((k) => !KINGDOM.includes(k))
  )
    return no('Choose exactly ten different company cards.');
  return { ok: true, value: { kingdom: [...r.kingdom] as Kind[] } };
}
export function pending(s: GiltState): Pending {
  if (s.result) return { type: 'over' };
  if (s.shuffle)
    return {
      type: 'shuffle',
      deck: 'pile',
      epoch: s.epoch + 1,
      from: s.shuffle.from.map((pos) => ({ deck: 'pile', pos })),
    };
  if (s.gaining) return { type: 'reveal', deck: 'pile', positions: [s.gaining.pos] };
  const t = s.tasks[0];
  if (t?.type === 'expose')
    return {
      type: 'reveal',
      deck: 'pile',
      positions: s.players[t.seat]![t.source].filter((c) => !(c.pos in s.revealed)).map((c) => c.pos),
    };
  return {
    type: 'player',
    seat: t && 'seat' in t ? t.seat : s.turn,
    decision: t?.type ?? s.phase,
  };
}
function candidates(s: GiltState, seat: number): GiltAction[] {
  const pd = pending(s);
  if (pd.type !== 'player' || pd.seat !== seat) return [];
  const p = s.players[seat]!;
  const hand = p.hand;
  const t = s.tasks[0];
  const cards = (type: 'play' | 'discard' | 'trash' | 'block', filter: (k: Kind) => boolean) =>
    hand.flatMap((c) =>
      c.card !== null && filter(kindOf(c.card)) ? [{ type, actor: seat, pos: c.pos, card: c.card }] : [],
    );
  const one = (type: 'next' | 'done' | 'accept' | 'end'): GiltAction => ({ type, actor: seat });
  const from = (
    source: Slot[],
    type: 'top' | 'repeat' | 'peektrash' | 'peekdiscard' | 'busk',
    filter: (k: Kind) => boolean = () => true,
  ): GiltAction[] =>
    source.flatMap((c) =>
      c.card !== null && filter(kindOf(c.card)) ? [{ type, actor: seat, pos: c.pos, card: c.card }] : [],
    );
  if (t?.type === 'top')
    return t.source === 'hand'
      ? hand.map((c) => ({ type: 'put', actor: seat, pos: c.pos }))
      : [...from(p.discard, 'top'), one('done')];
  if (t?.type === 'repeat') return [...from(hand, 'repeat', (k) => CARDS[k].type === 'action'), one('done')];
  if (t?.type === 'booking')
    return hand.some((c) => c.card !== null && CARDS[kindOf(c.card)].type === 'victory')
      ? from(hand, 'top', (k) => CARDS[k].type === 'victory')
      : [{ type: 'novictory', actor: seat }];
  if (t?.type === 'headliner')
    return from(p.peek, 'peektrash', (k) => CARDS[k].type === 'treasure' && k !== 'penny');
  if (t?.type === 'busker') return [...from(p.peek, 'busk', (k) => CARDS[k].type === 'action'), one('done')];
  if (t?.type === 'stagedoor')
    return t.phase === 'order'
      ? p.peek.map((c) => ({ type: 'put', actor: seat, pos: c.pos }))
      : [...from(p.peek, t.phase === 'trash' ? 'peektrash' : 'peekdiscard'), one('done')];
  if (t?.type === 'readchoice')
    return p.peek.flatMap((c) => [
      { type: 'keep' as const, actor: seat, pos: c.pos },
      ...(c.card === null || CARDS[kindOf(c.card)].type === 'action'
        ? [{ type: 'aside' as const, actor: seat, pos: c.pos }]
        : []),
    ]);
  if (t?.type === 'attack') return [...cards('block', (k) => k === 'understudy'), one('accept')];
  if (t?.type === 'discard') return cards('discard', () => true);
  if (t?.type === 'rehearsal') return [...cards('discard', () => true), one('done')];
  if (t?.type === 'trash')
    return [
      ...cards('trash', (k) =>
        t.mode === 'cashbox'
          ? k === 'penny'
          : t.mode === 'renovation' || t.mode === 'cuttingroom' || CARDS[k].type === 'treasure',
      ),
      ...(t.mode !== 'renovation' ? [one('done')] : []),
    ];
  if (t?.type === 'gain')
    return KINDS.filter(
      (k) => s.supply[k].length && CARDS[k].cost <= t.max && (!t.treasure || CARDS[k].type === 'treasure'),
    ).map((kind) => ({ type: 'gain', actor: seat, kind }));
  if (s.phase === 'action')
    return [...(s.actions > 0 ? cards('play', (k) => CARDS[k].type === 'action') : []), one('next')];
  if (s.phase === 'treasure') return [...cards('play', (k) => CARDS[k].type === 'treasure'), one('next')];
  return [
    ...(s.buys > 0
      ? KINDS.filter((k) => s.supply[k].length && CARDS[k].cost <= s.coins).map((kind) => ({
          type: 'buy' as const,
          actor: seat,
          kind,
        }))
      : []),
    one('end'),
  ];
}
export function legal(s: GiltState, seat: number): GiltAction[] {
  if ([...(s.players[seat]?.hand ?? []), ...(s.players[seat]?.peek ?? [])].some((c) => c.card === null))
    return [];
  return candidates(s, seat);
}
function actionValid(s: GiltState, raw: unknown): raw is GiltAction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const a = raw as Record<string, unknown>;
  const pd = pending(s);
  if (Object.getPrototypeOf(raw) !== Object.prototype || Object.values(a).some((v) => Object.is(v, -0)))
    return false;
  if (pd.type !== 'player' || a.actor !== pd.seat) return false;
  const projected = clone(s);
  if (['buy', 'gain'].includes(a.type as string)) {
    if (!keys(a, ['type', 'actor', 'kind']) || !KINDS.includes(a.kind as Kind)) return false;
  } else if (['next', 'done', 'accept', 'end', 'novictory'].includes(a.type as string)) {
    if (!keys(a, ['type', 'actor'])) return false;
  } else if (['put', 'keep', 'aside'].includes(a.type as string)) {
    if (!keys(a, ['type', 'actor', 'pos'])) return false;
  } else if (
    !['play', 'discard', 'trash', 'block', 'top', 'repeat', 'peektrash', 'peekdiscard', 'busk'].includes(
      a.type as string,
    )
  )
    return false;
  if (
    ['play', 'discard', 'trash', 'block', 'top', 'repeat', 'peektrash', 'peekdiscard', 'busk'].includes(
      a.type as string,
    )
  ) {
    if (!keys(a, ['type', 'actor', 'pos', 'card']) || !validCard(a.card)) return false;
    const p = projected.players[pd.seat]!;
    const t = projected.tasks[0];
    const zone = ['peektrash', 'peekdiscard', 'busk'].includes(a.type as string)
      ? p.peek
      : a.type === 'top' && t?.type === 'top' && t.source === 'discard'
        ? p.discard
        : p.hand;
    const slot = zone.find((c) => c.pos === a.pos);
    if (!slot || (slot.card !== null && slot.card !== a.card)) return false;
    slot.card = a.card;
  }
  return candidates(projected, pd.seat).some((c) => canonical(c) === canonical(raw));
}
function gain(
  s: GiltState,
  k: Kind,
  hand: boolean,
  seat = s.turn,
  destination: 'hand' | 'draw' | 'discard' = hand ? 'hand' : 'discard',
) {
  const pos = s.supply[k].shift();
  if (pos === undefined) return;
  s.gaining = { kind: k, pos, hand, seat, destination };
  s.dealt.push({ deck: 'pile', pos, to: null });
}
function remove(s: GiltState, seat: number, pos: number, card: number): Slot {
  const p = s.players[seat]!;
  p.hand.splice(
    p.hand.findIndex((c) => c.pos === pos),
    1,
  );
  return { pos, card };
}
export function apply(s: GiltState, raw: unknown): ApplyResult<GiltState, GiltEvent> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('Invalid action.');
  const a = raw as Record<string, unknown>;
  if (a.type === 'epoch') {
    if (
      !s.shuffle ||
      !keys(a, ['type', 'actor', 'epoch', 'size']) ||
      a.actor !== 'deck' ||
      a.epoch !== s.epoch + 1 ||
      a.size !== s.shuffle.from.length ||
      (s.mode === 'full' && !s.orders[a.epoch as number])
    )
      return no('Invalid shuffle.');
    const d = clone(s);
    const sh = d.shuffle!;
    d.epoch++;
    if (d.mode === 'view') d.orders.push(null);
    d.players[sh.seat]!.discard = [];
    d.players[sh.seat]!.draw = sh.from.map((_, i) => d.epoch * STRIDE + i);
    d.shuffle = null;
    settle(d);
    return yes(d);
  }
  if (a.type === 'reveal') {
    const pd = pending(s);
    if (
      pd.type !== 'reveal' ||
      !keys(a, ['type', 'actor', 'deck', 'pos', 'card']) ||
      a.actor !== 'deck' ||
      a.deck !== 'pile' ||
      !pd.positions.includes(a.pos as number) ||
      !validCard(a.card) ||
      (s.mode === 'full' && at(s, a.pos as number) !== a.card) ||
      (s.gaining && kindOf(a.card) !== s.gaining.kind)
    )
      return no('Invalid card reveal.');
    const d = clone(s);
    const slot = { pos: a.pos as number, card: a.card };
    remember(d, slot);
    if (d.gaining) {
      const g = d.gaining;
      const p = d.players[g.seat ?? d.turn]!;
      if (g.destination === 'draw') p.draw.unshift(slot.pos);
      else (g.hand ? p.hand : p.discard).push(slot);
      p.owned[g.kind]++;
      log(d, g.seat ?? d.turn, 'gained', g.kind);
      d.gaining = null;
    } else {
      const task = d.tasks[0];
      if (task?.type === 'expose') {
        const c = d.players[task.seat]![task.source].find((c) => c.pos === a.pos);
        if (!c || (c.card !== null && c.card !== a.card)) return no('Contradictory reveal.');
        c.card = a.card;
      }
    }
    settle(d);
    return yes(d);
  }
  if (!actionValid(s, raw)) return no('That move is not available.');
  const action = raw as GiltAction;
  const d = clone(s);
  if ('card' in action) remember(d, { pos: action.pos, card: action.card });
  const p = d.players[action.actor]!;
  const task = d.tasks[0];
  if (action.type === 'play') {
    const slot = remove(d, action.actor, action.pos, action.card);
    p.played.push(slot);
    const k = kindOf(action.card);
    const c = CARDS[k];
    log(d, action.actor, 'played', k);
    if (c.type === 'treasure') {
      d.coins += c.coins;
      if (k === 'banknote' && !d.glintPlayed) {
        d.coins += d.couriers;
        d.glintPlayed = true;
      }
    } else {
      d.actions--;
      effect(d, k);
    }
  } else if (action.type === 'discard' || action.type === 'trash') {
    const slot = remove(d, action.actor, action.pos, action.card);
    const k = kindOf(action.card);
    if (action.type === 'discard') {
      p.discard.push(slot);
      if (task?.type === 'rehearsal') task.count++;
      log(d, action.actor, 'discarded', k);
    } else {
      d.trash.push(slot);
      p.owned[k]--;
      if (task?.type === 'trash' && task.mode === 'cuttingroom') {
        task.count = (task.count ?? 0) + 1;
        settle(d);
        return yes(d);
      }
      d.tasks.shift();
      if (task?.type === 'trash' && task.mode === 'cashbox') {
        d.coins += 3;
        settle(d);
        return yes(d);
      }
      const refining = task?.type === 'trash' && task.mode === 'investor';
      d.tasks.unshift({
        type: 'gain',
        max: CARDS[k].cost + (refining ? 3 : 2),
        treasure: refining,
        hand: refining,
      });
      log(d, action.actor, 'trashed', k);
    }
  } else if (action.type === 'block') {
    const slot = p.hand.find((c) => c.pos === action.pos)!;
    slot.card = action.card;
    d.tasks.shift();
    log(d, action.actor, 'revealed', kindOf(action.card));
  } else if (action.type === 'accept') {
    d.tasks.shift();
    const attack = task?.type === 'attack' ? (task.attack ?? 'rivalry') : 'rivalry';
    if (attack === 'rivalry') d.tasks.unshift({ type: 'discard', seat: action.actor });
    if (attack === 'critic')
      d.tasks.unshift({ type: 'fixedgain', kind: 'scandal', seat: action.actor, destination: 'discard' });
    if (attack === 'booking') d.tasks.unshift({ type: 'booking', seat: action.actor });
    if (attack === 'headliner')
      d.tasks.unshift(
        { type: 'draw', seat: action.actor, count: 2, peek: true },
        { type: 'expose', seat: action.actor, source: 'peek' },
        { type: 'headliner', seat: action.actor },
      );
  } else if (action.type === 'done') {
    if (task?.type === 'stagedoor') task.phase = task.phase === 'trash' ? 'discard' : 'order';
    else d.tasks.shift();
    if (task?.type === 'busker') {
      p.discard.push(...p.peek);
      p.peek = [];
    }
    if (task?.type === 'rehearsal') d.tasks.unshift({ type: 'draw', seat: d.turn, count: task.count });
  } else if (action.type === 'top') {
    const zone = task?.type === 'top' && task.source === 'discard' ? p.discard : p.hand;
    zone.splice(
      zone.findIndex((c) => c.pos === action.pos),
      1,
    );
    p.draw.unshift(action.pos);
    d.tasks.shift();
  } else if (action.type === 'novictory') {
    d.tasks.shift();
    d.tasks.unshift({ type: 'expose', seat: action.actor, source: 'hand' });
  } else if (action.type === 'repeat' || action.type === 'busk') {
    const zone = action.type === 'busk' ? p.peek : p.hand;
    zone.splice(
      zone.findIndex((c) => c.pos === action.pos),
      1,
    );
    p.played.push({ pos: action.pos, card: action.card });
    d.tasks.shift();
    d.tasks.unshift(
      ...Array.from({ length: action.type === 'repeat' ? 2 : 1 }, () => ({
        type: 'effect' as const,
        kind: kindOf(action.card),
      })),
    );
  } else if (action.type === 'peektrash' || action.type === 'peekdiscard') {
    p.peek.splice(
      p.peek.findIndex((c) => c.pos === action.pos),
      1,
    );
    const slot = { pos: action.pos, card: action.card };
    if (action.type === 'peektrash') {
      d.trash.push(slot);
      p.owned[kindOf(action.card)]--;
    } else p.discard.push(slot);
    if (task?.type === 'headliner') {
      p.discard.push(...p.peek);
      p.peek = [];
      d.tasks.shift();
    }
  } else if (action.type === 'put') {
    const zone = task?.type === 'top' ? p.hand : p.peek;
    const slot = zone.splice(
      zone.findIndex((c) => c.pos === action.pos),
      1,
    )[0]!;
    if (task?.type === 'top') d.tasks.shift();
    if (slot.card !== null && (d.mode === 'full' || d.viewer === action.actor)) p.known[slot.pos] = slot.card;
    // Choose the bottom card first, so the last card chosen will be drawn first.
    p.draw.unshift(slot.pos);
  } else if (action.type === 'keep' || action.type === 'aside') {
    const slot = p.peek.splice(
      p.peek.findIndex((c) => c.pos === action.pos),
      1,
    )[0]!;
    (action.type === 'keep' ? p.hand : p.aside).push(slot);
    d.tasks.shift();
    d.tasks.unshift({ type: 'readingroom' });
  } else if (action.type === 'gain') {
    d.tasks.shift();
    gain(d, action.kind, task?.type === 'gain' && task.hand);
  } else if (action.type === 'buy') {
    d.coins -= CARDS[action.kind].cost;
    d.buys--;
    gain(d, action.kind, false);
  } else if (action.type === 'next') {
    d.phase = d.phase === 'action' ? 'treasure' : 'buy';
  } else if (action.type === 'end') {
    p.turns++;
    log(d, d.turn, 'ended their turn');
    d.tasks.push({ type: 'expose', seat: d.turn, source: 'hand' }, { type: 'cleanup', seat: d.turn });
  }
  settle(d);
  return yes(d);
}
export function learn(s: GiltState, l: Learn): ApplyResult<GiltState, GiltEvent> {
  if (s.mode !== 'view' || s.viewer === null || l.deck !== 'pile' || !validCard(l.card))
    return no('Invalid private card.');
  const player = s.players[s.viewer]!;
  const slot = [...player.hand, ...player.peek].find((c) => c.pos === l.pos);
  if (!slot || (slot.card !== null && slot.card !== l.card)) return no('Card is not in your hand.');
  const d = clone(s);
  const playerD = d.players[s.viewer]!;
  [...playerD.hand, ...playerD.peek].find((c) => c.pos === l.pos)!.card = l.card;
  playerD.known[l.pos] = l.card;
  return yes(d);
}
export function view(s: GiltState, viewer: number | null): GiltState {
  const d = clone(s);
  d.mode = 'view';
  d.viewer = viewer;
  d.orders = d.orders.map(() => null);
  d.players.forEach((p, i) => {
    if (i !== viewer) p.known = {};
    p.peek = p.peek.map((c) => (i === viewer || isPublic(s, c.pos) ? c : { ...c, card: null }));
    p.aside = p.aside.map((c) => (i === viewer || isPublic(s, c.pos) ? c : { ...c, card: null }));
    p.hand = p.hand.map((c) => (i === viewer || isPublic(s, c.pos) ? c : { ...c, card: null }));
    p.discard = p.discard.map((c) => (i === viewer || isPublic(s, c.pos) ? c : { ...c, card: null }));
  });
  return d;
}
function isPublic(s: GiltState, pos: number): boolean {
  return (
    pos in s.revealed ||
    s.players.some((p) => p.played.some((c) => c.pos === pos)) ||
    s.trash.some((c) => c.pos === pos) ||
    s.publicCards?.includes(pos) === true
  );
}
export const giltAndGuile: GameModule<GiltState, GiltEvent, Rules> = {
  id: 'gilt-and-guile',
  version: '0.1.0',
  defaultRules: () => ({}),
  validateRules,
  seatRange: () => ({ min: 2, max: 4 }),
  decks: () => [DECK],
  setup,
  pending,
  legalActions: legal,
  apply,
  learn,
  view,
  knownTo: (s, seat) =>
    [...(s.players[seat]?.hand ?? []), ...(s.players[seat]?.peek ?? [])].flatMap((c) =>
      c.card === null || isPublic(s, c.pos) ? [] : [{ deck: 'pile', pos: c.pos, card: c.card }],
    ) ?? [],
  outcome: (s) => s.result,
  standings: scores,
  dealt: (s) => s.dealt,
  revealsOf: (s, raw) => {
    if (!actionValid(s, raw) || !('card' in raw) || isPublic(s, raw.pos)) return [];
    return [{ deck: 'pile', pos: raw.pos, card: raw.card }];
  },
  invariants: (s) => {
    const errors: string[] = [];
    const positions = [
      ...KINDS.flatMap((k) => s.supply[k]),
      ...s.players.flatMap((p) => [
        ...p.draw,
        ...p.hand.map((c) => c.pos),
        ...p.discard.map((c) => c.pos),
        ...p.played.map((c) => c.pos),
        ...p.peek.map((c) => c.pos),
        ...p.aside.map((c) => c.pos),
      ]),
      ...s.trash.map((c) => c.pos),
      ...(s.gaining ? [s.gaining.pos] : []),
    ];
    if (new Set(positions).size !== positions.length) errors.push('A card occupies two places.');
    if ([s.actions, s.coins, s.buys].some((n) => !Number.isSafeInteger(n) || n < 0))
      errors.push('Invalid turn resources.');
    for (const p of s.players) {
      if (KINDS.some((k) => p.owned[k] < 0)) errors.push('Negative ownership.');
      if (
        KINDS.reduce((n, k) => n + p.owned[k], 0) !==
        p.hand.length + p.draw.length + p.discard.length + p.played.length + p.peek.length + p.aside.length
      )
        errors.push('Ownership does not match deck.');
    }
    return errors;
  },
  shufflePlaintexts: (s) =>
    s.mode === 'full' && s.shuffle ? s.shuffle.from.map((pos) => at(s, pos) as number) : [],
  installDeckOrder: (s, epoch, order) => {
    if (
      s.mode !== 'full' ||
      !s.shuffle ||
      epoch !== s.epoch + 1 ||
      s.orders[epoch] ||
      !Array.isArray(order) ||
      order.some((c) => !validCard(c))
    )
      return no('No matching shuffle.');
    const expected = s.shuffle.from.map((pos) => at(s, pos)).sort((a, b) => Number(a) - Number(b));
    if (canonical(expected) !== canonical([...order].sort((a, b) => a - b)))
      return no('Shuffle changed the cards.');
    const d = clone(s);
    d.orders.push([...order]);
    return yes(d);
  },
  resignAllowed: () => false,
  coverage: (s) => (s.result ? ['end:supply'] : []),
};
