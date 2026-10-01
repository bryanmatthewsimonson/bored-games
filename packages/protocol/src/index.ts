/*
 * Public API of @bored-games/protocol: NOSTR events for the Bored Games protocol (docs/PROTOCOL.md).
 * Signing and verification use @noble/curves `schnorr` directly, not nostr-tools (D026).
 */
export { ProtocolError } from './errors.ts';
export {
  type AttestSpec,
  type Audit,
  attestTemplate,
  logHash,
  type MoveContent,
  type MoveSpec,
  moveTemplate,
  type Outcome,
  type Parsed,
  type ParsedAttest,
  type ParsedMove,
  type ParsedSecret,
  type ParsedShares,
  type ParsedTimeout,
  type PosShare,
  parseAttest,
  parseMove,
  parseSecret,
  parseShares,
  parseTimeout,
  type SecretSpec,
  type SharesSpec,
  secretTemplate,
  sharesTemplate,
  type TimeoutSpec,
  timeoutTemplate,
} from './game.ts';
export { DEADLINES, DEFAULT_DEADLINE, KIND, MAX_EVENT_BYTES, PROTO } from './kinds.ts';
export {
  isRelayUrl,
  type JoinSpec,
  joinTemplate,
  makeJoinPok,
  type ParsedJoin,
  type ParsedRoot,
  type ParsedTable,
  parseJoin,
  parseRoot,
  parseTable,
  type RootSeat,
  type RootSpec,
  rootTemplate,
  rulesHash,
  type TableSpec,
  type TableStatus,
  tableAddress,
  tableTemplate,
  validateRoot,
  verifyJoin,
} from './lobby.ts';
export {
  type EventTemplate,
  eventBytes,
  eventId,
  finalizeEvent,
  getPublicKey,
  type Hex,
  isHex64,
  type NostrEvent,
  verifyEvent,
} from './nostr.ts';
export { many, named, one, requireProto } from './tags.ts';
