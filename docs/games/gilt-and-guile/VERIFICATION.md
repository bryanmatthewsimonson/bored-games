# Gilt & Guile — verification (2026-10-10)

The implemented scope is the current base edition: 26 selectable company cards and seven basics. Expansions and retired first-edition cards are excluded.

- 36 rules catalog tests pass. Each added effect has a focused case; complete two-, three-, and four-player games exercise all three curated supplies with card conservation, strict move validation, full-state replay, private player views, and spectator agreement.
- A real encrypted two-player session with a spectator passes opening partition shuffles, public cleanup, private draws, and two discard epochs. The final implementation marks explicit public reveals through the existing append-only dealt log; it does not bypass saved-share vetting.
- The 34 shared deck regressions pass: partition limits, the existing large opening deck, existing small-deck epochs, and the new game session.
- The broader game/web/repository/protocol run passes 1,285 tests across 65 files. The final focused game and encrypted-session reruns also pass after the public-assignment correction.
- 294 branding/source-guard/render tests pass. Public catalog facts use the approved comparison phrase, link to BoardGameGeek 36218, and preserve the non-affiliation notice. The production build and restricted-name scan pass.
- Repository type checking passes. Lint has no errors; non-null assertion and CSS specificity warnings remain. No new dependency was added.
- The two-browser end-to-end flow passes: 33-card catalog, search and filters, ten-card selection validation, persistence of the alternative Backstage Intrigue supply (including Headliner and Repertoire), joining, private hands, modal card play, purchase, public cleanup, two reshuffles, desktop scores to the right, and no horizontal overflow at 390/768/1440 pixels.
- All 33 original illustrations were rendered and visually inspected. The complete catalog also fits 390/768/1440-pixel viewports without page overflow.
- After integrating the latest main (Quill & Quarry), both browser tests pass together: Gilt & Guile through its two discard reshuffles, and Quill & Quarry through final scoring and audit. The combined repository typecheck and lint pass.
- Pre-merge `pnpm check` passes on the combined implementation: 185 test files, 2,520 tests passed and 40 skipped, using two workers. The combined production build and restricted-name distribution scan also pass.

The first browser run identified an inaccessible select label, which was corrected. The real browser cleanup test identified the saved-share ownership check; cleanup now appends a public assignment before requesting its reveal, using the established protocol flow. Final rules, session, and browser tests pass with that correction.

This is an experimental implementation. These tests do not constitute trademark clearance or an adversarial cryptographic review. Existing platform prompt-share limitations and disabled Resign are documented in RULES.md and D080.
