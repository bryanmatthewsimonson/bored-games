/*
 * Public API of @bored-games/client: the pure game-session fold that turns a game's signed NOSTR events into an
 * agreed state for a seat or a spectator, and builds that seat's next events.
 */
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
export { GameSession } from './session.ts';
export type {
  Duty,
  Identity,
  Phase,
  ReceiveResult,
  SessionAudit,
  SessionInput,
  SessionView,
} from './types.ts';
