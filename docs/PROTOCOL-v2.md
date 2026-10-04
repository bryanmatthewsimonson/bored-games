# Bored Games protocol, version 2 (draft)

`draft` `optional`

This document specifies **protocol version 2**: what changes from version 1 ([`PROTOCOL.md`](PROTOCOL.md)) so that clients can release decryption shares and dice contributions **promptly**, without letting any seat or coalition read a hidden value in a game that goes on.

- **Authority.** The owner approved the design on 2026-10-04: every recommendation of `docs/proposals/prompt-reveal.md` §10, and candidate (e), "plain stop" with the attestation-and-anchor cutoff, as amended in round 3 with the review's fixes F1–F5 (D059). D060 adds the owner's rulings on Bank and Luster. Where this document and the proposal differ, this document is the specification; where it is silent, v1 applies (§3).
- **Why a separate file.** A v1 game is folded by v1 rules for ever, by every client (§2). Keeping `PROTOCOL.md` as the frozen v1 text means a v1 rule never has to be read through "unless proto 2" clauses, and this file can list every change in one place, as a delta with section references. An implementer of v2 reads both: v1 for everything §3 lists as unchanged, this file for the rest.
- **Status.** Specified, not built. The implementation plan is the "Protocol v2" phase of `docs/PLAN.md`. D059 item 8 requires the unproven model scopes (proposal §6.7) to finish before the build.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. "§n" refers to this document; "v1 §n" to `PROTOCOL.md`.

## 1. Overview

| Concern | v1 | v2 |
|---|---|---|
| Releasing shares | Only inside the seat's own next move (v1 §6.2), except the deal and Luster's owner-exception duty (v1 §6.2a) | Also at once, in a Shares event, as soon as the client holds the granting move, while it holds no fork (§6.1). The slow path stays. |
| Shares events | Root tag only | Also an **anchor** tag: the releaser's head (§4.2) |
| Forks | Fork choice picks a branch; the equivocator is flagged and forfeits at the end (v1 §6.6) | **Fork stop:** any held fork ends the game at the fork, as the equivocator's forfeit, unless a result **stands** against it (§5). No branch is ever picked and nothing resumes. |
| Results | Attested by the npub with `{audit, logHash, outcome}` (v1 §7) | An **end attestation** names the result's identity (kind, head, forfeiting seats), without the audit, at once (§4.3, §7). The v1 attestation stays, for stats only. |
| Dice | Roll point bound to a roll counter; contributions are chain moves; the roller's share rides in the Roll move (v1 §6.3a) | Roll point bound to the requesting move; every seat's contribution is an anchored Shares event, the roller's included (§6.2) |
| Devices | Saved-event vetting (v1 §9) | The outbox rule (MUST), a check of the seat's own events before signing (SHOULD), own relays, and one playing device per seat in audit-`'none'` games (§9) |
| Version | `["proto", "1"]` | `["proto", "2"]` on every event of the game (§2) |

**Why it is safe** (proposal §5.2). Only the pending seat can sign a valid successor of a move (v1 §6.5 rule 2), so every fork is two signatures by one seat E on one prev: a self-proving certificate. To read a value through a fork (the D039 attack), a coalition needs every honest seat's share of it, released on side A; each of those honest clients holds A, so the moment any of them holds a rival B, it holds a fork and stops. The game the leak would affect is never played. The cutoff (§5.4) lets a finished result stand against a later fork only when nothing signed by a seat other than E lies on another side of that fork, so a standing result exposes nothing either. The executable model (`tools/protocol-model`, design `stop3`) finds no exposure, honest forfeit, rating gain or divergence in any completed scope (proposal §6.7). It is not a proof; the residuals are in §11.

## 2. Versioning and negotiation

1. **The tag.** Every event of a v2 game carries exactly one `["proto", "2"]` tag: the Table (37450), Joins (7451), the Game root (7450) and every in-game event (7452–7458). The NIP-78 key backup (30078) carries none, as in v1.
2. **A game has one version, for good.** The Table declares it. A Join MUST carry the proto of the Table it joins; the root MUST carry the proto of its Table; every in-game event MUST carry the proto of its root. Clients reject an event whose proto differs from its game's (parse step 3 of v1 §4, with "the game's proto" in place of `"1"`). A v1 game is never folded under v2 rules, and a v2 game never under v1 rules.
3. **Accepted values.** A v2 client accepts `"1"` and `"2"` and rejects any other value. A v1-only client rejects every v2 event at parse step 3, so it never lists a v2 table and cannot join one: there are no mixed games.
4. **Clients support both.** A v2 client MUST fold v1 games by the v1 rules, including v1 Luster games (v1 §5.5, §6.2a), for as long as it shows them.
5. **New tables.** A v2 client MUST create every new table at proto 2. It MAY join an open proto-1 table created by an older client and play it under v1.
6. **The module must support the version.** A module version declares the protocol versions it supports (§10). Clients MUST reject a Table or root whose (module id, engine version) does not support its proto. Bank's v2 engine is v2-only (its beacon moves change, §6.2); Bank 0.1.0 is v1-only. Chain Reaction, Chess and Luster run unchanged engines under both.
7. **Domain strings do not change.** The hash-to-curve DST `bored-games/v1`, the session proof message `bored-games/v1/session`, card points, generators and every proof transcript of v1 §3 and §5 are cryptographic domains, not protocol versions, and stay as they are in v2.

## 3. Unchanged from v1

Everything in `PROTOCOL.md` holds for v2 games except what §4–§10 change. In particular, unchanged:
- **§2 Notation and encoding:** the curve, `H2C`, `HS`, base64url, rejections, canonical JSON.
- **§3 Keys:** npub, session key, deck key, proof of knowledge, `sessionSig`, context strings, the key backup.
- **§4 Parsing (D027)** steps 1, 2, 4 and 5, field formats and the 262,144-byte cap. Step 3 checks the game's proto (§2).
- **§4.1 Table, §4.2 Join, §4.3 Game root:** tags, content and every check, plus the proto rule of §2.
- **§4.4 Move:** tags and both content forms. In a deckless game a game action's `shares` and `reveals` are always empty, a dice game included (§6.2).
- **§4.6 Timeout claim, §4.7 Secret reveal, §4.9 Resign:** tags, content and validity.
- **§5 Deck cryptography,** including partitioned decks (§5.5), which become a general v2 feature (§6.3).
- **§6.1 Phases** (Table, Shuffle, Deal, Play, End) and "a seat deals once"; **§6.2 owed shares** (the rule, buffering, and the slow path: a game action MUST carry every share its seat owes and the client does not hold yet); **§6.3 public reveals; §6.4 private cards;** **§6.5 move validity** rules 2–4, the decide gate and build once.
- **§8.1 Timeout:** local first-seen times, progress, claiming, accepting, stall attribution, claim limits, except as §8 amends.
- **§8.2 Forfeit outcome** for timeouts and failed audits; **§8.3 Resign:** validity, the head gate, cancelling, the scoring position S, the partial audit, unrated with 3 or more seats, the early secret; except as §8 amends.
- **§9 Relays:** publishing, retries, saved-event vetting and subscribing, except as §9 amends.
- **§11 Security considerations** that do not concern fork choice.

**Removed in v2** (each replaced as noted):
- Fork choice and its ranks, settled branches, the freeze, frozen ends and `"endedBy":{"type":"fork"}` (v1 §4.8, §6.6, §11): replaced by the fork stop and the cutoff (§5).
- Shuffle candidates and acknowledgement (at most 3 unacknowledged steps per prev, v1 §6.6): any two well-formed steps by one seat on one prev are a fork (§5.2), so no step needs to be verified to stop.
- Flagged equivocators who play on and forfeit at the end (v1 §6.6, §8.2): a fork either stops the game or only records E (§5.5).
- The deal-phase stall exception for a held shuffle fork (v1 §8.1): a held fork stops the game, before the first game action, so it is cancelled.
- The Secret reveal's wait for a full view (v1 §9, D056 fix round 2), which existed for the freeze: a v2 client MAY publish its Secret reveal as soon as its result needs it (§7).
- The Luster share duty and `DeckSpec.promptShares` (v1 §6.2a): replaced by prompt release for every deck game (§6.1).
- Roll shares inside Moves and the counter-bound roll point (v1 §6.3a): replaced by §6.2.

## 4. Events

The kinds of v1 §4 are unchanged, plus one new kind:

| Kind | Name | Type | Signed by | v2 change |
|---|---|---|---|---|
| 7453 | Shares | regular | session key | anchor tag; a roll variant; allowed in a dice game (§4.2) |
| 7456 | Result attestation | regular | player npub, or session key for an end attestation | two content variants (§4.3) |
| 7458 | Device note | regular | session key | new (§4.4) |

Every list below names each tag that MUST appear exactly once unless marked otherwise, as in v1 §4. Tags with other names are ignored. Each content form has exactly the keys shown and exactly one accepted encoding.

### 4.1 The proto tag
`["proto", "2"]`, exactly once, on every event of §2 item 1.

### 4.2 Shares (7453)
Decryption shares and dice contributions outside the move chain: the deal, prompt releases (§6.1) and roll contributions (§6.2).

**Tags:**
- `["e", <rootId>, "", "root"]`
- `["e", <anchorId>, "", "anchor"]`: **the anchor**, the releaser's head when it built the event: the id of the last move on its walk (§5.1), or the root id when the walk holds no move. Exactly two `e` tags, one per marker.
- `["proto", "2"]`

**Content, card variant** (a game with a deck):
```json
{"shares":[{"d":"<point>","pos":<n>,"proof":{"c":"<scalar>","s":"<scalar>"}}, …],"type":"shares"}
```
- `shares` holds **one or more** shares, strictly ascending by `pos`, each encoded as in v1 (§5.4; `packages/deck` `encodeShare`). `pos` is a global deck position (a packet position with a partitioned deck).

**Content, roll variant** (a game that rolls, §6.2):
```json
{"move":"<64 hex>","shares":[{"d":"<point>","pos":<n>,"proof":{"c":"<scalar>","s":"<scalar>"}}, …],"type":"roll"}
```
- `move` is the id of the **requesting move**, the Move whose action requested the rolls.
- `shares` holds one or more contributions, strictly ascending by `pos`. Here `pos` is the **roll index n** within the requesting move (0 for the first roll it requests), not a deck position.

**Parser rules** (in addition to v1 §4's pipeline):
- The anchor id and `move` are 64 lowercase hex characters.
- `type` is `"shares"` or `"roll"`, and selects the key set: `{shares, type}` or `{move, shares, type}`.
- An empty `shares`, a repeated or descending `pos`, or any share that fails v1's strict codec is rejected.

**Session rules:**
- A card variant in a game without a deck, or a roll variant in a game whose module does not roll (§10), is invalid.
- Every card share MUST verify against the signer's deck key and the final deck (v1 §5.4), or the whole event is rejected (as v1 `foldShares`). A card variant that arrives before the final deck is complete waits.
- Every roll contribution MUST verify as §6.2 says, against the requesting move. A roll variant whose requesting move is not held waits. One whose requesting move is held but requested fewer than n+1 rolls, or whose move is not a game action, is invalid as a whole.
- A client keeps at most one card share per (seat, position) and one contribution per (seat, requesting move, n), the first valid one (v1 §5.4).
- The anchor does not affect validity. A client records each held Shares event's signer and anchor for the cutoff (§5.4). An anchor that names an event the client does not hold is kept as **unresolved**.

### 4.3 Result attestation (7456)
Two content variants under one kind (D059 item 7).

**End attestation** (new): names a result's identity (§5.3), with no audit.
- **Tags:** `["e", <rootId>, "", "root"]`, `["e", <headId>, "", "head"]` (the result's head, §5.3), `["proto", "2"]`.
- **Content:**
  ```json
  {"end":{"forfeit":[<seat>, …],"kind":"over"|"claim"|"resign","logHash":"<64 hex>"}}
  ```
  - `kind` `"over"`: `forfeit` is `[]`.
  - `kind` `"resign"`: `forfeit` holds exactly one seat, the resigning seat.
  - `kind` `"claim"`: `forfeit` holds one or more seats, the seats the claim forfeits (§5.3).
  - `forfeit` is strictly ascending; every entry is a seat of the game (checked by the session; the parser checks non-negative safe integers).
  - `logHash` is v1's log hash (v1 §4.8) of the chain's move ids from move 1 to the head, in `seq` order.
- **Signer:** the seat's session key or its npub. An honest client signs it with the session key, automatically, with no signer prompt (§7). Either key counts for its seat.
- **Consistency:** once the client holds the head and the line to it (§5.1), it checks that `logHash` is that line's log hash. A mismatch makes the attestation invalid, and it is ignored for every purpose. Until then the attestation is kept as unresolved.

**Stats attestation** (v1 §4.8 and §7, kept for stats and display only):
- **Tags:** `["e", <rootId>, "", "root"]`, `["proto", "2"]`, and no `head` tag.
- **Content:** `{"audit":…,"logHash":"…","outcome":{…}}` exactly as v1 §4.8, except that `endedBy.type` is only `"resign"`: v2 has no frozen ends, so a v2 client rejects `"type":"fork"`.
- **Signer:** the player's npub only, as in v1.

**Parser rules.** The content key set selects the variant: exactly `{end}` is an end attestation and requires the `head` tag; exactly `{audit, logHash, outcome}` is a stats attestation and MUST NOT carry a `head` tag. Anything else is rejected. In the `end` object every key is required, and `forfeit` must match `kind` as above.

### 4.4 Device note (7458)
Hands one seat's play over from one device to another in a game whose module declares audit `'none'` (§9.5). Other games never need one; clients ignore a note in such a game, apart from storing it.

**Tags:** `["e", <rootId>, "", "root"]`, `["proto", "2"]`.

**Content:**
```json
{"device":"<32 lowercase hex>","n":<integer ≥ 1>,"type":"device"}
```
- `device` is the new playing device's id: 16 random bytes the device drew when it first opened the game, as 32 lowercase hex characters.
- `n` is the note's number: one more than the highest `n` the signing device held for its seat, a decimal integer without leading zeros.

**Signer:** the seat's session key. Every device of a seat holds that key (it is restored from the backup), so the note does not authenticate a device to other seats; it lets a seat's honest devices agree which one plays (§9.5).

### 4.5 Subscriptions
v1 §9's filters, with the new kind and the session-key end attestations:
- `{"kinds":[7452,7453,7454,7455,7456,7457,7458],"authors":[the seats' session keys],"#e":[rootId]}`
- `{"kinds":[7456],"authors":[the seats' npubs],"#e":[rootId]}`
