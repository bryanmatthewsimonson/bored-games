# Phase 2c: protocol events and engine readiness, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pure `packages/protocol` that builds, signs, verifies and strictly parses every NOSTR event of PROTOCOL v1, and a game contract and Chain Reaction engine that meet PROTOCOL §10: hands dealt at setup in seat order, `standings`, and position and reveal hooks.

**Architecture:**
- `packages/protocol` is pure. Clocks and randomness are injected; `created_at` is a parameter.
- NIP-01 event ids and BIP-340 signatures use `@noble/curves` `schnorr` directly. There is no nostr-tools dependency, which avoids the duplicate-noble problem (D023 M5).
- Each event kind gets a template builder (`…Template`) and a strict parser (`parse…`). Parsers throw `ProtocolError`.
- Semantic validation that needs game state (owed shares, who may move, audit) is **not** in this phase. It belongs to the 2d session engine.
- The game kit gains three contract members that the session engine needs generically: `standings`, `dealt` and `revealsOf`.

**Tech stack:** TypeScript 7, Vitest, fast-check, `@noble/curves@2.4.0` and `@noble/hashes@2.4.0` (already pinned), `@bored-games/deck`, `@bored-games/game-kit`.

**Spec:** `docs/PROTOCOL.md` §3, §4, §6.1, §8.2, §10 and §11; decisions D018–D025.

**Execution:** subagent-driven, the owner's standing choice (2b). The owner is away overnight and asked for the work to continue through the phases, so this plan runs without waiting for a review.

## Global constraints
- **Purity.** `packages/protocol/src` passes the repo purity guard: no `Date`, `Math.random`, timers, I/O, `node:` imports or `Intl`. Add it to the guard's list. Its tsconfig sets `types: []`.
- **Kinds:**
  - Table 37450, Join 7451, Game root 7450, Move 7452, Shares 7453, Timeout claim 7454, Secret reveal 7455, Result attestation 7456
  - every game event carries `["proto","1"]`
- **Deadlines:** 86400, 259200 (the default) and 604800 seconds.
- **Size cap:** `MAX_EVENT_BYTES = 262144`, the UTF-8 length of the serialized event JSON. Parsers reject anything larger.
- **Content is canonical JSON.** `content === canonicalJson(JSON.parse(content))`, using game-kit's `canonicalJson`. Anything else is rejected.
- **Hex forms (D025):**
  - ids and pubkeys are 64 lowercase hex characters
  - signatures are 128 lowercase hex characters
  - the table address is `37450:<creator hex>:<d>`
- **NIP-01:**
  - `id = sha256(utf8(JSON.stringify([0, pubkey, created_at, kind, tags, content])))`
  - `sig = schnorr.sign(id, sk, auxRand)`, with `auxRand` from an injected `RandomBytes` (32 bytes)
  - `created_at` is a non-negative safe integer
  - tags are arrays of strings
- **Errors:**
  - Parsers throw `ProtocolError` (a subclass of `Error` with `name = 'ProtocolError'` and `code: string`). They never throw anything else on any input.
  - `verifyEvent` returns a boolean and never throws.
- **New package dependencies** are workspace packages plus the already pinned noble packages; there is no new third-party dependency. Record D026: noble `schnorr` is used instead of nostr-tools.
- **Engine version:** `CHAIN_REACTION_VERSION` becomes `0.3.0` (D022 changes dealing).
- **Conventions:** follow CLAUDE.md. Run `pnpm check` before each commit, and end every commit with the session's co-author and session lines.

## Review focus
1. **Hostile event shapes** must all be rejected with `ProtocolError`, never a crash: a wrong kind, a missing or duplicated required tag, a missing `proto` tag, non-canonical content, an oversized event, non-string tag items, and an `id` or `sig` of the wrong length. (Tasks 3–5.)
2. **Forged events.** A valid signature over altered content or tags, a recomputed id with a stale signature, and the wrong pubkey must all fail `verifyEvent`. (Task 3.)
3. **Inconsistent roots** must fail `validateRoot`:
   - a seat pointing to a Join of another table
   - a duplicate npub, session or deck key
   - a bad PoK
   - a rules-hash mismatch
   - a version mismatch
   - a seat count that differs from the table
   - a Join whose pubkey is neither invited nor taking an open seat
   (Task 4.)
4. **Share lists** with unsorted or duplicate positions, and moves whose `seq`, `prev` or root tags are malformed, must be rejected by the parser. (Task 5.)
5. **The D022 engine change** must not regress the game: the fuzzer stays at 0 failures with every game ending by declaration, and the new contract hooks agree with full-mode state on every fuzzed step. (Tasks 1 and 2.)

---

## File structure

| Path | Responsibility |
|---|---|
| `packages/game-kit/src/types.ts` | `standings`, `dealt` and `revealsOf` on `GameModule`; the `DealtPosition` type |
| `packages/game-kit/src/fuzz.ts` | Generic checks of the new hooks |
| `packages/game-kit/test/toy.ts` | The toy module implements the hooks |
| `packages/games/chain-reaction/src/engine.ts`, `module.ts`, `types.ts` | The D022 deal, the dealt-position record, `standings`, `revealsOf` |
| `docs/games/chain-reaction/RULES.md` (C03), its catalog test | Dealing at setup in seat order |
| `packages/protocol/` | New package `@bored-games/protocol` |
| `src/nostr.ts` | Hex helpers, `NostrEvent`, `EventTemplate`, `eventId`, `finalizeEvent`, `verifyEvent`, `getPublicKey`, size check |
| `src/kinds.ts` | Kind constants, `PROTO`, `DEADLINES`, `MAX_EVENT_BYTES` |
| `src/errors.ts` | `ProtocolError` |
| `src/tags.ts` | Strict tag helpers: `one(tags, name)`, `many(tags, name)`, `requireProto` |
| `src/lobby.ts` | Table, Join and Game root: templates, parsers, `validateRoot`, `rulesHash`, `makeJoinPok` |
| `src/game.ts` | Move (shuffle and action), Shares, Timeout claim, Secret reveal and Result attestation: templates, parsers, `logHash` |
| `src/index.ts` | Public exports |

---

### Task 1: Hands dealt at setup in seat order (D022)

**Files:**
- Chain Reaction: `src/engine.ts` (setup and the deal), `src/module.ts` (version `0.3.0`)
- `docs/games/chain-reaction/RULES.md` C03, and the C03 catalog test
- Any catalog or unit tests and `tools/fuzz` fixtures that assumed the old deal
- `docs/DECISIONS.md` D022 (mark it shipped)

**Behavior:**
- At setup, in both full and view mode, seat k's hand is assigned positions `S + 6k … S + 6k + 5`, where S is the seat count. The setup tiles stay at positions `0..S−1` and are revealed through `pending()` as before. The first player is determined as before.
- Emit `tilesDealt` events at setup in seat order.
- In full mode, hands hold their tiles from setup. In view mode, the viewer's slots are `null` until `learn`.

- [ ] **Step 1:** rewrite C03 in RULES.md:
  - Title: "Hands are dealt at setup in seat order".
  - Setup: three seats.
  - Expected: seat 0 has positions 3–8, seat 1 positions 9–14, seat 2 positions 15–20, assigned before the setup tiles 0–2 are revealed. The first player is still decided by the setup tiles. Each hand is hidden from the other players.

  Update the C03 test to assert exactly that, including that the positions are assigned right after `setup` and before any reveal. Run it: FAIL.
- [ ] **Step 2:** implement. Fix every test that encoded the old order, changing expected values only where the deal order is the sole cause; never weaken an assertion.
- [ ] **Step 3:** run `pnpm check`, then `pnpm fuzz --games 2000 --seed d022`. Expected: 0 failures, and every game ends by declaration.
- [ ] **Step 4:** commit "Deal Chain Reaction hands at setup in seat order (D022)".

### Task 2: Contract hooks for the protocol: `standings`, `dealt`, `revealsOf`

**Files:**
- game-kit: `src/types.ts`, `src/fuzz.ts`, `test/toy.ts`, `test/kit.test.ts`
- chain-reaction: `src/module.ts` and new tests in `test/unit.test.ts`
- `docs/ARCHITECTURE.md`, the contract table

**Interfaces produced (on `GameModule<S, E, R>`):**
- `standings(state: S): readonly number[]`: per-seat scores as if the game ended now, computed from public data only, so it gives the same result on any seat's view. For Chain Reaction this is final scoring applied to a copy of the state, the same arithmetic as `finalScore`. Refactor so the two share one function.
- `dealt(state: S): readonly DealtPosition[]`, where `interface DealtPosition { readonly deck: string; readonly pos: number; readonly to: Seat | null }`. It lists every position assigned so far, in assignment order. `to` is the owning seat, or `null` for a public position (a requested or completed reveal). Once a position appears it stays, even after its card is played. It is identical in full mode and every view of the same log.
- `revealsOf(state: S, action: unknown): readonly Learn[]`: the hidden cards that `action` would make public from its actor's hand, as `{deck, pos, card}` claims. It returns `[]` for actions that reveal nothing, and for unparseable input.
  - Chain Reaction: `place` reveals `{tiles, pos, tile}`; `endTurn` reveals one entry per discard.

**Fuzzer checks added to `fuzzGame`** (the generic kit), every step:
- `dealt(full)` deep-equals `dealt(view(full, s))` for every seat s.
- Every `knownTo(full, s)` learn's position is dealt to s.
- Every position in a pending reveal is dealt `null`.
- For the action about to be applied, every `revealsOf` claim matches the deck order and is dealt to the actor.
- `standings(full)` deep-equals `standings(view(full, s))` and has length = seats.
- When `outcome` is non-null, `standings` equals `outcome.scores`.

**Planted-bug test:** add a toy bug mode in which `revealsOf` claims a wrong card, and assert that the fuzzer catches it.

- [ ] **Step 1:** write the failing tests:
  - kit: the toy implements the hooks, and the new bug mode is caught
  - Chain Reaction unit tests:
    - `dealt` right after setup lists positions 3–20 as the hands and 0–2 as `null` (3 seats)
    - after the first `endTurn` the drawn position is appended to the actor
    - `revealsOf(place)` gives `[{deck:'tiles', pos, card: tile}]`
    - `revealsOf({type:'nonsense'})` gives `[]`
    - `standings` on a fresh game gives the starting cash for every seat
    - `standings` at `over` equals `outcome.scores`

  Run: FAIL.
- [ ] **Step 2:** implement. The Chain Reaction state records assignments as plain JSON, for example `deck.dealt: {pos, to}[]` with `to: -1` for public.
- [ ] **Step 3:** run `pnpm check` and `pnpm fuzz --games 2000 --seed hooks`. Expected: 0 failures.
- [ ] **Step 4:** commit "Add standings, dealt and revealsOf to the game contract".

### Task 3: Protocol package, NIP-01 events

**Files:**
- Create `packages/protocol/{package.json,tsconfig.json,tsconfig.test.json}`, `src/{nostr.ts,kinds.ts,errors.ts,index.ts}` and `test/nostr.test.ts`.
- Modify `vitest.config.ts` (project `protocol`), `tests/repo-guards.test.ts` (purity list) and `docs/DECISIONS.md` (D026).

**Interfaces produced:**
- `type Hex = string`
- `interface EventTemplate { kind: number; created_at: number; tags: string[][]; content: string }`
- `interface NostrEvent extends EventTemplate { id: Hex; pubkey: Hex; sig: Hex }`
- `getPublicKey(sk: Uint8Array): Hex`
- `eventId(pubkey: Hex, t: EventTemplate): Hex`
- `finalizeEvent(t: EventTemplate, sk: Uint8Array, rnd: RandomBytes): NostrEvent`
- `verifyEvent(ev: unknown): ev is NostrEvent`. It checks the shape (exact key set, types, hex forms, tags as arrays of strings, a safe-integer `created_at`), recomputes the id and checks the schnorr signature. It never throws.
- `eventBytes(ev: NostrEvent): number`, the UTF-8 length of `JSON.stringify(ev)`
- `isHex64(s: unknown): s is Hex`
- `KIND = { table: 37450, join: 7451, root: 7450, move: 7452, shares: 7453, timeout: 7454, reveal: 7455, attest: 7456 } as const`
- `PROTO = '1'`
- `DEADLINES = [86400, 259200, 604800] as const`
- `DEFAULT_DEADLINE = 259200`
- `MAX_EVENT_BYTES = 262144`
- `class ProtocolError extends Error { code: string }`

- [ ] **Step 1: Failing tests.**
  - The NIP-01 id of a known event matches a pinned vector. Use the BIP-340 secret key `0x…03` from the BIP-340 test vectors, with fixed content. Compute the id with an independent `node:crypto` sha256 over `JSON.stringify([0,…])` in the test.
  - `verifyEvent(finalizeEvent(…))` is true.
  - `verifyEvent` is false, without throwing, for each of:
    - content altered
    - a tag altered
    - `created_at` altered
    - the id recomputed but the sig stale
    - the pubkey swapped for another valid key
    - an uppercase hex id
    - a 63-character pubkey
    - a non-string tag item
    - an extra key
    - `null`
    - a number
  - `getPublicKey` matches the BIP-340 vector's public key.
- [ ] **Step 2–4:** red, implement, green. Run `pnpm check`.
- [ ] **Carried from the 2b review:** in `packages/deck/src/dleq.ts`, `decryptPosition` returns `null` (does not throw TypeError) for a non-object `ct`, and treats a Map value of `undefined` like `null`. Add a test for each.
- [ ] **Step 5:** commit "Add protocol package: NIP-01 event ids and signatures".

### Task 4: Lobby events: Table, Join and Game root

**Files:** `packages/protocol/src/{tags.ts,lobby.ts}` and `test/lobby.test.ts`.

**Interfaces.** Consumes Task 3 plus deck's `provePok`/`verifyPok`, `encodePok`/`decodePok`, `encodePoint`/`decodePoint` and `Point`. Produces:
- `interface TableSpec { tableId: string; game: string; version: string; seats: number; deadline: number; invited: Hex[]; open: number; relays: string[]; status: 'open' | 'started' | 'cancelled'; rules: unknown }`
- `tableTemplate(spec: TableSpec, createdAt: number): EventTemplate`
- `parseTable(ev: NostrEvent): TableSpec & { creator: Hex; address: string }`. It checks that `invited.length + open === seats − 1`, the deadline is in `DEADLINES`, `seats ≥ 2`, `status` is valid and relays are `wss://` or `ws://` URLs.
- `tableAddress(creator: Hex, tableId: string): string`
- `interface JoinSpec { tableAddress: string; creator: Hex; deckKey: Point; pok: {c: bigint; s: bigint}; relays: string[]; session: Hex }`
- `makeJoinPok(x: bigint, tableAddress: string, npub: Hex, session: Hex, rnd: RandomBytes)`, which wraps `provePok` with ctx `[tableAddress, npub, session]` (PROTOCOL §3)
- `joinTemplate(spec: JoinSpec, createdAt: number): EventTemplate`
- `parseJoin(ev): JoinSpec & { id: Hex; npub: Hex }`, with `npub = ev.pubkey`
- `verifyJoin(join): boolean`, the PoK check
- `rulesHash(rules: unknown): Hex`, the hex SHA-256 of the UTF-8 of `canonicalJson(rules)`
- `interface RootSpec { table: ReturnType<typeof parseTable>; joins: ParsedJoin[] /* seat order */; rules: unknown; relays: string[] }`
- `rootTemplate(spec, createdAt): EventTemplate`. Tags follow PROTOCOL §4.3. The content is `{rules, seats:[{deckKey, npub, session}]}`.
- `parseRoot(ev): { id; creator; tableAddress; game; version; deadline; rulesHash; joinIds: Hex[]; relays; rules; seats: {deckKey: Point; npub: Hex; session: Hex}[] }`
- `validateRoot(root, table, joinsById: ReadonlyMap<Hex, ParsedJoin>, modules: ReadonlyMap<string, GameModule<any, any, any>>): string[]`. It returns a list of problems; empty means valid. Checks:
  - the creator is the table's creator and the table address matches
  - `game`, `version` and `deadline` match the table
  - `seats.length === table.seats`
  - each `joinIds[i]` is a known Join for this table whose fields equal `seats[i]`
  - each Join's PoK verifies
  - npubs, sessions and deck keys are each unique
  - the creator holds a seat
  - every seated npub other than the creator is either invited or fills one of the `open` seats (the count of non-invited joiners ≤ `open`)
  - `rulesHash` matches
  - the module exists with `version` equal to the module's
  - `validateRules` accepts the rules
  - the seat count is within `seatRange`

- [ ] **Step 1: Failing tests.**
  - Round trips for all three kinds.
  - Every Review Focus 1 shape case through each parser.
  - Every Review Focus 3 inconsistency through `validateRoot`, one assertion each.
  - A valid 3-seat root, with 1 invited and 1 open seat, validates.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Docs:** in PROTOCOL §4.3, state that `seats[].npub` and `seats[].session` are 64-character lowercase hex (D025).
- [ ] **Step 5:** commit "Add lobby events: table, join and game root".

### Task 5: In-game events: Move, Shares, Timeout, Secret reveal, Attestation

**Files:** `packages/protocol/src/game.ts` and `test/game.test.ts`; also update `src/index.ts`.

**Interfaces.** Consumes Tasks 3 and 4 plus deck's wire codecs (`decodeDeck(v, n)`, `decodeShuffleProof(v, n)`, `decodeShare`, the encoders). Produces:
- `type MoveContent = { type: 'shuffle'; deck: Ciphertext[]; proof: ShuffleProof } | { type: 'action'; action: unknown; reveals: PosShare[]; shares: PosShare[] }`, with `type PosShare = { pos: number; share: Share }`
- `moveTemplate(m: { rootId: Hex; prevId: Hex; seq: number; content: MoveContent }, createdAt): EventTemplate`, with tags per §4.4
- `parseMove(ev, deckSize: number): { id; pubkey; createdAt; rootId; prevId; seq; content: MoveContent }`
  - `deckSize` sizes the shuffle decoders.
  - `reveals` and `shares` must each be strictly ascending by `pos` with no duplicates.
  - `seq` is an integer ≥ 1 in decimal text without leading zeros.
  - `action` must be a JSON object; the module checks it later.
- `sharesTemplate` / `parseShares` (kind 7453): `{shares: PosShare[]}`, with the same ordering rule.
- `timeoutTemplate` / `parseTimeout`: tags root, head and seat; content `{}`.
- `secretTemplate` / `parseSecret`: content `{deckSecret}`, a scalar decoded with `decodeScalar`. The `x·G = X_k` check stays in the client.
- `attestTemplate` / `parseAttest`: `{audit: 'pass' | {fail: number[]; reason: string}, logHash: Hex, outcome: {places, reason, scores}}`
- `logHash(moveIds: readonly Hex[]): Hex`, the SHA-256 of `ids.join('\n')`

- [ ] **Step 1: Failing tests.**
  - Round trips for each kind, including a real 8-card shuffle step and real shares made with deck functions.
  - Review Focus 1 and 4 cases for each parser, one per assertion: unsorted shares, duplicate positions, `seq` values `0`, `01` and `-1`, a missing `prev`, two `root` tags, the wrong kind.
  - A Move whose `rootId` tag is not 64 hex characters is rejected.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** update `docs/PLAN.md`: 2c done, with results. Update the CLAUDE.md repo map with one line for `packages/protocol/`. Commit "Add in-game protocol events".

---

## Out of scope (2d)
- The session engine: folding the event log, owed shares, derived reveals, private learns, deadlines and timeouts, equivocation detection, the audit and forfeits.
- Relay transport.
- The NIP-78 key backup with NIP-44 encryption.

## Verification for the whole of 2c
- `pnpm check` is green.
- `pnpm fuzz --games 2000` gives 0 failures with every game declared.
- The purity guard covers `packages/protocol/src`.
