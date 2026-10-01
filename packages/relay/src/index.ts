/*
 * Public API of @bored-games/relay: a NOSTR relay pool over an injected WebSocket constructor.
 * Not a pure package: it holds sockets and timers.
 */
export {
  DEFAULT_BACKOFF_MS,
  type Filter,
  PUBLISH_TIMEOUT_MS,
  type PublishResult,
  RelayPool,
  type RelayPoolOptions,
  type RelayState,
  type SocketConstructor,
  type SocketLike,
} from './pool.ts';
