# Phase 2d: game session engine and simulations, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pure `packages/client` that turns a game's NOSTR events into an agreed game state for any seat or a spectator, and builds that seat's next events. It is proven by simulated asynchronous games over an in-memory relay, and by adversarial tests.

**Architecture:**
- `GameSession` is a deterministic fold over a set of events. They may arrive in any order and may be duplicated.
- `receive(ev, now)` stores the event, then re-folds to a fixpoint. Events that cannot be applied yet stay buffered.
- The fold has five phases:
  - **shuffle:** moves 1..S
  - **deal:** one 7453 Shares event per seat
  - **play:** game-action moves, plus reveals derived from shares and private learns
  - **end:** secret reveals, then the full-mode audit and attestations
  - **outcome:** including forfeits and cancellation
- `build…` methods sign this seat's events with its session key.
- The package is pure. Clock (`now`, `createdAt`) and randomness (`rnd`) are parameters.

**Tech stack:** TypeScript 7, Vitest, `@bored-games/{game-kit,deck,protocol,chain-reaction}`. `chain-reaction` is used only in tests and the simulator.

**Spec:** `docs/PROTOCOL.md` §6–§9, decisions D018–D026, and the rulings below. Rulings change the spec, so Task 7 writes them into PROTOCOL.md and DECISIONS (D030).

## Rulings (binding; recorded as D030)
- **R1, owed shares (PROTOCOL §6.2), stated monotonically.** A game-action move by seat k at parent state P is acceptable only if, counting k's shares already in the session's share store plus those in the move, k has a verified share for every position that `dealt(P)` assigns to another seat or to `null` (public).
  - A move that fails only this rule is **buffered**, not rejected. The missing shares may still arrive in an earlier 7453.
  - Clients therefore converge whatever order events arrive in.
- **R2, equivocation (§6.6).** Two distinct moves that both parse, carry the same root, `prev` and `seq`, and are signed by the same seated session key are equivocation. That seat forfeits, whether or not either move is otherwise valid.
- **R3, `pendingSince` (§8.1).** `pendingSince` is the largest `created_at` among accepted events: chain moves, accepted Shares events and accepted Secret reveals. It marks the game's last progress. Clients accept a timeout claim if all of the following hold:
  - its `head` is the current head
  - the named seat is stalled
  - `claim.created_at ≥ pendingSince + deadline`
  - the client's own `now ≥ pendingSince + deadline`

  A claim received too early is stored and re-checked on `tick(now)`.
- **R4, who is stalled:**
  - shuffle: the seat whose step is next
  - deal: every seat without an accepted Shares event
  - play: `pending().seat` for a player decision. For a pending reveal, the seats missing shares for those positions.
  - end: every seat without an accepted Secret reveal
- **R5, forfeit outcome (§8.2).**
  - Before the first game-action move is accepted, a forfeit cancels the game: `phase: 'cancelled'`, no outcome.
  - After that, the game ends immediately. Forfeiting seats share the last places. The others are ranked by `standings(state)`, descending, with ties sharing a place. The reason is `'forfeit'`.
  - A forfeit found at the end (failed audit or withheld secret) keeps the declared order among the other seats and moves the forfeiters to shared last places.
- **R6, audit.** Once every seat's secret is known (verified by `x·G = X_k`):
  - decrypt each final-deck position with `decryptWithSecrets` and `cardOf`
  - set up the module in full mode with that order
  - replay the session's **interleaved action log** (game actions and derived reveals, in the order the fold applied them)

  The first rejected action fails its actor (`audit: {fail:[actor], reason}`). If the replay's `outcome` differs from the view's, every seat fails ("outcome mismatch"). Otherwise `audit: 'pass'`.

## Notes from Phase 2c (binding)
- `revealsOf(state, action)` is syntactic: trust its claims only for actions `module.apply` accepts. Check `apply` on a scratch copy first, then the reveals.
- `dealt(state)` is append-only and identical across views. Setup positions are `to: null` from setup.
- `standings(state)` does not repay bonuses already paid in the current merger (D020 note).
- Protocol API: `parseTable`, `parseJoin`, `parseRoot`, `validateRoot(root, table, joinsById, modules)`, `parseMove(ev, deckSize)`, `parseShares`, `parseTimeout`, `parseSecret`, `parseAttest`, the `…Template` builders, `finalizeEvent(t, sk, rnd)`, `logHash`, and `ProtocolError(code, message)`. Joins carry `rules-hash` and `v` tags (2c fix round, D027).
- Decision numbers: D027 covers protocol lobby strictness, D028 in-game parsing, and D029 Phase 3 dependencies. This phase's rulings are **D030**.

## Global constraints
- **Purity.** `packages/client/src` is pure and is added to the purity guard; its tsconfig sets `types: []`. `GameSession` may mutate its own private fields. Every returned value is a fresh copy or frozen.
- **Events.** Every received event first goes through `verifyEvent`, the size cap and the strict protocol parser. Its signer must be a seated session key. Seat identity comes from the root.
- **Fixed parameters.** The deck id and size come from `module.decks(rules)`. Chain Reaction has one deck, `tiles`, of 108. The session supports exactly one deck; it throws `ClientError` at creation otherwise.
- **Shares.** At most one verified share per (seat, position), and the first valid one is kept. Private cards are decrypted with `decryptPosition` and `ownShare` (D025).
- **No throwing on peer input.** `receive` never throws on peer input; it returns a `ReceiveResult`. Only caller errors throw `ClientError` (`name = 'ClientError'`).
- **Conventions:** CLAUDE.md. Run `pnpm check` before each commit, and end every commit with the session's co-author and session lines.

## Review focus
1. **Arrival order.** Every client must reach the same head, state and outcome, whatever order and duplication the events arrive in. Test with permutations. (Tasks 2–4 and 7.)
2. **A move that arrives before the shares it relies on** must be buffered, then accepted once they arrive. It must never be dropped forever. (Task 3.)
3. **A cheating seat:**
   - a bad share proof or a wrong reveal: rejected
   - a forged skipPlace or an undeclared dead tile: caught by the audit
   - equivocation: forfeit
   - a tampered shuffle: rejected, then timeout, then cancel

   (Tasks 3–5 and 7.)
4. **A seat that vanishes** must be claimable after the deadline and not before, judged by both the claim's time and the client's own clock. Before the first action the game is cancelled; after it, the seat forfeits and the others are ranked by `standings`. (Task 5.)
5. **A spectator** (`me = null`) must follow the whole game, including the audit, and agree with the players. (Tasks 2 and 7.)

---

## File structure (`packages/client/`)

| Path | Responsibility |
|---|---|
| `src/errors.ts` | `ClientError` |
| `src/types.ts` | `Identity`, `SessionInput`, `ReceiveResult`, `Duty`, `SessionView`, `Phase` |
| `src/session.ts` | The `GameSession` class: intake, fold, phases, builders |
| `src/shares.ts` | `ShareStore`: verified shares per (seat, pos); owed-shares computation |
| `src/audit.ts` | Secret checks, full-mode replay, forfeit ranking (`rankWithForfeits`) |
| `src/lobby.ts` | Lobby fold and root assembly, `newGameKeys` |
| `src/memory-relay.ts` | `MemoryRelay`, a test and sim transport (pure; deterministic delivery from an injected rng) |
| `src/sim.ts` | `simulateGame(...)`, async simulated players and adversary hooks |
| `src/index.ts` | Public exports |
| `test/*.test.ts` | Per-task tests; `test/helpers.ts` builds tables, joins, roots and identities |
| `tools/sim/` (or a `scripts/` folder in the package) | `pnpm sim --games N --seats S --seed X` CLI |

## Shared interfaces (defined in Task 1, used by all)

```ts
interface Identity { seat: number; sessionSk: Uint8Array; deckSecret: bigint }
interface SessionInput {
  modules: ReadonlyMap<string, GameModule<any, any, any>>;
  table: NostrEvent; joins: readonly NostrEvent[]; root: NostrEvent;
  me: Identity | null;
}
type Phase = 'shuffle' | 'deal' | 'play' | 'end' | 'done' | 'cancelled';
type ReceiveResult =
  | { status: 'accepted' | 'stored' | 'duplicate' }
  | { status: 'rejected'; reason: string };
type Duty =
  | { kind: 'shuffle' } | { kind: 'deal' } | { kind: 'decide' }
  | { kind: 'secret' } | { kind: 'attest' };
interface SessionView {
  phase: Phase; rootId: Hex; seats: number; mySeat: number | null;
  head: { id: Hex; seq: number };
  state: unknown /* module state: view for mySeat, or spectator */;
  pending: Pending; pendingSince: number;
  outcome: Outcome | null; forfeits: number[];
  equivocators: number[];                    // flagged seats (Ruling 5); play goes on
  audit: 'pending' | 'pass' | { fail: number[]; reason: string };
  logHash: Hex; deadline: number;
  attested: number[];                        // seats whose attestation matches this session's result
}
class GameSession {
  static create(input: SessionInput): GameSession; // throws ClientError if root invalid (validateRoot)
  receive(ev: unknown, now: number): ReceiveResult;
  tick(now: number): void;
  view(): SessionView;
  duties(): Duty[];
  legalActions(): readonly unknown[];        // [] unless my 'decide' duty
  buildShuffle(rnd: RandomBytes, createdAt: number): NostrEvent;
  buildDeal(rnd: RandomBytes, createdAt: number): NostrEvent;
  buildAction(action: unknown, rnd: RandomBytes, createdAt: number): NostrEvent; // attaches owed shares + reveals
  buildSecret(rnd: RandomBytes, createdAt: number): NostrEvent;
  attestTemplate(createdAt: number): EventTemplate; // unsigned: the caller signs it with the seat's npub
  timeoutTarget(now: number): number | null;   // a seat I may claim against now
  buildTimeout(seat: number, rnd: RandomBytes, createdAt: number): NostrEvent;
}
```

A `build…` method throws `ClientError` when the duty isn't mine. It does not apply its own event: the caller publishes it and feeds it back through `receive`. Build once per decision and re-send that event: a rebuild has fresh randomness, so it is a rival move (equivocation).

---

### Task 1: Package, session creation and the shuffle phase

**Files:** the package scaffold mirroring `packages/protocol`; `src/{errors,types,session}.ts`; `test/helpers.ts`; `test/shuffle-phase.test.ts`. Modify `vitest.config.ts` (project `client`) and the purity guard.

**Behavior:**
- `create` parses the table, joins and root, and runs `validateRoot`. It finds `me.seat`'s session key and checks it matches `me.sessionSk`.
- Shuffle moves are accepted in `seq` order. Each one's signer must be the session key of seat `seq − 1`, and its `prev` must be the root (seq 1) or the previous head. The input deck is `initialDeck` (seq 1) or the previous step's output, and the proof is checked with `verifyShuffle` and ctx `{rootId, seat: seq−1, deckId}`.
- After S steps the phase becomes `'deal'`, and the module is set up in view mode for `me?.seat ?? null`.

**Helpers** (`test/helpers.ts`): `makeGame(seats, seed)` returns signed table, joins and root, plus each seat's `Identity`, using `seededRandom`, a fake `created_at` starting at 1_700_000_000, and keys from the rng.

- [ ] **Step 1: Failing tests** (3 seats):
  - Each seat's session builds its step in turn, and all sessions and a spectator accept every step. The phase becomes `'deal'` and `head.seq === 3`.
  - Steps delivered in reverse order are stored, then accepted.
  - A step signed by the wrong seat is rejected.
  - A step whose proof was made against a different input deck is rejected.
  - A duplicate reports `'duplicate'`.
  - An event for another root is rejected.
  - A bad signature is rejected.
  - `create` with a tampered root throws `ClientError`.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit "Add client session: creation and shuffle phase".

### Task 2: Deal, share store, derived reveals and private learns

**Files:** `src/shares.ts`, `src/session.ts`, `test/deal.test.ts`.

**Behavior:**
- **Deal duty.** In the `deal` phase, I owe one 7453 that covers every position in `dealt(state)` assigned to another seat or to `null`. `buildDeal` makes those shares (`makeShare` with ctx `{rootId, deckId, pos}`), sorted by position.
- **Accepting a Shares event.** It must come from a seated session key, and every share in it must verify against that seat's `X_k` and the final deck's ciphertext. An event with any invalid share is rejected as a whole. A seat's second Shares event is stored only for its shares that are new.
- **End of the deal.** When every seat has an accepted deal event, the phase becomes `'play'`. The engine pends a reveal of the setup positions first.
- **Derived reveals (§6.3).** While `pending()` is a reveal and every listed position has all S shares, apply `{type:'reveal', actor:'deck', deck, pos, card}` for each position, in ascending order. Append each one to the interleaved action log.
- **Private learns (§6.4).** For each position dealt to me with every other seat's share present, decrypt it with `decryptPosition` and `ownShare`, then call `module.learn`. This runs after every fold step.

- [ ] **Step 1: Failing tests** (3 seats, continuing from Task 1's helper):
  - All three deal events are accepted, the setup tiles are revealed identically in every session, and each seat learns exactly its 6 hand tiles. Compare with the audit truth: decrypt with all secrets.
  - The spectator sees the board but no hands.
  - A deal event with one bad share is rejected.
  - Delivering the deal events in every order gives identical views.
  - `duties()` is `[{kind:'deal'}]` before my deal and `[]` after it.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit "Add deal round, share store, derived reveals and private learns".

### Task 3: Play: game-action moves

**Files:** `src/session.ts`, `src/shares.ts`, `test/play.test.ts`.

**Behavior:**
- **Accepting a move.** A move with `content.type === 'action'` is accepted at the head when all of the following hold:
  - the signer is the session key of `pending().seat`, and `pending.type === 'player'`
  - `prev` is the head id and `seq` is head + 1
  - every share and reveal verifies (a bad one rejects the move)
  - R1 (owed shares) is satisfied; failing only R1 means the move is buffered
  - the `reveals` positions equal exactly the positions in `revealsOf(state, action)`, and each one decrypts, with all seats' shares, to the claimed card
  - `module.apply(state, action)` accepts it
- **After accepting.** Store the move's shares, append the action to the log, then continue the fold (derived reveals, learns).
- **`buildAction(action)`.** It requires my `decide` duty and the action in `legalActions()`. It attaches every share I owe as of the head (R1) and my reveal shares for `revealsOf`.
- **`duties()`.** It gives `[{kind:'decide'}]` when `pending` is my player decision and I know my hand. Any other seat's shares I need are present by construction.

- [ ] **Step 1: Failing tests:**
  - Three sessions play 30 moves with the uniform fuzz policy (`legalActions` then `rng.pick`). Every session and the spectator agree on head, state hash (`stateHash(view(...))`, compared on the public parts) and pending.
  - A move whose owed share comes only in a later 7453 is stored, then accepted once that event arrives.
  - A move with a wrong reveal card is rejected.
  - A move with an invalid share proof is rejected.
  - A move signed by a non-pending seat is rejected.
  - A move the module rejects is rejected.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit "Add game-action moves with owed shares and reveals".

### Task 4: End of game: secrets, audit, attestation, equivocation and forfeit ranking

**Files:** `src/audit.ts`, `src/session.ts`, `test/end.test.ts`.

**Behavior:**
- **Secrets.** When the module reaches `over`, the phase becomes `'end'` and every seat has a `secret` duty. A secret is accepted only if `x·G = X_k` for the signer's seat.
- **Audit.** When all S secrets are in, run the R6 audit. The phase becomes `'done'`, and every seat gets an `attest` duty until its attestation is accepted.
- **Attestation.** `attestTemplate(createdAt)` returns the unsigned event carrying `{audit, logHash, outcome}`, where `logHash` is `logHash` over the chain's move ids in `seq` order; the caller signs it with the seat's npub (it replaced `buildAttest`).
- **Accepting an attestation.** Its signer is the seat's **npub** (identity key, PROTOCOL §4.8), not its session key, and its content must equal the session's own audit, logHash and outcome. Matching attestations are recorded in `view().attested: number[]`.
- **Equivocation (R2).** Detected at `receive`, giving a forfeit. R5 decides between cancel and an immediate end. *Superseded by Rulings 3–5 (D030): fork choice by the longest valid branch, equivocators flagged in `view().equivocators`, play goes on, and at the end they move to the last places.*
- **`rankWithForfeits(scores, forfeits, declaredPlaces | null)`** implements R5.
- **`view().outcome`** comes from `module.outcome` when the game ended normally and passed the audit. A failed audit or a withheld secret (Task 5) applies R5's end-of-game adjustment.

- [ ] **Step 1: Failing tests:**
  - **Full honest game.** 3 seats play to the end with the fuzz policy. Every session passes the audit, gets identical outcomes, and gets the same `logHash`. All attestations are accepted.
  - **A cheater's forged `skipPlace`.** Build the move with a test-only helper that bypasses `buildAction`'s legality check. Every session accepts it, since hands are hidden, and the audit fails the cheater, who moves to last place.
  - **Equivocation mid-game.** Two moves on the same `prev` lead to a forfeit, with ranking by `standings`.
  - **Equivocation during the shuffle** leads to `'cancelled'`.
  - **`rankWithForfeits` unit cases:** ties, all-but-one forfeits, and the end-of-game adjustment.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit "Add end of game: secrets, audit, attestations and forfeits".

### Task 5: Deadlines and timeout claims

**Files:** `src/session.ts`, `test/timeout.test.ts`.

**Behavior:**
- Implement R3 and R4.
- `timeoutTarget(now)` returns the lowest stalled seat other than mine, once `now ≥ pendingSince + deadline`; otherwise `null`.
- `buildTimeout` signs a 7454 event naming that seat and the head.
- When a claim is accepted, the seat forfeits under R5. A shuffle or deal stall gives `'cancelled'`. A play stall ends the game by forfeit. An end-phase stall (a withheld secret) applies the end adjustment, and the audit still runs over the remaining seats' secrets: a seat that failed to reveal is not audited, and the others are.

  > Note: without every secret the deck can't be decrypted. Rule: the audit is then skipped (`audit: {fail: [withholders], reason: 'withheld secret'}`), and the outcome is the declared one, adjusted.
- `tick(now)` re-checks stored early claims.

- [ ] **Step 1: Failing tests:**
  - A claim one second early is stored, not accepted.
  - After `tick(now)`, past the deadline, it is accepted.
  - The claim's `created_at` is past the deadline but `now` is not: not accepted.
  - A claim against a seat that is not stalled is rejected.
  - A claim against an old head is rejected.
  - A stall during the deal leads to `'cancelled'`.
  - A stall in mid-play leads to a forfeit outcome ranked by `standings`.
  - A withheld secret leads to the adjusted declared outcome.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit "Add deadlines and timeout claims".

### Task 6: Lobby helpers

**Files:** `src/lobby.ts`, `test/lobby.test.ts`.

**Interfaces:**
- `newGameKeys(rnd): { sessionSk: Uint8Array; sessionPub: Hex; deckSecret: bigint; deckKey: Point }`.
- `foldLobby(table: NostrEvent, events: readonly NostrEvent[]): LobbyView`. `LobbyView = { table: ParsedTable; joins: ParsedJoin[] /* valid, one per npub, earliest wins; invited first then open seats by created_at, capped at open */; seatsFilled: number; full: boolean; root: ParsedRoot | null /* the first valid root seen */ }`.
- `rootSeatOrder(view)`: the creator first, then the joins in `foldLobby` order.
- `buildJoinTemplate(table, npub, keys, relays, rnd, createdAt): EventTemplate`. It is signed by the npub signer outside this package.
- `buildRootTemplate(view, relays, createdAt): EventTemplate`.

- [ ] **Step 1: Failing tests:**
  - A 3-seat table with 1 invited and 1 open seat: the invited player's join and an open-seat join make it `full`.
  - A second open-seat join beyond capacity is ignored.
  - A join with a bad PoK is ignored.
  - A duplicate join from the same npub keeps the earliest.
  - The built root validates, and `GameSession.create` accepts it.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit "Add lobby fold and root assembly".

### Task 7: Memory relay, async simulation, adversarial sims, CLI and docs

**Files:** `src/memory-relay.ts`, `src/sim.ts`, `test/sim.test.ts`, the sim CLI and a root `package.json` script `sim`; `docs/PROTOCOL.md` (R1–R6), `docs/DECISIONS.md` (D030), `docs/PLAN.md` and the CLAUDE.md repo map.

**`MemoryRelay`:** `publish(ev)`, `query(filter: {kinds?, '#e'?, '#a'?, authors?}): NostrEvent[]`. Delivery order is permuted per reader by an injected rng.

**`simulateGame({seats, seed, policy, adversary?})`:**
1. Run the lobby: build the table, joins and root through Task 6's helpers, signing with npub keys.
2. Loop. Each round, pick a random client. It syncs: it queries the relay for every event of the game and receives them in a shuffled order with `now` = the simulated clock. It then performs its duties: shuffle, deal, decide with the policy, secret, attest. Each built event is published and then received by the client itself.
3. Advance the clock by a random 1–3600 s.
4. Stop when every session is `'done'` or `'cancelled'`, or after a step cap, which counts as a failure.

It checks that every session (plus a spectator) agrees on phase, `logHash`, outcome and audit. It returns a report: moves, duration, outcome and failures. `adversary` hooks substitute a cheating behavior for one seat:
- `badShare`: a corrupt share in a move
- `forgedSkip`: `skipPlace` while holding a playable tile
- `equivocate`: publishes two moves on the same parent
- `vanish`: stops acting at a chosen move, so the others claim a timeout after the deadline
- `badShuffle`: a shuffle proof against the wrong input

**Expected results:**
- `badShare` and `badShuffle` are rejected. A `badShuffle` stalls the game, which then times out and is cancelled.
- `forgedSkip` fails the audit.
- `equivocate` gives a forfeit.
- `vanish` gives a forfeit, or a cancellation if it happens before the first action.

- [ ] **Step 1: Failing tests:**
  - One honest 3-seat game ends `'done'`, with the audit passed and everyone agreeing.
  - Each adversary gives its expected result, using 3 seats and timeouts generous enough for the run.
- [ ] **Step 2:** implement. Add a CLI, `pnpm sim --games N --seats 3-6 --seed S [--adversary name]`, that prints a one-line summary per game and the totals. Run `pnpm sim --games 4 --seats 3-4` and record the result.
- [ ] **Step 3: Docs:**
  - PROTOCOL: write R1–R6 into §6.2, §6.6, §7, §8.1 and §8.2.
  - DECISIONS: add D030, the rulings.
  - PLAN: set 2d to done, with the results.
  - CLAUDE.md: add a repo-map line for `packages/client/`.
- [ ] **Step 4:** run `pnpm check`, then commit "Add memory relay and async game simulations".

---

## Out of scope
- **2e:** the WebSocket relay pool, the live relay smoke test, and the NIP-78 backup.
- **Phase 3:** the web UI.
