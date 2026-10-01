# Bored Games protocol (draft, version 1)

`draft` `optional`

This document specifies how players run a turn-based multiplayer board game with hidden cards over NOSTR. It uses **no trusted server, dealer or referee**: only the players' clients and relays.

- Games are asynchronous. A player is never required to be online outside their own turn.
- The design was approved by the owner on 2026-10-01; decisions D018–D022 in `docs/DECISIONS.md` record it.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Overview

A game is a pure rules module implementing `GameModule` (`packages/game-kit`). Clients run the same module and agree on state by folding the same signed event log.

| Concern | How it is solved |
|---|---|
| Who may act | The rules module's `pending()` names exactly one seat, or a public deck reveal. Only that seat's session key may extend the move chain. |
| Ordering and forks | Moves form a hash chain (`prev` plus `seq`). Two different moves on the same parent from the same signer prove equivocation. |
| Hidden cards | Mental poker: ElGamal on secp256k1 with a joint key, one shuffle by every seat with a **zero-knowledge proof of shuffle**, and decryption shares with **DLEQ proofs**. |
| Async dealing | Each seat attaches decryption shares for other seats' new cards to its own next event. Every other seat acts between a player's draw and that player's next turn. |
| Result | Every client replays the log. At the end, each seat reveals its deck secret, and every client re-plays the whole game with all cards visible to audit every hidden claim. Players then sign attestations. |
| Abandonment | Per-game move deadline (1, 3 or 7 days). After it, a timeout claim makes the stalled seat forfeit. |

## 2. Notation and encoding

- **Curve.** The group is secp256k1 with base point `G` and order `q`. Scalar multiplication is written `k·P`; point addition `P + Q`.
- **`H2C(msg)`** is RFC 9380 `secp256k1_XMD:SHA-256_SSWU_RO_` with DST `bored-games/v1`.
- **`HS(parts…)`** hashes to a scalar: `SHA-256(encode(parts))` interpreted big-endian, reduced mod `q`. `encode` concatenates, for each part, a 4-byte big-endian length followed by its bytes:
  - points: compressed SEC1, 33 bytes. The identity, which never travels but is hashed in memory (the initial deck's `a`), is 33 zero bytes.
  - scalars: 32 bytes big-endian
  - strings: UTF-8. A string part MUST be well-formed Unicode: implementations MUST refuse to hash a string holding a lone UTF-16 surrogate, which UTF-8 encoders would otherwise silently replace with U+FFFD.
  - integers (seat, position): their decimal string, UTF-8
  - raw bytes: as they are.
- **Binary values in event content** (points, scalars) are base64url without padding. Compressed points are 44 characters; scalars are 43.
- **Rejections.** Implementations MUST reject:
  - the point at infinity
  - points not on the curve
  - scalars ≥ `q`
  - any non-canonical base64url.
- **Content** is canonical JSON: keys sorted, no whitespace (`canonicalJson` in game-kit). An event whose content is not canonical MUST be rejected.

## 3. Keys

Each player has:

| Key | Lifetime | Signs / used for |
|---|---|---|
| **npub** (identity) | permanent | Table (creator), Join, Game root (creator) and Result attestation events. Signing goes through NIP-07 or NIP-46. |
| **session key** | one game | All in-game events (kinds 7452–7455). Clients generate it locally; no signer prompt per move. |
| **deck key** `x_k`, `X_k = x_k·G` | one game | ElGamal secret share; must be distinct from the session key. |

**Backup.** Clients SHOULD back up the session key and deck key as a NIP-78 event:
- kind 30078, `d` tag `bored-games:<rootId>`
- content NIP-44-encrypted to the player's own npub.

That lets another device resume the game. Before the root exists, the table address substitutes for `rootId`.

**Proof of knowledge.** `X_k` is published with a Schnorr proof of knowledge `pok = (c, s)`, which defeats rogue-key attacks on the joint key:
- the prover picks `w`, computes `T = w·G` and `c = HS("pok", tableAddress, npub, sessionPub, X_k, T)`, then `s = w + c·x_k`
- the verifier recomputes `T = s·G − c·X_k` and checks `c`.

**Context strings.** The PoK hashes these identifiers as the UTF-8 of their NOSTR hex text (D025):
- `tableAddress` is the NIP-01 address of the Table event: `37450:<creator pubkey hex>:<d tag>`, with the creator's pubkey as 64 lowercase hex characters.
- `npub` and `sessionPub` are the player's identity and session x-only pubkeys as 64 lowercase hex characters, the form NOSTR tags and the Join's `session` field carry. They are not bech32 (`npub1…`).

## 4. Event kinds

All game kinds are unused in the NIPs registry as of 2026-10-01. The owner's reserved ranges 30050–30055 and 30100–30105 are avoided.

| Kind | Name | Type | Signed by |
|---|---|---|---|
| 37450 | Table | addressable | creator npub |
| 7451 | Join | regular | player npub |
| 7450 | Game root | regular | creator npub |
| 7452 | Move | regular | session key |
| 7453 | Shares | regular | session key |
| 7454 | Timeout claim | regular | session key |
| 7455 | Secret reveal | regular | session key |
| 7456 | Result attestation | regular | player npub |
| 30078 | Key backup (NIP-78) | addressable | player npub |

Every game event (all kinds above except 30078) carries `["proto", "1"]`.

### 4.1 Table (37450)
The lobby listing. It may be updated (it is addressable) until the game starts.

**Tags:**
- `["d", <tableId>]`
- `["game", <moduleId>]`, e.g. `chain-reaction`
- `["v", <engine semver>]`
- `["seats", <n>]`
- `["deadline", <seconds>]`, where seconds is 86400, 259200 (the default) or 604800
- `["p", <invited pubkey>]`, zero or more
- `["open", <count of open seats>]`
- `["relay", <url>]`, one or more
- `["status", "open" | "started" | "cancelled"]`

**Content:** `{"rules": <rules object>}`.

The number of `p` tags plus `open` MUST equal `seats` minus 1 (the creator holds a seat).

### 4.2 Join (7451)
Claims a seat: an invited seat, or one of the open seats.

**Tags:** `["a", "37450:<creator>:<tableId>"]`, `["p", <creator>]`.

**Content:**
```json
{"deckKey":"<point>","pok":{"c":"<scalar>","s":"<scalar>"},"relays":["wss://…"],"session":"<hex x-only pubkey>"}
```
The creator also publishes a Join for its own seat.

### 4.3 Game root (7450)
Starts the game. It is immutable, and **the game id is this event's id**. The creator publishes it once the seats are filled with valid Joins.

**Tags:**
- `["a", <table address>]`
- `["game", …]`, `["v", …]`, `["deadline", …]`
- `["rules-hash", <hex SHA-256 of canonical rules>]`
- one `["e", <join id>, <relay>, "seat:<i>"]` per seat, in seat order
- `["relay", <url>]`, one or more

**Content:**
```json
{"rules":{…},"seats":[{"deckKey":"…","npub":"…","session":"…"}, …]}
```

**Seat order.** The creator chooses the seat order, and the root fixes it. Clients MUST check that:
- every seat matches a valid Join for that table
- each Join's proof of knowledge verifies
- no npub, session key or deck key appears twice
- the rules validate under the named module and version.

**Joint key:** `X = Σ_k X_k`.

### 4.4 Move (7452)
The hash-chained log.

**Tags:**
- `["e", <rootId>, "", "root"]`
- `["e", <prevId>, "", "prev"]`: the previous move, or the root for the first move
- `["seq", <n>]`: 1 for the first move

**Content** is one of the following.

**Shuffle step.** Moves 1..N; move `k+1` is seat `k`'s shuffle.
```json
{"deck":[["<a>","<b>"], …],"proof":{…},"type":"shuffle"}
```
- `deck` holds the output ciphertexts, one per card (108 for Chain Reaction).
- `proof` is the shuffle proof (§5.3).

**Game action.**
```json
{"action":{…},"reveals":[{"d":"…","pos":<n>,"proof":{"c":"…","s":"…"}}, …],"shares":[{"d":"…","pos":<n>,"proof":{…}}, …],"type":"action"}
```
- `action` is the module action, canonical, with `actor` equal to the sender's seat.
- `reveals` holds the sender's own decryption shares for every card the action reveals from its hand, sorted by position; it is empty otherwise. In Chain Reaction, a card is revealed by `place` (its `pos`) and by each `endTurn.discard` entry.
- `shares` holds the decryption shares the sender owes (§6.2), sorted by position.

### 4.5 Shares (7453)
Decryption shares outside the chain: the deal round, or optional early help.

**Tags:** `["e", <rootId>, "", "root"]`.

**Content:** `{"shares":[…],"type":"shares"}`.

### 4.6 Timeout claim (7454)
Claims that the pending seat missed the deadline (§8).

**Tags:** `["e", <rootId>, "", "root"]`, `["e", <headId>, "", "head"]`, `["seat", <stalled seat>]`.

**Content:** `{}`.

### 4.7 Secret reveal (7455)
After the game ends.

**Tags:** `["e", <rootId>, "", "root"]`.

**Content:** `{"deckSecret":"<scalar x_k>"}`. Clients MUST check that `x_k·G = X_k`.

### 4.8 Result attestation (7456)
**Tags:** `["e", <rootId>, "", "root"]`.

**Content:**
```json
{"audit":"pass"|{"fail":[<seat>…],"reason":"…"},"logHash":"<hex>","outcome":{"places":[…],"reason":"…","scores":[…]}}
```

`logHash` is the SHA-256 of the move event ids in `seq` order, joined with `\n`.

## 5. Deck cryptography

**Context strings.** The shuffle and share transcripts hash these identifiers as the UTF-8 of their NOSTR text (D025):
- `rootId` is the game root's event id: 64 lowercase hex characters.
- `deckId` is the module's deck id, as `decks(rules)` names it (for example `tiles`).

### 5.1 Cards and the initial deck
- **Card points.** Card `m` of deck `d` is the point `M_m = H2C("card:" + d + ":" + m)`. Clients precompute the table of all `M_m` to map decrypted points back to cards.
- **Initial deck.** The trivial encryption `E_0[i] = (O, M_i)` for `i = 0..size−1` in card order. It is computed locally and never transmitted.
- **Ciphertexts.** A ciphertext is `(a, b) = (r·G, M + r·X)`.

### 5.2 Shuffle
**Seat order.** Seat `k` (k = 0..N−1, for N seats) takes the previous deck `E_k` (the `deck` of move `k`, or `E_0` for seat 0) and produces `E_{k+1}` by:
1. picking a uniformly random permutation `ψ` and fresh randomizers `r'_i`
2. computing `E_{k+1}[i] = (a_ψ(i) + r'_i·G, b_ψ(i) + r'_i·X)`.

It publishes `E_{k+1}` with a proof (§5.3). Every client MUST verify each shuffle step's proof before accepting the move.

**The final deck** is `E_N`; position `p` of the game deck is ciphertext `E_N[p]`.

**Shuffle secrets.** The shuffle randomness (`ψ`, `r'`) MUST be discarded after proving. It is never revealed: the end-of-game audit uses the deck secrets instead.

### 5.3 Shuffle proof
The Terelius–Wikström proof of a shuffle of ElGamal ciphertexts. Implementations follow the algorithms **GenShuffleProof** and **CheckShuffleProof** of the CHVote Protocol Specification (Haenni, Koenig, Locher, Dubuis; IACR ePrint 2017/325), translated to the elliptic-curve group:

| CHVote (multiplicative) | Here (additive) |
|---|---|
| `x · y`, `x^k` | `P + Q`, `k·P` |
| generators `g`, `h`, `h_1…h_N` | `G`, `H2C("gen:h")`, `H2C("gen:" + i)` |
| public key `pk` | joint key `X` |
| hash to `Z_q` | `HS` with the transcripts below |

**Challenges.** In this section `n` is the number of cards in the deck (108 for Chain Reaction), not the number of seats. Card indices are 1-based; `(a_i, b_i)` is input card `i` (`E_k`) and `(a'_i, b'_i)` output card `i` (`E_{k+1}`). Every challenge goes through the context hash `d`, which binds the root id, the seat, the deck id, the joint key and both full decks, so a proof cannot be reused in another game, at another step or for another deck:
```
d   = HS("shuffle-ctx", rootId, k, deckId, X, a_1, b_1, …, a_n, b_n, a'_1, b'_1, …, a'_n, b'_n)
u_i = HS("shuffle-u", d, c_1, …, c_n, i)                                   for i = 1..n
ch  = HS("shuffle-c", d, X, c_1, …, c_n, ĉ_1, …, ĉ_n, t1, t2, t3, t4[0], t4[1], t̂_1, …, t̂_n)
```
- `k` is the shuffling seat's 0-based index (§5.2). `k` and `i` are integer parts (decimal strings, §2).
- `d` enters `u_i` and `ch` as a scalar part: 32 bytes big-endian (§2), not its decimal string.
- The initial deck's `a` components are the identity, hashed as 33 zero bytes (§2).
- `c` is indexed by input card; `ĉ_0 = H2C("gen:h")` is implicit and not hashed.

**Proof object.** For a deck of n cards:
```json
{"c":[n points],"cHat":[n points],
 "s":{"s1":scalar,"s2":scalar,"s3":scalar,"s4":scalar,"sHat":[n scalars],"sPrime":[n scalars]},
 "t":{"t1":point,"t2":point,"t3":point,"t4":[point,point],"tHat":[n points]}}
```
- `c`: permutation commitments
- `cHat`: chained commitments
- `t4`: the ElGamal-pair commitment
- `sPrime`: the responses for the permuted randomizers.

**Verifying.** The proof transmits the commitments `t`. The verifier recomputes `d`, every `u_i` and `ch`, then checks each of CheckShuffleProof's equations for `t1`, `t2`, `t3`, `t4` and every `t̂_i` against `s`, `c` and `ĉ`. CHVote instead transmits `ch` and recomputes `t`; both are Fiat–Shamir forms of the same Σ-protocol, with equal soundness (D019). The transmitted form costs n + 5 more points.

**Test vectors.** `packages/deck/test/vectors/v1.json` is a complete 3-seat, 8-card deal from a fixed seed. It holds:
- the generators and card points
- the context strings in the forms above: a hex `rootId`, hex `npub` and `sessionPub` per seat, and a NIP-01 `tableAddress`
- keys with their proofs of knowledge, and the joint key
- every shuffle step's deck and proof, with its transcript `d`, `u_1…u_n` and `ch` as encoded scalars
- one share per seat and position, and the decrypted card at each position.

Secrets are included. Conforming implementations MUST verify every proof in it, reproduce every hash and reproduce every decryption. Every hash is checkable on its own: the shuffle transcripts are listed, and the proof-of-knowledge and share challenges are the proofs' `c`.

**Size.** For 108 cards:
- deck: 216 points
- proof: 3·108 + 5 = 329 points and 2·108 + 4 = 220 scalars
- total: 36,051 bytes of canonical JSON (deck 10,369, proof 25,682), measured.

### 5.4 Decryption shares
**Computing a share.** For a ciphertext `(a, b)`, seat `k`'s share is `D_k = x_k·a`, with a Chaum–Pedersen proof that `log_G X_k = log_a D_k`:
1. Pick `w`; compute `T1 = w·G` and `T2 = w·a`.
2. Compute `c = HS("dleq", rootId, deckId, pos, X_k, a, D_k, T1, T2)` and `s = w + c·x_k`.
3. The proof is `(c, s)`.

**Verifying.** Recompute `T1 = s·G − c·X_k` and `T2 = s·a − c·D_k`, then check `c`.

**Decrypting.** With all N shares, `M = b − Σ_k D_k`; the card is the `m` with `M_m = M`. No match means the deck is corrupt, which cannot happen once all proofs verify.
- Clients keep at most one share per seat and position. A seat may publish the same `D_k` twice with different proofs, and summing both would give a non-card.
- Each share is verified against its own seat's `X_k` before use, and a position is decrypted only once every seat is covered.
- The owner of a private card uses its own layer `x_k·a` in place of its share (§6.4). That layer needs no proof and is never published.
- `packages/deck` implements this as `decryptPosition` and `ownShare` (D025).

**Privacy.** Shares are public. A card stays hidden until its owner's own share is published, which happens only when the card is played or discarded.

## 6. Game flow

### 6.1 Phases
1. **Table:** Table, Joins, then Game root.
2. **Shuffle:** moves 1..N, one shuffle step per seat, in seat order.
3. **Deal:** every seat publishes one Shares event (7453) covering every position that is either:
   - assigned to *another* seat in the module's initial deal, or
   - a public position (the setup positions that `pending()` will request as reveals).
4. **Play:** game-action moves, `seq` N+1 onward.
5. **End:** the module reaches `over`. Then come Secret reveals (7455), the audit (§7) and Result attestations (7456).

**Required engine change.** The deal round needs every seat's hand positions to be assigned in the public state before any card is revealed. Chain Reaction currently deals hands after the setup tiles are revealed, starting from the first player, who depends on those tiles. It MUST change to assigning hands **at setup, in seat order**:
- seat 0 gets the 6 positions right after the setup tiles, seat 1 the next 6, and so on
- the setup tiles are then revealed, and the first player is determined as before.

Dealing order has no effect on fairness: positions are uniformly shuffled. RULES.md C03 changes accordingly.

### 6.2 Owed shares (liveness rule)
- **What is owed.** After any event, a seat *owes* a share for every deck position that is assigned (in the public state) to another seat, or is public, and for which the seat has not yet published a share.
- **Every game-action move MUST include all shares its sender owes as of the parent state.** A move missing any owed share is invalid.
- **Why that's enough.** In a round-robin game, each seat acts at least once between a player's draw and that player's next turn. So by the time a player must act, every other seat has shared their new cards. **No seat is ever needed online outside its own turn.**

### 6.3 Public reveals
- **When.** When `pending()` requests a public reveal of position `p` and all N valid shares for `p` exist, every client derives the module action `{"type":"reveal","actor":"deck","deck":…,"pos":p,"card":m}` and applies it.
- **Not signed.** Derived reveals are not events. Every client derives them identically from the share set.

### 6.4 Private cards
When a seat holds all other seats' shares for a position it owns, it decrypts locally and calls the module's `learn`. Learned cards never leave the client except through a play or discard reveal.

### 6.5 Move validity
A client accepts a Move (7452) as the next link if and only if all of the following hold:
1. Its `prev` is the current head and its `seq` is head + 1.
2. Its signer is the session key of the seat the protocol expects:
   - seat `seq−1` for shuffle steps
   - otherwise `pending()`'s seat.
3. The content is canonical and of the expected type.
4. For a shuffle step, the proof verifies.
5. For a game action:
   - every share and reveal proof verifies
   - all owed shares are present
   - each revealed share decrypts the named position to the card named in the action
   - the module's `apply` accepts the action.

**Invalid events are ignored.** They don't block the game: the seat can still publish a valid move.

### 6.6 Equivocation
Two different valid-looking Moves with the same `prev`, signed by the same session key, prove equivocation. Any client can show both events. The signer forfeits (§8.2).

## 7. End of game and audit
1. When the module reaches `over`, each seat MUST publish its Secret reveal (7455) within the game's deadline.
2. **Audit.** With every `x_k` known, any client decrypts every deck position, which gives the full deck order. It then replays the entire log in the module's **full mode** with that order. The full-mode engine re-checks every claim that depended on hidden cards, for example in Chain Reaction:
   - "no playable tile" (`skipPlace`)
   - "every dead tile discarded"
   - every hand slot's contents.
3. **Audit failure.** If the replay rejects an action, the action's actor cheated and forfeits.
4. **Attestation.** Each player SHOULD publish a Result attestation (7456).
   - A result is **valid** once the log, the reveals and the audit verify. It is **finalized** once every seat has attested.
   - Stats and ratings count valid results, and anyone can recompute one.

## 8. Deadlines, timeouts and forfeits

### 8.1 Timeout
- **Deadline.** The game root fixes `deadline` in seconds.
- **`pendingSince`** is the `created_at` of the event that made the stalled seat pending: the head move, or the event that completed the shares the seat needed.
- **Claiming.** Any seat MAY publish a Timeout claim (7454) naming the stalled seat and the current head, once `created_at ≥ pendingSince + deadline`.
- **Accepting.** Clients accept a claim only if the named seat is in fact pending at that head, and their own clock also shows the deadline has passed.
- **Who can be stalled:**
  - during play, the pending seat
  - during Shuffle, the seat whose step is next
  - during Deal or the end-of-game reveal, any seat that has not yet published.

### 8.2 Forfeit outcome
A seat forfeits by any of: an accepted timeout claim, equivocation, a failed audit, or failing to reveal its deck secret in time.

**When a forfeit happens before the end:**
- **Before the first game action** (during Shuffle or Deal): the game is **cancelled**. There is no result and no rating change, and the stalled seat is flagged.
- **Otherwise the game ends immediately:**
  - Forfeiting seats share the last places.
  - The other seats are ranked by the module's `standings(state)`: the scores the module would award if the game ended now, computed from public data. For Chain Reaction, that is final scoring applied to a copy of the current state.
  - Ties share places. The outcome reason is `forfeit`.

**When the forfeit is discovered at the end** (a failed audit or a withheld reveal), the declared final ranking is adjusted: the forfeiting seats move to the last places, and the others keep their relative order.

## 9. Relays
- **Publishing.** Clients publish to every relay in the root's `relay` tags plus their own NIP-65 write relays, and deduplicate by event id.
- **Retries.** On failure, clients rebroadcast the same signed event; they never re-sign.
- **Subscribing.** Clients subscribe with `{"kinds":[7452,7453,7454,7455,7456],"#e":[rootId]}`.

## 10. Requirements on rules modules
A `GameModule` used with this protocol MUST provide:
- `decks(rules)`
- deterministic dealing of positions, with initial hands assigned at setup, before any reveal (§6.1)
- `pending()` with public reveal requests
- `learn`, `knownTo`, `view` and `outcome`
- **`standings(state)`**, the scores as if the game ended now (new; added to the game kit in Phase 2)
- **round-robin liveness:** every seat acts at least once between two consecutive turns of any seat.

## 11. Security considerations
- **Hidden cards** are secret as long as at least one seat is honest about its deck key, which it never reveals before the end.
- **Shuffle tampering** (duplicating, removing or tracking cards) is prevented by the shuffle proof. Bad decryption shares are rejected by DLEQ proofs. A false claim about a hidden hand is caught by the end-of-game audit, with forfeit.
- **Collusion** between players can share their own private information. It cannot be prevented, only observed in statistics.
- **Self-reported `created_at`.** Deadlines are measured in days, so clock skew is irrelevant. Clients also check deadlines against their own clocks.
- **Cross-game replay.** Every proof and challenge binds the root id, the position or seat, and the deck. Moves are bound to the root and the parent.
- **Denial of service.** Clients MUST cap accepted event size (256 KB) and MUST ignore events from keys that are not seated.
- **Relay limits.** A public relay with an event-size cap below about 50 KB may refuse shuffle events. Mitigation: prefer relays that accept them (the owner's relay does). If needed, a later protocol version splits the proof into its own event.

## 12. Versioning
- This is protocol version 1, carried in the `proto` tag. The rules module id and version are pinned in the root.
- A game is always replayed with the engine version it started on.
- Incompatible protocol changes bump `proto`.
