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
- **The chain** is the walk's moves. Derived reveals and rolls are applied along it exactly as in v1 §6.3 and §6.2 here. The walk does not stop at a counted claim or a counted Resign: moves past them are linked, so that forks past them are found, but they are never scored (§5.5).
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
- `resign`: the list is one seat k, the client holds a valid Resign (v1 §4.9) by k naming the head, and it does not cancel (v1 §8.3: the line to its scoring position holds a game action at or after the first game action, or a game action by k).

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
- **Before the first game action** (the walk up to P holds no game action, so the fork is at or below a shuffle step or the deal): the game is **cancelled**: no result, no attestation, no rating change. E is recorded.
- **2 seats:** E is last and the other seat first. Scores are the module's `standings` at P; the reason is `stop`. The result is **rated**: a loss for E.
- **3 or more seats:** E is **strictly last** and its last place is **rated**. The other seats are ranked by `standings` at P, ties sharing places; scores are the standings; the reason is `stop`. The result is **unrated for every seat other than E**, and E is recorded as the seat that ended it.
- **A game with a deck:** the Secret phase and a partial audit up to P follow (§7.3).
- **No time limit** (D059 item 3): a seat can cause a stop at any time while the game is live, as it can resign; after the end, only until the result stands (F1, accepted, D059 item 6).
- **Never attested** (F5): a client publishes neither an end attestation nor a stats attestation for a stop. A stop and its equivocator are recorded by the fork certificate (§7.5).

**Why E is rated last with 3 or more seats.** Scored as an unrated abort alone, a timed-out seat could fork at its own head and turn its rated last place into an unrated abort, now that a stop overrides a counted claim (the model's `void-forfeit`). Scored as E's timeout at P, E would choose the position the others are rated at.

### 5.7 While a fork is held
- No seat is stalled in play, so no Timeout claim counts, except a claim for a withheld secret after a stop (§7.3).
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
- **Release.** A client publishes **one roll Shares event per requesting move** (§4.2: `move` M, a contribution for every roll index of M that its seat has not contributed, with `pos` = n), anchored on its head, when:
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
