/*
 * The protocol 2 roll contract (PROTOCOL-v2 §6.2, §10), as a helper for the client and web module-contract tests.
 * A module version that runs under protocol 2 and rolls must:
 * - list only `RollEntry`s (`{id, count, sides}`, positive safe integers), ids never reused, the list append-only;
 * - append entries only when applying a game action, never on a derived reveal or a derived roll (learns are a
 *   view-mode matter, and these games run in full mode);
 * - pend `{type: 'beacon', id}` for a new entry at once after the game action that appended it (build plan D-C);
 * - reject a player-sent `{type: 'rolled'}`.
 */
import { createRng, type GameModule, isRollEntry, range, shuffle } from '@bored-games/game-kit';
import { expect } from 'vitest';

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

const GAMES = 6;
const MAX_STEPS = 3000;

/** Seeded games of `module` at each of `seatCounts`, failing on the first breach of the roll contract. */
export function checkRollContract(module: AnyModule, seatCounts: readonly number[]): void {
  const rules = module.defaultRules();
  const rollsOf = module.rolls?.bind(module);
  if (rollsOf === undefined) throw new Error(`${module.id} does not roll`);
  expect(seatCounts.length, `${module.id}: no seat count to check`).toBeGreaterThan(0);
  let rolled = 0;
  for (let g = 0; g < GAMES; g++) {
    const rng = createRng(`roll-contract-${module.id}-${g}`);
    const seats = seatCounts[g % seatCounts.length] as number;
    const deckOrders: Record<string, number[]> = {};
    for (const deck of module.decks(rules)) deckOrders[deck.id] = shuffle(range(deck.size), rng);
    const init = module.setup({ rules, seats, mode: 'full', deckOrders });
    if (!init.ok) throw new Error(init.error.message);
    let state = init.value;
    let entries = rollsOf(state);
    expect(entries, `${module.id}: no roll before the first game action`).toEqual([]);
    for (let step = 0; step < MAX_STEPS; step++) {
      const where = `${module.id}, game ${g}, step ${step}`;
      const p = module.pending(state);
      if (p.type === 'over') break;
      let action: unknown;
      let gameAction = false;
      if (p.type === 'reveal') {
        const pos = p.positions[0] as number;
        action = { type: 'reveal', actor: 'deck', deck: p.deck, pos, card: deckOrders[p.deck]?.[pos] };
      } else if (p.type === 'beacon') {
        const entry = entries.find((e) => e.id === p.id);
        expect(isRollEntry(entry), `${where}: the beacon pends roll ${p.id}, which is not a RollEntry`).toBe(
          true,
        );
        const { count, sides } = entry as { count: number; sides: number };
        const dice = range(count).map(() => rng.int(sides) + 1);
        for (let seat = 0; seat < seats; seat++) {
          const forged = module.apply(state, { type: 'rolled', actor: seat, id: p.id, dice });
          expect(forged.ok, `${where}: a player-sent rolled by seat ${seat} was accepted`).toBe(false);
        }
        action = { type: 'rolled', actor: 'beacon', id: p.id, dice };
        rolled++;
      } else {
        action = rng.pick(module.legalActions(state, p.seat));
        gameAction = true;
        const forged = module.apply(state, { type: 'rolled', actor: p.seat, id: entries.length, dice: [1] });
        expect(forged.ok, `${where}: a player-sent rolled was accepted`).toBe(false);
      }
      const r = module.apply(state, action);
      if (!r.ok) throw new Error(`${where}: ${r.error.code}: ${r.error.message}`);
      state = r.state;
      const next = rollsOf(state);
      expect(next.slice(0, entries.length), `${where}: the roll list is not append-only`).toEqual(entries);
      const added = next.slice(entries.length);
      if (!gameAction) expect(added, `${where}: a derived reveal or roll appended a roll`).toEqual([]);
      for (const e of added) {
        expect(isRollEntry(e), `${where}: ${JSON.stringify(e)} is not a RollEntry`).toBe(true);
        expect(
          next.filter((x) => x.id === e.id),
          `${where}: roll id ${e.id} is reused`,
        ).toHaveLength(1);
      }
      if (added.length > 0)
        expect(module.pending(state), `${where}: no beacon pends right after the roll`).toEqual({
          type: 'beacon',
          id: (added[0] as { id: number }).id,
        });
      entries = next;
    }
    expect(module.pending(state).type, `${module.id}, game ${g}: did not finish`).toBe('over');
  }
  expect(rolled, `${module.id}: the games rolled no dice`).toBeGreaterThan(0);
}
