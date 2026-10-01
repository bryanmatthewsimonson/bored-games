import type { EngineError, GameModule, LogEntry, Seat, SetupInput } from './types.ts';

export type ReplayResult<S> =
  | { readonly ok: true; readonly state: S }
  | { readonly ok: false; readonly index: number; readonly error: EngineError };

/**
 * Folds a log into a state. `entries` may interleave private learn records
 * (a player's own view); index -1 means setup failed.
 */
export function replay<S, E extends { readonly type: string }, R>(
  module: GameModule<S, E, R>,
  setup: SetupInput<R>,
  entries: readonly LogEntry[],
): ReplayResult<S> {
  const init = module.setup(setup);
  if (!init.ok) return { ok: false, index: -1, error: init.error };
  let state = init.value;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as LogEntry;
    const res =
      entry.kind === 'action' ? module.apply(state, entry.action) : module.learn(state, entry.learn);
    if (!res.ok) return { ok: false, index: i, error: res.error };
    state = res.state;
  }
  return { ok: true, state };
}

export function actionEntries(actions: readonly unknown[]): LogEntry[] {
  return actions.map((action) => ({ kind: 'action', action }));
}

export type { Seat };
