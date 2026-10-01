# Bored Games protocol (draft, version 1)

`draft` `optional`

This document specifies how players run a turn-based multiplayer board game with hidden cards over NOSTR. It uses **no trusted server, dealer or referee**: only the players' clients and relays.

- Games are asynchronous. A player is never required to be online outside their own turn.
- The design was approved by the owner on 2026-10-01; decisions D018–D022 in `docs/DECISIONS.md` record it. The game-session rulings of Phase 2d (D030) amend §6–§8 and §11.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Overview

A game is a pure rules module implementing `GameModule` (`packages/game-kit`). Clients run the same module and agree on state by folding the same signed event log.

| Concern | How it is solved |
|---|---|
| Who may act | The rules module's `pending()` names exactly one seat, or a public deck reveal. Only that seat's session key may extend the move chain. |
| Ordering and forks | Moves form a hash chain (`prev` plus `seq`). Fork choice picks one chain. Two valid-looking moves on the same parent from the same signer prove equivocation; the signer ranks last. |
| Hidden cards | Mental poker: ElGamal on secp256k1 with a joint key, one shuffle by every seat with a **zero-knowledge proof of shuffle**, and decryption shares with **DLEQ proofs**. |
| Async dealing | Each seat attaches decryption shares for other seats' new cards to its own next event. Every other seat acts between a player's draw and that player's next turn. |
| Result | Every client replays the log. At the end, each seat reveals its deck secret, and every client re-plays the whole game with all cards visible to audit every hidden claim. Players then sign attestations. |
| Abandonment | Per-game move deadline (1, 3 or 7 days), measured on each client's own clock. After it, a timeout claim makes every stalled seat forfeit. |

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
| **session key** | one game | All in-game events (kinds 7452–7455), and the Join's `sessionSig` proving possession (below). Clients generate it locally; no signer prompt per move. |
| **deck key** `x_k`, `X_k = x_k·G` | one game | ElGamal secret share; must be distinct from the session key. |

**Backup.** Clients SHOULD back up the session key and deck key as a NIP-78 event:
- kind 30078, `d` tag `bored-games:<rootId>`
- content NIP-44-encrypted to the player's own npub.

That lets another device resume the game. Before the root exists, the table address substitutes for `rootId`.

**Proof of knowledge.** `X_k` is published with a Schnorr proof of knowledge `pok = (c, s)`, which defeats rogue-key attacks on the joint key:
- the prover picks `w`, computes `T = w·G` and `c = HS("pok", tableAddress, npub, sessionPub, X_k, T)`, then `s = w + c·x_k`
- the verifier recomputes `T = s·G − c·X_k` and checks `c`.

**Session key proof of possession (D033).** The Join also carries `sessionSig`, a BIP-340 signature by the session secret key over `SHA-256(UTF-8("bored-games/v1/session\n" + tableAddress + "\n" + npub))`, the same identifier forms as below. It proves that whoever publishes the Join holds the session key, and binds that key to one npub at one table.

**Context strings.** The PoK and the session signature hash these identifiers as the UTF-8 of their NOSTR hex text (D025):
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

**Parsing (D027).** Clients reject a game event unless all of these hold, checked in this order:
1. Its serialized JSON is at most 262,144 bytes of UTF-8 (§11).
2. It is a valid NIP-01 event: exact key set, lowercase hex, and a correct id and signature.
3. It has the expected kind and exactly one `["proto", "1"]` tag.
4. Each tag this section lists appears exactly once, unless it is marked "zero or more" or "one or more", and has exactly the items shown. Tags with other names are ignored.
5. The content is canonical JSON (§2) with exactly the keys shown.

**Field formats:**
- Pubkeys and event ids are 64 lowercase hex characters (D025).
- Counts and seconds (`seats`, `open`, `deadline`) are decimal integers without leading zeros.
- A relay URL is `ws://` or `wss://`, then a host (a DNS-style name of `[A-Za-z0-9.-]` with no leading `-`, an IPv4 address, or a bracketed IPv6 address), an optional `:port` of 1–5 digits up to 65535, and an optional path, query or fragment of printable ASCII. It has at most 256 characters and no userinfo.

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
- `tableId` has 1–64 characters from `[A-Za-z0-9._-]`. `moduleId` and the engine version have 1–64 characters.
- `seats` is between 2 and 64.
- `relay` URLs are distinct.
- Invited pubkeys are distinct and never the creator.

### 4.2 Join (7451)
Claims a seat: an invited seat, or one of the open seats.

**Tags:**
- `["a", "37450:<creator>:<tableId>"]`, `["p", <creator>]`
- `["rules-hash", <hex SHA-256 of the table's canonical rules>]`
- `["v", <engine semver>]`, the table's version

The Join commits to the table's rules and version, because the Table is addressable and its creator could republish it with other rules after players join. The proof of knowledge below stays bound to `[tableAddress, npub, session]` (§3).

**Content:**
```json
{"deckKey":"<point>","pok":{"c":"<scalar>","s":"<scalar>"},"relays":["wss://…"],"session":"<hex x-only pubkey>","sessionSig":"<128 hex>"}
```
The creator also publishes a Join for its own seat.
- The `p` tag MUST be the creator named in the `a` address.
- `relays` holds one or more distinct relay URLs.
- `session` is 64 lowercase hex characters (D025).
- `sessionSig` is 128 lowercase hex characters: the session key's BIP-340 signature over `SHA-256(UTF-8("bored-games/v1/session\n" + tableAddress + "\n" + npub))`, where `npub` is the Join's pubkey (§3). Clients MUST reject a Join whose `sessionSig` does not verify against `session`.
  - **Why:** nothing else proves that the joiner owns `session`. Without it, anyone could copy another player's `session` into their own Join, and the session collision checks (§4.3) would then evict the honest player. Because the message binds the npub and the table address, a copied `session` and `sessionSig` fail on any other Join.

### 4.3 Game root (7450)
Starts the game. It is immutable, and **the game id is this event's id**. The creator publishes it once the seats are filled with valid Joins.

**Tags:**
- `["a", <table address>]`
- `["game", …]`, `["v", …]`, `["deadline", …]`
- `["rules-hash", <hex SHA-256 of canonical rules>]`
- one `["e", <join id>, <relay>, "seat:<i>"]` per seat, in seat order (`i` = 0, 1, …). The join ids are distinct, and `<relay>` is a relay URL or `""`.
- `["relay", <url>]`, one or more

**Content:**
```json
{"rules":{…},"seats":[{"deckKey":"…","npub":"…","session":"…"}, …]}
```
- `seats` has one entry per `e` tag, in the same order.
- `seats[].npub` and `seats[].session` are 64-character lowercase hex x-only pubkeys, not bech32 (D025).
- `seats[].deckKey` is a point (§2).

**Seat order.** The creator chooses the seat order, and the root fixes it. Clients MUST check that:
- the root is signed by the table's creator and names its address, with the table's `game`, `v` and `deadline`
- there are exactly as many seats as the table's `seats`
- every seat matches a valid Join for that table: same npub, session and deck key
- each Join's proof of knowledge verifies
- no npub, session key or deck key appears twice
- no seat's session key equals any seat's npub, and no deck key's x-coordinate equals its session key (§3)
- each Join's `rules-hash` equals the root's `rules-hash`, and its `v` equals the root's `v`
- the creator holds a seat, and every other seat is either invited or one of the `open` seats
- the `rules-hash` is the hash of the rules, and the rules equal the table's rules (as the client holds that Table; the Joins' `rules-hash` and `v` are what stop a later switch)
- the joint key `X` is not the identity (D024)
- the named module exists at that version, its `validateRules` accepts the rules, and the seat count is within its `seatRange`.

**Joint key:** `X = Σ_k X_k`.

**OPEN:** clients do not check the table's `status` when validating a root. The creator flips `status` to `started` after it publishes the root, so the order of the two events is not fixed.

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
Claims that the game has stalled at `head` past the deadline (§8). `seat` names the stalled seat the claimant saw. Clients use neither it nor `created_at` to judge the claim (§8.1).

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

The attestation is signed by the player's npub (§7). After a timeout ending, `audit` records the forfeits with reason `timeout` or `withheld secret` (§8.2).

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

A timeout claim can end the game at any phase (§8): it is **cancelled** before the first game action and ends by forfeit after it.

**Hands at setup.** The deal round needs every seat's hand positions to be assigned in the public state before any card is revealed. Chain Reaction therefore assigns hands **at setup, in seat order** (D022, engine 0.3.0):
- seat 0 gets the 6 positions right after the setup tiles, seat 1 the next 6, and so on
- the setup tiles are then revealed, and the first player is determined as before.

Dealing order has no effect on fairness: positions are uniformly shuffled. RULES.md C03 states it.

### 6.2 Owed shares (liveness rule)
- **What is owed.** At a state `S`, seat `k` owes a share for every position that `dealt(S)` assigns to another seat or to `null` (a public position). A share is paid once the client holds a verified share by `k` for that position, from a Shares event (7453) or from any of `k`'s moves. Clients keep at most one share per seat and position, the first valid one (§5.4).
- **The rule (monotone).** A game-action move by seat `k` on parent state `S` is acceptable only if, counting `k`'s verified shares the client already holds plus those in the move, `k` has a share for every position it owes at `S`. The rule counts only what is held, never what is absent.
- **Buffering.** A move that fails only this rule MUST be buffered, not rejected. The missing shares may still arrive, for example in a Shares event published earlier that reaches this client later. The move links once they are held. Clients therefore converge whatever order events arrive in.
- **Building.** A client building a game action MUST attach every share its seat owes as of the head and has not yet published.
- **Why that's enough.** In a round-robin game, each seat acts at least once between a player's draw and that player's next turn. So by the time a player must act, every other seat has shared their new cards. **No seat is ever needed online outside its own turn.**

### 6.3 Public reveals
- **When.** Once the deal is complete, whenever `pending()` requests a public reveal and every listed position has all N verified shares, every client derives, for each listed position in ascending order, the module action `{"type":"reveal","actor":"deck","deck":…,"pos":p,"card":m}` and applies it. It repeats while the module requests reveals it can satisfy. The setup reveals are the first.
- **Not signed.** Derived reveals are not events. Every client derives them identically from the share set, and records each one in the interleaved action log (§7) at the point the fold applied it.
- **Moves wait.** While a reveal is pending, a game action on that state waits (§6.5).
- If a position decrypts to no card, or the module rejects the derived reveal, the client stops deriving. With verified shuffles and shares this cannot happen.

### 6.4 Private cards
- When a client holds every other seat's verified share for a position that `dealt` assigns to its own seat, it decrypts the position with its own layer (`ownShare`, §5.4) and calls the module's `learn`. Each position is tried once.
- **Learns are local.** They never enter the log or the audit. Learned cards never leave the client except through a play or discard reveal.
- **Learns start with the play phase**, after the setup reveals, so the module's state and events do not depend on the order in which the deal's Shares events arrived. During play, where a learn falls in the fold still depends on when the shares arrive; §10 requires modules to allow that.

### 6.5 Move validity
Clients keep every well-formed Move from a seated session key in a pool keyed by `prev` until it can be judged. A Move (7452) links to the chain as the next move if and only if all of the following hold:
1. Its `prev` is the current head and its `seq` is head + 1, or it is on the branch that fork choice selects (§6.6).
2. Its type and signer fit its `seq`:
   - `seq` ≤ N: a shuffle step signed by seat `seq−1`
   - otherwise: a game action signed by `pending()`'s seat.
3. For a shuffle step, the proof verifies against the deck at `prev` (§5.3).
4. For a game action, judged on the parent state, in this order:
   - The game is in play. If the deal is not complete, or a public reveal is pending, the move **waits**.
   - Every share and reveal proof verifies against the signer's deck key.
   - The module's `apply` accepts the action (on a copy of the state).
   - `reveals` covers exactly the positions that `revealsOf(state, action)` claims. `revealsOf` is syntactic, so it is trusted only for an action `apply` accepts.
   - Each reveal, combined with the other seats' held shares, decrypts the position to the card `revealsOf` claims. If another seat's share of a revealed position is missing, the move **waits**.
   - The owed-shares rule (§6.2). If it fails, the move **waits**.

A move that waits stays pooled and is judged again as events arrive. A move that fails any other check is invalid. A pooled move is judged when its `prev` links, and an invalid one is dropped for good, since its `prev` fixes its whole ancestry.

**Invalid events are ignored.** They don't block the game: the seat can still publish a valid move.

**When to act (the decide gate).** A seat's client MUST offer a decision exactly when the play phase pends a player decision for that seat and the module's `legalActions(state, seat)` is non-empty. A non-empty list is exact (§10), so the client MUST NOT also wait for the seat's whole hand to decrypt. Waiting for the hand deadlocks honest games: a merger disposal is an out-of-turn decision, and it can come before the other seats have shared the seat's last-drawn tile.

**Build once.** Every built event carries fresh randomness, so building a move twice for one decision gives two distinct valid moves on one `prev`: equivocation (§6.6). A client MUST build at most one move per decision (and one deal Shares event and one Secret reveal), persist it before publishing, and rebroadcast that same event (§9).

### 6.6 Equivocation and fork choice
- **Equivocation.** Two distinct Moves with the same `prev`, `seq` and signer, both *valid-looking*, prove equivocation. Any client can show both events. Valid-looking means valid as of `prev` on every check of §6.5 except the owed-shares rule:
  - a shuffle step: its proof verifies against the deck at `prev`
  - a game action: the signer is pending, every share and reveal proof verifies, the reveals decrypt to the claimed cards, and `apply` accepts the action.

  An invalid move never counts. Only rivals whose `prev` is on the chain count.
- **The seat is flagged, and play goes on.** Equivocation never stops, rewinds or cancels the game; otherwise one re-signed old move would let a seat void a finished game. The chain follows fork choice. When the game ends, the flagged seats forfeit with the end adjustment (§8.2), and the audit still runs.
- **Fork choice.** From the root, at each move on the chain, the next move is the successor heading the best valid branch. Branches rank by, in order:
  1. reaching the module's `over` (a branch that reaches it beats any that does not, whatever their lengths)
  2. length in accepted moves, longer first
  3. the lowest event id of the successor.

  A late rival on an old `prev` is shorter than the chain and never displaces it, and a finished game cannot be reopened by a branch that does not finish it. Moves on losing branches stay pooled; a branch switch replays the fold from the fork point.

## 7. End of game and audit
1. **Secrets.** When the module reaches `over`, each seat MUST publish its Secret reveal (7455). Clients accept a secret only if `x_k·G = X_k` for the signer's seat. A secret that arrives before the end is kept and counts once the game is over.
2. **Audit.** Once every seat's secret is known, any client:
   - decrypts every final-deck position with all the secrets (`decryptWithSecrets`, then `cardOf`), which gives the full deck order
   - sets the module up in **full mode** with that order
   - replays the **interleaved action log**: the chain's game actions and the derived reveals (§6.3), in the order the fold applied them. Learns are not replayed.

   The full-mode engine re-checks every claim that depended on hidden cards, for example in Chain Reaction:
   - "no playable tile" (`skipPlace`)
   - "every dead tile discarded"
   - every hand slot's contents.
3. **Verdict.** The audit is `pass`, or `{fail: [seats ascending], reason}`:
   - The first game action the replay rejects fails its actor, alone.
   - A rejected derived reveal, a position that decrypts to no card, or a full-mode setup that refuses the order fails every seat: no single seat is to blame.
   - If the replay's `outcome` differs from the one the client's own state declares, every seat fails (`outcome mismatch`).
   - `reason` has at most 500 code points.

   The failed seats forfeit, with the end adjustment (§8.2).
4. **Attestation.** Each player SHOULD publish a Result attestation (7456), signed by its **npub**, holding `{audit, logHash, outcome}` as its client computed them.
   - An attestation counts for a client when its signer is a seated npub and its content equals the client's own result.
   - One that does not match is kept, since the result may still change as events arrive, but only the latest per seat (by `created_at`, then the lowest id).
   - **Forfeit endings are attested too.** When a timeout ends the game the audit cannot run, so the `audit` field records the forfeits: `{fail: [forfeiting seats ascending], reason: "timeout"}` during play, or `reason: "withheld secret"` at the end (§8.2). A cancelled game has no result and is not attested.
   - A result is **valid** once the log, the reveals and the audit verify. It is **finalized** once every seat has attested.
   - Stats and ratings count valid results, and anyone can recompute one.

## 8. Deadlines, timeouts and forfeits

### 8.1 Timeout
- **Deadline.** The game root fixes `deadline` in seconds.
- **Local time.** Deadlines are measured on each client's own clock, never on `created_at`. A client records each event's **first-seen time**, the local time at which it first received that event. Clients MUST persist first-seen times by event id, so that a reload keeps them.
- **Progress time P** is the largest first-seen time over the root and every accepted progress event:
  - the chain's moves
  - Shares events that added a share the client did not hold
  - once the module is over, Secret reveals.

  Any progress restarts the deadline for every seat still stalled.
- **Claiming.** Once `now ≥ P + deadline` and a seat other than its own is stalled at the head, a seat MAY publish a Timeout claim (7454) naming the head and the lowest such seat.
- **Accepting.** A client accepts a claim if and only if:
  - it is signed by a seated session key
  - its `head` is the client's current head
  - some seat is stalled at that head (below)
  - the client's own clock shows `now ≥ P + deadline`.

  The claim's `created_at` and the seat it names are **ignored**. A claim whose head the client has not linked, or whose deadline the client's clock has not reached, is kept and judged again as events arrive and the clock advances. A claim naming an older head is rejected.
- **Who is stalled at the head:**
  - Shuffle: the seat whose step is next.
  - Deal: every seat that has not shared every position the deal assigns to another seat or to `null`.
  - Play, a player decision: the pending seat. Exception: if a position dealt to the pending seat lacks another seat's share, and the module lists no action for the seat on the public state (`legalActions(view(state, null), seat)` is empty), the decision needs that card, and the stalled seats are instead those missing a share of such a position. The test uses the public state so every client agrees.
  - Play, a pending public reveal: the seats missing a share of a listed position.
  - End: every seat whose Secret reveal is not in.
- **Claim limits.** A client keeps at most the 4 lowest-id claims per signer per head, evicting higher ids, and at most 8 claims per signer naming heads it has not linked. Further claims are ignored.

### 8.2 Forfeit outcome
A seat forfeits by any of: being stalled when a client accepts a timeout claim, equivocation, a failed audit, or a withheld deck secret (being stalled at the end when a claim is accepted).

**Accepting a claim.** Every seat stalled at the head forfeits, whichever claim was accepted and whichever seat it names. Seats flagged for equivocation (§6.6) forfeit with them. Then:
- **Before the first game action** (the chain holds no game-action move: during Shuffle, Deal, or play before the first action): the game is **cancelled**. There is no result, no attestation and no rating change, and the forfeiting seats are flagged.
- **During play: the game ends immediately.**
  - Forfeiting seats share the last places.
  - The other seats are ranked by the module's `standings(state)`: the scores the module would award if the game ended now, computed from public data. For Chain Reaction, that is final scoring applied to a copy of the current state.
  - Ties share places. The scores are the standings, and the outcome reason is `forfeit`.
  - The audit cannot run, so it is `{fail: [forfeiting seats], reason: "timeout"}` (§7).
- **At the end** (the module is over and a secret is missing): the forfeiting seats move to shared last places, and the others keep their declared relative order. The audit is `{fail: [forfeiting seats], reason: "withheld secret"}`.

**Forfeits found at a normal end** (a failed audit or equivocation): the declared final ranking is adjusted the same way. The forfeiting seats share the last places, the others keep their relative order, the declared scores are kept, and the reason is `forfeit`.

**Finality.** Accepting a claim is final for the client. From then on, every later move, Shares event and Secret reveal of the game is stored but changes nothing, fork choice stops, and the client's result no longer changes. Attestations are still accepted. Clients can still disagree if a stalled seat acts while some have accepted and others have not (§11).

## 9. Relays
- **Publishing.** Clients publish to every relay in the root's `relay` tags plus their own NIP-65 write relays, and deduplicate by event id.
- **Retries.** On failure, clients rebroadcast the same signed event; they never re-sign.
- **Subscribing.** Clients subscribe with `{"kinds":[7452,7453,7454,7455,7456],"#e":[rootId]}`.

## 10. Requirements on rules modules
A `GameModule` used with this protocol MUST provide:
- `decks(rules)`. The session supports exactly one deck.
- deterministic dealing of positions, with initial hands assigned at setup, before any reveal (§6.1)
- `pending()` with public reveal requests
- `learn`, `knownTo`, `view` and `outcome`
- **`standings(state)`**, the scores as if the game ended now, from public data only, so every view agrees (§8.2)
- **`dealt(state)`**, append-only and identical in full mode and in every view (§6.2)
- **`revealsOf(state, action)`**, the cards an action shows from its actor's hand; clients trust it only for actions `apply` accepts (§6.5)
- **round-robin liveness:** every seat acts at least once between two consecutive turns of any seat.

It MUST also meet these contract rules, which the session relies on:
- **`legalActions` is exact or empty.** It MUST return `[]` whenever the legality of any action it would list depends on hidden cards the seat has not learned. A non-empty list is then always exact, which the decide gate (§6.5) and stall attribution (§8.1) rely on. `view(state, null)` MUST accept a view-mode state, since stall attribution asks `legalActions` on the public view.
- **`learn` tolerates arrival order.** Where a learn falls among other seats' actions depends on when shares arrive (§6.4). A learn MUST commute with every action: learning a card before or after an action gives the same state. A module's `learn` SHOULD emit no events, since their place in the event log would depend on arrival order (Chain Reaction's emits none).

## 11. Security considerations
- **Hidden cards** are secret as long as at least one seat is honest about its deck key, which it never reveals before the end.
- **Shuffle tampering** (duplicating, removing or tracking cards) is prevented by the shuffle proof. Bad decryption shares are rejected by DLEQ proofs. A false claim about a hidden hand is caught by the end-of-game audit, with forfeit.
- **Collusion** between players can share their own private information. It cannot be prevented, only observed in statistics.
- **Timestamps.** `created_at` is self-reported and can hold any value, so no rule a seat could exploit depends on it. Deadlines use local first-seen times (§8.1). `created_at` only orders a seat's own mismatching attestations (§7), the lobby's default fill order (D021) and NIP-01 replacement of the Table. Consequences:
  - Each client's deadline starts when *it* sees progress, so no client accepts a claim before a full deadline has passed on its own clock since the last progress it saw. A client that syncs late is more lenient, never stricter.
  - A claim's date proves nothing: dating a claim, a move or a share ahead or back changes no client's judgement.
  - A client without persisted first-seen times (a new device) sees every event for the first time when it syncs, which restarts its deadlines. That only delays its own acceptance.
- **The claim race.** Clients accept a claim at different moments: each when its own deadline passes, so there is a window between the first and the last. If a stalled seat publishes inside that window, clients can split. One that accepted first ignores the late event (§8.2, finality). One that folds the event first rejects the claim if it was a move, since the head moved on; if it was a share or a secret, its deadline restarts, and it later forfeits fewer seats or none. Signatures cannot settle the order, since any `created_at` can be claimed. The window opens only after a full deadline of silence from the stalled seat, so this is accepted as a residual risk.
- **Postponement by fresh shares (OPEN).** Every Shares event that adds a share counts as progress (§8.1). Any seat, the stalled one included, can therefore restart the deadline by publishing a share it has not published before, for example of a position still in the bag. Each seat has one share per position, so this is bounded by the deck size per seat (108 deadlines for Chain Reaction), but it is not prevented.
- **Alternative endings.** Fork choice ranks a branch that reaches `over` first, so a finished game cannot be reopened. When two branches both reach `over`, length and then id decide, so the last mover can still choose between alternative endings it signed. That can change the other seats' relative order and the `logHash`. Signing two endings is equivocation, which costs that seat its own place, so this is accepted.
- **Re-signed old moves** never rewind or cancel a game (§6.6): they flag the signer, who forfeits at the end.
- **Cross-game replay.** Every proof and challenge binds the root id, the position or seat, and the deck. Moves are bound to the root and the parent.
- **Denial of service.** Clients MUST cap accepted event size (256 KB) and MUST ignore events from keys that are not seated. They also bound the work a seat can cause:
  - An event whose id is already held is a duplicate, found before it is parsed or verified.
  - Timeout claims: the limits of §8.1.
  - Rival shuffle steps: at most 3 proof verifications per (`prev`, signer).
  - Mismatching attestations: one per seat (§7).
  - Fork choice runs trial folds, and they are bounded. A pooled move that cannot link yet counts as depth 1 at most, with nothing below it. A branch's pooled depth is computed iteratively and capped at 64. Each fork's verdict is kept until the pool below it or the share set changes. Trials skip the audit and private learns, and the audit is cached by log hash.
  - **Residual:** junk moves under a rival that can link still cost one trial each, paid for with the attacker's own signed events. The first trial drops them as invalid.
- **Relay limits.** A public relay with an event-size cap below about 50 KB may refuse shuffle events. Mitigation: prefer relays that accept them (the owner's relay does). If needed, a later protocol version splits the proof into its own event.

## 12. Versioning
- This is protocol version 1, carried in the `proto` tag. The rules module id and version are pinned in the root.
- A game is always replayed with the engine version it started on.
- Incompatible protocol changes bump `proto`.
