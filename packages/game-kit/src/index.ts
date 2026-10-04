export { assertJsonSafe, canonicalJson, compareCodeUnits, jsonEqual } from './canonical.ts';
export type {
  BrandNames,
  CatalogEntry,
  CatalogStatus,
  Genre,
  Luck,
  Mechanism,
  Mode,
  TurnStructure,
} from './catalog.ts';
export { COMPARE_PREFIX, catalogProblems, GENRES, MECHANISMS, MODES, STATUSES, TURNS } from './catalog.ts';
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
export { currentModules, isRollEntry, moduleFor, moduleProtocols } from './registry.ts';
export { actionEntries, type ReplayResult, replay } from './replay.ts';
export type {
  ApplyResult,
  DealtPosition,
  DeckSpec,
  DiceRoll,
  EngineError,
  GameLog,
  GameModule,
  Learn,
  LogEntry,
  Outcome,
  Pending,
  ProtocolVersion,
  Result,
  RevealAction,
  RollEntry,
  Seat,
  SetupInput,
} from './types.ts';
