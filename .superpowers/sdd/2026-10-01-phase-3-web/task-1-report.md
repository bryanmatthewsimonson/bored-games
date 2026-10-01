# Task 1 report: relay pool and dev relay

Status: DONE. Branch worktree-agent-a8be0126876b39919.

## Delivered
- `packages/relay` (`@bored-games/relay`): `RelayPool` (publish, subscribe, close, status), `Filter`, `SocketLike`/`SocketConstructor`. Depends only on `@bored-games/protocol`.
- `tools/dev-relay` (`@bored-games/dev-relay`): `startDevRelay({ port })`, `src/main.ts` (`pnpm relay`, port 7777), `ws` 8.22.0 and `@types/ws` 8.18.2 pinned exactly.
- Root `relay` script, vitest projects `relay` and `dev-relay`, D029 in `docs/DECISIONS.md`.

## Behaviour notes
- Publish timeout is 10 s per relay, counted from the `publish` call, so a relay that never connects also times out. Messages: `timeout`, `closed`, or the relay's OK text.
- An unacknowledged event is resent (the same serialized frame) after a reconnect, until its timeout.
- Publishing the same event id again while outstanding joins the first attempt.
- `onEose` fires once, when every relay has sent EOSE or CLOSED, or is down. A dead relay does not block it.
- Events over 262144 bytes are dropped before `verifyEvent`. Dedupe is per subscription and survives reconnects.
- Dev relay: stale addressable versions get `OK false "replaced: ..."`; a duplicate id gets `OK true "duplicate: ..."`; a bad REQ filter gets `CLOSED subId "invalid: ..."`. Tag filters accept any single-letter `#x`. `until` is supported (the pool's `Filter` type also has it). WebSocket server `maxPayload` is 4x the event cap so that oversize events get an OK reply and not a dropped connection.
- `SocketLike` handler parameters are typed `never`, so the platform `WebSocket` is assignable without the DOM lib. `packages/relay/tsconfig.json` uses `types: ["node"]` for `setTimeout`.

## Verification
`pnpm check` green: 32 files, 595 tests (20 pool, 16 dev-relay). `pnpm relay` prints `dev relay on ws://localhost:7777`.
