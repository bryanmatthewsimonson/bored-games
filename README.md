# Bored Games (working name)

A decentralized platform for online, human-only, multiplayer board games over NOSTR. Play is asynchronous first, and there is no trusted server, referee or bot. The first game is **Chain Reaction**, which implements the mechanics of a classic merger-and-stock tile game for 3 to 6 players.

**Status:** playable end to end in the browser. Players create, join and start a table, and every client shuffles and deals with zero-knowledge shuffle proofs. The game is played turn by turn over relays and ends with an audit of every hidden move; a stalled player can be timed out. Still to come: cross-device backup of game secrets, "your turn" notifications, records and ratings. See `docs/PLAN.md`.

## Quickstart

```sh
pnpm install   # Node ≥ 22.18, pnpm 10
pnpm dev       # dev relay on ws://localhost:7777 + app on http://localhost:5173
```

Open `http://localhost:5173/?profile=a&relays=ws://localhost:7777`, then the same with `profile=b` and `profile=c`, in three browser windows side by side, one per player (hidden tabs slow the shuffle); a table takes 3 to 6 players, so open `profile=d` to `f` for more. Each profile is a separate player, and `relays=` keeps it on the local relay. Create a table in one tab, join it from the others, start the game and play. **`docs/TESTING.md`** walks through local play step by step, then covers playing with real people (GitHub Pages and relays) and the known limitations.

## Commands

```sh
pnpm check                 # typecheck + lint + all unit tests (run before every commit)
pnpm e2e                   # end-to-end browser test: 3 players through the UI (Playwright); E2E_SEATS=6 for 3 to 6
pnpm fuzz --games 1000     # random-play invariant fuzzing of the rules engine
pnpm build:web             # static build in apps/web/dist (deployed to GitHub Pages once CI passes on main)
```

## Layout

- `packages/game-kit`, `packages/games/chain-reaction`: the game contract and the pure rules engine
- `packages/deck`, `packages/protocol`, `packages/client`: shuffle and deal crypto, NOSTR events, and the game session
- `packages/relay`, `tools/dev-relay`: the relay pool and an in-memory relay for development and tests
- `apps/web`: the Preact web app
- `docs/`:
  - `ARCHITECTURE.md`: the design
  - `PROTOCOL.md`: the event protocol
  - `DECISIONS.md`: the decision log
  - `PLAN.md`: status and open questions
  - `TESTING.md`: how to test and play
  - `games/chain-reaction/RULES.md`: the rules

`CLAUDE.md` lists the conventions.
