# Driftwrights implementation and release gates

Status: **implemented; local release checks passed** (2026-10-06, PR #39).

The owner authorized a Driftwrights-specific D050 exception (D069) and merge/deployment once ready. The game keeps independent player clients and Nostr relays; there is no trusted dealer. Original floating-island art and rewritten rules accompany the three/four-player classic-layout implementation.

## Multiplayer implementation

`module.ts` implements the pure GameModule contract. Full mode knows all hands for replay/audit. View mode uses public resource counts, unknown sentinels for rival hands, privately learned ventures and encrypted supply deliveries. Never broadcast or store the reference authoritative State as production public state. Production registration covers the lobby, catalog, rules page, board, fuzz target and signed session.

Cards and dice use separate proof slots and verification caches. New mixed-game rolls bind every contribution to the signed requesting move, before any contribution is released. Bank's existing deckless path retains its original wire format. The prompt-share flag is allowlisted for Driftwrights, Luster and Right of Way.

Theft uses a uniform public index in the victim's privately permuted hand. Its committed deck key, root and requesting move fix the permutation before contributions arrive. Victim and thief receive separate authenticated NIP-44 packets. Other seats see the public count change. At game end, released deck keys let everyone verify both packets and the exact selection. Resource payments, discards and complete named-resource requisitions are concealed claims during play and checked against full hands by the final audit; this is not a live zero-knowledge inventory proof. A dishonest claim fails its signer. No future venture ciphertext changes owners.

An immediately purchased landmark can win on its owner's turn, once its private draw is delivered. Public victory declarations include landmark identities and verified decryption shares. Resignation stays disabled. The ordinary session deadlines, forfeit handling and final secret/audit duties apply.

D069 accepts the existing v1 fork/rollback limits for prompt release, as for Luster. It does not establish safety against equivocating prompt releases; protocol v2 remains the general remedy.

## Rules fidelity

The [publisher FAQ](https://www.catan.com/faq/basegame) supports the separate trade/build sequence, action ventures before rolling, finite-bank production shortages and award ties. Reference names stay in documentation except for the single public comparison phrase (D080).

The scarce-bank Windfall interpretation is explicitly a table rule (`available` or `two`, C33, D070). New tables default to taking whatever remains when the entire bank contains fewer than two supplies. Applying the general sole-recipient shortage exception to Windfall is an inference; no explicit publisher clarification was found. The alternative requires two available supplies. Ordinary play requires exactly two under both options.

## Verification and release gates

- Reference catalog: 33 cases, including 22 complete seeded games and exact replay.
- Pure network adapter: complete games in independent owner views plus a spectator; private theft, venture delivery, requisitions and declaration.
- Codec/audit tests: unrelated seats cannot decrypt; root/request/parent replay fails; both packets are verified; dishonest selections fail the sender.
- Signed sessions: complete independent games, out-of-order replay/reload and final audits.
- Browser: full three/four-seat games through real relay events, negotiated trades, private theft, venture draws, reload, spectator privacy, phone layout and final audits.
- Release: full `pnpm check`, existing browser regressions, production build/brand scan and CI must pass. Then merge and verify GitHub Pages' deployed commit and live game picker.

### Completed local checks (2026-10-06)

- `VITEST_MAX_WORKERS=2 pnpm check`: 144 files passed, 2,043 tests passed, 40 optional tests skipped; typechecking and linting passed.
- `E2E_CHROMIUM=/usr/bin/chromium pnpm e2e`: all 15 browser tests passed, including complete three/four-seat Driftwrights games and existing Bank, Chess, Luster, Chain Reaction, Right of Way and profile regressions.
- Signed three/four-seat sessions, private packet forgery attribution, card/beacon separation and legacy Bank/Right of Way transport checks passed.
- 100 seeded independent-view games passed invariants and replay across 92,705 actions.
- `VITE_LICENSED_BRANDS=0 pnpm build:web` and `pnpm scan:dist` passed on the release application source.

PR #39 records the final CI, merge and deployment result. The 40 skipped tests are the repository's optional simulation checks; the complete signed Driftwrights games are part of the ordinary suite.

The reference fixture remains development-only and is excluded from production entry points. Its one-device coordinator/policy are test tooling. Artwork is original generated artwork from this task, with no reference-game images; its CC0 dedication is in `packages/games/driftwrights/ART-LICENSE.md`, matching the catalog credit. The title is provisional: no trademark clearance search is claimed.
