# CLAUDE.md

Bored Games (working name) is a decentralized platform for online, human-only, multiplayer board games over NOSTR. It is asynchronous first, with no trusted server, referee or bots. The first game is **Chain Reaction**, an implementation of *Acquire*'s mechanics. Never use a reference game's name, its company or designer names, or Chain Reaction's reference chain names, in any case, outside `licensed/` directories (licensed brand packs, loaded only by builds made with `VITE_LICENSED_BRANDS=1` and never deployed until licensed) and `docs/`, with one exception: the exact phrases "Compare to <reference title>" for Chain Reaction (D053), Luster (D060) and Right of Way (D066), each stored once in its game's `src/compare.ts`. The repo guard (every package file) and the build scans (`pnpm check`, and `pnpm scan:dist` before every Pages upload) enforce this (D046).

## Commands
- `pnpm install`: install (Node ≥ 22.18, pnpm 10)
- `pnpm test`: all Vitest projects (kit, chain-reaction, chess, bank, luster, right-of-way, driftwrights, dice, deck, protocol, client, relay, dev-relay, web, brand, fuzz smoke, repo guards)
- `pnpm vitest run --project <name>`: one project (for example `web` or `client`)
- `pnpm typecheck`, `pnpm lint`, `pnpm format`
- `pnpm check`: typecheck + lint + test (including the public build scan, `pnpm scan:build`). Run it before every commit.
- `pnpm fuzz --games 10000 [--game chain-reaction|chess|bank|luster|right-of-way|driftwrights] [--seed S] [--players 3-6] [--no-views]`: invariant fuzzing across workers. The default game is Chain Reaction; Bank's seat counts are 2–6, Right of Way's 2–5, Driftwrights' 3–4
- `pnpm fuzz --one "<seed#i>" --players N`: reproduce one failing game
- `pnpm dev`: the dev relay (`ws://localhost:7777`) and the Vite dev server (`http://localhost:5173`, `strictPort`); open `?profile=a&relays=ws://localhost:7777` per player (`docs/TESTING.md`). `VITE_LICENSED_BRANDS=1 pnpm dev` adds the licensed names (Settings → Game names)
- `pnpm relay`: the in-memory dev relay alone, on port 7777
- `pnpm e2e`: the Playwright end-to-end specs (Chain Reaction with three players, profiles, Chess, Bank, Luster, Right of Way, Driftwrights) on free ports (not part of `check`)
- `pnpm sim --game <id>`: whole games between independent clients over an in-memory relay
- `pnpm build:web`: static build of `apps/web` into `apps/web/dist` (GitHub Pages deploys it once CI passes on `main`)

## Repo map
- `packages/game-kit/`: the `GameModule` contract, canonical JSON, hash, PRNG, replay, generic fuzzer, and the catalog types and vocabularies (pure)
- `packages/deck/`: mental-poker deck crypto on secp256k1: ElGamal, shuffle proofs, DLEQ shares, the dice beacon (`src/beacon.ts`, deck id `roll`), wire codecs (pure `src/`, randomness injected; `scripts/` holds `vectors` and `bench`)
- `packages/dice/`: pure dice faces from a seed, by rejection sampling (D058). The session calls it; engines do not
- `packages/protocol/`: NOSTR events for the protocol: NIP-01 ids and signatures, lobby events (Table, Join, Game root) and in-game events (Move, Shares, Timeout, Secret, Attestation), strict parsers (pure)
- `packages/client/`: `GameSession`, the deterministic fold over one game's signed events (duties, timeouts, audit)
- `packages/relay/`: the relay pool (WebSocket injected; not pure)
- `packages/games/chain-reaction/`: the Chain Reaction rules engine (pure). `src/theme.ts` is the only `src` file with user-facing game names (the trademark-safe brand pack); `licensed/` holds the licensed pack.
- `packages/games/chess/`: the Chess rules engine (pure, deckless)
- `packages/games/bank/`: the Bank rules engine (pure, deckless, dice beacon). `src/theme.ts` holds the display names
- `packages/games/right-of-way/`: the Right of Way rules engine (pure; one 580-card packet in groups: freight, four spare index decks for reshuffles, charters; D066). `src/theme.ts` holds the display names
- `packages/games/driftwrights/`: the Driftwrights rules engine and private-view adapter (pure; 25 ventures plus request-bound dice and private supply selection; D069, D070). `src/theme.ts` holds the display names
- `packages/brand/`: platform display name
- `apps/web/`: the Preact + Signals web app: lobby and game controllers, screens, the game registry (`games/registry.ts`), `games/<id>/` components, `e2e/`
- `tools/fuzz/`: fuzz CLI, plus per-game policies and deck orders (test tooling only)
- `tools/dev-relay/`: in-memory NIP-01 relay for development and tests
- `scripts/dev.ts`: runs `pnpm relay` and the Vite dev server together
- `tests/`: repo-wide guards (purity, branding, the public build scan for restricted names)
- `docs/`: ARCHITECTURE, PROTOCOL, PLAN (status and open questions), DECISIONS (log), TESTING (owner's guide), `games/<id>/RULES.md` (source of truth; Chain Reaction, Chess, Bank, Luster, Right of Way; Hanabi and Room for Doubt are spec only)

## Conventions
- **Pure packages** (game-kit, dice, deck `src/`, games/*): no `Math.random`, `Date`, timers, I/O, `node:` imports, `Intl` or locale APIs. State is plain JSON, money is integers, absent values are `null`.
- **`apply` never throws or mutates.** Every move has exactly one accepted encoding.
- **Import style:** relative imports use `.ts` extensions, there are no enums (`erasableSyntaxOnly`), and type-only imports use `import type`.
- **Rules:** RULES.md is the source of truth. Never invent rules. Mark uncertain ones OPEN, make them a rules option, and log them.
- **Games end only by declaration.** There is no stall rule. A game that does not end is a bug in the rules, the engine or the fuzz policies (DECISIONS D015, D016).
- **Catalog tests:** every `#### Cnn` in `docs/games/<id>/RULES.md` needs an `it('Cnn …')` in `packages/games/<id>/test/catalog/`; `tests/catalog.test.ts` enforces this for every game.
- **Dependencies:** few. Justify each one in `docs/DECISIONS.md`.
- **Commits:** small and focused; nothing is done while tests fail. Keep `docs/PLAN.md` status and `docs/DECISIONS.md` current so a fresh session can pick up cold.
- **Adding a game (D045):**
  - `packages/games/<id>`: a pure `GameModule` (`decks` may be `[]`), its `src/theme.ts`, a `src/catalog.ts` entry and a trademark-safe brand pack (D046), and `test/catalog/`;
  - `docs/games/<id>/RULES.md` with a `#### Cnn` catalog (`tests/catalog.test.ts` checks it);
  - a fuzz target in `tools/fuzz/src/index.ts` (the sim takes `--game <id>`);
  - the web app: the module in `MODULES` (`apps/web/src/net.ts`), the id in `apps/web/src/games/ids.ts`, and `apps/web/src/games/<id>/` with `meta.ts`, a component taking `GameViewProps` and a rules page, registered in `games/registry.ts`, `game-names.ts` and `games/catalog.ts`;
  - an e2e spec in `apps/web/e2e/`;
  - **Resign (D052):** a game with a deck, and any co-op game or game where a seat cannot see its own cards (Hanabi), must redo the early-secret analysis of PROTOCOL §8.3 before Resign is enabled for it. Where it fails (a co-op game: the resigner's secret exposes others' cards), the module opts out with `resignAllowed(rules, seats) → false`. A game with public reveals during play needs a Resign rule for them first (`module-contract.test.ts`). A deckless game with no hidden cards (Chess, Bank) resigns on the deckless path: no secret on the Resign.
  - **Dice (D058):** a game that rolls uses `rolls` and `beaconOf`. The session attaches the beacon share and derives the faces (PROTOCOL §6.3a). The engine must not import `deck` or `dice`, and must not accept a player-sent `{type:'rolled'}`. A public roll hides nothing, so each other seat's open app sends its contribution automatically (owner, D050, D060); protocol v2 binds each roll to the move that requests it (D059 item 5).
