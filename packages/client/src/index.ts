/*
 * Public API of @bored-games/client: the pure game-session fold that turns a game's signed NOSTR events into an
 * agreed state for a seat or a spectator, and builds that seat's next events.
 */
export { type LoggedAction, rankWithForfeits } from './audit.ts';
export { ClientError } from './errors.ts';
export {
  buildJoinTemplate,
  buildRootTemplate,
  foldLobby,
  type GameKeys,
  type LobbyView,
  newGameKeys,
  rootSeatOrder,
} from './lobby.ts';
export { backupSeat, seatForGameKeys } from './recover.ts';
export { GameSession } from './session.ts';
export { sealedOwed, sealedPositions } from './shares.ts';
export {
  type Adversary,
  type CheatRecord,
  type SimOptions,
  type SimPolicy,
  type SimReport,
  type SimTurn,
  simulateGame,
} from './sim.ts';
export type {
  Duty,
  Identity,
  Phase,
  ReceiveResult,
  SessionAudit,
  SessionInput,
  SessionView,
} from './types.ts';
