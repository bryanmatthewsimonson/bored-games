# Driftwrights implementation and release gates

Status: **reference implementation; not ready for multiplayer release** (2026-10-06).

The owner requested implementation, end-to-end testing, and merge/deployment once the game is ready. This branch supplies the deterministic rules engine, original floating-island artwork, rewritten rules, responsive board controls, and a development browser fixture. It does not register a playable production game or change the existing multiplayer protocol.

## What works

- Three/four players, highest-roll starting player with tie rerolls, reverse-order second placements, starting supplies, production and finite-bank shortages.
- Squall, half-hand discards, random theft, negotiated player trades and mooring/bank rates.
- Connectivity, spacing, piece limits, hubs, all 25 ventures, awards (including tied/broken routes), and victory during the owner's turn.
- Strict action parsing, immutable transitions, resource/piece/card invariants, owner/spectator view redaction and deterministic replay.
- SVG island artwork and keyboard/mouse building controls, supply/venture hand, discard/trade forms, and mobile layout.

`State` is an authoritative reference state: it contains everyone's private supplies and the venture permutation. **Never broadcast or persist it as a public multiplayer state.** `view` redacts hands for display, but rendering redaction alone provides no cryptographic privacy. `EntropyAction` is a coordinator input for deterministic tests, not a player action or a verified Nostr event. The test policy is test tooling, not a production bot.

## Why the current session cannot host this ruleset

1. `GameSession` currently supports a card deck or the dice beacon. Its action proof path switches on `usesBeacon`, and `ShareStore` keys positions by seat and position without a deck namespace. Driftwrights needs both, with independently bound proofs.
2. `dealt` describes append-only private card assignments. Resource theft changes ownership. Sending the old ciphertext to a new owner would expose it: that owner's original share has already been published. Uniform random selection must also be verified without disclosing the victim's hand composition or giving either player a choice of card.
3. Guild Requisition must verify an opponent transferred *all* cards of the named resource without making their other resources public. A client-supplied count or a public resource ledger would alter privacy or permit cheating.
4. A bought landmark can win immediately. Turn-piggybacked venture shares cannot guarantee the owner learns the card during that purchase. D050 reserves automatic hidden-information release for reviewed protocol support; the Luster-only exception is not a platform-wide allowance.
5. Resignation/timeout and final audit need explicit rules for transferred cards, pending theft/roll/venture operations, and early-secret disclosure. Existing deckless or single-deck paths do not establish those rules.

D050 says: **“A game whose mechanics cannot work that way waits for K.”** The branch does not extend the Luster prompt-share allowlist or accept player-provided dice.

## Architecture decision still open

The owner's choice is requested between:

- Continue the decentralized design, building reviewed deck namespaces, fork-bound reveal grants, private resource ownership/transfer proofs, and complete hidden-effect/final-audit support.
- Adopt the separate trusted-dealer design in [dealer-relay.md](../../proposals/dealer-relay.md). This is a trust-model change: the dealer sees hands and must stay online. It is a proposal, not an implemented service. It needs signed ordered receipts, encrypted private deliveries, committed randomness, replay verification, outage handling and a hosting target.

The choice does not change the gameplay requirements. Public resource identities, player-selected theft, delayed landmark scoring, and a one-device simulation are not substitutes for the requested multiplayer game.

## Rules fidelity follow-up

The [publisher base-game FAQ](https://www.catan.com/faq/basegame) supports the separate trade/build sequence, action ventures before rolling, free-link play without ending trading, finite supply shortages, and award ties. Those behaviors are covered by the reference catalog. Publisher names and references stay in documentation only.

**OPEN:** Supply Windfall when fewer than two supply cards exist across the entire bank. The reference currently requires two available cards; confirm the scarce-bank edge case from a primary rule clarification and add a catalog case before release. The full ruleset is not declared release-complete while this is unresolved.

## Required before merge and deployment

- Implement the chosen transport/session architecture and adversarial tests for hidden effects, ordering, restore, dishonest inputs and audit.
- Expose the game through the `GameModule` contract, fuzz/simulation targets, catalog, lobby, game registry, rules page and controller.
- Review resignation/timeout secret-release behavior; disable resignation until proved safe.
- Play full three/four-seat browser games with independent contexts through the real relay/dealer, including private theft, ventures, negotiated trades, disconnect/rejoin and final audit.
- Run the repository checks, existing end-to-end regression suite and production build/brand scan.
- Merge only the finished implementation; verify GitHub Pages' deployed commit and live lobby/game flow.

## Reference verification

Run from the repository root:

```sh
pnpm vitest run --project driftwrights
pnpm --filter @bored-games/web exec playwright test --config e2e/driftwrights.config.ts
pnpm check
```


The 32 catalog cases include complete seeded games, invariants at every transition and exact replay. The browser fixture plays both seat counts to victory through the board, checks phone overflow and spectator privacy, and reloads midgame. These are **reference engine/UI tests**, not live multiplayer tests. The fixture labels that limitation and is excluded from production entry points.

Artwork: `apps/web/src/games/driftwrights/island-atlas.png` is original generated artwork from this task; no reference-game images are used. The new title is provisional, and the implementation does not claim a trademark clearance search has been completed.

Verified on 2026-10-06: the 32 catalog cases pass, including 22 complete seeded games. The final reference browser run passes both seat counts (55.1 s / 52.0 s), including actual mouse clicks, phone enlarge/fit controls, no page overflow, spectator redaction and midgame reload. The 210 repository catalog/guard checks and application/fixture type checks also pass. Full `pnpm check` passes: 130 test files, 1,935 passing tests and 40 skipped (25.9 minutes on this machine). This evidence does not establish live multiplayer readiness.
