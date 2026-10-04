# Bored Games protocol (draft, version 1)

`draft` `optional`

This document specifies how players run a turn-based multiplayer board game with hidden cards over NOSTR. It uses **no trusted server, dealer or referee**: only the players' clients and relays.

- Games are asynchronous. A player is never required to be online outside their own turn.
- The design was approved by the owner on 2026-10-01; decisions D018–D022 in `docs/DECISIONS.md` record it. The game-session rulings of Phase 2d (D030) amend §6–§8 and §11. D045 adds deckless games (§6.1, §10) and Resign (§4.9, §8.3).

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
| Abandonment | Per-game move deadline (1, 3 or 7 days), measured on each client's own clock. After it, a timeout claim makes every stalled seat forfeit. In a 2-seat game without a deck, either seat may also resign at any time (§4.9, §8.3). |
| Games without hidden cards | A module with no deck (Chess) skips the shuffle, the deal, the shares and the secrets: play starts with move 1 (§6.1). |

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
| 7457 | Resign | regular | session key |
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

**Shuffle step.** Moves 1..N, where N is the number of shuffle steps (§6.1); move `k+1` is seat `k`'s shuffle.
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

A valid Resign in a game with a deck carries the same secret (§4.9) and counts as the seat's Secret reveal: a seat whose secret is in, by either event, owes no Secret reveal (D052).

### 4.8 Result attestation (7456)
**Tags:** `["e", <rootId>, "", "root"]`.

**Content:**
```json
{"audit":"pass"|{"fail":[<seat>…],"reason":"…"},"logHash":"<hex>","outcome":{"places":[…],"reason":"…","scores":[…]}}
```

`logHash` is the SHA-256 of the move event ids in `seq` order, joined with `\n`.

**Unrated results (D052).** When a Resign ended a game of 3 or more seats (§8.3), `outcome` carries two more keys, both or neither: `"unrated":true` and `"endedBy":{"seat":<k>,"type":"resign"}`, `k` the resigning seat. **A frozen end (D056, fix round 2):** when the module's end holds only because a deck secret froze its fork (§6.6), a game of 3 or more seats carries the same two keys with `"endedBy":{"seat":<k>,"type":"fork"}`, `k` the forker. Every other outcome has exactly `places`, `reason` and `scores`, so its attestation is unchanged. Each key has one accepted encoding: `unrated` is only `true`, and `endedBy` has exactly those two keys, with `type` `"resign"` or `"fork"` and `seat` a seat of the game. A client from before D056's fix round 2 rejects the `"fork"` type; it computes another result for such a game anyway (it ranks the end above the settled chain without the marker, §6.6), so no game it agreed on changes.

The attestation is signed by the player's npub (§7). After a timeout ending, `audit` records the forfeits with reason `timeout` or `withheld secret` (§8.2); after a resign ending, with reason `resign`, or `resign; <reason>` when the partial audit or a withheld secret adds forfeits (§8.3).

### 4.9 Resign (7457)
A seat gives up the game (D045, D052). **Allowed in every game,** whatever its number of seats and whether or not it has a deck, with two exceptions where every Resign is invalid: a **2-seat game with a deck** (the resigner's published secret plus the other seat's own key would open the whole deck, draw pile included, even if the Resign never counts), and a game whose module opts out (`resignAllowed(rules, seats)` returns false: a co-op game, or one where a seat cannot see its own cards, where the early secret would expose other seats' cards, §8.3). Any seat may publish one at any time while the game is live, on its turn or not. Its effect is in §8.3.

**Tags:** `["e", <rootId>, "", "root"]`, `["e", <headId>, "", "head"]`: the head the resigning seat saw (the root before the first move). A Resign counts only once that head is on the receiving client's chain (§8.3).

**Content:** one accepted form per game:
- **Deckless game:** `{"type":"resign"}`.
- **Game with a deck:** `{"secret":"<scalar x_k>","type":"resign"}`, the seat's deck secret, encoded as in the Secret reveal (§4.7). Clients MUST check that `x_k·G = X_k` for the signer's seat.

A Resign that lacks the secret in a game with a deck, carries one in a deckless game, or carries a secret that does not match its seat's deck key is **invalid**, and clients reject it. The secret in a valid Resign is the seat's Secret reveal (§4.7), whether or not the Resign counts: the resigning seat owes nothing afterwards, and the remaining seats owe their secrets (§8.3). The secret is public from the moment the Resign is; §8.3 ("The early secret") explains what that reveals.

A client builds at most one Resign per game, persists it before publishing and rebroadcasts that same event (§9).

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
**N, the number of shuffle steps,** is the number of seats when the module has a deck (`decks(rules)` lists one), and **0 for a deckless game** (`decks(rules) = []`, for example Chess). Game actions are moves N+1 onward.

1. **Table:** Table, Joins, then Game root.
2. **Shuffle:** moves 1..N, one shuffle step per seat, in seat order.
3. **Deal:** every seat publishes one Shares event (7453) covering every position that is either:
   - assigned to *another* seat in the module's initial deal, or
   - a public position (the setup positions that `pending()` will request as reveals).

   **A seat deals once per game (D056, review F7).** A seat that has published its deal on one final deck MUST NOT publish deal shares on another: after a shuffle fork (§6.6) the equivocating shuffler knows the re-encryption factors of both rival decks, so it can translate a seat's shares from one deck to the other and read that seat's hand (§11). A client therefore owes no deal while it holds a Shares event of its own seat that fails against the current final deck, and stall attribution during the deal names the shuffle equivocator instead (§8.1). A client keeps every deal it built, published or not, and never builds another: a deal that never got a relay's confirmation may still be on a relay (§9). A client SHOULD republish the shuffle steps of the deck it deals on when it publishes its deal, so that every client its deal reaches also holds that deck, and with it any fork the equivocator showed to some seats only.
4. **Play:** game-action moves, `seq` N+1 onward.
5. **End:** the module reaches `over`. Then come Secret reveals (7455), the audit (§7) and Result attestations (7456).

**Deckless games (D045, amended by D058 for dice).** With N = 0 there is no Shuffle and no Deal: the client sets the module up in view mode when it loads the root, and play starts with move 1. There are no card shares and no deck secrets: a Shares event (7453) or a Secret reveal (7455) for a deckless game is invalid. A game action's `reveals` is empty. Its `shares` is empty too, except in a dice game (§6.3a), where a roll or a contribution carries exactly one beacon share and nothing else. When the module reaches `over` the audit runs at once (§7), with no Secret phase. Joins and the root still carry deck keys and their proofs (§4.2), unchanged: a dice game uses those keys for the beacon.

A timeout claim (§8) or a Resign (§8.3) can end the game in any phase before the module is over: it is **cancelled** before the first game action and ends by forfeit after it. After a Resign in a game with a deck, the End phase still follows: the remaining Secret reveals, a partial audit and the attestations (§8.3).

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

### 6.3a Derived dice rolls (D058)
A module that rolls dice exposes `rolls` and `beaconOf`. The session treats it as a beacon game even when `decks(rules)` is empty. Bank is the first (§4.3 of `docs/GAME-SYSTEMS.md`, option 1b). The roll is one public result. Each other seat's share is sent by its open app, with no decision. That is not a prompt duty in D050's sense: it releases no hidden card and no sealed choice.
- **The point.** Roll `i` is `H_i = h2c('roll:' + rootId + ':' + i)`. Seat `k`'s contribution is `D = x_k·H_i`, published as one decryption share (`packages/deck` `makeRollShare`) bound to the reserved deck id `roll` and position `i`, with a DLEQ proof against the seat's deck key. The deck key was fixed at Join, so the seat has exactly one valid contribution. Proof randomness does not change `D`.
- **Who publishes, and when.** The seat who chooses to roll attaches its share to that Roll move. `beaconOf` names the roll id for that action and for each later Contribute action, and names none for a bank or a stay. Every other seat then publishes one contribution, in the order the module lists. An open app sends it as a `beacon` duty (`buildBeacon`); it is not a player decision, and the screen offers no button. The last publisher is a seat other than the roller, so the roller cannot compute the faces before choosing to roll. That last seat learns the faces first and can only withhold, which a closed window does by publishing nothing. Withholding is a timeout forfeit (§8). The share is the one the deck key already determines.
- **Not a Shares event.** The share rides on the move (§6.1). A Shares event (7453) in a deckless game stays invalid. The session stores the share in the same share store as card shares, keyed by the roll id. Bank deals nothing, so a roll id never meets a card position. A game that deals and rolls needs a deck id on that store; v1 does not have one.
- **Deriving.** Once `pending()` is `{type:'beacon', id}` and every seat has one verified share of that id, every client computes the seed as the SHA-256 of those `D` points in seat order, each as compressed SEC1 bytes, draws two faces in `1..6` by rejection sampling (`packages/dice` `faces`), and applies `{type:'rolled', actor:'beacon', id, dice:[a,b]}`. The action is not an event. It is recorded in the interleaved action log (§7) at the chain length where the fold applied it, which is the length after the last contribution. The fold derives it in the same settle as that contribution, and a trial fold does too, so fork choice sees the dice. The client repeats while the module pends a beacon it can satisfy.
- **A player does not send the faces.** A game action whose action is `{type:'rolled', …}` is invalid (`a player does not send the dice`), before the pending-seat check. While a beacon is pending, a game action is invalid (`no player decision is pending`): the fold derives the roll itself, and the move is not buffered. A roll or a contribution with the wrong number of shares, a reveal, a share for another roll, or a share that fails `verifyRollShare` is invalid. A bank or a stay that carries a share is invalid.
- **Audit.** Contributions are checked when the move is folded. The replay (§7) re-applies the derived roll from the log. It does not re-draw the faces: the faces in the log are what every client derived from the same shares. A module that rejects that roll fails every seat, as a rejected derived reveal does.

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

A move that waits stays pooled and is judged again as events arrive. A move that fails any other check is invalid. A pooled move is judged when its `prev` links (a shuffle step only while it is a candidate, §6.6), and an invalid one is dropped for good, since its `prev` fixes its whole ancestry.

**Invalid events are ignored.** They don't block the game: the seat can still publish a valid move, unless it has already published more than 3 shuffle steps on that `prev` (§6.6). A second well-formed shuffle step still flags its seat (§6.6).

**When to act (the decide gate).** A seat's client MUST offer a decision exactly when the play phase pends a player decision for that seat and the module's `legalActions(state, seat)` is non-empty. A non-empty list is exact (§10), so the client MUST NOT also wait for the seat's whole hand to decrypt. Waiting for the hand deadlocks honest games: a merger disposal is an out-of-turn decision, and it can come before the other seats have shared the seat's last-drawn tile.

**Build once.** Every built event carries fresh randomness, so building a move twice for one decision gives two distinct valid moves on one `prev`: equivocation (§6.6). A client MUST build at most one move per decision (and one deal Shares event per game, §6.1, and one Secret reveal), persist it before publishing, and rebroadcast that same event (§9), but only while it still fits the game (§9, "Saved events that may be stale").

### 6.6 Equivocation and fork choice
- **Equivocation.** Two distinct Moves with the same `prev`, `seq` and signer prove equivocation when `prev` is the chain's move at `seq − 1`. Any client can show both events.
  - **Shuffle steps** (`seq ≤ N`): any two *well-formed* steps count, whether or not their proofs verify. Well-formed means the event parses and is signed by seat `seq − 1`. Only that seat's key can sign both, and an honest client signs one step per prev (D030 Ruling 12).
  - **Game actions:** both must be *valid-looking*, that is, valid as of `prev` on every check of §6.5 except the owed-shares rule: the signer is pending, every share and reveal proof verifies, the reveals decrypt to the claimed cards, and `apply` accepts the action. An invalid action never counts.
- **The seat is flagged, and play goes on.** Equivocation never stops or cancels the game, and it rewinds the game only for a rival branch that reaches the module's `over` (fork choice below; §11, "A stale rival"); otherwise one re-signed old move would let a seat void a finished game. The chain follows fork choice. When the game ends, the flagged seats forfeit with the end adjustment (§8.2), and the audit still runs.
- **Shuffle candidates.** For each `prev`, `seq ≤ N` and signer, let C be the well-formed steps held. If C holds 3 steps or fewer, each is a candidate. Otherwise only *acknowledged* steps are: some well-formed Move signed by another seat lies 1 to 32 Moves below the step along `prev`, every Move on that path held. Fork choice considers only candidates. A step that is not one is kept, not verified and not rejected; it becomes a candidate if it is acknowledged later, and a step on the chain that stops being one is cut back off it, with the Moves after it. Both conditions depend only on the events held, so clients holding the same events agree. A seat that publishes more than 3 unacknowledged steps on one `prev` therefore stalls its own position, and the timeout falls on it (§8).
- **Fork choice.** From the root, at each move on the chain, the next move is the successor heading the best valid branch among the candidates, every branch from that move ranked at that fork. A branch is **settled** when every seat other than the signer of its first move (the seat that forked there) has signed a move on it. Branches rank by, in order:
  1. reaching the module's `over` or being settled: such a branch beats one that is neither, whatever their lengths. At a **frozen** fork, being settled does not count here: the fork is frozen once the client holds the deck secret (a Secret reveal, or a Resign that carries it) of any seat other than the forker;
  2. length in accepted moves, longer first;
  3. reaching the module's `over`;
  4. the lowest event id of the successor.

  **Consensus change (D056, "the late ending rival").** Up to D056's fix round rank 1 was "reaching `over`" alone (D030 Ruling 9), with no rank 3. An ending side branch still beats a longer live chain, unless every other seat has played on that chain since the fork: then the live chain stays, and the ender, who signed both, is flagged (it equivocated). Before, a seat could sign a rival that ended the game at an old turn of its own and cut a game in play back to it: rated kingmaking at the cost of its own place. A finished game is still not reopened by an honest seat: a seat whose client holds the end never plays on the rival, so the rival is settled only if every seat but the ender played on it, having never seen the end or colluding with the ender (§11). **The freeze** keeps a game whose secrets are out from going on: clients publish their deck secret as soon as their chain is over (§7), so without it a colluder of the ender could withhold its move on the live chain until the honest seats had seen the ending branch win and revealed their secrets, then settle the live chain with that move and play on knowing their hands. The ender's own secret does not freeze the fork, or the ender could force its rewind alone. **A frozen end is unrated (fix round 2).** Any other seat can reveal its secret at any time, and nothing can tell an early reveal from an honest one made after the end won, so a colluder's reveal mid-game would give the ender its old rewind back at almost no cost (the colluder's hand stops mattering once the game ends). So when the chain is over and, at the lowest fork on it that is frozen, the best side branch ranked without the freeze would beat the chain's tail, the result is marked `"unrated":true` with `"endedBy":{"seat":<forker>,"type":"fork"}` in a game of 3 or more seats (§4.8); the forker forfeits as an equivocator either way. This is a function of the events held. With 2 seats the only other seat is the forker's opponent, and the forker is last whatever the branch, so the result stays rated. Ranking settled live branches above unsettled ones whatever their lengths is forced: with "ending beats unsettled" and "a longer settled branch beats an ending one", comparing live branches by length alone would be cyclic, so not a function of the events held. Every fork is a same-seat equivocation (only the seat `pending()` names, or seat `seq − 1` for a shuffle step, can sign a valid successor of a given move), so this ranking matters only once a seat equivocates. No event kind or tag changes; an attested outcome gains one `endedBy` type (§4.8).

  A late rival on an old `prev` that no other seat has played on is shorter than the chain and never displaces it, and a finished game cannot be reopened by a branch that does not finish it unless that branch is settled. Moves on losing branches stay pooled; a branch switch replays the fold from the fork point.

## 7. End of game and audit
1. **Secrets.** When the module reaches `over`, each seat MUST publish its Secret reveal (7455). Clients accept a secret only if `x_k·G = X_k` for the signer's seat. A secret that arrives before the end is kept and counts once the game is over. A deckless game has no secrets: its audit runs as soon as the module reaches `over`, and its full-mode setup gets `deckOrders: {}`.
2. **Audit.** Once every seat's secret is known, any client:
   - decrypts every final-deck position with all the secrets (`decryptWithSecrets`, then `cardOf`), which gives the full deck order
   - sets the module up in **full mode** with that order
   - replays the **interleaved action log**: the chain's game actions, the derived reveals (§6.3) and the derived rolls (§6.3a), in the order the fold applied them. Learns are not replayed.

   The full-mode engine re-checks every claim that depended on hidden cards, for example in Chain Reaction:
   - "no playable tile" (`skipPlace`)
   - "every dead tile discarded"
   - every hand slot's contents.
3. **Verdict.** The audit is `pass`, or `{fail: [seats ascending], reason}`:
   - The first game action the replay rejects fails its actor, alone.
   - A rejected derived reveal, a rejected derived roll, a position that decrypts to no card, or a full-mode setup that refuses the order fails every seat: no single seat is to blame.
   - If the replay's `outcome` differs from the one the client's own state declares, every seat fails (`outcome mismatch`).
   - `reason` has at most 500 code points.

   The failed seats forfeit, with the end adjustment (§8.2).
4. **Attestation.** Each player SHOULD publish a Result attestation (7456), signed by its **npub**, holding `{audit, logHash, outcome}` as its client computed them.
   - An attestation counts for a client when its signer is a seated npub and its content equals the client's own result.
   - A client keeps one attestation per seat: its latest by (`created_at`, id), the higher id winning a tie, whatever the arrival order. The seat counts as attested when that one matches; an older one never counts. A mismatching latest one is kept, since the result may still change as events arrive.
   - **Forfeit endings are attested too.** When a timeout ends the game the audit cannot run, so the `audit` field records the forfeits: `{fail: [forfeiting seats ascending], reason: "timeout"}` during play, or `reason: "withheld secret"` at the end (§8.2). A cancelled game has no result and is not attested.
   - A result is **valid** once the log, the reveals and the audit verify. It is **finalized** once every seat has attested.
   - Stats and ratings count valid results, and anyone can recompute one.
   - **Ratings exclude unrated results (D052).** An outcome with `"unrated":true` (a Resign ended a game of 3 or more seats, §8.3, or a frozen end, §6.6) counts toward no rating, ranking, completion or win statistic. Its `endedBy` records the seat that ended the game, for anti-griefing tracking: a client or a future rating service SHOULD count, per player, the games they ended this way. A 2-seat Resign is an ordinary loss and is rated.

## 8. Deadlines, timeouts and forfeits

### 8.1 Timeout
- **Deadline.** The game root fixes `deadline` in seconds.
- **Local time.** Deadlines are measured on each client's own clock, never on `created_at`. A client records each event's **first-seen time**, the local time at which it first received that event. Clients MUST persist first-seen times by event id, so that a reload keeps them.
- **Progress time P** is the largest first-seen time over the root and every accepted progress event:
  - the chain's moves
  - Shares events and Secret reveals that **removed a seat from the set of stalled seats** at the head (D030, Ruling 11). A Shares event that adds shares but leaves the stalled set unchanged is not progress.

  Any progress restarts the deadline for every seat still stalled.
- **Claiming.** Once `now ≥ P + deadline`, a seat that is not itself stalled at the head, while another seat is, MAY publish a Timeout claim (7454) naming the head and the lowest such seat.
- **Accepting.** A client accepts a claim if and only if:
  - it is signed by a seated session key
  - its `head` is the client's current head
  - some seat is stalled at that head (below)
  - its signer's seat is **not** stalled at that head: a stalled seat cannot claim
  - the client's own clock shows `now ≥ P + deadline`.

  The claim's `created_at` is **ignored**, and the seat it names is a shape check only (a seat of the game other than the claimant's): it need not be stalled, and it does not change the effect. A client judges its stored claims only after recording the progress of the event it is folding, so an event that makes progress restarts the deadline before any claim is judged again, whatever the arrival order. A claim whose head the client has not linked, or whose deadline the client's clock has not reached, is kept and judged again as events arrive and the clock advances. A claim naming an older head is rejected.
- **Who is stalled at the head:**
  - Shuffle: the seat whose step is next.
  - Deal: every seat that has not shared every position the deal assigns to another seat or to `null`. **Exception (D056, review F7):** while a shuffle fork is held on the chain (two well-formed shuffle steps by one seat on a chain prev, §6.6), the stalled seats are the shuffle equivocators alone. A seat that dealt on a rival deck owes no second deal (§6.1), so it is never blamed; a timeout then cancels the game with the equivocator forfeiting (§8.2). **Progress is frozen meanwhile:** no Shares event changes that stalled set, so none is progress (above), and the deadline runs from the last progress before the fork was held (a chain move, the fork-choice switch to the rival step included, or a Shares event that removed a seat), however many honest seats deal after it. Only the deal completing on the canonical deck (every seat dealt on it: play starts, which changes the stalled set) or a chain change is progress again.
  - Play, a player decision: the pending seat. Exception: if a position dealt to the pending seat lacks another seat's share, and the module lists no action for the seat on the public state (`legalActions(view(state, null), seat)` is empty), the decision needs that card, and the stalled seats are instead those missing a share of such a position. The test uses the public state so every client agrees.
  - Play, a pending public reveal: the seats missing a share of a listed position.
  - End: every seat whose Secret reveal is not in.
- **Claim limits.** A client keeps at most the 4 lowest-id claims per signer per head, evicting higher ids, and at most 8 claims per signer naming heads it has not linked. Further claims are ignored.

### 8.2 Forfeit outcome
A seat forfeits by any of: being stalled when a client accepts a timeout claim, equivocation, a failed audit (the partial one after a Resign included), a withheld deck secret (being stalled at the end when a claim is accepted), or a Resign (§8.3).

**Accepting a claim.** Every seat stalled at the head forfeits, whichever claim was accepted and whichever seat it names. Seats flagged for equivocation (§6.6) forfeit with them. Then:
- **Before the first game action** (the chain holds no game-action move: during Shuffle, Deal, or play before the first action): the game is **cancelled**. There is no result, no attestation and no rating change, and the forfeiting seats are flagged.
- **During play: the game ends immediately.**
  - Forfeiting seats share the last places.
  - The other seats are ranked by the module's `standings(state)`: the scores the module would award if the game ended now, computed from public data. For Chain Reaction, that is final scoring applied to a copy of the current state.
  - Ties share places. The scores are the standings, and the outcome reason is `forfeit`.
  - The audit cannot run, so it is `{fail: [forfeiting seats], reason: "timeout"}` (§7).
- **At the end** (the module is over and a secret is missing): the forfeiting seats move to shared last places, and the others keep their declared relative order. The audit is `{fail: [forfeiting seats], reason: "withheld secret"}`.

**Forfeits found at a normal end** (a failed audit or equivocation): the declared final ranking is adjusted the same way. The forfeiting seats share the last places, the others keep their relative order, the declared scores are kept, and the reason is `forfeit`.

**Finality.** Accepting a claim is final for the client. From then on, every later move, Shares event, Secret reveal and Resign of the game is stored but changes nothing, fork choice stops, and the client's result no longer changes. Attestations are still accepted. A Resign is final too, but differently: the game stays ended by it, while held moves still link and fork choice still runs to settle the head it is scored at (§8.3). Clients can still disagree if a stalled seat acts while some have accepted and others have not, or if a Resign races a claim or a move (§11).

### 8.3 Resign
A Resign (§4.9) is a voluntary forfeit (D045, D052), allowed in every game.
- **Validity.** A well-formed Resign with this game's root, signed by a seated session key, in the content form of its game (§4.9): with a deck, its secret must match the seat's deck key. An invalid Resign is rejected and recorded. A client keeps the lowest-id Resign per seat for the record, and the secret of every valid Resign it keeps counts as that seat's Secret reveal.
- **It counts once its head is held.** A Resign counts when the head it names is held by the receiving client: the root, a Move on its chain, or a Move on a side branch that lost fork choice, the branch's first move valid at its fork point below the client's head (an equivocation moved the chain off the named head; D052, review F8). A Move pooled on the head itself (waiting for shares) is not held. Until then the Resign waits, so a Resign that arrives before the resigner's own last move waits for that move, and every client ends the game at least at the resigner's head. Without the side-branch case, a lower-id rival signed by an equivocator left the Resign waiting for ever on clients that got the rival first, while clients that counted it first had stopped: the seat pending on the rival branch was then timed out there. A client keeps at most 8 waiting Resigns per seat, the lowest ids, and rejects the others; waiting Resigns do not count, so the cap never retracts anything.
- **It is final for the client, like an accepted claim (§8.2 "Finality").** If the client's result is not final yet (no claim accepted, no Resign counted, the module not over), the first Resign to count ends the game for every seat, at the client's head then:
  - **Cancelled** (no result, no audit) when the head it names comes before the first game action (the root, or in a game with a deck a shuffle step: seq ≤ N) **and** the client's chain holds no game action by the resigning seat. A Resign raced by another seat's first action therefore cancels on every client; a stale Resign naming the root, by a seat that has already played, is a loss on every client that holds one of its actions. Chain linking makes a client that holds any later action hold the resigner's earlier ones, so what is left to arrival order is only the resigner's own events, as with the head gate: a client that counts a stale Resign before holding any action by its seat cancels (the web client feeds a loaded batch's Resigns last, so a fresh device holds them). In a game with a deck **every seat still owes its Secret reveal after a cancel** (the resigner's came with its Resign): the secrets change nothing (no audit, no result), but a client that cancelled and one that ended the game owe the same secrets, so no client can forfeit an honest seat for a withheld secret over such a split. No Timeout claim counts in a cancelled game.
  - **Otherwise** the resigning seat (and any equivocator) forfeits and is ranked last; the others are ranked by the module's `standings(state)` at the head, the scores **as if the game ended now** (for Chain Reaction: bonuses paid and every share sold, even mid-merger). Ties share places, the scores are the standings, and the outcome reason is `resign`, even if this client's chain holds no game action yet.
    - **Deckless game:** done at once. Nothing is hidden, so no audit runs: the audit field records the forfeits, `{fail: [forfeiting seats], reason: "resign"}`, and the result is attested as usual.
    - **Ranked at the scoring position S, not simply at the named head** (below, "What is final, and where it is scored"): ranking at the head the Resign names would let the resigner pick a past position to be ranked at, which is kingmaking. The resigning seat is **strictly last**: when other seats forfeit too (equivocation, a failed partial audit, a withheld secret), they share the place just above it.
    - **Game with a deck: the End phase follows.** Every seat whose secret is not in yet owes its Secret reveal (§4.7); the resigning seat's came with its Resign. The counted Resign is progress (§8.1): the deadline for the secrets runs from its first-seen time, and a claim against a missing secret is judged as at the end (the seats whose secret is not in are the stalled seats; a claimant must have published its own). Once every secret is in, the client runs the **partial audit**: it decrypts every final-deck position with all the secrets, sets the module up in full mode, and replays the interleaved action log of its canonical chain (§8.3, "What is final"), exactly as in §7 step 2; if the chain changes later, it runs again. The verdicts of §7 step 3 apply (the first game action the replay rejects fails its actor; a rejected derived reveal, an undecryptable position or a refused setup fails every seat), but **no outcome is compared**, since the game did not end by its rules. The seats it fails forfeit too, just above the resigning seat. The audit field is `{fail: [forfeiting seats], reason: "resign"}` when it passes, or `reason: "resign; <the audit's reason>"` (cut to 500 code points) when it fails. If a claim is accepted for a withheld secret instead, the seats stalled then forfeit too and the audit field is `{fail: [forfeiting seats], reason: "resign; withheld secret"}`; the audit cannot run without every secret. Attestations wait for this result, as at a normal end.
  - **Unrated with 3 or more seats.** The outcome then also carries `"unrated":true` and `"endedBy":{"seat":<k>,"type":"resign"}` (§4.8), and both are attested. Ratings exclude the result, and `endedBy` records who ended it (§7 step 4). A 2-seat Resign is an ordinary loss: its outcome carries neither key, and it is rated.

  **What is final, and where it is scored (D052, review F8 and fix round 2).** The fact that the game ended by this Resign is final for the client: a counted Resign is never evicted or undone, later Resigns are too late, and no Timeout claim counts except for a secret the End phase owes. The client keeps folding Moves and Shares events and running fork choice exactly as in play (no seat owes a decision any more), but the result is scored at a **scoring position S** on the canonical chain, a function of the events held:
  1. **H'** is the named head if it is on the chain, else the Move where the named head's branch leaves the chain.
  2. **S0** is H', moved forward to just after the resigning seat's last game action on the chain, if it has any after H'. The resigner's own last turn counts ("move, then resign" and "resign, then move" cannot be told apart, and both are legitimate), and naming an old head never drops the resigner's own later Moves.
  3. **S** extends S0 through the contiguous Moves signed by the seat pending at S0, unless that is the resigning seat: the next seat's turn raced against the Resign is scored. It stops at the first Move by any other signer. Moves past S still link, but are never scored.
  4. **If the module is over at S** (a mate, a declared end), the game's own outcome stands: the rules result, with the normal End phase (Secret reveals and the full audit in a game with a deck), rated, without `unrated` or `endedBy`; clients record that a Resign was also held. Otherwise the result is the resign ranking at S, the resigner strictly last, unrated with `endedBy` with 3 or more seats.
  5. The **partial audit** replays the action log up to S (derived reveals and derived rolls included), and the attestation's `logHash` covers the chain up to S.

  Every client holding the same events computes the same S and attests the same result. Scoring at the bare canonical head was rejected (fix round 2): nobody can answer moves made after a Resign, so a resigner or a coalition could add free turns, and a pending Chess player could resign and then mate, giving places and scores that contradict each other. A Resign that cancels stops the fold for good (there is no result to score). An accepted claim (a withheld secret) stops the fold too.
- **A Resign that counts after the result is final changes nothing,** whether the result came from the module's own end (a mate or a declared end that raced the Resign stands), an accepted claim, or an earlier Resign. Its secret still counts as the seat's Secret reveal where the End phase needs one, so a seat whose own client counted its Resign first, and so publishes no Secret, is not timed out by the clients where the game ended otherwise.
- **Races (the claim-race residual, §11).** The head gate settles the honest case: the resigner's own last move. What remains is a true race, an event another seat sent at the same head before it received the Resign; which comes first then depends on each client's arrival order, and clients can disagree:
  - an ordinary raced move: no disagreement once every client holds it, since it links after the Resign too and the result is scored at the canonical head;
  - **a raced game-ending move: different outcomes.** For example, Black offers a draw with its move, then resigns while White sends `acceptDraw`: a client that counts the Resign first records a White win, one that folds the acceptance first a draw. A mate, a stalemating move, a capture that leaves insufficient material or a declared end race the same way;
  - **a raced timeout claim:** a client that accepts the claim first ends the game by forfeit (rated, the stalled seats last) and rejects the Resign; one that counts the Resign first ends it by the Resign, and the claim then fails, since its claimant now owes a secret, or there is no stalled seat.
- **Residuals.** A seat that floods more than 8 waiting Resigns naming heads nobody holds, and gets them to a client before its real Resign and before the head that Resign names, makes that client drop its real Resign (its own flood fills the cap); the client then still shows the game in play. It cannot undo a Resign that counted on the players' clients, whose attestations record the loss. The web client folds a loaded batch's other events before its Resigns, so its real Resign meets a held head and counts at once, outside the cap. A seat that withholds its secret after a Resign blocks the partial audit, as at a normal end: it forfeits for the withheld secret, but the hidden claims of the others go unchecked. **A Resign while the module pends a public reveal** (§6.3) no longer splits clients: the fold goes on after the Resign, so the derived reveals are applied once their shares are held, on every client alike. Chain Reaction pends public reveals only at setup, before the first game action, where a Resign cancels; `module-contract.test.ts` keeps it that way unless a game is reviewed for it.
- **Kingmaking by timing (moot).** A seat out of contention can end a game of 3 or more seats at a moment it picks, fixing the others' ranking at no cost to itself. Such a result is unrated and records who ended it, so it moves no rating, and a player who does this often is visible (§7 step 4).
- **The early secret.** A Resign in a game with a deck publishes the resigner's deck secret `x_r` at once, including to clients where the Resign still waits for its head, or never counts (its head lost a fork, or the resigner's own flood dropped it). `x_r` removes the resigner's layer from every position, and nothing else:
  - **The resigner's own cards** become public: every other seat's share of a position dealt to the resigner is already published (§6.2), so with `x_r` anyone can decrypt the resigner's hand, and on a branch where play goes on, every card the resigner draws later. This harms only the resigner, who chose to publish it, and it could always show its hand off the protocol.
  - **Another seat's cards** stay hidden: a position dealt to seat `j` still needs `j`'s own layer, which `j` never shares; the resigner's share of it was published already, so `x_r` adds nothing.
  - **Undealt positions** (the draw pile) still need the layer of every other seat, so they stay hidden while one of those seats is honest. Collusion with the resigner gains nothing new: it could always pass `x_r` privately.
  - A seat that sees the resigner's hand while the Resign waits for its head can use it for at most a move raced against the Resign (above), in a game that is ending, unrated.

  So the secret need not be hidden until the Resign counts, and the protocol does not try (it could not: an event is public once published).
- **Escaping the audit.** A seat cannot use a Resign to dodge the audit of its own hidden claims: the Resign carries its secret, so the partial audit decrypts every position once the others publish theirs, and replays every action up to the head, the resigner's included. An ally that resigns right after another seat's profitable cheat triggers that audit, which catches the cheat. Only withholding a secret blocks it, and that forfeits (Residuals, above).

## 9. Relays
- **Publishing.** Clients publish to every relay in the root's `relay` tags plus their own configured relays, and deduplicate by event id. Clients SHOULD also publish to their NIP-65 write relays (kind 10002); this client does not implement that yet.
- **Retries.** On failure, clients rebroadcast the same signed event; they never re-sign.
- **Saved events that may be stale (D056).** A client republishes a saved move, deal or Resign that no relay has confirmed only after its initial sync, and only once **every counted relay** has answered (EOSE) a query for its own seat's events: every page of the initial sync, or a later query. The counted relays are every root relay, and the player's own relays less any the client's pool has not had open for 2 minutes (`deadAfterMs`); a relay of another game the page opened does not count. A root relay always counts, dead or not, since the other device's move may be on it alone: a dead root relay leads to the hold cap and Send anyway. While a counted relay is silent the client holds the event, neither published nor discarded, and asks again on each tick. It also holds while it is visibly behind: it pools a move above its head (seq beyond head + 1) whose ancestry reaches the head or a parent it does not hold. It asks every counted relay for the missing parents by id; those that none sends, once every counted relay has answered, no longer hold anything back (a seat's junk move naming a random parent cannot). After 10 minutes of holding, the player is offered **Send anyway**, which vets the event on what the relays have sent (the screen warns that if the turn was already played on another device, sending counts as signing two moves). A saved move built on a saved move that was discarded is discarded with it. Then:
  - a move: discarded if another move of its seat on that parent is held, or if its parent is on the chain below the head; published if its parent is the current head (or the client already folded it in); otherwise (its parent is not held yet) it waits;
  - a deal: published if no other Shares event of its seat is held and the session accepts it; otherwise **kept** unpublished, and no other deal is ever built (§6.1: a seat deals once). A client never discards a deal its seat signed; it feeds it to its session, which then owes no deal;
  - a Resign: discarded if another Resign of its seat is held, or the game is no longer live; otherwise published. It need not name the current head: it counts once its head is held, and is scored at the scoring position (§8.3).

  A discarded event is removed from storage and logged. The seat's other device may have played that turn otherwise in the meantime, and republishing would be an equivocation the player never intended (§11, "A stale rival"). A saved Timeout claim, Secret reveal or attestation cannot conflict with anything and is republished as before. A client SHOULD publish the shuffle steps of its deck, and wait for the relays' answers, before its deal (§6.1); when it keeps a refused deal, it SHOULD republish the rival shuffle steps it holds on the forked prev, so a client that never saw the deck it dealt on holds the fork and stalls the equivocator, not this seat (§8.1). A saved move whose parent is on a branch that lost fork choice is discarded too.
- **The Secret reveal waits for a full view (D056, fix round 2).** A client publishes its Secret reveal only once every counted relay has answered a query for the whole game and it is not visibly behind (above), or after 10 minutes of waiting (timed apart from saved events' holds), or on Send anyway: a client that saw an ending branch win on a partial view would otherwise reveal, freezing the fork for everyone (§6.6).
- **Subscribing.** Clients subscribe with `{"kinds":[7452,7453,7454,7455,7457],"authors":[the seats' session keys],"#e":[rootId]}` and `{"kinds":[7456],"authors":[the seats' npubs],"#e":[rootId]}`, so strangers' events cannot crowd a relay's capped answer, and they still drop any event from another key. Stored events are paged: while a page brings an event not seen before, clients ask again with `until` set to that page's oldest `created_at`.

## 10. Requirements on rules modules
A `GameModule` used with this protocol MUST provide:
- `decks(rules)`: one deck, or none (`[]`). A deckless game has N = 0 shuffle steps, no deal, no card shares and no secrets (§6.1). A deckless game may still roll dice (§6.3a): `rolls` and `beaconOf` present means each roll or contribution carries exactly one beacon share. Several decks are not supported yet (`docs/GAME-SYSTEMS.md` §4.1.4).
- deterministic dealing of positions, with initial hands assigned at setup, before any reveal (§6.1)
- `pending()` with public reveal requests
- `learn`, `knownTo`, `view` and `outcome` (a deckless module's `learn` is never called)
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
- **Postponement by fresh shares (closed by Ruling 11).** Only events that change the stalled set count as progress (§8.1), so a stalled seat cannot restart its own deadline by publishing shares it was not stalled on.
- **Alternative endings.** Fork choice ranks a branch that reaches `over` with settled branches, above every other (§6.6), so a finished game cannot be reopened unless every seat but the ender played on a rival branch (none whose client held the end would). When two branches both reach `over`, length and then id decide, so the last mover can still choose between alternative endings it signed. That can change the other seats' relative order and the `logHash`. Signing two endings is equivocation, which costs that seat its own place, so this is accepted.
- **Re-signed old moves** never cancel a game (§6.6): they flag the signer, who forfeits at the end. They rewind it only when the rival branch reaches `over`, the chain has not, and some other seat has not played on the chain since the fork (below, "A stale rival").
- **A stale rival (the stale outbox, D056).** A seat's own old device may hold a move it saved offline for a turn the seat then played otherwise on another device. If that device republished the move, v1 would treat it as any re-signed old move (`packages/client/test/stale-rival.test.ts` pins this):
  - **Flagged, always.** The two moves are valid-looking rivals on one prev, so the seat is an equivocator and forfeits: ranked last at the end, during play and after it. In a finished game its place, and so the attested result, change after the attestations were signed (they no longer match, and must be signed again).
  - **No reorganization for an ordinary rival.** A rival on an old prev is shorter than the chain and never displaces it, in play or after the end (equal-length ties only arise for a rival of the last move).
  - **A reorganization when the rival ends the game, only within about a round.** A branch that reaches `over` beats one that does not, whatever its length, unless that one is settled (§6.6, D056). So a stale rival that ended the game at its position (in Chain Reaction a turn that declared the end; in Chess a mate, a stalemating move or an accepted draw) cuts the chain back to that old position and ends the game there only while some other seat has not played on the canonical chain since that position: the moves played since are dropped from the chain, and the result is that old ending with the seat ranked last. Once every other seat has played on the chain after it, the chain stays and the seat is only flagged. Before D056's fix round this rewind had no time limit (Ruling 9 alone; `stale-rival.test.ts` pins both answers). Once the chain is over too, the longer finished chain wins.
  - **Not after a timeout.** A client that accepted a timeout claim has stopped folding, so it does not even flag the seat (the claim-race class, above).

  The web client never republishes such a move (§9, "Saved events that may be stale"). Residuals: two devices of one seat that publish rival moves before either has seen the other's (no relay check can order them); a relay that accepted an event without confirming it and does not return it to queries; and a seat that signs such a rival on purpose, which costs it its place. A malicious seat can likewise end a game in play retroactively at a turn where it could have ended it, at the same cost, but only until every other seat has played after that turn (about one round). The coalition residuals: when the ender itself signs a rival and every other seat plays on it (colluding, or never shown the end), a real end is lost and the ender is only flagged; that takes every seat but the ender, since a seat whose client held the end never plays on. And a colluder that reveals its own deck secret mid-game freezes every fork whose forker is another seat (§6.6), which gives the ender its old rewind back at almost no cost to the colluder (its hand no longer matters once the game ends there); such a frozen end is unrated with the forker recorded (§4.8), so it moves no rating, and the forker is last. An honest Resign carries a secret and freezes too, but that game is ended by the Resign, unrated, already. Whether an ending branch should win fork choice at all is left to the v2 design ("final, or stop").
- **A shuffle fork during the deal (review F7, D056).** A last shuffler that signs two rival final steps A and B, and gets one seat to deal on A and another on B (or one seat on both), can translate the honest seats' shares between the decks: it knows the re-encryption factors of both (`packages/deck/test/fork-translation.test.ts`), so it can read the honest starting hands. Before D056 an honest client dealt again after fork choice moved it to the other deck. Now:
  - **A seat deals once** (§6.1): a seat that dealt on a rival deck owes no deal on the canonical one, and the web client never builds a second deal. So the deal completes on a deck only when every seat dealt on that deck, and then no honest share sits on a rival deck: the game that is played exposes nothing.
  - **The equivocator is stalled** (§8.1): while dealing, a held shuffle fork makes the shuffle equivocators the stalled seats, so a timeout claim cancels the game (before its first action) with the equivocator forfeiting, never a seat that dealt on a rival deck. Hands the equivocator could read belong to a game that is cancelled before anybody plays them.
  - **Deterministic and monotone in the events held:** the fork, the shares that fail against the canonical deck and fork choice are functions of the event set, and none is undone by more events. A rival step that arrives after the first game action is shorter than the chain and only flags its signer (§6.6, Ruling 5); "any shuffle fork cancels" was rejected, since such a late rival would void a game in play, or split clients that had linked a game action from those that had not.
  - **Griefing.** A last shuffler can now cancel a game before its first action by forking its step, flagged and blamed; it could already cancel it by stalling its step or by resigning (§8.3).
  - **Residuals.** A client that never holds the rival step blames the honest seat whose deal fails against its deck, until the fork reaches it; republishing the dealt-on deck with the deal (§6.1) makes a deal carry its deck, so this needs the equivocator to keep the step from every relay the deal reaches. Two devices of one seat that deal on two decks at once, before either sees the other's deal, still deal twice (the multi-device residual). A deal is never rebuilt, even one that no relay confirmed (§9), so a seat whose only deal is on the rival deck owes no other; on a client that never holds the rival step, that seat is blamed for the deal stall instead of the equivocator, and the game is cancelled before its first action (no result).
- **Resigns never rewind a game** (§8.3). A Resign is scored at the canonical head of the events held, never at the head it names, and it cannot be retracted. A finished game stands whatever Resigns arrive later.
- **The resign race.** A Resign counts once its named head is held and is then final, so a client that receives it before a move, claim or game-ending move another seat sent at the same moment ends the game earlier than one that receives them the other way round. This is the same class as the claim race above and is accepted for the same reason. An ordinary raced move converges (it still links after the Resign, §8.3); a raced game-ending move (an accepted draw, a mate), a raced claim, or two seats resigning at once can leave clients with different results.
- **A Resign's deck secret** is public as soon as the Resign is, before it counts anywhere. It reveals only the resigner's own cards; every other hidden card still needs another seat's layer (§8.3, "The early secret"). That holds only with 3 or more seats and when no seat's own cards are hidden from it, so a 2-seat deck game, and a module that opts out, reject every Resign (§4.9).
- **Equivocation evidence after a timeout is never flagged.** Once a timeout claim is accepted (or a Resign cancels the game), the fold stops (§8.2, "Finality"), so a rival move that arrives afterwards does not flag its signer there, while a client that received it before did. The forfeits, and so the places, can then differ between clients, as in the claim race. After a Resign that ends the game the fold goes on, so such evidence is still flagged (§8.3).
- **Moves after a Resign.** Moves signed after a Resign still link, but the result is scored as if the resigner had resigned just after its own last action: every Move up to that action is scored, whenever it was signed, plus the contiguous run of the seat pending there (§8.3, the scoring position). Moves past that are never scored, are not progress (§8.1) and do not move the head a Timeout claim must name, so they cannot delay a claim for a withheld secret. Residuals, the same on every client given the same events and only in unrated results: a resigner can keep playing its own turns after its Resign and have them scored (as if it had resigned later); a malicious resigner naming an old head drops the Moves made after its own last action, except the next seat's run; a coalition seat that is next after the resigner's last action gets that one run scored.
- **Hiding a Resign.** A resigner that publishes its Resign to some relays only could leave other clients thinking the game is live, so that a coalition times out an honest pending seat there. A client that counts a Resign republishes it to the root's relays and its own (the web controller does), and the bounded scoring position removes any post-resign move that would keep the game looking live.
- **Cross-game replay.** Every proof and challenge binds the root id, the position or seat, and the deck. Moves are bound to the root and the parent.
- **Denial of service.** Clients MUST cap accepted event size (256 KB) and MUST ignore events from keys that are not seated. They also bound the work a seat can cause:
  - An event whose id is already held is a duplicate, found before it is parsed or verified.
  - Timeout claims: the limits of §8.1.
  - Rival shuffle steps: per (`prev`, `seq`, signer), a client verifies only the candidates (§6.6): at most the 3 steps that arrive while the group holds 3 or fewer, plus those another seat acknowledged. The others stay unverified whatever their arrival order, yet still flag their signer. Acknowledging junk takes another seat's signed Move, so only colluding seats can buy more verifications, one per Move they sign.
  - Attestations: one per seat (§7).
  - Fork choice runs trial folds, and they are bounded. A pooled move that cannot link yet counts as depth 1 at most, with nothing below it. A branch's pooled depth is computed iteratively and capped at 64. Each fork's verdict is kept until the pool below it or the share set changes. Trials skip the audit and private learns, and the audit is cached by log hash.
  - **Residual:** junk moves under a rival that can link still cost one trial each, paid for with the attacker's own signed events. The first trial drops them as invalid.
- **Relay limits.** A public relay with an event-size cap below about 50 KB may refuse shuffle events. Mitigation: prefer relays that accept them (the owner's relay does). If needed, a later protocol version splits the proof into its own event.

## 12. Versioning
- This is protocol version 1, carried in the `proto` tag. The rules module id and version are pinned in the root.
- A game is always replayed with the engine version it started on.
- Incompatible protocol changes bump `proto`.
