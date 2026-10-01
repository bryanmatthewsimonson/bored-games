export { assertJsonSafe, canonicalJson, compareCodeUnits, jsonEqual } from './canonical.ts';
export type {
  FuzzBatchOptions,
  FuzzBatchReport,
  FuzzFailure,
  FuzzGameOptions,
  FuzzGameReport,
  FuzzPolicy,
} from './fuzz.ts';
export { deepFreeze, fuzzBatch, fuzzGame, gameSeed, uniformPolicy } from './fuzz.ts';
export { cyrb53, stateHash } from './hash.ts';
export { createRng, type Rng, range, shuffle } from './prng.ts';
export { actionEntries, type ReplayResult, replay } from './replay.ts';
export type {
  ApplyResult,
  DealtPosition,
  DeckSpec,
  EngineError,
  GameLog,
  GameModule,
  Learn,
  LogEntry,
  Outcome,
  Pending,
  Result,
  RevealAction,
  Seat,
  SetupInput,
} from './types.ts';
