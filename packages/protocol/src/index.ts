/*
 * Public API of @bored-games/protocol: NOSTR events for the Bored Games protocol (docs/PROTOCOL.md).
 * Signing and verification use @noble/curves `schnorr` directly, not nostr-tools (D026).
 */
export { ProtocolError } from './errors.ts';
export { DEADLINES, DEFAULT_DEADLINE, KIND, MAX_EVENT_BYTES, PROTO } from './kinds.ts';
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
