/*
 * Module registries and protocol versions (PROTOCOL-v2 §2 item 6, §10; build plan D-B). A registry is a
 * `ReadonlyMap<string, GameModule>`. A module's own `id` key holds its current version, the one new tables use.
 * Versions kept only to fold older games sit under `${id}@${version}` (for example `bank@0.1.0`). Pure.
 */
import type { ProtocolVersion, RollEntry } from './types.ts';

/** The fields of a module the registry helpers read. */
interface Versioned {
  readonly id: string;
  readonly version: string;
  readonly protocols?: readonly ProtocolVersion[];
}

/** The protocol versions `module` runs under: its `protocols`, or `[1]` when it declares none. */
export function moduleProtocols(module: Versioned): readonly ProtocolVersion[] {
  return module.protocols ?? [1];
}

/**
 * The module that folds games of (`id`, `version`): the current module under `id` when its version matches,
 * otherwise the one kept under `${id}@${version}`, which must itself be that id and version. Undefined when the
 * registry has neither.
 */
export function moduleFor<M extends Versioned>(
  registry: ReadonlyMap<string, M>,
  id: string,
  version: string,
): M | undefined {
  const current = registry.get(id);
  if (current !== undefined && current.id === id && current.version === version) return current;
  const kept = registry.get(`${id}@${version}`);
  if (kept !== undefined && kept.id === id && kept.version === version) return kept;
  return undefined;
}

/** The registry without the `@` keys: the current module of each game, for lists and new tables. */
export function currentModules<M>(registry: ReadonlyMap<string, M>): ReadonlyMap<string, M> {
  return new Map([...registry].filter(([key]) => !key.includes('@')));
}

/**
 * Whether a roll entry is a protocol 2 `RollEntry` rather than a protocol 1 `DiceRoll`: a safe integer `id`, `count`
 * from 1 to 64 and `sides` from 2 to 256, the range `faces` draws (PROTOCOL-v2 §10). An entry outside that range
 * could never be derived, so it is not a `RollEntry`, and the roll contract fails a module that lists one.
 */
export function isRollEntry(x: unknown): x is RollEntry {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  const within = (v: unknown, min: number, max: number): boolean =>
    Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
  return Number.isSafeInteger(r.id) && within(r.count, 1, 64) && within(r.sides, 2, 256);
}
