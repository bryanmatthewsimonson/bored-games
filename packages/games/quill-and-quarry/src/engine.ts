import type { ApplyResult, Learn, Pending, Result, SetupInput } from '@bored-games/game-kit';
import { premiumAt, TILES } from './data.ts';
import type { Action, Event, Placement, Play, Rules, State, Tile, Word } from './types.ts';
export const DEFAULT_RULES: Rules = { dictionary: 'table', challenge: 'double' };
const error = (message: string) => ({ ok: false as const, error: { code: 'illegal', message } });
const record = (a: unknown): a is Record<string, unknown> =>
  a !== null && typeof a === 'object' && !Array.isArray(a);
const keys = (a: Record<string, unknown>, k: string[]) =>
  Object.keys(a).sort().join(',') === k.sort().join(',');
const int = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const cardAt = (s: State, pos: number): number | null => s.orders[Math.floor(pos / 128)]?.[pos % 128] ?? null;
const copy = (s: State): State => JSON.parse(JSON.stringify(s)) as State;
const success = (s: State, type = 'changed'): ApplyResult<State, Event> => ({
  ok: true,
  state: s,
  events: [{ type, seat: s.turn, points: 0 }],
});
export function validateRules(raw: unknown): Result<Rules> {
  return record(raw) &&
    keys(raw, ['dictionary', 'challenge']) &&
    raw.dictionary === 'table' &&
    raw.challenge === 'double'
    ? { ok: true, value: { ...DEFAULT_RULES } }
    : error('Use the table dictionary and double-challenge rules.');
}
export function parseAction(raw: unknown): Action | null {
  if (!record(raw) || typeof raw.type !== 'string') return null;
  if (raw.type === 'epoch')
    return keys(raw, ['type', 'actor', 'epoch', 'size']) &&
      raw.actor === 'deck' &&
      int(raw.epoch, 1, Number.MAX_SAFE_INTEGER / 128) &&
      int(raw.size, 1, 100)
      ? (raw as unknown as Action)
      : null;
  if (raw.type === 'reveal')
    return keys(raw, ['type', 'actor', 'deck', 'pos', 'card']) &&
      raw.actor === 'deck' &&
      raw.deck === 'pile' &&
      int(raw.pos, 0, Number.MAX_SAFE_INTEGER) &&
      int(raw.card, 0, 99)
      ? (raw as unknown as Action)
      : null;
  if (!int(raw.actor, 0, 3)) return null;
  if (['pass', 'accept', 'challenge', 'finish'].includes(raw.type))
    return keys(raw, ['type', 'actor']) ? (raw as unknown as Action) : null;
  if (raw.type === 'judge')
    return keys(raw, ['type', 'actor', 'valid']) && typeof raw.valid === 'boolean'
      ? (raw as unknown as Action)
      : null;
  if (raw.type === 'exchange')
    return keys(raw, ['type', 'actor', 'positions']) &&
      Array.isArray(raw.positions) &&
      raw.positions.length > 0 &&
      raw.positions.length <= 7 &&
      raw.positions.every((p, i, all) => int(p, 0, Number.MAX_SAFE_INTEGER) && (i === 0 || p > all[i - 1]))
      ? (raw as unknown as Action)
      : null;
  if (
    raw.type === 'place' &&
    keys(raw, ['type', 'actor', 'tiles']) &&
    Array.isArray(raw.tiles) &&
    raw.tiles.length > 0 &&
    raw.tiles.length <= 7
  ) {
    const tiles = raw.tiles;
    if (
      tiles.every(
        (t, i) =>
          record(t) &&
          keys(t, ['cell', 'pos', 'card', 'letter']) &&
          int(t.cell, 0, 224) &&
          int(t.pos, 0, Number.MAX_SAFE_INTEGER) &&
          int(t.card, 0, 99) &&
          typeof t.letter === 'string' &&
          /^[A-Z]$/.test(t.letter) &&
          (i === 0 || t.cell > (tiles[i - 1] as Placement).cell),
      )
    )
      return raw as unknown as Action;
  }
  return null;
}
function give(s: State, seat: number, count: number) {
  const hand = s.hands[seat];
  if (!hand) return;
  for (let i = 0; i < count && s.bag.length > 0; i++) {
    const pos = s.bag.shift();
    if (pos === undefined) break;
    hand.push({ pos, card: cardAt(s, pos), open: false });
    s.dealt.push({ deck: 'pile', pos, to: seat });
  }
}
export function setup(input: SetupInput<Rules>): Result<State> {
  const rules = validateRules(input.rules);
  if (!rules.ok) return rules;
  if (!int(input.seats, 2, 4)) return error('Seat two to four players.');
  const order = input.mode === 'full' ? input.deckOrders.pile : null;
  if (
    input.mode === 'full' &&
    (order?.length !== 100 || new Set(order).size !== 100 || !order.every((c) => int(c, 0, 99)))
  )
    return error('The bag needs one of every tile.');
  if (input.mode === 'view' && input.viewer !== null && !int(input.viewer, 0, input.seats - 1))
    return error('Unknown viewer.');
  const s: State = {
    game: 'quill-and-quarry',
    rules: rules.value,
    mode: input.mode,
    viewer: input.mode === 'view' ? input.viewer : null,
    seats: input.seats,
    phase: 'start',
    turn: 0,
    hands: Array.from({ length: input.seats }, () => []),
    board: Array.from({ length: 225 }, () => null),
    bag: Array.from({ length: 100 }, (_, i) => i),
    scores: Array.from({ length: input.seats }, () => 0),
    dealt: [],
    orders: [order ? [...order] : null],
    epoch: 0,
    shuffle: [],
    shuffleFor: null,
    drawSeats: Array.from({ length: input.seats }, (_, i) => i),
    draws: [],
    drawCursor: 0,
    first: null,
    play: null,
    reviewers: [],
    scoreless: 0,
    out: null,
    result: null,
    history: [],
    skips: [],
  };
  startDraw(s);
  return { ok: true, value: s };
}
function startDraw(s: State) {
  s.draws = s.drawSeats.map(() => ({ pos: s.drawCursor++, card: null, open: true }));
  for (const d of s.draws) s.dealt.push({ deck: 'pile', pos: d.pos, to: null });
}
function finishStart(s: State) {
  const rank = (card: number | null) => (card === null ? 99 : (TILES[card]?.letter.charCodeAt(0) || 64) - 64);
  const best = Math.min(...s.draws.map((d) => rank(d.card)));
  const tied = s.drawSeats.filter((_, i) => rank(s.draws[i]?.card ?? null) === best);
  if (tied.length > 1) {
    s.drawSeats = tied;
    startDraw(s);
    return;
  }
  s.first = tied[0] ?? 0;
  s.turn = s.first;
  s.phase = 'shuffle';
  s.shuffle = [...s.bag];
  s.shuffleFor = 'start';
}
export function pending(s: State): Pending {
  if (s.phase === 'over') return { type: 'over' };
  if (s.phase === 'shuffle')
    return {
      type: 'shuffle',
      deck: 'pile',
      epoch: s.epoch + 1,
      from: s.shuffle.map((pos) => ({ deck: 'pile', pos })),
    };
  if (s.phase === 'start')
    return {
      type: 'reveal',
      deck: 'pile',
      positions: s.draws.filter((d) => d.card === null).map((d) => d.pos),
    };
  if (s.phase === 'ending')
    return {
      type: 'reveal',
      deck: 'pile',
      positions: s.hands
        .flat()
        .filter((h) => !h.open)
        .map((h) => h.pos),
    };
  return { type: 'player', seat: s.turn, decision: s.phase };
}
function neighbors(cell: number): number[] {
  const r = Math.floor(cell / 15),
    c = cell % 15;
  return [
    r > 0 ? cell - 15 : -1,
    r < 14 ? cell + 15 : -1,
    c > 0 ? cell - 1 : -1,
    c < 14 ? cell + 1 : -1,
  ].filter((c) => c >= 0);
}
function wordAt(board: (Tile | null)[], cell: number, step: 1 | 15): number[] {
  const same = (a: number, b: number) =>
    b >= 0 && b < 225 && (step === 15 || Math.floor(a / 15) === Math.floor(b / 15));
  let start = cell;
  while (same(start, start - step) && board[start - step]) start -= step;
  const cells: number[] = [];
  for (let p = start; same(start, p) && board[p]; p += step) cells.push(p);
  return cells;
}
/** Placement geometry and points; vocabulary is settled with the dictionary agreed by the table. */
export function evaluate(s: State, actor: number, tiles: Placement[]): Result<Play> {
  const hand = s.hands[actor];
  if (!hand) return error('Unknown player.');
  if (tiles.length === 0 || tiles.length > 7 || new Set(tiles.map((t) => t.pos)).size !== tiles.length)
    return error('Use one to seven different rack tiles.');
  const cells = tiles.map((t) => t.cell),
    rows = new Set(cells.map((c) => Math.floor(c / 15))),
    cols = new Set(cells.map((c) => c % 15));
  if (rows.size !== 1 && cols.size !== 1) return error('Place tiles in one row or one column.');
  const board = [...s.board];
  for (const t of tiles) {
    const slot = hand.find((h) => h.pos === t.pos),
      face = TILES[t.card];
    if (
      !slot ||
      !face ||
      (slot.card !== null && slot.card !== t.card) ||
      board[t.cell] !== null ||
      !int(t.cell, 0, 224) ||
      !/^[A-Z]$/.test(t.letter) ||
      (face.letter !== '' && face.letter !== t.letter)
    )
      return error('Use your own tiles on empty squares; name each blank.');
    board[t.cell] = { pos: t.pos, card: t.card, letter: t.letter, seat: actor };
  }
  const step = rows.size === 1 ? 1 : 15,
    first = Math.min(...cells),
    last = Math.max(...cells);
  for (let p = first; p <= last; p += step) if (!board[p]) return error('Leave no gap in the word.');
  const opening = s.board.every((c) => c === null);
  if (opening && (!cells.includes(112) || tiles.length < 2))
    return error('Your first word must use at least two tiles and cross the center.');
  if (!opening && !cells.some((c) => neighbors(c).some((n) => s.board[n] !== null)))
    return error('Connect your word to a tile already on the board.');
  const lines = new Map<string, number[]>();
  for (const cell of cells)
    for (const direction of [1, 15] as const) {
      const line = wordAt(board, cell, direction);
      if (line.length > 1) lines.set(line.join(','), line);
    }
  if (lines.size === 0) return error('Make a word of at least two letters.');
  const fresh = new Set(cells);
  const words: Word[] = [...lines.values()].map((line) => {
    let multiplier = 1,
      sum = 0;
    for (const cell of line) {
      const tile = board[cell];
      if (!tile) continue;
      const premium = fresh.has(cell) ? premiumAt(cell) : null;
      sum += (TILES[tile.card]?.value ?? 0) * (premium === '2L' ? 2 : premium === '3L' ? 3 : 1);
      multiplier *= premium === '2W' ? 2 : premium === '3W' ? 3 : 1;
    }
    return { text: line.map((c) => board[c]?.letter ?? '').join(''), cells: line, points: sum * multiplier };
  });
  return {
    ok: true,
    value: {
      actor,
      tiles: tiles.map((t) => ({ ...t })),
      words,
      points: words.reduce((sum, w) => sum + w.points, 0) + (tiles.length === 7 ? 50 : 0),
    },
  };
}
function log(s: State, seat: number, text: string, points = 0, cells: number[] = []) {
  s.history.push({ seat, text, points, cells });
}
function next(s: State, seat: number) {
  s.turn = (seat + 1) % s.seats;
  s.phase = 'turn';
  while (s.skips.includes(s.turn) && s.scoreless < 6) {
    s.skips.splice(s.skips.indexOf(s.turn), 1);
    log(s, s.turn, 'Unsuccessful challenge — turn lost');
    s.scoreless++;
    s.turn = (s.turn + 1) % s.seats;
  }
}
function end(s: State, out: number | null) {
  s.out = out;
  s.phase = 'ending';
  if (s.hands.flat().every((h) => h.open)) finish(s);
}
function finish(s: State) {
  const remaining = s.hands.map((hand) =>
    hand.reduce((sum, t) => sum + (TILES[t.card ?? -1]?.value ?? 0), 0),
  );
  s.scores = s.scores.map(
    (n, i) => n - (remaining[i] ?? 0) + (i === s.out ? remaining.reduce((a, b) => a + b, 0) : 0),
  );
  s.result = {
    scores: [...s.scores],
    places: s.scores.map((n) => 1 + s.scores.filter((m) => m > n).length),
    reason: s.out === null ? 'Six consecutive scoreless turns' : 'An empty rack and an empty bag',
  };
  s.phase = 'over';
}
function acceptPlay(s: State, lostChallenge: number | null = null) {
  const play = s.play;
  if (!play) return;
  s.scores[play.actor] = (s.scores[play.actor] ?? 0) + play.points;
  s.scoreless = play.points === 0 ? s.scoreless + 1 : 0;
  log(
    s,
    play.actor,
    play.words.map((w) => w.text).join(' · '),
    play.points,
    play.tiles.map((t) => t.cell),
  );
  s.play = null;
  s.reviewers = [];
  if (s.bag.length === 0 && s.hands[play.actor]?.length === 0) {
    end(s, play.actor);
    return;
  }
  give(s, play.actor, 7 - (s.hands[play.actor]?.length ?? 0));
  if (lostChallenge !== null) s.skips.push(lostChallenge);
  next(s, play.actor);
}
export function legalActions(s: State, seat: number): Action[] {
  if (s.turn !== seat || ['over', 'ending', 'start', 'shuffle'].includes(s.phase)) return [];
  if (s.phase === 'review')
    return [
      { type: 'accept', actor: seat },
      { type: 'challenge', actor: seat },
    ];
  if (s.phase === 'judge')
    return [
      { type: 'judge', actor: seat, valid: true },
      { type: 'judge', actor: seat, valid: false },
    ];
  if (s.scoreless >= 6) return [{ type: 'finish', actor: seat }];
  if (s.hands[seat]?.some((h) => h.card === null)) return [];
  return [{ type: 'pass', actor: seat }];
}
export function apply(s: State, raw: unknown): ApplyResult<State, Event> {
  const a = parseAction(raw);
  if (a === null) return error('Malformed action.');
  const d = copy(s);
  if (a.type === 'epoch') {
    if (
      d.phase !== 'shuffle' ||
      a.epoch !== d.epoch + 1 ||
      a.size !== d.shuffle.length ||
      (d.mode === 'full' && d.orders[a.epoch]?.length !== a.size)
    )
      return error('No matching shuffle is ready.');
    d.epoch = a.epoch;
    if (d.mode === 'view') d.orders.push(null);
    d.bag = Array.from({ length: a.size }, (_, i) => a.epoch * 128 + i);
    d.shuffle = [];
    if (d.shuffleFor === 'start') {
      for (let round = 0; round < 7; round++) for (let seat = 0; seat < d.seats; seat++) give(d, seat, 1);
      d.phase = 'turn';
    } else next(d, d.turn);
    d.shuffleFor = null;
    return success(d, 'shuffled');
  }
  if (a.type === 'reveal') {
    const full = cardAt(d, a.pos);
    if (d.mode === 'full' && full !== a.card) return error('The tile contradicts its bag.');
    if (d.phase === 'start') {
      const slot = d.draws.find((h) => h.pos === a.pos && h.card === null);
      if (!slot) return error('No such starting draw.');
      slot.card = a.card;
      if (d.draws.every((h) => h.card !== null)) finishStart(d);
      return success(d, 'starting');
    }
    if (d.phase === 'ending') {
      const slot = d.hands.flat().find((h) => h.pos === a.pos && !h.open);
      if (!slot || (slot.card !== null && slot.card !== a.card)) return error('No such scoring reveal.');
      slot.card = a.card;
      slot.open = true;
      d.dealt.push({ deck: 'pile', pos: slot.pos, to: null });
      if (d.hands.flat().every((h) => h.open)) finish(d);
      return success(d, 'scored');
    }
    return error('No tile reveal is pending.');
  }
  if (a.actor !== d.turn || ['over', 'ending', 'start', 'shuffle'].includes(d.phase))
    return error('Wait for your turn.');
  if (a.type === 'accept' || a.type === 'challenge') {
    if (d.phase !== 'review' || !d.play) return error('No word is being reviewed.');
    if (a.type === 'challenge') {
      d.phase = 'judge';
      return success(d, 'challenged');
    }
    d.reviewers.shift();
    if (d.reviewers.length === 0) acceptPlay(d);
    else d.turn = d.reviewers[0] ?? d.turn;
    return success(d, 'accepted');
  }
  if (a.type === 'judge') {
    if (d.phase !== 'judge' || !d.play) return error('No dictionary check is pending.');
    if (a.valid) acceptPlay(d, a.actor);
    else {
      const play = d.play;
      for (const t of play.tiles) {
        d.board[t.cell] = null;
        d.hands[play.actor]?.push({ pos: t.pos, card: t.card, open: true });
      }
      log(d, play.actor, 'Word withdrawn after challenge');
      d.scoreless++;
      d.play = null;
      d.reviewers = [];
      next(d, play.actor);
    }
    return success(d, 'judged');
  }
  if (d.phase !== 'turn') return error('Resolve the word review first.');
  if (d.scoreless >= 6) {
    if (a.type !== 'finish') return error('Six scoreless turns: finalize the scores.');
    end(d, null);
    return success(d, 'finished');
  }
  if (a.type === 'pass') {
    log(d, a.actor, 'Passed');
    d.scoreless++;
    next(d, a.actor);
    return success(d, 'passed');
  }
  if (a.type === 'exchange') {
    const hand = d.hands[a.actor];
    if (!hand || d.bag.length < 7 || !a.positions.every((pos) => hand.some((h) => h.pos === pos)))
      return error('Exchange requires at least seven tiles in the bag and tiles from your rack.');
    d.hands[a.actor] = hand.filter((h) => !a.positions.includes(h.pos));
    // Replacement tiles come from the OLD bag. Returned tiles enter only after the draw.
    give(d, a.actor, a.positions.length);
    d.shuffle = [...d.bag, ...a.positions];
    d.bag = [];
    d.shuffleFor = 'exchange';
    d.phase = 'shuffle';
    d.scoreless++;
    log(d, a.actor, `Exchanged ${a.positions.length} tile${a.positions.length === 1 ? '' : 's'}`);
    return success(d, 'exchanged');
  }
  if (a.type === 'place') {
    const checked = evaluate(d, a.actor, a.tiles);
    if (!checked.ok) return checked;
    d.play = checked.value;
    for (const t of a.tiles) d.board[t.cell] = { pos: t.pos, card: t.card, letter: t.letter, seat: a.actor };
    d.hands[a.actor] = (d.hands[a.actor] ?? []).filter((h) => !a.tiles.some((t) => t.pos === h.pos));
    d.reviewers = Array.from({ length: d.seats - 1 }, (_, i) => (a.actor + i + 1) % d.seats);
    d.turn = d.reviewers[0] ?? 0;
    d.phase = 'review';
    return success(d, 'placed');
  }
  return error('That action is not available.');
}
export function learn(s: State, item: Learn): ApplyResult<State, Event> {
  if (s.mode !== 'view' || s.viewer === null || item.deck !== 'pile' || !int(item.card, 0, 99))
    return error('Cannot learn that tile.');
  const slot = s.hands[s.viewer]?.find((h) => h.pos === item.pos);
  if (!slot || (slot.card !== null && slot.card !== item.card))
    return error('That tile is not in your rack or contradicts it.');
  const d = copy(s),
    target = d.hands[s.viewer]?.find((h) => h.pos === item.pos);
  if (target) target.card = item.card;
  return { ok: true, state: d, events: [] };
}
export function knownTo(s: State, seat: number): Learn[] {
  return (s.hands[seat] ?? []).flatMap((h) =>
    h.card !== null && !h.open ? [{ deck: 'pile', pos: h.pos, card: h.card }] : [],
  );
}
export function view(s: State, viewer: number | null): State {
  return {
    ...s,
    mode: 'view',
    viewer,
    orders: s.orders.map(() => null),
    hands: s.hands.map((hand, seat) =>
      hand.map((h) => ({ ...h, card: seat === viewer || h.open ? h.card : null })),
    ),
  };
}
export function revealsOf(_s: State, raw: unknown): Learn[] {
  const a = parseAction(raw);
  return a?.type === 'place' ? a.tiles.map((t) => ({ deck: 'pile', pos: t.pos, card: t.card })) : [];
}
export function shufflePlaintexts(s: State): number[] {
  return s.mode === 'full' && s.phase === 'shuffle'
    ? s.shuffle.flatMap((p) => {
        const c = cardAt(s, p);
        return c === null ? [] : [c];
      })
    : [];
}
export function installDeckOrder(
  s: State,
  epoch: number,
  order: readonly number[],
): ApplyResult<State, Event> {
  const expected = shufflePlaintexts(s).sort((a, b) => a - b);
  if (
    s.mode !== 'full' ||
    s.phase !== 'shuffle' ||
    epoch !== s.epoch + 1 ||
    s.orders[epoch] !== undefined ||
    !Array.isArray(order) ||
    order.length !== expected.length ||
    !order.every((c) => int(c, 0, 99)) ||
    [...order].sort((a, b) => a - b).some((c, i) => c !== expected[i])
  )
    return error('The new bag must be a permutation of the returned tiles.');
  const d = copy(s);
  d.orders.push([...order]);
  return { ok: true, state: d, events: [] };
}
export function invariants(s: State): string[] {
  const problems: string[] = [];
  if (s.board.length !== 225) problems.push('board size');
  if (s.hands.some((h) => h.length > 7)) problems.push('rack size');
  if (s.scores.length !== s.seats || s.scores.some((n) => !Number.isSafeInteger(n))) problems.push('scores');
  const active = [
    ...s.hands.flat().map((h) => h.pos),
    ...s.board.flatMap((t) => (t === null ? [] : [t.pos])),
    ...(s.phase === 'shuffle' ? s.shuffle : s.bag),
  ];
  if (active.length !== 100 || new Set(active).size !== 100) problems.push('tile conservation');
  if (!int(s.turn, 0, s.seats - 1)) problems.push('turn');
  if (s.mode === 'view' && s.orders.some((o) => o !== null)) problems.push('private bag exposed');
  if (s.phase === 'over' && s.result === null) problems.push('missing outcome');
  return problems;
}
