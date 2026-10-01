# CLAUDE.md

Bored Games (working name) is a decentralized platform for online, human-only, multiplayer board games over NOSTR. It is asynchronous first, with no trusted server, referee or bots. The first game is **Chain Reaction**, an implementation of *Acquire*'s mechanics. Never use the reference game's name or its chain names in product code; a test enforces this.

## Commands
- `pnpm install`: install (Node ≥ 22.18, pnpm 10)
- `pnpm test`: all Vitest projects (kit, chain-reaction, deck, protocol, client, relay, dev-relay, web, brand, fuzz smoke, repo guards)
- `pnpm vitest run --project <name>`: one project (for example `web` or `client`)
- `pnpm typecheck`, `pnpm lint`, `pnpm format`
- `pnpm check`: typecheck + lint + test. Run it before every commit.
- `pnpm fuzz --games 10000 [--seed S] [--players 3-6] [--no-views]`: invariant fuzzing across workers
- `pnpm fuzz --one "<seed#i>" --players N`: reproduce one failing game
- `pnpm dev`: the dev relay (`ws://localhost:7777`) and the Vite dev server (`http://localhost:5173`, `strictPort`); open `?profile=a&relays=ws://localhost:7777` per player (`docs/TESTING.md`)
- `pnpm relay`: the in-memory dev relay alone, on port 7777
- `pnpm e2e`: Playwright end-to-end test, three players through the UI on free ports (not part of `check`)
- `pnpm build:web`: static build of `apps/web` into `apps/web/dist` (GitHub Pages deploys it once CI passes on `main`)

## Repo map
- `packages/game-kit/`: the `GameModule` contract, canonical JSON, hash, PRNG, replay and generic fuzzer (pure)
- `packages/deck/`: mental-poker deck crypto on secp256k1: ElGamal, shuffle proofs, DLEQ shares, wire codecs (pure `src/`, randomness injected; `scripts/` holds `vectors` and `bench`)
- `packages/protocol/`: NOSTR events for the protocol: NIP-01 ids and signatures, lobby events (Table, Join, Game root) and in-game events (Move, Shares, Timeout, Secret, Attestation), strict parsers (pure)
- `packages/client/`: `GameSession`, the deterministic fold over one game's signed events (duties, timeouts, audit)
- `packages/relay/`: the relay pool (WebSocket injected; not pure)
- `packages/games/chain-reaction/`: the Chain Reaction rules engine (pure). `src/theme.ts` is the only file with user-facing game names.
- `packages/brand/`: platform display name
- `apps/web/`: the Preact + Signals web app: lobby and game controllers, screens, `games/chain-reaction/` components, `e2e/`
- `tools/fuzz/`: fuzz CLI, plus per-game policies and deck orders (test tooling only)
- `tools/dev-relay/`: in-memory NIP-01 relay for development and tests
- `scripts/dev.ts`: runs `pnpm relay` and the Vite dev server together
- `tests/`: repo-wide guards (purity, branding)
- `docs/`: ARCHITECTURE, PROTOCOL, PLAN (status and open questions), DECISIONS (log), TESTING (owner's guide), `games/chain-reaction/RULES.md` (source of truth)

## Conventions
- **Pure packages** (game-kit, deck `src/`, games/*): no `Math.random`, `Date`, timers, I/O, `node:` imports, `Intl` or locale APIs. State is plain JSON, money is integers, absent values are `null`.
- **`apply` never throws or mutates.** Every move has exactly one accepted encoding.
- **Import style:** relative imports use `.ts` extensions, there are no enums (`erasableSyntaxOnly`), and type-only imports use `import type`.
- **Rules:** RULES.md is the source of truth. Never invent rules. Mark uncertain ones OPEN, make them a rules option, and log them.
- **Games end only by declaration.** There is no stall rule. A game that does not end is a bug in the rules, the engine or the fuzz policies (DECISIONS D015, D016).
- **Catalog tests:** every `#### Cnn` in RULES.md needs an `it('Cnn …')` in `packages/games/chain-reaction/test/catalog/`; a meta-test enforces this.
- **Dependencies:** few. Justify each one in `docs/DECISIONS.md`.
- **Commits:** small and focused; nothing is done while tests fail. Keep `docs/PLAN.md` status and `docs/DECISIONS.md` current so a fresh session can pick up cold.
- **Adding a game:** create `packages/games/<id>` implementing `GameModule`, register it in `tools/fuzz/src/index.ts` and in `MODULES` (`apps/web/src/net.ts`), and write `docs/games/<id>/RULES.md` with a catalog.
