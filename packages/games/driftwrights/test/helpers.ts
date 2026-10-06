import { createRng, shuffle } from '@bored-games/game-kit';
import { choices, chooseForTest } from '../src/choices.ts';
import { apply, invariants, setup, ZERO } from '../src/engine.ts';
import type { Action, EntropyAction, Goods, State } from '../src/types.ts';
export function step(s: State, a: Action | EntropyAction): State {
  const r = apply(s, a);
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}
export function fresh(seats = 3): State {
  const s = setup(
    seats,
    Array.from({ length: 25 }, (_, i) => i),
  );
  if (!s.ok) throw new Error(s.error.message);
  return s.value;
}
export function started(seats = 3): State {
  let s = fresh(seats);
  for (let i = 0; i < seats; i++) {
    s = step(s, { type: 'request-roll', actor: i });
    s = step(s, { type: 'dice', actor: 'entropy', faces: i === 0 ? [6, 6] : [1, 1] });
  }
  return s;
}
export function ready(seats = 3): State {
  let s = started(seats);
  while (s.stage.startsWith('setup')) s = step(s, chooseForTest(s, choices(s)));
  return s;
}
export function hands(s: State, values: readonly Goods[]): State {
  return {
    ...s,
    players: s.players.map((p, i) => ({ ...p, goods: values[i] ?? ZERO })),
    bank: ZERO.map((_, r) => 19 - values.reduce((n, x) => n + (x[r] ?? 0), 0)) as unknown as Goods,
  };
}
export function venture(s: State, card: number, bought = -1): State {
  const order = [card, ...s.ventureOrder.filter((v) => v !== card)];
  return {
    ...s,
    ventureOrder: order,
    ventureNext: 1,
    players: s.players.map((p, i) => (i === s.actor ? { ...p, ventures: [{ pos: 0, card, bought }] } : p)),
  };
}
export function complete(
  seed: string,
  seats: number,
): { state: State; log: (Action | EntropyAction)[]; tags: Set<string> } {
  const rng = createRng(seed),
    order = shuffle(
      Array.from({ length: 25 }, (_, i) => i),
      rng,
    );
  const initial = setup(seats, order);
  if (!initial.ok) throw new Error(initial.error.message);
  let s = initial.value;
  const log: (Action | EntropyAction)[] = [],
    tags = new Set<string>();
  for (let i = 0; i < 20000 && s.result === null; i++) {
    const a: Action | EntropyAction =
      s.chance?.kind === 'dice'
        ? { type: 'dice', actor: 'entropy', faces: [1 + rng.int(6), 1 + rng.int(6)] }
        : s.chance?.kind === 'theft'
          ? { type: 'theft', actor: 'entropy', index: rng.int(s.chance.size) }
          : chooseForTest(s, choices(s));
    const before = s;
    s = step(s, a);
    log.push(a);
    tags.add(a.type);
    if (invariants(s).length) throw new Error(`invariants after ${a.type}: ${invariants(s).join(',')}`);
    if (before.stage === 'starting-roll') tags.add('starter');
  }
  if (!s.result) throw new Error(`reference game stalled after ${log.length} actions at turn ${s.turnNo}`);
  return { state: s, log, tags };
}
