# Bored Games (working name)

A decentralized platform for online, human-only, multiplayer board games over NOSTR: asynchronous first, with no trusted servers. The first game is **Chain Reaction**, which implements the mechanics of a classic merger-and-stock tile game.

The current status is that the rules engine and test tooling are done; networking and UI are next. See `docs/PLAN.md` for progress and open questions, `docs/ARCHITECTURE.md` for the design, and `CLAUDE.md` for commands and conventions.

```sh
pnpm install
pnpm check                 # typecheck + lint + tests
pnpm fuzz --games 1000     # random-play invariant fuzzing
```
