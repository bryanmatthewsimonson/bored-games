# Phase 2b: `packages/deck` implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pure TypeScript package with the mental-poker cryptography of PROTOCOL.md §2, §3 and §5:
- strict encodings
- card points
- ElGamal with a joint key
- the key proof of knowledge
- DLEQ decryption shares
- the Terelius–Wikström shuffle and its proof
- the wire codecs.

It ships with tamper tests, test vectors and a measured cost profile.

**Architecture:** small focused modules over `@noble/curves` v2 (secp256k1 `Point`, `secp256k1_hasher` per RFC 9380, Pippenger multi-scalar multiplication).
- Randomness is injected (`RandomBytes`), so every function is deterministic under test, and the package stays pure: no `crypto`, `Math.random` or I/O in `src`.
- Points are noble `Point` objects in memory and base64url only on the wire.

**Tech stack:** TypeScript 7 (strict, `.ts` imports, no enums), Vitest and fast-check, `@noble/curves@2.4.0` and `@noble/hashes@2.4.0` pinned exactly.

**Spec:** `docs/PROTOCOL.md` (approved 2026-10-01), §2 notation, §3 keys and proof of knowledge, §5 deck cryptography. Decisions D018–D022.

**On saving:** once this plan is approved, the first action is to copy it verbatim to `docs/superpowers/plans/2026-10-01-phase-2b-deck.md` and commit it.

**Execution method (owner's choice):** subagent-driven, using superpowers:subagent-driven-development. A fresh implementer and a fresh reviewer handle each task, and a whole-branch review follows Task 9.

## Global constraints
- **Group:** secp256k1, base point `G`, order `q = Point.Fn.ORDER`.
- **`H2C(label)`:** `secp256k1_hasher.hashToCurve(utf8(label), { DST: 'bored-games/v1' })`.
- **`HS(parts…)`:** `SHA-256` over, for each part, a 4-byte big-endian length followed by the bytes, then interpreted big-endian mod `q`. Part encodings:
  - point: 33-byte compressed
  - scalar: 32-byte big-endian
  - string: UTF-8
  - number: its decimal string, UTF-8
- **Base64url** without padding. A point is 44 characters, a scalar 43. Reject:
  - non-canonical text
  - the identity point
  - points not on the curve
  - scalars ≥ `q`
- **Labels:**
  - card point: `card:<deckId>:<m>`
  - generators: `gen:h` and `gen:<i>`, for i = 1..N
  - hash domains: `"pok"`, `"dleq"`, `"shuffle-ctx"`, `"shuffle-u"`, `"shuffle-c"`
- **Ciphertexts and shares:**
  - a ciphertext is `(a, b) = (r·G, M + r·X)`
  - the initial deck is `(O, M_i)`, computed locally and never transmitted
  - a share is `D = x·a`
- **Purity:** `packages/deck/src` must pass the repo purity guard (add it to the scanned pure packages). Typecheck with `types: []`.
- **Dependencies:** exactly two new runtime deps, justified in DECISIONS (D023).
- **Conventions:** follow CLAUDE.md. Run `pnpm check` before each commit, and end every commit with the session's co-author and session lines.

## Review focus (inputs no task would otherwise exercise; each gets a test in its owning task)
1. **Hostile wire values.** Identity points, off-curve points, scalars ≥ q and padded or non-canonical base64url must all be rejected by the decoders (Task 1 and Task 8).
2. **A share or proof for the right numbers in the wrong context** (another root, position or deck) must fail verification (Tasks 4, 5 and 7).
3. **A shuffle that is a valid permutation but with one card replaced** by a fresh encryption of a different card must be rejected (Task 7).
4. **Degenerate deck sizes.** N = 1 must prove and verify; N = 0 and mismatched input and output lengths must be rejected (Task 7).
5. **A full multi-seat game flow** (3 and 6 seats) must decrypt every position to a permutation of all cards, both with private shares and after the audit's secret reveal (Task 9).

---

## File structure (`packages/deck/`)

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json` (src: `types: []`), `tsconfig.test.json` | Package `@bored-games/deck`, exports `./src/index.ts` |
| `src/random.ts` | The `RandomBytes` type and `randomScalar(rnd)` |
| `src/encoding.ts` | Base64url, point and scalar codecs, `HS` |
| `src/group.ts` | `G`, `q`, `H2C`, generators `h` and `h_i` (cached), `msm` |
| `src/cards.ts` | Card points, card lookup table |
| `src/elgamal.ts` | Ciphertexts, joint key, initial deck, re-encryption |
| `src/pok.ts` | Schnorr proof of knowledge of the deck key |
| `src/dleq.ts` | Decryption shares with Chaum–Pedersen proofs; combining shares into a card |
| `src/shuffle.ts` | Permute plus re-encrypt, and the Terelius–Wikström prove and verify |
| `src/wire.ts` | Strict JSON codecs for decks, proofs, shares and the proof of knowledge (PROTOCOL §4) |
| `src/index.ts` | Public exports |
| `test/util.ts` | `seededRandom(seed): RandomBytes`, built on game-kit `createRng` |
| `test/*.test.ts`, `test/vectors/v1.json`, `scripts/vectors.ts`, `scripts/bench.ts` | Tests, vectors, benchmark |

Also modified: `vitest.config.ts` (a `deck` project), `tests/repo-guards.test.ts` (add the deck src to the pure list), `docs/DECISIONS.md`, `docs/PLAN.md`, `CLAUDE.md` (repo map).

---

### Task 1: Package scaffold, randomness and encoding

**Files:**
- Create the package files above, plus `src/random.ts`, `src/encoding.ts`, `test/encoding.test.ts` and `test/util.ts`.
- Modify `vitest.config.ts`, `tests/repo-guards.test.ts` and `docs/DECISIONS.md` (D023: `@noble/curves` and `@noble/hashes` are audited, zero-dependency and the basis of nostr-tools).

**Interfaces produced:**
- `type RandomBytes = (n: number) => Uint8Array`
- `randomScalar(rnd: RandomBytes): bigint`: 48 random bytes reduced mod `q`, rejecting 0
- `type Part = Uint8Array | string | number | bigint | Point`
- `hs(...parts: Part[]): bigint`
- `b64u.encode(bytes: Uint8Array): string` and `b64u.decode(s: string): Uint8Array`, which throws on non-canonical input
- `encodePoint(P): string` and `decodePoint(s): Point`, which throws on the identity or off-curve points
- `encodeScalar(k): string` and `decodeScalar(s): bigint`, which throws on `≥ q`
- `seededRandom(seed: string): RandomBytes` (test utility)

- [ ] **Step 1: Write the failing tests** (`test/encoding.test.ts`):
  - `b64u` round-trips random bytes (fast-check)
  - `decode` rejects `'='` padding, `+` and `/`, and a final character with non-zero spare bits
  - `decodePoint(encodePoint(G·k))` equals `G·k`
  - `decodePoint` rejects the 33-byte zero string, a 33-byte value with prefix `0x05`, and an x coordinate off the curve
  - `decodeScalar` rejects `q` and `q+1`, and accepts `q−1`
  - `hs('a', 'b') !== hs('ab')` (length prefix)
  - `hs` is deterministic and always `< q`
  - `randomScalar(seededRandom('x'))` is reproducible and never 0
- [ ] **Step 2:** run `pnpm vitest run --project deck`. Expected: FAIL (module missing).
- [ ] **Step 3:** implement as specified. `hs` uses `sha256` from `@noble/hashes/sha2.js` over `u32be(len) ‖ bytes` for each part.
- [ ] **Step 4:** run `pnpm vitest run --project deck` and `pnpm check`. Expected: PASS; the purity guard covers `packages/deck/src`.
- [ ] **Step 5:** commit: "Add deck package: encodings, hash-to-scalar, injected randomness".

### Task 2: Group helpers and card points

**Files:** `src/group.ts`, `src/cards.ts`, `test/cards.test.ts`.

**Interfaces:**
- **Consumes:** Task 1.
- **Produces:**
  - `G: Point`, `q: bigint`
  - `h2c(label: string): Point`
  - `generators(n: number): { h: Point; hs: Point[] }`, cached and extended lazily
  - `msm(points: Point[], scalars: bigint[]): Point`, via noble `pippenger`; scalars may be 0
  - `cardPoint(deckId: string, m: number): Point`
  - `cardTable(deckId: string, size: number): Map<string, number>`, keyed by `encodePoint`
  - `cardOf(table, P): number | null`

- [ ] **Step 1: Failing tests.**
  - `cardPoint('tiles', 0)` is stable across calls and equals `h2c('card:tiles:0')`.
  - All 108 `tiles` card points are distinct and none is the identity.
  - `cardOf(cardTable('tiles', 108), cardPoint('tiles', 37)) === 37`.
  - A point not in the table gives `null`.
  - `generators(5).hs` are distinct from each other, from `h` and from `G`.
  - `msm([P, Q], [2n, 0n])` equals `P·2`.
  - Pinned vector: `encodePoint(h2c('gen:h'))`. Record the value at first green and keep it in the test, to catch any accidental change of label or DST.
- [ ] **Step 2:** run and see it fail.
- [ ] **Step 3:** implement. Use `multiplyUnsafe` only where every scalar is public (verification and `msm`), and `multiply` for secret scalars.
- [ ] **Step 4:** run and see it pass. Run `pnpm check`.
- [ ] **Step 5:** commit: "Add deck group helpers and card points".

### Task 3: ElGamal, joint key and initial deck

**Files:** `src/elgamal.ts`, `test/elgamal.test.ts`.

**Interfaces:**
- **Consumes:** Tasks 1 and 2.
- **Produces:**
  - `interface Ciphertext { a: Point; b: Point }`
  - `jointKey(keys: Point[]): Point`
  - `initialDeck(deckId: string, size: number): Ciphertext[]`, where `a` is `Point.ZERO`
  - `reEncrypt(c: Ciphertext, X: Point, r: bigint): Ciphertext`, computing `(a + r·G, b + r·X)`
  - `decryptWithSecrets(c: Ciphertext, secrets: bigint[]): Point`, computing `b − (Σx)·a` (used by tests and the audit)

- [ ] **Step 1: Failing tests.**
  - With three secrets: re-encrypting `initialDeck('tiles', 108)[i]` twice with random `r` and decrypting with all three secrets gives `cardPoint('tiles', i)`.
  - Decrypting with two of the three secrets does not give it.
  - `jointKey` of one key is that key.
- [ ] **Step 2:** run and see it fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run and see it pass.
- [ ] **Step 5:** commit: "Add ElGamal primitives".

### Task 4: Proof of knowledge of the deck key (PROTOCOL §3)

**Files:** `src/pok.ts`, `test/pok.test.ts`.

**Interfaces:**
- `provePok(x: bigint, ctx: Part[], rnd: RandomBytes): { c: bigint; s: bigint }`
- `verifyPok(X: Point, proof, ctx: Part[]): boolean`

Callers pass `ctx = [tableAddress, npub, sessionPub]`.

**Math:**
- **Prove:** `T = w·G`, `c = hs('pok', ...ctx, X, T)`, `s = w + c·x mod q`.
- **Verify:** `T' = s·G − c·X`, then check `c == hs('pok', ...ctx, X, T')`.

- [ ] **Step 1: Failing tests.**
  - A valid proof verifies.
  - Verification fails with a different `X`, a different context (each of the 3 parts changed in turn), `c + 1`, or `s + 1`.
  - Verification fails for `X = Point.BASE` with a proof made for another key.
- [ ] **Step 2:** run and see it fail. **Step 3:** implement. **Step 4:** run and see it pass.
- [ ] **Step 5:** commit: "Add deck-key proof of knowledge".

### Task 5: Decryption shares (DLEQ) and combining (PROTOCOL §5.4)

**Files:** `src/dleq.ts`, `test/dleq.test.ts`.

**Interfaces:**
- `interface Share { D: Point; c: bigint; s: bigint }`
- `makeShare(x: bigint, ct: Ciphertext, ctx: ShareCtx, rnd): Share`, with `type ShareCtx = { rootId: string; deckId: string; pos: number }`
- `verifyShare(X: Point, ct: Ciphertext, share: Share, ctx: ShareCtx): boolean`
- `combine(ct: Ciphertext, Ds: Point[]): Point`, computing `b − ΣD`

**Math:**
- **Make:** `T1 = w·G`, `T2 = w·a`, `c = hs('dleq', rootId, deckId, pos, X, a, D, T1, T2)`, `s = w + c·x`.
- **Verify:** `T1 = s·G − c·X`, `T2 = s·a − c·D`; recompute `c` and compare.

- [ ] **Step 1: Failing tests.**
  - For 3 seats, shares from all seats on a twice-re-encrypted card combine to its card point, and `cardOf` gives the index.
  - Each share verifies.
  - Tampered `D` (`+G`), `c`, `s`, a wrong `X`, wrong `pos`, wrong `rootId` and wrong `deckId` each fail verification.
  - A share made with seat 1's secret but checked against seat 0's `X` fails.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit: "Add DLEQ decryption shares".

### Task 6: Shuffle with commitments (prover-side building blocks)

**Files:** `src/shuffle.ts` (part 1), `test/shuffle.test.ts`.

**Notation:**
- The output index is `i`; `ψ(i)` is the input index.
- `e'_i = reEncrypt(e_ψ(i), X, r'_i)`.
- `u'_i = u_ψ(i)`.

**Interfaces:**
- `shuffleDeck(deck: Ciphertext[], X: Point, rnd): { out: Ciphertext[]; psi: number[]; rPrime: bigint[] }`, with `psi` a uniform Fisher–Yates permutation from `rnd`.
- Internal (exported for tests via `src/shuffle.ts`, not from `index.ts`):
  - `permutationCommitment(psi, hs, rnd): { c: Point[]; r: bigint[] }`, with `c[ψ(i)] = r[ψ(i)]·G + hs[i]`
  - `commitmentChain(h, uPrime, rnd): { cHat: Point[]; rHat: bigint[] }`, with `ĉ_0 = h` and `ĉ_i = r̂_i·G + u'_i·ĉ_{i−1}` for i = 1..N

- [ ] **Step 1: Failing tests.**
  - `shuffleDeck` output decrypts (all secrets) to a permutation of the input's cards, matching `psi`.
  - `Σ c_k − Σ h_i == (Σ r_k)·G`.
  - `ĉ_N − (Π u'_i)·h == (Σ r̂_i·v_i)·G`, where `v_i = Π_{j>i} u'_j` and `v_N = 1`.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit: "Add deck shuffle and commitment helpers".

### Task 7: Terelius–Wikström shuffle proof (PROTOCOL §5.3)

**Files:** `src/shuffle.ts` (part 2), `test/shuffle-proof.test.ts`.

**Interfaces:**
- `type ShuffleCtx = { rootId: string; seat: number; deckId: string }`
- `interface ShuffleProof { c: Point[]; cHat: Point[]; t: { t1, t2, t3: Point; t4: [Point, Point]; tHat: Point[] }; s: { s1, s2, s3, s4: bigint; sHat: bigint[]; sPrime: bigint[] } }`
- `proveShuffle(input, output, X, psi, rPrime, ctx, rnd): ShuffleProof`
- `verifyShuffle(input, output, X, proof, ctx): boolean`. It returns false, never throws, on any length mismatch, `N = 0`, or an identity point.

**Algorithm.** CHVote GenShuffleProof and CheckShuffleProof, in additive notation. All sums are point sums; arithmetic is mod `q`.

**Common setup (prover and verifier):**
1. `d = hs('shuffle-ctx', rootId, seat, deckId, X, ...input(a, b pairs), ...output(a, b pairs))`.
2. `{h, hs} = generators(N)`.
3. Challenges: `u_i = hs('shuffle-u', d, ...c, i)` for i = 1..N.

**Prover:**
1. `(c, r) = permutationCommitment`.
2. Compute `u`, then `u'_i = u_ψ(i)`.
3. `(ĉ, r̂) = commitmentChain(h, u')`.
4. Pick random `ω1..ω4`, `ω̂_i` and `ω'_i`.
5. Compute the commitments:
   - `t1 = ω1·G`
   - `t2 = ω2·G`
   - `t3 = ω3·G + Σ ω'_i·h_i`
   - `t4 = (Σ ω'_i·a'_i − ω4·G, Σ ω'_i·b'_i − ω4·X)`
   - `t̂_i = ω̂_i·G + ω'_i·ĉ_{i−1}`
6. Challenge: `ch = hs('shuffle-c', d, X, ...c, ...ĉ, t1, t2, t3, t4[0], t4[1], ...t̂)`.
7. Responses:
   - `s1 = ω1 + ch·Σr_k`
   - `s2 = ω2 + ch·Σ r̂_i·v_i`
   - `s3 = ω3 + ch·Σ u_k·r_k`
   - `s4 = ω4 + ch·Σ u'_i·r'_i`
   - `ŝ_i = ω̂_i + ch·r̂_i`
   - `s'_i = ω'_i + ch·u'_i`

**Verifier:**
1. Recompute `u` and `ch` (from the proof's `t`).
2. Compute:
   - `c̄ = Σc_k − Σh_i`
   - `ĉ* = ĉ_N − (Π u_k)·h`
   - `c̃ = Σ u_k·c_k`
   - `ã = Σ u_k·a_k`, `b̃ = Σ u_k·b_k` over the input deck
3. Check all of:
   - `t1 == s1·G − ch·c̄`
   - `t2 == s2·G − ch·ĉ*`
   - `t3 == s3·G + Σ s'_i·h_i − ch·c̃`
   - `t4[0] == Σ s'_i·a'_i − s4·G − ch·ã`
   - `t4[1] == Σ s'_i·b'_i − s4·X − ch·b̃`
   - `t̂_i == ŝ_i·G + s'_i·ĉ_{i−1} − ch·ĉ_i` for every i

   Use `msm` for each sum.

For the initial deck (`a = O`), `ã` is the identity, and that's fine: the identity is only rejected on decode, never in memory.

- [ ] **Step 0: Cross-check against the source.** Try to fetch the CHVote specification (`eprint.iacr.org/2017/325`, or the CHVote repository on gitlab.com).
  - If reachable: compare each equation above with GenShuffleProof / CheckShuffleProof and record the result in DECISIONS D019.
  - If blocked (the environment's network policy currently blocks `eprint.iacr.org`): record in D019 that the equations were derived and algebraically checked, then continue. The completeness and soundness tests below don't depend on the source.
- [ ] **Step 1: Failing tests.**
  - **Completeness:** an honest proof verifies for N ∈ {1, 2, 3, 8, 108}, including from `initialDeck`.
  - **Soundness:** `verifyShuffle` returns false after each of these tampers:
    1. one output ciphertext replaced by a fresh encryption of a different card (Review Focus 3)
    2. two outputs swapped after proving
    3. a duplicated card (output j := output k)
    4. the proof verified under another `rootId`, another `seat`, or another `deckId`
    5. a wrong `X`
    6. each scalar field in `s` changed by +1, and each point in `t`, `c` and `cHat` changed by `+G` (iterate over every field and index)
    7. arrays truncated or extended by one
    8. `N = 0`
    9. input and output of different lengths
- [ ] **Step 2:** run and confirm the failures are for the right reason.
- [ ] **Step 3:** implement per the algorithm above.
- [ ] **Step 4:** run and see all pass (the 108-card cases are within the default timeout). Run `pnpm check`.
- [ ] **Step 5:** commit: "Add Terelius–Wikström shuffle proof with tamper tests".

### Task 8: Wire codecs (PROTOCOL §4.4 and §5.3)

**Files:** `src/wire.ts`, `test/wire.test.ts`, `src/index.ts`.

**Interfaces:**
- `encodeDeck(Ciphertext[]): [string, string][]` and `decodeDeck(unknown): Ciphertext[]`
- `encodeShuffleProof(ShuffleProof): object` and `decodeShuffleProof(unknown, n): ShuffleProof`
- `encodeShare({pos, share}): {d, pos, proof:{c, s}}` and `decodeShare(unknown)`
- `encodePok` and `decodePok`

Decoders throw a `DeckWireError` with a message on any shape, key-set, length or encoding error. Field names match PROTOCOL §5.3 exactly (`c`, `cHat`, `t.t1`…`t.tHat`, `s.s1`…`s.sPrime`).

- [ ] **Step 1: Failing tests.**
  - Round trips for each type.
  - Rejects extra keys, missing keys, wrong array lengths and each Review Focus 1 value.
  - `canonicalJson(encodeShuffleProof(p))` plus `canonicalJson(encodeDeck(out))` for N = 108 is under 40,000 bytes.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit: "Add deck wire codecs".

### Task 9: End-to-end deck flow, test vectors and cost profile

**Files:** `test/flow.test.ts`, `scripts/vectors.ts`, `test/vectors/v1.json`, `test/vectors.test.ts`, `scripts/bench.ts`. Modify `packages/deck/package.json` scripts (`vectors`, `bench`).

**Flow test** (3 and 6 seats; Review Focus 5):
1. Each seat makes keys and a proof of knowledge, and every proof of knowledge verifies.
2. `X = jointKey`.
3. Seats shuffle in order. Each step is proved, encoded, decoded and verified.
4. Positions are assigned as in Chain Reaction (setup tiles, then 6 per seat).
5. Every seat shares every position not its own. Each owner combines all shares, including its own `D`, into its private cards.
6. Public setup positions are combined with all shares.
7. After a "secret reveal", `decryptWithSecrets` over the whole deck gives a permutation of 0..107 that agrees with every privately and publicly learned card.

**Vectors:**
- `scripts/vectors.ts` (run with `pnpm --filter @bored-games/deck vectors`) writes `v1.json` from `seededRandom('bored-games/deck/v1')` for 3 seats with an 8-card deck. It includes keys, proofs of knowledge, the shuffle outputs and proofs, and shares, all wire-encoded.
- `test/vectors.test.ts` asserts that:
  - regenerating the vectors gives byte-identical JSON
  - every proof in the file verifies.

**Bench:** `scripts/bench.ts` prints prove and verify times and the encoded size for N = 108. Record the results in PLAN.md. There is no hard performance gate; the PROTOCOL and DECISIONS risk notes get updated with the numbers.

- [ ] **Step 1:** write `flow.test.ts` and `vectors.test.ts`. Run them: the flow test passes as soon as Tasks 1–8 are correct; the vectors test fails because `v1.json` is missing.
- [ ] **Step 2:** write `scripts/vectors.ts`, generate `v1.json`, and re-run. Expected: PASS.
- [ ] **Step 3:** write and run `scripts/bench.ts`; note the numbers.
- [ ] **Step 4:** docs:
  - PROTOCOL §5.3: the vectors are at `packages/deck/test/vectors/v1.json`, with the measured size.
  - PLAN.md: 2b status and results.
  - CLAUDE.md: add the deck package to the repo map.
- [ ] **Step 5:** run `pnpm check`. Expected: all green. Commit "Add deck flow test, test vectors and benchmark", then push.

---

## Out of scope for 2b (planned with 2c / 2d)
- The engine change D022 (deal at setup, in seat order) and the CHAIN_REACTION_VERSION bump.
- `GameModule.standings`.
- NOSTR events and the client.

## Verification for the whole of 2b
- `pnpm check` is green.
- `pnpm vitest run --project deck` passes all of: encoding, cards, ElGamal, proof of knowledge, DLEQ, shuffle, shuffle-proof tamper suite, wire, flow and vectors.
- Bench output is recorded in PLAN.md.
- The purity guard covers `packages/deck/src`.
