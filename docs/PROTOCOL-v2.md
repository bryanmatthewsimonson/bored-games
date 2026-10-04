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
- The deal-phase stall exception for a held shuffle fork (v1 §8.1): a held fork stops the game, which is cancelled while no game action has been played past it (§5.6).
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

## 5. The fork stop and the cutoff (replaces v1 §6.6)

Everything in this section is a function of the events the client holds: no clock, no arrival order. Clients holding the same events compute the same walk, the same fork, the same standing result and the same stop.

### 5.1 The walk
- **Held moves.** A held Move is a Move event (7452) of this game that parses (v1 §4.4, §5.5) and is signed by a seated session key, whether or not it is valid.
- **Lines.** The **line** of a held move h is h and its ancestors through `prev`, down to the root. A line is **valid** when every move on it is valid at its prev (v1 §6.5 rules 2–4, judged on the state folded along that line, owed shares included; for a shuffle step, its proof verifies). Lines other than the walk are folded only when the cutoff needs them (§5.4).
- **Descendants.** A held event id `a` is **at or past** a move or root `h` when `a = h`, or the `prev` links of held moves lead from `a` down to `h`. An id the client does not hold, or whose `prev` links reach a move it does not hold before reaching `h`, is not at or past `h`.
- **The walk.** Start with the head at the root. At head h, let **C(h)** be the set of held Moves with `prev` h and `seq` one more than h's that are **valid-looking** at h:
  - a shuffle step (`seq ≤ N`): **well-formed**: it parses, `seq ≤ N`, and it is signed by the seat that step belongs to (v1 §5.5: seat `floor((seq−1)/G)`; seat `seq−1` for an unpartitioned deck). Its proof need not verify;
  - a game action: valid at h on every check of v1 §6.5 except the owed-shares rule (v1 §6.6's definition): the signer is pending, every share and reveal proof verifies, the reveals decrypt to the claimed cards, and `apply` accepts the action.

  Then:
  - if C(h) holds **two or more** moves, the walk **ends at a fork at h** (§5.2);
  - if C(h) holds exactly one move and it is **valid** (it also passes the owed-shares rule, and a shuffle step's proof verifies), it is linked: the head becomes that move, and the walk continues;
  - otherwise (no move, or one that waits or is invalid), the walk **ends at h**: h is the client's head.
- **The chain** is the walk's moves. Derived reveals (v1 §6.3) and derived rolls (§6.2) are applied along it as the fold reaches them. The walk does not stop at a counted claim or a counted Resign: moves past them are linked, so that forks past them are found, but they are never scored (§5.5).
- **Holding a fork.** A client **holds a fork** exactly when its walk ends at a fork. Then it holds no head to play on.

### 5.2 Forks and the fork certificate
- **A fork** at a move or root P is two or more valid-looking successors in C(P), with P on the walk. By v1 §6.5 rule 2 they are all signed by one seat E: the seat pending at P (for a shuffle step, the step's seat). The walk meets forks in order from the root, and **the topmost fork decides**: forks below it are never judged on their own (proposal §5.1 rule 6, "Several forks").
- **The fork certificate** is a pair of distinct Move events with the same `prev` P, the same `seq` and the same signer E, both valid-looking at P, with P on the walk. It is self-proving: anyone who holds the game's events up to P, and the shares the two moves' validity depends on, can check it by folding to P. Shuffle steps need only be well-formed.
- **A rival that becomes valid-looking later** (its reveal shares arrive late, proposal R4) makes the fork when it becomes valid-looking, and not before.
- A fork never flags E for later: it either **stops** the game at P (§5.5) or, if a result stands (§5.4), only **records** E. E is recorded in both cases, by the certificate.

### 5.3 Results and their identity
A **result** is a natural end, a counted Timeout claim or a counted Resign. A cancelled game (a claim or Resign before the first game action, v1 §8.2, §8.3) has no result. **A result's identity is (kind, head, forfeiting seats)** (D059 item 7; proposal §5.1 rule 6, F4):

| Kind | Head | Forfeiting seats |
|---|---|---|
| `over` | the move at which the module reaches `over` | none: `[]` |
| `claim` | the head the Timeout claim names (the client's head when it accepted the claim) | the seats stalled at that head when the client accepted it (v1 §8.2: every stalled seat forfeits), ascending |
| `resign` | the head the counted Resign names (its `head` tag) | the resigning seat |

- The resign's head is the head it **names**, not its scoring position S, so every client that counts the same Resign gives it the same identity. Its scoring position is computed from that head (§8.3).
- With a single stalled seat a claim's identity is the approved (kind, head, seat). A claim can forfeit several seats (a pending public reveal, v1 §8.1), so the forfeiting seats are a list.
- The audit is not part of a result (§7.2).

**A result is valid** from the held events when:
- its head is the root or a held move whose line is valid; and
- `over`: the forfeiting list is empty and the module is over at the head;
- `claim`: the list is non-empty, the module is not over at the head, the line to the head holds a game action, and the client holds a Timeout claim (7454) naming that head, signed by a seat not in the list. No clock and no stall check: rule (a) below asks every seat but E, the forfeiting seats included, to have attested it;
- `resign`: the list is one seat k, the client holds a valid Resign (v1 §4.9) by k naming the head, and it does not cancel (v1 §8.3): its head is at or after the first game action, or the line to its scoring position (§8.3) holds a game action by k.

### 5.4 The cutoff
When the walk ends at a fork at P, signed by E, a result X **stands** against it when all three hold:
- **(a) Attested.** Every seat other than E has signed at least one valid end attestation (§4.3) of X's identity, with either of its keys. This includes the forfeiting seats of a claim or a resign, unless that seat is E. Every end attestation counts, not only a seat's latest: a later one cannot withdraw an earlier one.
- **(b) Nothing off its line.** No seat other than E has signed any of the following **off X's line**, where X's path is X's head and its line, and "past X's head" is "at or past X's head" (§5.1):
  - a **Move** that is neither on X's path nor has its `prev` at or past X's head;
  - a **Shares event** whose anchor is neither on X's path nor at or past X's head. An unresolved anchor (not held) is off the line;
  - an **end attestation** whose head is neither on X's path nor at or past X's head (attestations are anchored on their head; round 3, after the battery).

  Events past X's head do not block X: the values they concern were granted after X's end, so a read of them is post-end (proposal §2.2). The test is **global**: it covers every held event by every seat other than E, wherever it lies, not only events near the fork. It does not cover Timeout claims, Resigns, Secret reveals, stats attestations or Device notes.
- **(c) Alone.** No other valid result meets (a) and (b).

Only valid results are candidates (§5.3), and a valid result's head lies on the walk or below P (a valid line through a move above P that is not on the walk would be a fork above P).

**Then:** if exactly one result X stands, the game's result is X, and the fork only records E: nobody forfeits for it, and X's places and scores do not change for it. Otherwise the game **stops at P** (§5.6).

**What the clauses are for** (proposal §5.2, §6.7). Without (b), a seat's second device that attests side B while its first device released a share on side A lets B stand: an exposure. Without the forfeiting seat in (a), two colluders time out an honest seat, attest it and fork. With attestations left out of (b), or events past the head counted, a 2-seat game with two devices and a resign gives the opponent a rating gain. The model checks each of these as a regression.

### 5.5 The game's result
- **No fork held:** the client's own result, by v1 rules as §8 amends them: the module over on the chain, an accepted Timeout claim, or a counted Resign; or the game is live; or it is cancelled.
- **A fork held:** the standing result X if one stands (§5.4); otherwise the **stop** at P. A stop **overrides** any claim or Resign this client counted that does not stand (proposal §5.1 rule 7), so every client reaches the same answer from the same events.
- **Not final while events arrive.** Attestations that arrive later can make a result stand, and a rival that arrives later can move the topmost fork up. A client recomputes the walk and the cutoff whenever it folds an event. Clients converge once every event has reached every client (A3, §9.1). What still depends on arrival order is the claim and resign race with no fork held (v1 §11), unchanged.
- **Scoring a standing result:** `over` is the module's outcome with the audit (§7.2); `claim` is v1 §8.2's forfeit ranking at its head; `resign` is v1 §8.3's resign ranking at its scoring position S (§8.3).

### 5.6 The stop and its scoring (proposal §5.1 rules 4 and 5; D059 items 3 and 4)
The stop ends the game at P. It is never resumed. Its outcome:
- **Cancelled only if nothing was played** (review H1). The game is **cancelled** (no result, no attestation, no rating change; E is recorded) only when the client holds **no game action at or past P on any line**: no held Move that is a game action, whose line is valid and passes through P (it is at or past P, §5.1). The test is on what was played, not on where P is: a fork at the root or at an old shuffle step, signed after play began, is a stop scored as below, never a cancel. Otherwise E could escape a lost game at any time by signing a second move 1, or a second well-formed step on its old shuffle prev (whose proof need not verify).
- **2 seats:** E is last and the other seat first. Scores are the module's `standings` at P; the reason is `stop`. The result is **rated**: a loss for E.
- **3 or more seats:** E is **strictly last** and its last place is **rated**. The other seats are ranked by `standings` at P, ties sharing places; scores are the standings; the reason is `stop`. The result is **unrated for every seat other than E**, and E is recorded as the seat that ended it.
- **P before play.** When the walk up to P holds no game action (P is the root, a shuffle step, or the head during the deal or before the first action) but the stop is not a cancel, `standings` at P are not used: every seat other than E shares first place, E is last, and every score is 0. The 2-seat and 3-or-more-seat rules above still decide what is rated.
- **A game with a deck:** secrets and a partial audit up to P may follow; they never change the places except for a proven audit failure (§7.3).
- **No time limit** (D059 item 3): a seat can cause a stop at any time while the game is live, as it can resign; after the end, only until the result stands (F1, accepted, D059 item 6).
- **Never attested** (F5): a client publishes neither an end attestation nor a stats attestation for a stop. A stop and its equivocator are recorded by the fork certificate (§7.5).

**Why E is rated last with 3 or more seats.** Scored as an unrated abort alone, a timed-out seat could fork at its own head and turn its rated last place into an unrated abort, now that a stop overrides a counted claim (the model's `void-forfeit`). Scored as E's timeout at P, E would choose the position the others are rated at.

### 5.7 While a fork is held
- No seat is stalled, so no Timeout claim counts, including after a stop (§7.3).
- The client owes no decision and releases nothing: no Move, no Shares event, no roll contribution, no end attestation (§6, §7.1).
- It keeps folding every event it receives, so that the cutoff and the topmost fork stay current (§5.5).

## 6. Prompt release

### 6.1 Card shares (proposal §5.1 rule 2)
A seat's client **releases** its shares of newly granted positions in a Shares event as soon as it can, instead of waiting for its own next move.

**Conditions.** A client MUST NOT publish a card Shares event unless all of these hold:
1. it holds no fork (§5.1), and its head is h;
2. the game has no result on this client and is not cancelled;
3. the final deck is complete (the deal or the play phase);
4. it holds no Shares event of its own seat that fails against the final deck (a seat deals once, v1 §6.1).

**Positions.** The event MUST hold only positions that `dealt` at h's state assigns **to another seat or to `null`**, and for which the client holds no verified share by its seat (the owed positions of v1 §6.2). It MUST NOT hold a position dealt to its own seat, nor a position `dealt` does not list (an undealt card). It SHOULD hold every such position at once, sorted.

**The event** is the card variant of §4.2 with the anchor h.
- **In the deal phase** it is the seat's deal (v1 §6.1): at most one per game, kept and never rebuilt.
- **In the play phase** it is a prompt release. A client SHOULD publish it as soon as it links a move that grants positions (it MAY debounce a burst of moves for about a second).

**Who.** Every seated client, with its session key, on every device of the seat, except view-only devices in audit-`'none'` games (§9.5).

**The slow path stays** (v1 §6.2): a game action MUST still carry every share its seat owes as of its prev that the client does not hold. A seat whose app is closed releases nothing early, and its shares ride on its next move. Prompt release is liveness, not safety: a client that never releases is still conforming, except where the game cannot go on without it (§6.4).

**Sealed shares** (proposal §7, `packages/deck/src/sealed.ts`) are not part of v2's wire format. No game uses them yet; the game that needs them (Hanabi) specifies their Shares variant in a later revision.

### 6.2 Dice (replaces v1 §6.3a; D059 item 5, D060)
A module that rolls (§10) requests rolls with game actions; every seat contributes to each roll in a Shares event; the session derives the faces.

- **Requesting move and roll index.** When a client applies the game action of a Move M and the module's `rolls(state)` list grows by r entries, the new entries, in list order, are the rolls **(M, 0) … (M, r−1)**. M is the requesting move. Only a game action appends a roll (§10).
- **The point.** Roll (M, n) is
  ```
  H(M, n) = H2C("roll:" + rootId + ":" + M + ":" + n)
  ```
  with `rootId` and `M` as 64 lowercase hex characters and `n` in decimal. A rival requesting move has another id, so another point.
- **A contribution.** Seat k's contribution is `D = x_k·H(M, n)`, with the Chaum–Pedersen proof of v1 §5.4 for the ciphertext `(a, b) = (H(M, n), H(M, n))` and the context deck id `roll`, position `n`: `c = HS("dleq", rootId, "roll", n, X_k, H(M, n), D, T1, T2)`. The point binds M, so a proof for one requesting move fails for any other. The deck key was fixed at Join, so seat k has exactly one valid `D` per roll; proofs differ, `D` does not.
- **Release.** A client publishes **one roll Shares event per requesting move** (§4.2: `move` M, a contribution for every roll index of M for which it holds no verified contribution by its seat, with `pos` = n), anchored on its head, when:
  - it holds no fork;
  - M is on its chain; and
  - the game has no result on this client.

  The requesting seat's client publishes its own contribution **after** its move M, once M is on its chain: it cannot before, since the point needs M's id. A Move never carries a contribution in v2. The contributions are not ordered: every client publishes as soon as it can. Contributions are automatic, with no human action (D060).
- **Deriving.** When the module pends `{type:'beacon', id}` and `id` is roll (M, n), and the client holds every seat's verified contribution to (M, n), it computes the seed as the SHA-256 of the `D` points in seat order, each as 33 compressed SEC1 bytes, draws `count` faces in `1..sides` by rejection sampling (`packages/dice` `faces(seed, count, sides)`), with `count` and `sides` from the module's roll entry, and applies `{type:'rolled', actor:'beacon', id, dice:[…]}`. The action is not an event: it is recorded in the interleaved action log (v1 §7) where the fold applied it. The fold repeats while the module pends a beacon it can satisfy. Every line is folded the same way.
- **Invalid.**
  - A game action whose action is `{type:'rolled', …}` (`a player does not send the dice`), before the pending-seat check.
  - A game action while a beacon is pending (`no player decision is pending`); it is not buffered.
  - In a deckless game, a game action with any share or reveal (v1 §4.4).
  - A contribution that fails its proof, or names a roll index its requesting move did not request (§4.2).
- **Stalls.** While the module pends a beacon for (M, n), the stalled seats are **every seat without a verified contribution to (M, n)**, the requesting seat included (v1 §8.1, with these seats). A roll Shares event that removes a seat from the stalled set is progress. While a beacon is pending no game action is valid, so contributions have no slow path: a seat that does not contribute is timed out after the deadline (§6.4).
- **Who learns the faces first.** The seat whose contribution completes the set; any seat may be last, the requester included. The requester learns nothing before signing M, since the point needs M's id (the foresight rule, proposal §2.2). The last contributor can only withhold, which is a timeout forfeit.
- **What the binding closes** (D060). Under v1 a rival Roll on another branch had the same point, so a coalition could see the next roll before a bank decision. Under v2 a rival requesting move has its own point, contributions to one say nothing about the other, and the rival is a fork, which stops the game (§5).
- **Two devices** of one seat may both publish a contribution to (M, n). They hold the same `D`, the first verified one is kept, and Shares events are not moves, so this is not a fork (D060's false equivocation flag).
- **Audit.** Contributions are verified when folded. The replay (v1 §7) re-applies the logged rolls and does not re-draw them; a module that rejects a logged roll fails every seat (v1 §6.3a).
- **Decks and dice together.** Card shares are keyed by position and contributions by (seat, M, n), in separate stores, so a game may both deal and roll in v2.

**Bank under v2.** Bank's engine moves to a v2-only version (§2 item 6): after a Roll it pends `{type:'beacon', id}` at once, with no `contribute` decision, and its roll entry is `{id, count: 2, sides: 6}`. `beaconOf` is not used by v2 sessions. Bank's Resign stays on the deckless path (no secret).

### 6.3 Partitioned decks and Luster
- **Partitioned decks** (v1 §5.5) are a general v2 feature: any module may set `partitions`, with v1 §5.5's checks, steps (N = groups × seats), step seats, group domains, global positions and parsing. `DeckSpec.promptShares` is ignored by v2 sessions: prompt release (§6.1) applies to every deck game.
- **Luster under v2** (D059's Luster exception: "Luster moves onto v2's prompt-reveal design when it lands"; the Luster audit's table "moving Luster to v2"):
  - **Deck:** the 100-card `glass` packet with groups `tier-1`, `tier-2`, `tier-3`, `patrons` (40, 30, 20, 10), unchanged. The engine needs no change for v2.
  - **Refills:** after a buy or a reserve from the display, the engine assigns the next card of that tier to `null` and pends its public reveal. Every seat releases its share under §6.1, anchored, and only while it holds no fork. Every client derives the reveal (v1 §6.3) once all are held; moves wait meanwhile.
  - **Blind reservations:** the top card of a tier is dealt to the actor; every other seat releases its share under §6.1, and the owner learns the card (v1 §6.4). The owner never releases its own layer of it; the card is revealed by the owner's own move when bought (`revealsOf`), and by the secrets at the end.
  - **Forks stop** (§5): a lone equivocator who reserves blind, reads the card from the automatic shares and signs a rival stops the game on itself; nothing is played on the rival (closes the Luster audit's F1, and F2 for an honest seat on two devices). The values read are post-end. Luster's audit is `'reveal'` (every card is public at the end), so the one-device rule of §9.5 does not apply (D059 item 1).
  - **Stale shares:** a saved Shares event is vetted by the outbox rule (§9.2) and is never republished for a position now dealt to its own seat (closes F3).
  - **Owed reveals keep their timeout** (D060, §6.4).
  - **Resign stays disabled** (`resignAllowed` returns false): a game with public reveals during play needs a Resign rule for them first (D052).
  - **v1 Luster games in progress** stay on v1 (v1 §5.5, §6.2a) for good (§2).

### 6.4 Owed reveals, contributions and timeouts (D060)
- **The timeout stays.** v1 §8.1's stall attribution is unchanged: while the module pends a public reveal, every seat missing a share of a listed position is stalled, and while it pends a beacon, every seat missing a contribution is (§6.2), whether or not it is that seat's turn. After the deadline a Timeout claim forfeits them.
- **What that means for async play.** v1 §6.2's guarantee, "no seat is ever needed online outside its own turn", holds in v2 only for modules that pend no public reveal and no beacon during play (Chain Reaction, Chess). In Luster every refill, and in Bank every roll, waits for every seat's app, or for its player to come back within the deadline. The owner accepted this for Luster (D060) and for Bank's dice (D050, D060).
- **The client MUST say so.** A client with a user interface MUST show, on the game screen and in its list of games (Home), which seats owe a reveal or a contribution, and when the deadline passes on this client's clock (D060).

## 7. End of game, audit and attestations (amends v1 §7)

### 7.1 End attestations (proposal §5.1 rule 6; D059 item 7)
- **When.** A client MUST publish an end attestation (§4.3) of its result as soon as it has one (§5.5, no fork held): the module over on its chain, an accepted Timeout claim or a counted Resign. It MUST NOT publish one while it holds a fork, and MUST NOT attest a result it does not compute. It attests before the Secret phase and before any audit.
- **Who.** Every seat, the forfeiting seats included: a timed-out seat's client attests its own timeout when it comes back, and a resigner's client its Resign. Every device that computes the result may attest it, except view-only devices in audit-`'none'` games (§9.5).
- **How.** Signed by the session key, automatically, with no signer prompt. A client builds at most one end attestation per result identity, persists it before publishing, and rebroadcasts that same event (v1 §6.5, build once).
- **Not attested:** a cancelled game, and a stop (§5.6).
- **Counting.** For the cutoff every valid end attestation counts (§5.4 (a)). Unlike the stats attestation, there is no "latest per seat".

### 7.2 The audit verdict, from the events (F4)
The audit verdict is a function of the held events (the secrets, the claims and the log). It needs no attestation. It is computed on the game's result (§5.5), and it changes that result's places and scores (forfeits), never which result stands. A seat that fails the audit has already attested the end, so it cannot keep the result from standing by refusing to attest its own audit forfeit.
- **`over`:** every seat owes its Secret reveal (v1 §7 step 1). Once every secret is in, the full audit runs (v1 §7 steps 2–3), and the seats it fails forfeit with the end adjustment (v1 §8.2). A withheld secret is claimed as in v1 §8.1 ("End"); such a claim names a head where the module is over, and is never a `claim` result (§5.3).
- **`resign`:** the partial audit up to the scoring position S, as in v1 §8.3; the Secret phase as there.
- **`claim` during play:** no audit, as in v1: the audit field records the forfeits with reason `timeout`.
- **A stop:** §7.3.

A v2 client MAY publish its Secret reveal as soon as its result needs it, or once it holds a stop (§7.3): v1 §9's wait for a full view protected the freeze, which v2 does not have. Without fork choice no game goes on after a fork, so a published secret helps nobody play.

### 7.3 After a stop in a game with a deck (review H2)
**A stop's places are fixed at the stop** (§5.6). Nothing that happens after it, a missing secret included, demotes a seat, except a proven audit failure.
- **Secrets.** Every seat SHOULD publish its Secret reveal once its client holds the stop, E included. The secrets let anyone audit the hidden claims made before the fork. They expose only values of a game that has ended.
- **No Timeout claim counts after a stop.** No seat is stalled after a stop, and a client accepts no claim, whoever it names. **Why none, rather than claims against E only:**
  - E is already strictly last and rated (§5.6), so a claim against E would change no place.
  - Any accepted claim needs a deadline on each client's own clock. A client whose player was away sees every event fresh when it comes back, so clients would disagree, and E could pick the moment of its fork so that the deadline runs while an honest player is away (an async game promises no seat must be online out of turn, §6.4).
  - With no claims, the outcome of a stop stays a function of the events alone.
- **A missing secret.** A seat whose Secret reveal never arrives is **recorded** as "secret withheld" (shown and kept for stats). It **never forfeits** for it. E's place cannot get worse. For any other seat, the stop already fixed its place.
- **The partial audit runs on the secrets that arrive.** Whenever the client's held secrets, together with the held shares, decrypt every final-deck position (a position needs, for each seat, that seat's secret or its verified share of that position), it runs the partial audit: full mode with that order, replaying the interleaved action log up to P, with no outcome comparison (v1 §8.3). Otherwise the audit does not run, and the stop's places stand.
- **Only a proven audit failure demotes a seat.** The first game action the replay rejects fails its actor. A failed seat moves to just above E, and failed seats share that place. A verdict that fails every seat (a rejected derived reveal or roll, an undecryptable position, a refused setup; v1 §7 step 3) demotes nobody after a stop: no single seat is proven to blame.
- **Override of v1.** After a stop, v1 §8.2's "At the end" rule (seats with a withheld secret move to shared last places) and v1 §8.3's "a claim against a missing secret" do **not** apply.
- A deckless game has no Secret phase and no audit after a stop.

### 7.4 The stats attestation (v1 §7 step 4, kept for stats only)
- The v1 attestation `{audit, logHash, outcome}`, signed by the npub. A client SHOULD publish it once its result and audit verdict are final, as in v1. `logHash` covers the chain up to the result's scoring head: S for a Resign, the result's head otherwise.
- A client keeps the latest per seat, as in v1, for display.
- It plays **no part** in the cutoff.
- It MUST NOT be published for a stop or a cancelled game.

### 7.5 Stats and ratings (F5)
- **A valid result** is the game's result (§5.5) with the audit verdict (§7.2). Anyone holding the events can recompute it.
- **Ratings exclude unrated results**, as in v1 §7 (a Resign of 3 or more seats).
- **A stop counts from its fork certificate, never from attestations** (there are none):
  - 2 seats: a rated loss for E and a rated win for the other seat;
  - 3 or more seats: E's rating moves as a last place against every other seat, and no other pair's rating moves;
  - E is recorded as the seat that ended the game, for the anti-griefing count of v1 §7 step 4;
  - the stop counts as no completion and no win for the other seats.
- **A result that stood against a fork** counts like any result. E is recorded for the fork, with no change to its place.
- **A cancelled game** (a fork with no game action held at or past it, §5.6) counts for nothing; the seat that forked is recorded.

## 8. Timeouts and Resign (amends v1 §8)

### 8.1 Timeout
- **Stalled seats:** v1 §8.1, with these changes:
  - while the client holds a fork, no seat is stalled, also after a stop (§7.3);
  - a pending beacon stalls every seat without a contribution (§6.2);
  - the v1 deal-phase exception for a held shuffle fork is removed: such a fork stops the game, which is cancelled while no game action has been played past it (§5.6).
- **Progress:** v1 §8.1, roll Shares events included.
- **Accepting a claim:** v1 §8.1, and the client holds no fork (§7.3: no claim counts after a stop).
- **Finality (amends v1 §8.2 "Finality").** An accepted claim is final for the client while it holds no fork. The client keeps folding moves and Shares events past the claim's head (unscored) to find forks. A held fork replaces the claim unless the claim stands (§5.5).

### 8.2 Forfeits
v1 §8.2 for timeouts and failed audits. Equivocation is no longer a forfeit at the end: a fork stops the game (E rated last, §5.6) or only records E (§5.4).

### 8.3 Resign
v1 §4.9 and §8.3, with these changes:
- **It counts once its named head is on the client's chain** (the root or a move on its walk). v1's side-branch case is gone: a Resign naming a move on a side of a held fork is judged by the cutoff, where it is a valid `resign` result (§5.3) whether or not it counted.
- **Finality:** as for a claim (§8.1): final while no fork is held.
- **The scoring position S** is computed as in v1 §8.3 steps 2–3, starting from the named head H (step 1's H' is H), along **H's line forward**: from H, the client follows the unique valid successor while there is exactly one, and **stops at the first held fork past H**. Without a fork this is the chain, as in v1. With a fork past H, no move on either side of it is scored, so every value granted on a side is post-end. When a `resign` result stands against a fork at P above H (H on one side), S is computed along that side from H.
- **The identity** of a resign result is (resign, H, k), and its end attestation names H with `logHash` of H's line (§4.3). Its stats attestation's `logHash` covers the line up to S, as in v1 §8.3 step 5.
- Everything else in v1 §8.3 is unchanged: the 2-seat deck-game refusal and the module opt-out, the early secret, cancelling, the resigner strictly last, unrated with 3 or more seats, the partial audit.

## 9. Devices and relays (amends v1 §9; proposal §5.1 rules 8 and 9; D059 item 2)

### 9.1 Gossip (A3)
- A client MUST rebroadcast **both moves of every fork it holds** (the fork certificate) to the root's relays and its own relays, as soon as it holds them.
- It SHOULD rebroadcast every game event of the game it holds (Moves, Shares events, Timeout claims, Resigns, Secret reveals, end attestations) to the root's relays, for example once after each sync.
- Rebroadcasting republishes the same signed event; it never re-signs (v1 §9).

The design assumes (A3) that every event an honest client holds reaches every honest client within the game's deadline. Today's timeouts already assume it for moves.

### 9.2 The outbox rule (MUST)
A saved event that no relay has confirmed is republished only after the client's sync with every counted relay, as v1 §9 says ("Saved events that may be stale"), with the client's own relays counted (§9.4). Then:
- **A Move** is published only if its `prev` is the client's current head, the client holds no other move by its seat on that `prev`, and the client holds no fork. It is **discarded** if another move by its seat on that `prev` is held, if its `prev` is on the chain below the head, or if its `prev` is held but not on the chain. It waits while its `prev` is not held, as in v1.
- **A Shares event other than the deal** (a prompt release or a roll contribution) is published only if its anchor is on the client's chain (the head or below it), the client holds no fork and has no result, and:
  - card variant: every position in it is still dealt to another seat or to `null` at the head's state, and the client holds no verified share by its seat for it;
  - roll variant: its requesting move is on the chain.

  Otherwise it is **discarded**. In particular a saved share of a position that is now dealt to its own seat is never published (the Luster audit's F3).
- **The deal** is kept and never rebuilt, as in v1 §6.1 and §9.
- **A Resign:** as in v1 §9.
- **An end attestation** is published only while the client holds no fork and still computes that result; otherwise it is discarded.
- **A Timeout claim, Secret reveal, stats attestation or Device note** is republished as in v1.

A discarded event is removed from storage and logged (v1 §9). Without this rule, a tablet's move saved offline, after the human played that turn otherwise on a phone, would fork the honest seat weeks later: the game would stop as that seat's forfeit, or record it as an equivocator after the end (the model's `honest-forfeit` and `honest-flagged`; proposal §6.7).

### 9.3 Check before signing (SHOULD)
Before signing a Move, a Resign or a Timeout claim, a device SHOULD:
1. fetch its seat's own events of this game from the root's relays and its own relays: authors its session key and its npub, `#e` the root, kinds 7452–7458;
2. fetch the moves those events build on, and the claim or Resign each end attestation names;
3. wait until every counted relay has answered (v1 §9's hold and its **Send anyway** after 10 minutes apply);
4. fold all of it, then decide on what it holds. In particular:
   - it never signs a move on a `prev` where its seat already has a move;
   - it treats a Timeout claim signed by its own seat (another device), naming a head on its chain, as accepted;
   - it adopts a claim or Resign result its own seat end-attested (from another device) as its own result.

This keeps one seat's devices from ending on different results, and stops a human moving twice on one turn except within the seconds a move takes to reach the relays (residual, §11). The model finds it unnecessary for safety under the amended cutoff, but on thin evidence, so it stays a SHOULD (round-3 review).

### 9.4 Own relays (F2)
A device SHOULD also query, and publish to, relays of its player's own choosing (its configured or NIP-65 relays), not only the root's: before publishing a saved event (§9.2), before signing (§9.3), and when syncing. These relays count in v1 §9's sync as "the player's own relays". Reason: the root's relays are picked by its creator, who may be the opponent; an opponent who controls every root relay can hide one device's move from another, so that the outbox rule publishes a stale move (A6, proposal §9 residual 6).

### 9.5 One playing device per seat, in audit-`'none'` games (D059 items 1 and 2)
A module may declare audit `'none'` (§10; poker-like games, where cards are never all revealed). In such a game a seat MUST play from one device at a time. No current module declares it (GAME-SYSTEMS §4.1.7); this section is built with the first one.
- **The playing device** of seat k is the device named by k's Device note (§4.4) with the highest `n`, when exactly one note has that `n`. With no note, it is the device that built the seat's Join (implicitly `n = 0`). When two or more notes share the highest `n`, no device of seat k plays until a note with a higher `n` exists.
- **View-only devices.** Any other device of the seat is view-only: it shows the game and publishes no event of its seat except a Device note. A device that restored the seat's keys from the backup starts view-only.
- **Handing over.** On an explicit human action ("Play on this device"), a device runs the check before signing (§9.3), with Device notes, then publishes a note with `n` one more than the highest it holds, naming its own device id, and plays from then on.
- **Giving up.** A device that receives a higher note naming another device becomes view-only at once, and discards every saved event it has not published.
- **Why.** In a game whose cards are never revealed, a seat's second device may play on a branch that a stop later voids, so a coalition would learn a card and the decisions made with it (proposal residual 1, the review's A1). With one playing device no honest player ever plays on a voided branch.
- **Residuals.** Two handovers at once leave no playing device until a further note (a human acts again). The old device can sign a move in the seconds before the note reaches it.
- In every other game devices are not restricted: the outbox rule and the check before signing apply (§9.2, §9.3).

## 10. Requirements on rules modules (amends v1 §10)
v1 §10 holds, with these changes:
- **Protocol versions.** A module version declares which protocol versions it supports (for example a `protocols` list beside its version). A table or root for a version it does not support is rejected (§2 item 6).
- **Rolls.** A module that rolls exposes `rolls(state)`, an append-only list of `{id, count, sides}` entries: `id` never reused, `count` and `sides` positive safe integers. Only applying a game action may append entries, never a derived reveal, a derived roll or a learn. After a game action that appends a roll, the module pends `{type:'beacon', id}` for it before any player decision that should not see it. The engine does not import `deck` or `dice`, and rejects a player-sent `{type:'rolled'}` (CLAUDE.md, D058). `beaconOf` is not used by v2 sessions.
- **Partitioned decks.** Any module may set `partitions` (v1 §5.5). `promptShares` is ignored.
- **Audit mode.** A module may declare `audit(rules)`: `'reveal'` (the default: every card is public at the end) or `'none'`. `'none'` requires §9.5.
- **Unchanged:** one deck or none; deterministic dealing with hands assigned at setup; `pending` with public reveal requests; `learn`, `knownTo`, `view`, `outcome`; `standings` (now also scoring a stop, §5.6); `dealt`; `revealsOf`; round-robin liveness; `legalActions` exact or empty; `learn` commutes with every action; a game with public reveals during play needs a Resign rule for them before Resign is enabled (D052).

## 11. Security considerations
v1 §11 holds for everything that does not concern fork choice. In addition (proposal §9, round 3):
1. **Values read on a stopped branch** (post-end). An equivocator or a coalition can read values released before its fork surfaced: its own draw, or a card that would have gone to another seat on the rival. The game stops at the fork as its forfeit, so nothing is played with them. With audit `'none'` and two devices an honest player's second device might have played on the voided branch; §9.5 removes that.
2. **Coalitions of 3 or more seats.** A colluder that never attests keeps a finished game open to its partner's fork, and a coalition can void a colluder's counted timeout before it stands. The forker takes a rated last place and is recorded; the others are unrated.
3. **Stops are unbounded in time** (accepted, D059 items 3 and 6). During play a seat can stop the game at any of its earlier turns, as it can resign. After the end, a lone equivocator can stop the game until every other seat has attested, which an absent player never does, and a timed-out seat (absent by definition) never attests its own timeout, so a counted timeout almost never stands (F1). Each stop costs the equivocator a rated last place and exposes nothing; with 2 seats nothing changes for the opponent.
4. **Two devices.** The check before signing leaves a race of seconds. Shares and end attestations are automatic on every device, so a seat's second device acting on the other side of a fork keeps an attested result from standing (the stop is then E's forfeit). Two devices of one seat can also end on different results with no fork held (a claim or Resign race between them), as two clients can.
5. **The claim and resign races** with no fork held (v1 §11), unchanged.
6. **Assumptions.** A3 (gossip within the deadline, §9.1) and A6 (the relays a device queries return its own seat's events; at least one honest relay). When the opponent picks every root relay, A6 can fail; §9.4 mitigates it.
7. **Unresolved anchors.** A Shares event or end attestation anchored on an event nobody holds counts as off every result's line (§5.4). Only a seat other than E can block a result that way, and an honest client anchors only on moves it holds and rebroadcasts (§9.1), so this is the same as a colluder withholding its attestation (item 2). The model does not include unresolved anchors.
8. **Selective abort on dice.** Contributions are unordered (§6.2), so any seat, not only one fixed seat as in v1, can try to contribute last, see the faces first and withhold. Withholding is a timeout forfeit, and no seat can choose the faces.
9. **Owed reveals and contributions out of turn** (§6.4): a seat whose app stays closed can be timed out in Luster and Bank when it is not its turn. Accepted by the owner (D060).
10. **Denial of service.** v1 §11's bounds hold, with these changes. A shuffle fork needs only two well-formed steps, so no rival step's proof is verified (the candidate cap of v1 is gone). Junk game actions by the pending seat cost one validity check each, paid for with its own signed events, as in v1. The cutoff folds a side line only to judge a valid result on it, at most once per line and event set. Shares events, end attestations and Device notes are size-capped like every event (262,144 bytes); a client MAY drop duplicate end attestations of one identity by one seat, which never changes the cutoff.
11. **Not a proof.** The model's limits (proposal §9 residual 7): small scopes, abstract crypto, one pending seat per prev, a draw/pass game, hash compaction, attestations delivered at once. D059 item 8 requires the unproven scopes to finish before the build.

## 12. Conformance

### 12.1 Requirements
Each item is a testable requirement on a v2 client (session, protocol package or controller). "Reject" means the event is refused and changes nothing.

**Versioning**
- **V2-01** MUST put exactly one `["proto", "2"]` tag on every Table, Join, root and in-game event of a v2 game (§2).
- **V2-02** MUST reject a Join, root or in-game event whose proto differs from its game's, and any proto value other than `"1"` or `"2"` (§2).
- **V2-03** MUST fold a proto-1 game by v1 rules and a proto-2 game by v2 rules, selected by the root (§2).
- **V2-04** MUST create new tables at proto 2 (§2).
- **V2-05** MUST reject a Table or root whose (module, engine version) does not support its proto (§2, §10).

**Parsers**
- **V2-06** MUST reject a v2 Shares event without exactly one `root` and one `anchor` `e` tag (§4.2).
- **V2-07** MUST reject a Shares event with an empty `shares`, non-ascending `pos`, a `type` other than `"shares"` or `"roll"`, or a key set that does not match its `type` (§4.2).
- **V2-08** MUST reject a card variant in a deckless game and a roll variant in a game that does not roll (§4.2).
- **V2-09** MUST reject an end attestation without a `head` tag, with keys other than `end`, with `forfeit` not strictly ascending, or with `forfeit` not matching `kind` (`over` empty, `resign` one seat, `claim` one or more) (§4.3).
- **V2-10** MUST reject a stats attestation with a `head` tag, and one whose `endedBy.type` is `"fork"` (§4.3).
- **V2-11** MUST accept an end attestation from a seat's session key or its npub, and count both for that seat (§4.3).
- **V2-12** MUST ignore an end attestation whose `logHash` does not match the line to its head once that line is held (§4.3).
- **V2-13** MUST reject a Device note whose `device` is not 32 lowercase hex characters or whose `n` is not an integer of at least 1 without leading zeros (§4.4).

**The walk, forks and the cutoff**
- **V2-14** MUST end the walk at a fork when a head has two or more valid-looking successors, and treat any two well-formed shuffle steps of one seat on one chain prev as a fork without verifying their proofs (§5.1, §5.2).
- **V2-15** MUST NOT pick a branch at a fork: no move past the fork is ever scored, whatever its length, id or end (§5.2, §5.5).
- **V2-16** MUST judge only the topmost fork on the walk (§5.2).
- **V2-17** MUST compute result identities as §5.3 says, and judge validity without a clock (§5.3).
- **V2-18** MUST let a result stand only when (a), (b) and (c) of §5.4 hold, counting every end attestation ever held and testing (b) globally over every held Move, Shares event and end attestation by a seat other than E (§5.4).
- **V2-19** MUST NOT let events at or past a result's head block it, and MUST count an unresolved anchor as off the line (§5.4).
- **V2-20** MUST give the same result as a function of the held events, whatever their arrival order, whenever a fork is held (§5.5).
- **V2-21** MUST let a held fork override a counted claim or Resign that does not stand (§5.5).
- **V2-22** MUST score a stop as §5.6 says: cancelled only when no game action is held at or past P on any line; 2 seats, E's rated loss; 3 or more seats, E strictly last and rated, the others by `standings` at P (all tied, scores 0, when P comes before play) and unrated.
- **V2-23** MUST keep folding moves past a counted claim or Resign, without scoring them, so as to find forks (§5.1, §8.1).
- **V2-24** MUST NOT accept a Timeout claim in play while it holds a fork (§5.7, §8.1).

**Prompt release**
- **V2-25** MUST NOT publish a card Shares event while it holds a fork, after its result, or before the final deck is complete (§6.1).
- **V2-26** MUST NOT publish a share of a position dealt to its own seat, or of a position `dealt` does not list (§6.1).
- **V2-27** MUST anchor every Shares event on its head at build time (§4.2, §6.1).
- **V2-28** MUST still attach every owed, unheld share to its own game action (the slow path, §6.1).
- **V2-29** SHOULD release owed card shares in one Shares event as soon as it links a move that grants positions (§6.1).

**Dice**
- **V2-30** MUST compute roll points as `H2C("roll:" + rootId + ":" + M + ":" + n)` with M the requesting move (§6.2).
- **V2-31** MUST map the roll entries a game action appends to (M, 0) … (M, r−1) in list order (§6.2).
- **V2-32** MUST verify each contribution with the context deck id `roll`, position n, against its requesting move's point, and keep one per (seat, M, n) (§6.2).
- **V2-33** MUST reject a Move that carries a contribution, a player-sent `rolled` action, and any game action while a beacon is pending (§6.2).
- **V2-34** MUST publish its own contribution only once the requesting move is on its chain, while it holds no fork and has no result; the requester's contribution comes after its own move (§6.2).
- **V2-35** MUST derive faces from the seat-ordered seed with the module's `count` and `sides`, by `faces` (§6.2).
- **V2-36** MUST treat every seat without a contribution to a pending roll as stalled (§6.2, §8.1).

**Attestations, audit and stats**
- **V2-37** MUST publish an end attestation of its result once it has one and holds no fork, signed by the session key, and MUST NOT publish one while it holds a fork or for a result it does not compute (§7.1).
- **V2-38** MUST NOT publish an end attestation or a stats attestation for a stop or a cancelled game (§5.6, §7.4).
- **V2-39** MUST compute the audit verdict from the events on the game's result and apply it to places and scores, never to which result stands (§7.2).
- **V2-40** After a stop, MUST keep the places fixed at the stop, MUST accept no Timeout claim, MUST NOT demote a seat for a missing secret (only record "secret withheld"), and MUST demote a seat (to just above E) only for a proven audit failure of the partial audit, run once the held secrets and shares decrypt every position (§7.3).
- **V2-41** MUST count a stop in stats from its fork certificate (§7.5).

**Timeouts and Resign**
- **V2-42** MUST count a Resign only once its named head is on its chain (§8.3).
- **V2-43** MUST compute a Resign's scoring position along its named head's line, stopping at the first held fork past it (§8.3).

**Devices and relays**
- **V2-44** MUST rebroadcast both moves of every fork it holds to the root's relays and its own (§9.1).
- **V2-45** MUST apply the outbox rule to saved Moves, Shares events and end attestations (§9.2).
- **V2-46** SHOULD run the check before signing before every Move, Resign and Timeout claim (§9.3).
- **V2-47** SHOULD query and publish to the player's own relays besides the root's (§9.4).
- **V2-48** In an audit-`'none'` game, a device that is not the seat's playing device MUST NOT publish any event of its seat except a Device note (§9.5).
- **V2-49** A client with a user interface MUST show which seats owe a reveal or a contribution and when the deadline passes, on the game screen and in its list of games (§6.4).

### 12.2 Test vectors to produce
Each as a JSON file under the package that owns it, with every intermediate value, secrets included, and a test that reproduces it (as v1's `packages/deck/test/vectors/v1.json`):
1. **Roll points** (`packages/deck`): rootId, requesting move id and n for n = 0, 1, 2, with `H(M, n)` as compressed points; per seat of a 3-seat game, the secret, the contribution `D`, its proof and the DLEQ transcript; the seed, and the faces for (2, 6) and one other (count, sides). Include two requesting moves on one prev, to show different points.
2. **Partitioned shuffle** (`packages/deck`, a v1 gap, D060): a 2-seat, 2-group deal (for example groups of 5 and 3) with every step's group, seat, domain, input slice, output, proof transcript, the full packet after each step, one share per seat and position, and the decrypted cards. Conforming v1 clients must reproduce it too.
3. **Parser vectors** (`packages/protocol`), accepted and rejected:
   - Shares, card and roll variants, with anchors; rejections for a missing or doubled anchor, a third `e` tag, an empty list, descending `pos`, a wrong key set, a non-hex `move`;
   - end attestations of each kind; rejections for a missing `head` tag, a mismatched `forfeit` and `kind`, an unsorted `forfeit`, extra keys;
   - stats attestations, and the rejected `"type":"fork"` and stats-with-`head` cases;
   - Device notes, and rejections for a bad `device` or `n`;
   - proto: the same event with `"1"`, `"2"`, `"3"` and two proto tags, against v1 and v2 games.
4. **Log hashes** for end attestations: the empty line (the root), a shuffle-only line, and a line through game actions.
5. **Fold scenarios** (`packages/client`): event sets with the expected walk, fork, result or stop, and outcome, each also fed in several arrival orders:
   - a 2-seat and a 3-seat stop during play, with the outcomes of §5.6;
   - a shuffle fork (cancelled) and a deal-phase fork (cancelled);
   - a standing `over` result after a later fork by a seat that attested nothing;
   - the same, blocked by a share anchored on the rival side (the proposal's §6.7 "cutoff without the anchor clause" trace);
   - the same, not blocked by events past the result's head;
   - two devices and a resign (proposal §6.7, both traces), and two devices and a claim;
   - a claim that does not stand overridden by a stop (A2), and a claim that stands;
   - two valid attested results (rule (c): stop);
   - a fork below another fork (the topmost decides);
   - an unresolved anchor blocking a result;
   - a Resign whose scoring position stops at a fork past its named head.
6. **Prompt release scenarios:** the positions a seat releases after a Chain Reaction draw, a Luster refill and a Luster blind reservation; none while a fork is held; none of its own positions.
7. **Dice scenarios:** a Bank roll with contributions arriving in every order, the requester's last; a rival Roll (a stop); two devices contributing the same `D` (not a fork).
8. **Outbox scenarios:** a stale saved move discarded; a saved Shares event discarded once its position is dealt to its own seat; a saved end attestation discarded once a fork is held.
9. **Model traces as session tests:** every regression trace of proposal §6.3, §6.4 and §6.7 that applies to `stop3`, replayed through `GameSession` with real events, with the model's verdict.

## Appendix A. v1 sections and their v2 status

| v1 section | v2 |
|---|---|
| §2, §3 | unchanged |
| §4 parsing, field formats | unchanged, proto per §2 |
| §4.1–§4.3 lobby events | unchanged, proto per §2 |
| §4.4 Move | unchanged; no contribution in a Move (§6.2) |
| §4.5 Shares | changed: anchor, roll variant (§4.2) |
| §4.6, §4.7, §4.9 | unchanged |
| §4.8 Result attestation | changed: end attestation added, stats attestation kept without `"fork"` (§4.3) |
| — | new: Device note, kind 7458 (§4.4) |
| §5.1–§5.4 | unchanged |
| §5.5 partitioned decks | unchanged; any module (§6.3) |
| §6.1, §6.2 | unchanged; prompt release added (§6.1) |
| §6.2a Luster share duty | replaced by §6.1, §6.3 |
| §6.3, §6.4 | unchanged |
| §6.3a dice | replaced by §6.2 |
| §6.5 | rule 1's fork choice replaced by the walk (§5.1); the rest unchanged |
| §6.6 | replaced by §5 |
| §7 | amended by §7 |
| §8 | amended by §8 |
| §9 | amended by §9 |
| §10 | amended by §10 |
| §11 | amended by §11 |
| §12 | v2 is proto 2 (§2) |
