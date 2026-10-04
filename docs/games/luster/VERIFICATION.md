# Luster verification

## Reproduce

From the repository root, with the pinned pnpm 10.28.0 and existing dependencies:

```sh
pnpm check
pnpm vitest run --project luster
pnpm fuzz --game luster --games 100 --players 2-4 --workers 1 --seed luster-random-start
pnpm sim --game luster --games 3 --seats 2-4 --workers 1 --seed luster-random-start
pnpm e2e luster.spec.ts
pnpm build:web
pnpm scan:dist
```

The managed workspace uses `/usr/bin/chromium`; set `E2E_CHROMIUM=/usr/bin/chromium` when invoking the browser test here. The relay/browser tests require local socket access. The workspace's cached pinned pnpm is selected with `PATH=/workspace/.onboarding/bin:$PATH COREPACK_HOME=/workspace/.onboarding/corepack`; no runtime dependency installation is required.

## Checked behavior

- Final release validation on the combined Bank/Luster revision passed: full `pnpm check` (all workspace type checks, lint across 388 files, 116 test files with 1,766 tests passed and 34 skipped). All four browser flows passed: Bank plus Luster with 2, 3 and 4 players. The explicit prompt-share opt-in and combined registry/catalog checks passed separately (33 tests). Production build and restricted-name distribution scan passed. These checks include the Luster-only release-policy opt-in and preserve Bank's merged implementation.
- Before the random-start follow-up, the full `pnpm check` passed: all workspace type checks and lint, then 105 test files with 1,688 tests passed and 34 skipped. Catalog filter/search expectations include Luster; their 14 tests also passed separately after the update.
- Follow-up validation passed: workspace type checks and lint, 22 Luster engine/replay tests, 24 focused web tests and 171 repository tests (217 total). The prior full legacy crypto suite was not repeated; this follow-up changes Luster's rules and the grouped-deck setup progress display, with no client/deck crypto changes.
- Ten named rules catalog tests, plus full-game core and encrypted-packet replay tests, cover every entry in RULES.md. The numeric card/patron fingerprint covers every cost, discount, score and requirement; two faulty tier-two values in one external reference have explicit regression assertions.
- Random-start tests enumerate all 1,560 ordered setup-card pairs at each player count. Each seat appears exactly 780, 520 or 390 times for 2, 3 or 4 seats respectively. Tests cover out-of-order reveals, the rejected three-seat tail, full/view/spectator agreement, every starter and scoring-trigger position, rotated round numbers, and final token returns/patron choices.
- Pure engine fuzzing checks JSON serialization, immutability, all seats' views and the spectator, consistent public standings, token/card conservation, legal-action samples, shuffled identity claims, immutable assignment history and full/private replay.
- 100 packet-adapter games for 2–4 seats completed with view checks enabled after the random-start change: 14,730 actions, 4,994 purchases, 298 reservations, 67 token returns and 19 patron-choice decisions, with no failures.
- Complete NOSTR simulations for 2, 3 and 4 seats passed after the change with verified audits and attestations: 252 player actions across 783 signed events, no forfeits or cancellations.
- Production build and the existing restricted-name distribution scan passed after the change. All three Luster browser flows passed (2, 3 and 4 players). The existing Chess browser flow passed before this follow-up.
- Partition security tests preserve the legacy one-deck domain and reject malformed partitions, a proof for another group, and a proof over another group's input. A spectator folds all partition steps and derives the same public reveal.
- The browser tests play complete two-, three- and four-player games through NOSTR, each with an additional spectator. They check agreement on the random starter; owner-only immediate knowledge of blind reservations; purchases/payments and token actions; mid-game reload preserving the starter; a passed audit and confirmed result signatures from every player; and the rules route. At 390px, game and rules pages have no horizontal page overflow. Captured screenshots are in `/tmp/luster-{2,3,4}-*-390.png` and `/tmp/luster-{2,3,4}-result-1280.png` in this session.

## Integration boundaries

Luster-specific paths: `packages/games/luster`, `apps/web/src/games/luster`, `apps/web/test/luster.test.ts`, `apps/web/e2e/luster.spec.ts`, `tools/fuzz/src/luster.ts`, and `docs/games/luster`.

Shared runtime additions: `DeckSpec.partitions` and explicitly opt-in `DeckSpec.promptShares`; `packages/client/src/partitioned-deck.ts` and opt-in session shuffle handling; the `share` duty, builder and simulator dispatch; and web-controller dispatch with separate persisted share slots. The game screen counts completed players correctly when each player has several shuffle steps. Registries, manifests, lockfile and Vitest configuration receive additive entries. Existing catalog-model test expectations include the added game. No Bank files, dice library, cryptographic primitive, protocol format, PWA or global style files change.

## Limits

**Merge/deploy authorization: Luster-only exception.** The initial release assessment was blocked by D050's no-prompt-shares gate. After that assessment, the owner instructed: "For this game only, merge and deploy anyway." This authorizes the current beta release while retaining the disclosed limitations. It does not approve the Phase K protocol or permit prompt duties in other games. The immediate `share` duty now requires explicit `DeckSpec.promptShares`; only Luster's production module enables it. Other games, including partitioned decks without that opt-in, retain turn-piggybacked card shares. Policy tests verify that private layers are released automatically only with the explicit flag, and that the owner never automatically shares its private layer.

The duty publishes newly assigned non-owner layers immediately, including private reservations, using the existing root-scoped Shares format. Current happy-path and cross-partition checks do not establish safety across competing action branches, stale devices and reorganisation. Authorization accepts shipping with that unresolved review; it does not establish cheat-proofness or legal/name clearance. GitHub Pages automatically deploys main after CI passes.

The full final `pnpm check` required by CLAUDE.md passed before committing and merging; its results are recorded above separately from the earlier baseline and follow-up runs.

Resign is disabled until the refill/reveal path receives a dedicated review. The new engine and shared deck integration still need dedicated adversarial review before production readiness. Per the follow-up request, a random starting player deliberately replaces the tabletop youngest-player convention. The UI and rules are original, and original gemstone, landscape and noble illustrations are offered under CC0; jurisdiction-specific legal and name clearance remain outside the implementation's verification. Native independent multi-deck sessions are not implemented: the documented packet adapter provides the required behavior for Luster.


## Interface revision verification — 2026-10-04

The redesigned interface passed the full `pnpm check` before its commit: all workspace type checks, lint across 389 files, 116 test files, 1,769 tests passed and 34 skipped. Final presentation refinements also passed web type checking, scoped lint and 24 focused web/catalog/registry tests.

Complete NOSTR browser games passed at 2, 3 and 4 seats. They exercise direct gem selection, pairs and distinct colors, draft removal/reset, card/deck/noble selection, optional Gold substitutions, private reservations, spectators, reloads, audits and every player's result signature. A further two-player run verified the final original-art gradients, keyboard focus restoration, resources beside the bank, affordable-card highlighting and responsive layouts. Public reveal placeholders and mobile tap-target refinements are included in the subsequent combined integration checks.

The standard player-count supply remains 4/5/7 regular gems per color for 2/3/4 players and five Gold. No engine, protocol, deck or dice implementation changes are part of this interface revision. Bank PR #27 landed while validation ran; integration retains its automatic public-dice path separately from Luster's opt-in card shares. The final combined revision receives the repository CI check and Bank plus all three Luster browser flows before merge.


## Face-down hands and score-sidebar verification

Nine focused presentation tests pass, including known market reservations hidden outside their owner’s hand, blind reservations, owner selection, spectator/sidebar output, and absence of face details in text, accessibility labels, tooltips and identity attributes. Bank and complete Luster browser games at 2, 3 and 4 seats pass. These regressions reserve both unseen and market cards, verify backs for every player and spectator, reload the market-card owner, and finish with verified audits and signed results. A further two-player run passes after the card-back contrast correction, including desktop sidebar position/alignment and the tier-one back color. Mobile screenshots and rules fit at 390px.

The local `pnpm check` ran before the commit: all workspace types and lint across 389 files passed; 111 test files with 1,726 tests passed. Its remaining five files failed or skipped cases solely because the first invocation lacked permission to bind local sockets or spawn the build subprocess (`EPERM`). All five affected files were rerun with authorized network access and passed: 57 tests, including relay, controllers, profiles and the public/licensed build controls. Together these runs verify all 116 files and 1,772 distinct passing tests, with the usual 34 skips. The initial command’s nonzero result is recorded rather than described as a clean full-check pass. Final presentation tests, web types, repository lint, production build and distribution scan also pass after the visual refinements.

Bank PR #29 landed during verification and is incorporated unchanged after the Luster commit. The final combined revision receives a fresh full repository CI run and Bank plus all three Luster browser flows before merge. No engine, deck, client, dice, protocol or common library changes are part of this follow-up. Market reservation identities remain public in earlier signed moves; only their current hand presentation is face down. Blind reservations retain engine-level owner-only knowledge.
