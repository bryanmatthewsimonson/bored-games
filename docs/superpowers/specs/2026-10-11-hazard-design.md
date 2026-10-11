# Hazard: design

**Date:** 2026-10-11. **Status:** brainstorm answered by the owner in conversation; this file awaits the owner's review before the plan is written.

**Scope:** a full build in the manner of D078 (Room for Doubt) and D080 (Gilt & Guile): rules, engine, catalog tests, fuzz target, web game, rules page, original art (cover, thumbnail, atlas, cards), three in-play screenshots, an e2e spec, the "Compare to" phrase, guards, and decision-log entries.

## 1. Request and success criteria

The owner asked: *"Design a trademark & copyright safe version of Risk with a clever name and original artwork and rewritten rules, which follows the exact same gameplay mechanics as Risk. Make sure to include all game metadata, art, screenshots, BoardGameGeek link, and 'Compare to [Game]' hint. The art needs to be appealing and fit the game."* (This file is under `docs/`, so it may name the reference game; CLAUDE.md, D046.)

Done when:
1. `docs/games/hazard/RULES.md` states the classic world-domination rules exactly, in new prose, each rule marked **verified**, **platform** or **OPEN**, with a `#### Cnn` catalog and a named test for every entry.
2. The engine `packages/games/hazard` is pure and passes its catalog, invariants and the fuzzer (games end by conquest).
3. Hazard is playable on the site by 3–6 players: lobby, game screen, rules page, catalog card with cover art, "Compare to" link (BoardGameGeek 181), three screenshots.
4. Nothing reproduces the reference game's names, map drawing, card art, piece look or rulebook wording. All art is original and dedicated CC0-1.0.
5. `pnpm check` passes; the e2e spec passes; `pnpm sim --game hazard` finishes whole games with the audit passing.

## 2. Decisions taken in the brainstorm

| Decision | Choice (owner) | Set aside |
|---|---|---|
| Name | **Hazard**: a synonym of the reference title, and the medieval dice game that craps descends from | Overreach, Brinkmanship |
| Opening | classic: claim one army at a time, then place one at a time | bulk placement; both as an option |
| Defender's dice | table option `defense`: `choose` (default, exact) or `auto` (always the most allowed) | choose only; auto only |
| Seats | 3–6; the 2-player neutral variant is OPEN, logged | 2–6 with neutral now |

**Name check.** A generic English word; not a trademark search (as for Luster, Right of Way and Room for Doubt, a lawyer clears the name before release). Fallback title: *Overreach*.

## 3. Sources

The Parker Brothers rulebook, 1993 printing ("Rules ©1959, 1963, 1975, 1980, 1990, 1993"), 16 pages, read in full from a public library's PDF. Every rule below is **verified** against it unless marked. BoardGameGeek id **181** for the reference game is to be confirmed at build time by a search limited to boardgamegeek.com.

| Topic | Rule | Basis |
|---|---|---|
| Players | 3–6 (2 with a neutral army: OPEN) | verified |
| Starting armies | 35 / 30 / 25 / 20 for 3 / 4 / 5 / 6 | verified |
| First player | one die each, highest claims first and takes the first turn; ties roll again among the tied | verified; the tie roll is **platform** |
| Claim | in turn, one army on an empty territory, until all 42 are held | verified |
| Place | in turn, one army on an own territory, until every army is placed; seats with none left are skipped | verified; the skip is **platform** |
| Reinforcement | max(3, ⌊territories / 3⌋) + every whole continent held at the turn's start | verified |
| Continent bonuses | 5, 2, 5, 3, 7, 2 for the 9-, 4-, 7-, 6-, 12- and 4-territory continents | verified (board chart, as recalled and matching every secondary source) |
| Cards | 44: 42 territories (14 of each of three designs) and 2 wilds | verified |
| Sets | three alike, one of each, or any two and a wild | verified |
| Set values | 4, 6, 8, 10, 12, 15, then +5 each, counted over all players' trades | verified |
| Territory bonus | a traded card showing a territory you hold: +2 armies, placed there; at most +2 per turn | verified |
| Forced trade | 5 or more cards at the turn's start: trade at least one set (may trade a second) | verified |
| Attack | from a territory with 2+ armies to an adjacent enemy; attacker 1–3 dice (one fewer than the armies), defender 1–2 (2 needs 2 armies); both announce, then roll | verified |
| Battle | highest against highest, then the next pair; ties to the defender | verified |
| Conquest | move in at least the dice of the last roll, leaving one behind | verified |
| Card earned | one card at the end of attacking, if at least one territory was captured this turn | verified |
| Elimination | take the loser's cards; with 6+ trade at once until 4 or fewer, then stop; fewer than 6 waits | verified |
| Fortify | once, from one territory to one adjacent own territory, leaving one | verified; the connected-path variant (an expert rule) is OPEN |
| Win | hold all 42 territories | verified |
| Empty draw pile | the traded-in cards are shuffled into a new pile; if there are none, no card is drawn | **platform** (the 1993 book is silent) |

Out of scope, logged OPEN: the 2-player neutral rules, Capital and Secret Mission variants, the expert variations.

## 4. The game under its own names

- **Title:** Hazard. **Tagline:** "Six realms. Forty-two provinces. Every roll a hazard."
- **World:** *the Meridian*, an invented world of six realms. The map is a **topological twin** of the reference board (the same 42 nodes, the same 83 links, the same continent sizes and bonuses), because the graph is part of the mechanics; every name, every coastline and the whole drawing are new. The realms sit in a mirrored, island-chain arrangement unlike the reference map's, each realm its own landmass, with 14 sea lanes between realms (and two within the south-east isle's realm), drawn as dotted lines. The far west and far east are joined by a lane that runs off both edges.
- **Realms (bonus):** Hollowpine 5 (9 provinces), Verdance 2 (4), the Old Crowns 5 (7), Sunscorch 3 (6), the Vast 7 (12), Farshore 2 (4).
- **Vocabulary:** provinces (territories), troops (armies), realms (continents), muster (reinforce), charters (cards), with three designs **Spear**, **Horse** and **Cannon** and the wild **Crown**; a set is cashed in; *march* is the fortify move.
- **Engine ids:** provinces `a1`–`a9`, `b1`–`b4`, `c1`–`c7`, `d1`–`d6`, `e1`–`e12`, `f1`–`f4`; realms `a`–`f`. Names live only in `src/theme.ts`.

## 5. Art

All drawn for this repository, CC0-1.0, no raster from elsewhere.
- **Atlas:** a hand-tuned hex grid (pointy-top, odd rows offset), one ASCII grid in the package; each province is a contiguous cluster of hexes. Provinces are filled with the holder's color over a parchment sea with wave hatching, realm coastlines drawn thick, province borders thin, troop counts on round tokens, realm names in an engraved serif, a compass rose and a cartouche. A test proves the grid's land contacts plus the listed lanes equal the engine graph, edge for edge, and that every province is contiguous.
- **Charters:** card faces with the province's own hex silhouette and its design glyph (spear, horse head, cannon), the Crown for wilds.
- **Cover and thumbnail:** an atlas fragment with troop tokens, three red and two ivory dice mid-roll, the title on a banner; a textless square thumbnail.
- **Screenshots:** `pnpm previews hazard` from a fuzzed game: the opening claim, a mid-game battle, a late game with charters.

## 6. Online play

- **Dice:** the platform's dice beacon (D058), one committed roll per battle (`rollShape` = attacker's dice + defender's dice, d6; the attacker's faces first), and one per first-player roll (one die per seat still tied). Every seat contributes, eliminated seats included (the session needs all shares).
- **Charters:** one hidden deck `pile` of 44 with `promptShares` (D075). A drawn charter is dealt privately to its drawer.
- **Cashing a set is a two-step public reveal**, for every set: the `cash` action names three held positions and the bonus province; the engine deals them to the public and pends `{type:'reveal'}`; every seat's app shares; once the cards are known the engine checks the set and grants the troops. One path for all sets, because a charter captured from an eliminated seat cannot be revealed through `revealsOf` (its first holder publishes no public share until the position is dealt to `null`, PROTOCOL §6.2). A set that turns out invalid (only a cheating client can send one) is discarded for nothing and the seat is marked as having fouled; the audit names it.
- **Empty pile:** a play-phase epoch (D073) shuffles the cashed charters into a new pile (deck id `pile`, so the session's epoch path applies).
- **Elimination:** the loser's charters are re-dealt privately to the conqueror with sealed shares (D067).
- **Resign:** disabled (`resignAllowed` false) pending a D052 review, as for every deck game with public reveals.

### 6.1 Platform changes (new decision entry)

The investigation of `packages/client` found that no game yet combines the beacon, epochs and re-dealt positions, and three gaps follow. Each is fixed generically, with tests, and leaves every existing game's wire format unchanged (each new branch is reachable only by a module that has both epochs and a beacon, or a re-dealt epoch position):
1. **Roll positions collide with epoch positions.** A roll's share sits at `deckSize + id`, and epoch k's cards at `stride·k + i`, so roll 84 lands on epoch 1's first card in a 44-card deck. Fix: in a game with both epochs and a beacon, roll positions use only the unused tail of each stride block (`stride·b + size + j`), and every "card or roll?" filter (`pos < deckSize`) asks one helper instead.
2. **Sealed shares read only the opening deck.** `intakeSealed`, `sealedVerifies` and `buildSealed` use `deck[pos]`; they take the ciphertext through `ciphertextAt`, so a charter drawn after a reshuffle can be re-dealt.
3. **`pnpm sim` cannot reshuffle.** `sim.ts` maps a `shuffle` duty to `buildShuffle` only; it learns the epoch builder, as the web controller already does.

## 7. Testing

Catalog tests per `#### Cnn`; invariants (armies ≥ 1 per held province, 42 held after the claim, card conservation); fuzz with policies that conquer, so games end; `pnpm sim --game hazard` with real cryptography; client session tests for re-deal plus epoch plus beacon; an e2e spec through the opening, battles, a drawn charter's privacy, and a reload.
