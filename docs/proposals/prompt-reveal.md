# Proposal: a prompt reveal that cannot expose a hidden value ("final, or stop")

**Status: Proposal (Phase K, D055). Research and design only: nothing here is wired into the session or the protocol.** It replaces [`fast-reveal.md`](fast-reveal.md) as the main document on prompt reveals; that file stays as the history of the "acknowledge, then share" candidate and its first review.

**The owner's rule (2026-10-02):** no prompt shares in any game, co-op included, until a cheat-proof protocol exists; everything stays inside the platform and NOSTR (no third parties, owner answers §7 Q2 and Q6). Until the owner approves this design after an independent adversarial review, every game stays turn-piggybacked (PROTOCOL §6.2).

**Verdict in one paragraph.** Every reorganisation in the protocol is either a fork, which only the pending seat can sign and which therefore always carries a self-proving equivocation certificate, or an early end of one client's chain (a claim or a resign race), which never moves a value to another seat. The recommended design, **final, or stop** (§5), uses both facts: a prompt share is released only for a move that every seat has vouched for (by an Ack or by building on it), and a fork with no such vouched side **stops the game at the fork**, with the equivocator last and the game unrated, instead of letting fork choice move honest seats to the other side. Within the model's explored scope (§6: 3 seats, and 4 seats with two colluders; every coalition of 1–2 seats; equivocation, withholding, delays, selective acks, timeout claims and resigns, for private, viewer-set and public grants) it shows **no exposure, no honest forfeit and no divergence other than the existing claim race**, and the model reproduces the known attacks on D039 and on plain "acknowledge, then share". **Cheat-proof: yes for exposure within the explored scope, under the assumptions of §2.3,** with the residuals of §9: post-end learning of values that were never dealt on the final chain, the existing claim and resign races, the gossip-within-the-deadline assumption, and key hygiene. It is not a proof: the model is small-scope and abstracts the cryptography; §8 records the attacks tried and §9 what a reviewer should press on next.

**Two findings about the shipped protocol v1** came out of the survey (§3) and need decisions independently of this proposal:
- **F7, deal-round translation.** An equivocating last shuffler can read other seats' starting hands from the deal round, because honest clients deal again on the rival deck and a share translates between the two decks (`packages/deck/test/fork-translation.test.ts`). This is a D039-class exposure in v1 today.
- **F8, resign plus equivocation.** With Resign allowed in games of 3 or more seats (Phase G), a seat that resigns on one branch and equivocates can get an honest seat timed out on other clients (the model's v1 trace in §6.3).

## 1. The problem
A hidden value (a tile, a card, a roll) is readable by a seat once every other seat has released its decryption share to it. Today a seat releases the shares it owes only inside its own next move (PROTOCOL §6.2), so a new tile shows "?" until every other seat has moved. A prompt reveal means releasing them as soon as the value is granted, without a human action.

The obstacle is that a decryption share `D = x·a` is a value of the ciphertext, not of the branch. A share released for a grant on branch A is just as good on a rival branch B where the same position belongs to someone else.
- **D039 (reverted).** One equivocator E signs A (it draws p), collects the prompt shares, then signs a lower-id rival B on the same prev in which p goes to the next drawer N. Fork choice moves everyone to B, and E knows N's tile (fast-reveal.md §1).
- **"Acknowledge, then share" (fast-reveal.md §2).** Shares wait for Acks from every other seat, and a move with all Acks is final in fork choice. A colluder that withholds its Ack, lets honest seats move to a rival, and then acknowledges late pulls every client back (the late-Ack reorg, §4.2 there).
- **"Ack implies lock" (§5 there)** closes the late-Ack reorg, but honest seats that acknowledged different rivals stay locked apart (honest splits), and every lock-release rule found reopened the reorg.

## 2. Threat model, properties and assumptions

### 2.1 Threat model
- **Seats.** Any coalition of seats (up to all but one) may deviate arbitrarily: sign rival moves (equivocate), sign or withhold Acks, publish shares or not, claim timeouts, resign, and share everything they know among themselves. Colluders always see each other's hands; that is out of scope (PROTOCOL §11, "Collusion").
- **Network.** Messages are delayed arbitrarily; the adversary chooses the order in which each client receives events; seats can be partitioned for a time.
- **Relays** drop, reorder, delay or withhold events, including from some clients and not others. They cannot forge signatures.
- **Clocks.** Each client's clock is its own; `created_at` proves nothing (PROTOCOL §11).

### 2.2 Properties
- **S1, no illegitimate learning.** Let F be the final chain of an honest client (the chain it ends on once every event has reached it). If a coalition C can read the value at position p, then on F the value is granted to a member of C, or made public, by a move that was signed **before** C could read it. The second half is the foresight rule: learning a value before signing the move that grants it (a roll seen before the decision, a tile seen before choosing the turn) is a breach even if F grants it. A breach is **post-end** when every share C used was released on a chain that strictly extends F: the release happened past the end of F (typically for a value never dealt on F), and every move on F predates it, so it cannot influence the result. The model reports post-end breaches separately (§6) and §9 lists them as a residual.
- **S2, no forced loss.** No honest seat is timed out, flagged or ranked last because of protocol games.
- **S3, convergence.** Honest clients holding the same events reach the same result. The existing claim and resign races (PROTOCOL §11) are the only accepted exception.
- **Liveness.** With every seat honest and online, a granted value is readable by its viewers within about two relay round trips (seconds). Otherwise the turn-piggybacked path still reveals it by the viewer's next turn, as today; nothing waits forever.

### 2.3 Assumptions
- **A1, one move per prev.** Only the pending seat can sign a valid move on a prev (PROTOCOL §6.5, rule 2). Every game today has one pending seat per prev. Simultaneous moves outside the chain (sealed choices v2, GAME-SYSTEMS §4.4) would break it and need their own analysis.
- **A2, honest seats sign once.** An honest seat signs one move per prev and never Acks two conflicting moves, and it persists both before publishing (build once, PROTOCOL §6.5). One session key used on two devices, or restored from an old backup, breaks this; the seat is then the equivocator and the game stops on it (§9).
- **A3, gossip within the deadline.** Every event that some honest client holds reaches every honest client within the game's deadline. Clients MUST rebroadcast both events of any fork they hold, and SHOULD rebroadcast every game event they hold, to the root's relays. Today's timeouts already rely on this for moves: an honest move that does not reach the claimant in time gets its seat timed out.
- **A4, deterministic validity.** Whether a move is valid as of its prev depends only on the events held, and only grows as events arrive (PROTOCOL §6.5; D030 R1). It holds today.
- **A5, honest humans act within the deadline** (as today).

## 3. Every source of reorganisation (K2)

**Lemma (forks are signed).** By A1, two successors of one prev are signed by the same seat, the pending seat at that prev. If both are valid as of the prev (valid-looking, PROTOCOL §6.6), they are an equivocation certificate that any client can show: two signatures by one key on one prev. Every branch switch in fork choice happens at such a fork, so **every reorganisation of the chain carries a certificate against one seat**. Everything else a client can disagree on is where a chain *ends*: one client's chain is a prefix of another's.

| # | Source | Fork? | Can a prompt reveal be released on a branch that later loses? | Under "final, or stop" |
|---|---|---|---|---|
| R1 | **Equivocation**: two game actions by the pending seat on one prev | yes, certificate | **D039: yes** (the lone-equivocator exposure). **Ack, no lock: yes** (late-Ack reorg). **Ack and lock: no reorg, but honest splits.** | Released only on final moves, and a final move is never on a losing side; a fork with no final side stops the game. |
| R2 | **Shuffle-step fork**, including the candidate cut (D030 Ruling 12) | yes, certificate (two well-formed steps) | **Yes, in v1 today**: the deal round is a prompt release (F7 below). | The fork stops the setup, so the game is cancelled; deal shares wait for the last step to be final. |
| R3 | **Over-first rule**: a shorter branch that reaches `over` beats a longer one | only at a fork (R1) | as R1 | no ranking at all: final side or stop |
| R4 | **A rival that becomes valid later** (its reveal shares arrive late, A4) | yes, once valid | as R1, late | the stop happens when the rival becomes valid-looking, unless the other side is final |
| R5 | **Timeout claim racing a move** (the claim race, PROTOCOL §11) | no: the claiming client's chain ends early | A share is released on the continuing chain, past the claimant's end. In v1 and D039 the recipient is entitled there (post-end on the claimant's client). | A move past the claimant's end can never be final: the claimant's own honest seat never vouches for it (§5.4), so no prompt share goes out for it. |
| R6 | **Resign racing a move** (PROTOCOL §8.3) | no | as R5 | as R5 |
| R7 | **Raced game-ending moves** (a mate or an accepted draw against a resign or a claim) | no, unless two endings are signed (R1) | as R5 | as R5 |
| R8 | **Relay withholding, delay, partition** | no, by itself | Only combined with R1 (a split). Withholding alone only delays. | A split is a fork with honest seats on both sides; neither side can become final, so the game stops when the halves meet (A3). |
| R9 | **The finality filter itself** (fast-reveal.md §2.4): a late Ack makes a far-back move final and pulls every chain to it | yes (R1 below it) | **Yes**: the late-Ack reorg | no fork choice to pull: a side is followed only if every seat other than the equivocator vouched for it, which no honest seat on the other side ever does |
| R10 | **Device duplication or an old backup** (A2 broken) | yes, an honest-looking seat equivocates | as R1 | the game stops on that seat (it is the equivocator) |
| R11 | **Resign counted on a branch that later loses** (F8) | R1 plus a Resign | v1 with Phase G's multi-seat resign: an honest seat whose client counted the resign stops moving and is timed out on the other side. | the fork stops the game on every client that holds it, and a stop takes precedence over a claim or resign at or past it (§5.1, rule 9) |
| R12 | **Interim stops** (this design): a fork is seen before an Ack that makes one side final | no, a pause | | Resuming is safe (§5.4); the event that resumes play is progress, so no deadline runs during the pause. |

**F7, deal-round translation (v1 today).** The deal (PROTOCOL §6.1, step 3) is a prompt release: every seat shares the other seats' hand positions as soon as the shuffle ends. The last shuffler E signs two rival final steps A and B on the same prev. Both outputs re-encrypt the same input deck, and E keeps both randomizer vectors, so for a card at `A[i]` and `B[j]` E knows `δ = rA_i − rB_j` with `A[i].a = B[j].a + δ·G`. An honest seat's share of `A[i]` then gives its share of `B[j]`: `x·B[j].a = x·A[i].a − δ·X`. In v1 an honest client that dealt on A and is moved to B (a lower id) deals again on B; the web controller rebuilds an orphaned deal on purpose (`game-controller.ts`, "A deal … the session refused … is built anew"). E picks the B permutation so that each seat's B-hand cards were not in its A-hand, translates, and reads every honest seat's B-hand, then plays the whole game knowing them. It is flagged (two shuffle steps) and forfeits at the end, which is exactly the residual the owner rejected for D039. `packages/deck/test/fork-translation.test.ts` checks the algebra. **Immediate v1 fix, independent of this proposal:** a seat never deals a second time in a game (a deal orphaned by a shuffle fork is not rebuilt; the seat stalls and the game is cancelled before the first action), or any shuffle-step fork cancels the game.

**F8, resign plus equivocation (Phase G).** With Resign allowed in 3-seat games, E signs move A and a Resign naming A, and delivers both to honest seat H2 only; it signs a lower-id rival B and delivers it to H1. H2 counts the Resign (final), so it never moves; H1 is on B and waits for H2, then claims a timeout: H2 is timed out on H1's client. The model finds it in v1 (§6.3). Phase G should add: a Resign counts only if the head it names has no rival held, or adopt rule 9 of §5.1.

## 4. Candidate designs (K3)

### 4.1 (a) "Acknowledge, then share" with "ack implies lock", lock release only on an equivocation certificate, and proven equivocation ends the game
The hypothesis: every exposure needs an equivocation, an honest split needs one too, and if a proven equivocation ends the game, any exposure happens only in a game that is already over.

**What holds.** The lemma of §3 confirms the first two parts: every branch switch is at a certified fork, and an honest split is a fork with honest Acks on both sides. Claims, resigns and raced endings never create a fork, so the non-equivocation reorgs of K2 (R5–R8) do not break the hypothesis: they end one client's chain early, and with unanimous finality (§5.4) no prompt share is ever released past an honest client's early end.

**What breaks, and what fixes it.** "Ends the game" must say *where*.
- **At each client's current head:** heads differ between clients, so results differ (S3), and the side the client was on may be the one that loses, after shares went out on it.
- **At the fork, always:** monotone and deterministic, but a seat can then void any game, even a finished one, by re-signing a move from long ago (the reason Ruling 5 refused rollback), and a final move with prompt shares already out would be voided after the fact (post-end learning everywhere).
- **At the fork, unless one side is final:** this is §5. A move every seat vouched for can never be voided, so an old rival is only evidence (as Ruling 5 has it), and the window in which an equivocation can stop the game closes as soon as the move is final (seconds online, one round otherwise).

The lock is no longer needed as a separate rule: with no fork choice, an honest seat never switches sides, which is what the lock was for, and a split simply stops. The "lock release on certificate" also disappears: the certificate ends the game unless a side is final, and a final side needs the vouch of every honest seat, which only one side can have.

**Attacks on the literal (a)** (the model's `ack-lock` design keeps fork choice under the lock): an honest split leaves honest clients locked on different sides (`divergence`), and the seat locked on the other side looks stalled and is timed out (`honest-forfeit`); see §6.

### 4.2 (b) Reveals gated on a unanimous Ack certificate, deterministic finality
Release only on a move with Acks from every other seat; fork choice keeps every final move. Finality is monotone in the event set, so clients agree. **Alone it fails:** finality jumps (R9). The model finds the late-Ack reorg with one honest seat and two colluders (§6.2): the honest seat Acks A, the colluder withholds, a lower-id rival B wins fork choice, the honest seat moves on B and its slow-path share of a later position goes out, then the late Ack makes A final, every client returns to A, and on A that position is dealt to the honest seat. Adding the lock gives (a). Adding fork stop gives §5.

### 4.3 (c) Per-mechanic fallbacks
- **Draw-ahead** (GAME-SYSTEMS §4.1.8): draw at the end of the previous turn, so the turn-piggybacked path is in time. No protocol change, no new risk; a rules variant, logged per game as OPEN.
- **The reveal rides on the next action:** a decide-then-roll or on-demand draw waits for the next seat's move (+1 async round).
- **Hanabi with 3 or more seats** has no fallback of this kind: a viewer must see a new card before its next turn, and the sealed shares it needs come from seats that move after it. It needs prompt releases (§5) or waits for every seat to be online.

These remain the shipped behaviour until the owner approves §5, and stay the fallback inside §5.

### 4.4 Fork stop without Acks (`fs` in the model)
Prompt shares as in D039, but a fork with no side vouched by every other seat (by moves alone) stops the game. **No exposure** in the model: a value learned on a side that loses is learned only past the end of the final chain. But many **post-end** breaches: the equivocator can still read the value its own rival discards (it draws, reads the tile, then stops the game by equivocating), and a roll can be seen before a stopped decision. Acks remove those (§5).

## 5. The recommended design: final, or stop

### 5.1 Rules
1. **Ack (new kind, 7458 suggested).** `{"type":"ack"}` with tags `["e", <rootId>, "", "root"]`, `["e", <moveId>, "", "ack"]`, signed by the seat's session key, strictly parsed. An honest client publishes an Ack of a move M once M is on its chain, its chain is live (not over, stopped or frozen), it did not sign M, and M creates a prompt duty (it grants a value: a draw, a viewer-set grant, a public reveal, a roll; and the last shuffle step, for the deal). It never Acks a move that conflicts with one it signed or acknowledged, and it persists the Ack before publishing (A2).
2. **Vouch.** Seat k vouches for move M if it signed M or a descendant of M, or published an Ack of M or of a descendant of M. A function of the event set.
3. **Final.** M is final when every seat vouches for it (its signer by signing it). Monotone: more events never undo it.
4. **Fork stop (replaces fork choice).** From the root, follow the unique valid-looking successor. At a prev P with two or more (signed by the pending seat E, an equivocation certificate):
   - if exactly one successor's side is vouched for by every seat other than E, follow it; E is flagged (forfeits at the end, as Ruling 5);
   - if several are (only possible when every seat but E colludes), follow the lowest id;
   - otherwise the game **stops at P**: ended by equivocation, E last, the others ranked by `standings` at P, unrated, and the cheat recorded (as the owner ruled for aborted games). Before the first game action the game is cancelled.
   Shuffle steps count as successors when well-formed (no proof check needed to stop).
5. **Prompt release.** An honest client releases a share it owes for a grant made by M outside its own moves (a Shares event: public shares, sealed shares §7, roll contributions, public-reveal shares, deal shares) only when M is final, on its chain, and the chain is live.
6. **Slow path, unchanged.** A move carries every share its seat owes as of the head (PROTOCOL §6.2). It needs no finality.
7. **Gossip** (A3). Clients rebroadcast both events of any fork they hold, and the game events they hold, to the root's relays.
8. **Progress** (Ruling 11, extended). An event that starts or ends a stop, or makes a move final in a way that changes the stalled set, is progress. Acks are otherwise not progress.
9. **A stop takes precedence** over a counted claim or resign whose head is at or past the fork, so the result stays a function of the held events (closes R11). Claims and resigns below the fork are unchanged.
10. **Stalls, for games that need prompt reveals to proceed** (Hanabi with 3 or more seats): when the pending decision needs a value that is not readable yet, the stalled seats are those missing an Ack of the granting move, and once it is final, those missing a release. Games that do not need them (Chain Reaction) keep today's attribution, since the slow path reveals in time.
11. **Ack evidence.** An Ack and a move, or two Acks, by one seat on both sides of a fork prove misbehaviour; the seat is flagged like an equivocator. A deterrent; the fork rule does not depend on it.

### 5.2 A turn with everyone online (Chain Reaction)
1. E's End turn move M draws position p.
2. Every other client sees M on its chain and publishes an Ack. (One relay round trip.)
3. Each client holding all S−1 Acks sees M final and publishes its share of p in a Shares event. (A second round trip.)
4. E reads its tile, about a second after its move when every window is open and in view; a background tab is throttled.
If any seat is offline, M is not final, nothing is released early, and the shares ride on each seat's next move as today.

### 5.3 The uses
- **U1, a private draw** (Chain Reaction): as above. Grant `{d}`; every other seat owes a public share.
- **U2, a viewer-set draw** (Hanabi: everyone but the owner Q). Q owes a public share, and every other viewer owes a sealed share (§7) to each other viewer. All of them wait for M to be final (Q's included: releasing it inside M itself looks harmless, since only entitled viewers can use it, but it is one more value out before finality, and the model checks the uniform rule). Each viewer opens and reads the card about a second after M.
- **U3, a public reveal of an unknown card** (a Hanabi play): the play move M requests a public reveal; every seat's public share waits for M to be final; then every client derives the reveal (PROTOCOL §6.3). Without finality, D039 returns in a Hanabi form: play, read your own card from the prompt shares, then sign a rival that keeps it (the model's `public` mode, §6).
- **U4, a dice or beacon roll** (GAME-SYSTEMS §4.3, key-committed beacon): the move that schedules the roll is M; the other seats' contributions are released when M is final, so no seat sees a roll before the move that requests it is fixed (the foresight rule). Binding the roll point to M's id as well (`H_i = h2c('roll:' + rootId + ':' + moveId)`) is cheap defence in depth: a contribution released on a rival then says nothing about this branch's roll.

### 5.4 Why it holds (argument; the model checks it in scope)
1. **An honest seat is on at most one side of any fork, ever.** It vouches for a side only while the side is on its chain. Once it holds both sides, it follows a side only if every seat other than the equivocator, itself included, vouched for that side, which it did for at most one side; otherwise it stops. Its event set only grows, so it never returns to the other side.
2. **Prefix relation.** For an honest client's chain L at any time and the final chain F (on all events), one is a prefix of the other. Walk both from the root: where L has one successor and F has several, F either stops (F is a prefix of L) or follows a side every seat but the equivocator vouched for. If that side were not L's, the honest seat that released on L would have vouched for both sides, which 1 forbids. Claims, resigns and natural ends only end a chain where it stands.
3. **S1.** A prompt release for a grant by M happens only when M is final, so every seat vouched for M, every honest seat had M on its chain, and no stop can occur at or below M (M's side is vouched by every seat at every fork below it). So M is on every honest client's final chain F, unless that client's chain ended before M by a claim or resign. But then that client's own seat never vouched for M (its chain ended before M reached it, rule 1 needs a live chain), so M is not final: contradiction. The grant on F equals the grant on L, because grants are append-only along a chain. Foresight: M exists before the release, and its grant is the one on F. Slow-path releases (inside moves) satisfy 2 only: they can be learned past the end of F (post-end), never on F.
4. **S2.** Honest seats never fork, so a stop never names an honest seat. A stop is not a forfeit for anyone but the equivocator. By A3 and rule 7, a stop reaches every honest client before any deadline can pass, and while stopped no seat is stalled; resuming is progress (rule 8). An honest seat waiting for an Ack (rule 10) is never the stalled one.
5. **S3.** The chain, finality, stops and releases are functions of the held events (rule 9 makes stops dominate the order-dependent claim and resign finality at or past the fork). What remains order-dependent is today's claim and resign race below any fork.
6. **The late-Ack and split attacks** need an honest seat to move to the other side, which 1 rules out: the honest seats stop instead, and a late Ack can only resume the side they all vouched for.

### 5.5 Costs
- **Events.** S−1 Acks and up to S−1 Shares events per granting move, each under 1 KB (as fast-reveal.md §6): about 10 extra events per drawing turn at 6 seats.
- **Latency.** Two relay round trips after the move.
- **Consensus change.** Fork stop replaces fork choice, and finality is new: a protocol version bump, every seat on the new client.
- **Policy.** An equivocation inside the vouching window ends the game, unrated. The owner already chose this treatment for multi-seat aborts (owner answers §3.5.1), and the window is seconds online or one round otherwise; past it, equivocation stays a flag and a forfeit at the end.
- **Code** (later, after approval): the Ack kind and parser in `packages/protocol`; vouches, finality, fork stop, the release duty, the stop result and rule 10's attribution in `packages/client`; a quiet duty in the web controller; simulator adversaries for every trace of §6.

## 6. The executable model (`tools/protocol-model`)

### 6.1 What it is
`tools/protocol-model/src/model.ts` explores every ordering of events, within a bound, for 3 seats (4 with options) and every coalition of 1 or 2 seats. It is test tooling only.
- **Game.** Round-robin seats; a move is `draw` or `pass`; the game is over after `length` moves. Grants: `private` (U1), `viewers` (U2) or `public` (U3, U4). Honest seats draw; the adversary picks.
- **Crypto, abstracted.** A value is readable by a set of seats once every seat outside it has released its share to it, publicly or sealed to a member.
- **Adversary.** Signs any move its seats may sign (rivals included, choosing which rival gets the lower id), Acks anything, claims timeouts at any head, resigns naming any head, and delivers every event to each honest client in any order. Honest moves are scheduler steps (the human chooses when). A deadline passes on a client only when honest gossip is complete and no honest seat has a move to make (A3, A5).
- **Checks** at every state where every event has reached every honest client: S1 (with the foresight rule, and post-end breaches reported apart), S2, S3 (the claim race reported apart), and liveness in honest-only runs.
- **Designs:** `v1`, `d039`, `ack` (fast-reveal.md §2), `ack-lock` (fast-reveal.md §5 A and B), `fs` (§4.4) and `fgr` (§5).
- **Exhaustive within the bound,** with states deduplicated by a 64-bit hash of their canonical form (a collision could only prune a state; the odds are about n²/2⁶⁵ for n states, `exactKeys` turns it off). Two reductions, both sound for the properties checked: a move is delivered only after its prev (a pooled move changes nothing until then), and standalone Shares events reach every honest client at once (they change no honest decision, and the adversary sees them at once anyway).

**Run it:** `pnpm model --design fgr --length 4 --moves 3 --traces` (see `src/cli.ts`); `pnpm vitest run --project protocol-model` runs the CI scope; `PROTOCOL_MODEL_BIG=1` adds the larger scope.

### 6.2 Results
**The design matrix** (`pnpm model --length 3 --moves 2 --acks 1 --claims 1 --resigns 0 --expiries 1`): 3 seats, a 3-move game, every coalition of 1 or 2 seats, at most 2 adversary moves (rivals included), one adversary Ack, one adversary timeout claim and one deadline. Each row sums the 6 coalitions; counts are states showing the violation (one attack shows in many states). Every run is complete (the whole bounded space explored).

| Design | Grant | States | Exposure | Post-end | Honest forfeit | Divergence | Claim race |
|---|---|---|---|---|---|---|---|
| v1 | private / viewers / public | 12,617 / 12,377 / 12,617 | 0 | 0 | 0 | 0 | 244 each |
| d039 | private / viewers / public | 17,734 / 18,712 / 22,330 | **240 / 86 / 264** | 0 | 0 | 0 | 288 each |
| ack (no lock) | private / viewers / public | 446,098 / 504,576 / 651,684 | 0 (at this depth; see the late-Ack run) | 0 | 0 | 0 | 943 / 1,397 / 1,397 |
| ack-lock | private / viewers / public | 376,079 / 429,978 / 546,592 | 0 | 0 | **180 / 550 / 550** | **172 / 564 / 564** | 1,051 / 1,859 / 1,859 |
| fs (fork stop, no Acks) | private / viewers / public | 16,508 / 17,896 / 20,544 | 0 | 728 / 420 / 1,408 | 0 | 0 | 100 each |
| **fgr (final, or stop)** | private / viewers / public | 322,480 / 451,619 / 554,329 | **0** | 180 each | **0** | **0** | 319 / 525 / 525 |

**The late-Ack depth** (two colluders and one honest seat, a 6-move game, 6 adversary moves, one Ack): `ack` shows the late-Ack exposure after 2,786 states; `fgr` explores the whole space with **no exposure, honest forfeit or divergence** in every mode (private 1,318,464 states, viewers and public 1,755,552 each; 62,792 and 75,976 post-end states, all from slow-path shares released on sides that a stop later voided).

**Liveness** (honest seats only, every ordering of the humans' moves, synchronous network, a 5-move game): `d039`, `ack`, `fs` and `fgr` reveal every grant to its viewers once the network is quiet, in every mode; `v1` does not (by design: it waits for moves). With one lazy seat that never acks nor shares early (offline between its turns), `fgr` still reveals every grant by the time every other seat has moved after it (the fallback), for every lazy seat and mode.

**CI and the big scope.** `pnpm vitest run --project protocol-model` (about 40 s) runs the regressions of §6.3, the `fgr` sweeps (every mode and coalition at 3 moves; with a claim; with a resign; two colluders at 5 moves and 5 adversary moves) and the liveness runs. `PROTOCOL_MODEL_BIG=1` adds the bigger scope (about 16 minutes on a shared machine), every run complete, all for `fgr`, all with **no exposure, honest forfeit or divergence**:

| Scope | States | Other reports |
|---|---|---|
| Every mode and coalition, 4 moves, 3 adversary moves, an Ack | 297,719 / 598,408 / 813,094 (private / viewers / public) | post-end 188 / 212 / 212 |
| Private, every coalition, 3 moves, 2 adversary moves, an Ack, a claim, a resign, a deadline | 6,523,372 | claim race 8,537; post-end 2,124 |
| 4 seats, every pair of colluders, 4 moves, 2 adversary moves, an Ack, every mode | 30,634 to 75,869 per run | post-end 96 (pair {0,3}) |
| The late-Ack scope: two colluders, 6 moves, 6 adversary moves, an Ack, every mode | 1,318,464 / 1,755,552 / 1,755,552 | post-end only |

A single adversary with 4 seats leaves three honest clients whose delivery orders exceed 4 million states at 4 moves; that scope was not completed.

### 6.3 Regression traces
Each trace is the model's own output, shortened only by omitting `→ seat n` where only one honest seat exists. Move ids name their path: `0d0/1p1` is seat 1's `pass` (variant 1, the higher id) on seat 0's `draw`.

**D039, a lone equivocator (coalition {1}, private).** Seat 0 draws p0. Seat 1 signs `0d0/1d1` (it draws p1) and delivers it; the honest clients release their shares of p1 at once. Seat 1 then signs the lower-id rival `0d0/1p0` (a pass). Every client moves to it, and p1 is now the next tile seat 2 will draw: seat 1 knows it. With public grants, the same trace is a roll seen before re-deciding.
```
seat 0 moves
seat 1 signs 0d0/1d1 → seat 0
seat 1 signs 0d0/1p0 → seat 0
deliver 0d0, 0d0/1d1, 0d0/1p0 to seat 2
⇒ exposure: {1} reads position 1; on the final chain [0d0 0d0/1p0] it is not dealt yet (seat 2 draws it next)
```

**The late-Ack reorg (coalition {0, 1}, honest seat 2, design `ack`).** Seat 2 acknowledges seat 0's draw `…/0d1`, seat 1 withholds its Ack, the lower-id rival `…/0d0` wins fork choice, seat 1 draws on it and seat 2 moves on it, releasing (slow path) its share of the position seat 1 drew. Seat 1's late Ack makes `…/0d1` final and every client returns to it, where that position is the next undealt one, and the coalition knows it.
```
seat 0 signs 0p1;  seat 1 signs 0p1/1p1, then 0p1/1p0;  seat 2 moves (0p1/1p0/2d0)
seat 0 signs …/2d0/0d1 (seat 2 acks it), then the rival …/2d0/0d0
seat 1 signs …/0d0/1d1;  seat 2 moves on it (its move carries its share of position 2)
seat 1 acks …/2d0/0d1   ⇒ exposure: {0,1} reads position 2; the final chain ends at …/0d1, position 2 not dealt yet
```

**Ack implies lock: an honest split (coalition {0}, design `ack-lock`).** Seat 0 signs a pass `0p1` and a draw `0d0`; seat 2 sees the draw first and acknowledges it (locked); seat 1 sees the pass first and moves on it. Neither side can become final, and the lock keeps them apart: seat 1 ends on `0p1/1d0`, seat 2 on `0d0`. When seat 2's deadline passes, it claims a timeout against seat 1, which is waiting on the other side: honest seat 1 is timed out on seat 2's client.

**F8, v1 with a multi-seat Resign (coalition {1}).** Seat 1 signs `0d0/1p1`, a Resign naming it, and the lower-id rival `0d0/1p0`. Seat 2 receives the first branch and the Resign, counts it and stops; seat 0 is on `0d0/1p0`, where seat 2 is to move. Seat 0's deadline passes and it claims: honest seat 2 is timed out on seat 0's client.
```
seat 0 moves;  seat 1 signs 0d0/1p1 → seat 0;  seat 1 resigns naming 0d0/1p1 → seat 2
seat 1 signs 0d0/1p0 → seat 0;  deliver the rest to seat 2
deadline passes for seat 0 at 0d0/1p0;  seat 0 claims   ⇒ honest seat 2 timed out
```
Under `fgr` the same events stop the game at `0d0` on every client (rule 9), with seat 1 last.

## 7. Sealed shares (K5)
Reference implementation: `packages/deck/src/sealed.ts`, codecs in `wire.ts`, tests in `test/sealed.test.ts`, vectors in `test/vectors/sealed-v1.json` (`test/sealed-vectors.test.ts`). **Unused by gameplay** until the owner approves; nothing in `packages/client` or `packages/protocol` imports it.

### 7.1 Construction
Seat k (secret `x_k`, key `X_k = x_k·G`) seals its decryption share of position j (ciphertext `(R, S)`) to seat T (key `X_T`):
- `D = x_k·R`; pick `r`; `A = r·G`, `B = D + r·X_T` (ElGamal encryption of `D` under `X_T`).
- **Proof** of knowledge of `(x_k, r)` with `X_k = x_k·G`, `A = r·G`, `B = x_k·R + r·X_T`: pick `w1, w2`; `T1 = w1·G`, `T2 = w2·G`, `T3 = w1·R + w2·X_T`;
  `c = HS("sealed", rootId, deckId, pos, X_k, X_T, R, S, A, B, T1, T2, T3)`; `s1 = w1 + c·x_k`, `s2 = w2 + c·r`. The proof is `(c, s1, s2)`.
- **Verify:** `T1 = s1·G − c·X_k`, `T2 = s2·G − c·A`, `T3 = s1·R + s2·X_T − c·B`, recompute `c`. Reject the identity for any point, `X_k = X_T`, and scalars outside `[0, q)`.
- **Open:** `D = B − x_T·A`, then decrypt as with any share.
- **Transferable opening:** T publishes `E = x_T·A` with a DLEQ proof (`log_G X_T = log_A E`, label `sealed-open`, bound to the context, `X_k`, `X_T`, `A` and `B`). Anyone computes `D = B − E` and checks it, without k or T online: a passed card can be played by its new owner.
- `HS` is the package's hash to scalar (length-prefixed parts, SHA-256, mod q; PROTOCOL §2). The labels `sealed` and `sealed-open` separate these transcripts from `dleq`, `pok` and `shuffle-*`.
- **Wire:** `{"a", "b", "pos", "proof": {"c", "s1", "s2"}, "to"}` and `{"e", "from", "pos", "proof": {"c", "s"}}`, strict like every deck codec. The sender is the event's signer.

### 7.2 Security argument
- **Completeness:** `s1·G − c·X_k = w1·G`, `s2·G − c·A = w2·G`, `s1·R + s2·X_T − c·B = w1·R + w2·X_T`.
- **Special soundness:** two accepting transcripts with the same commitments and challenges `c ≠ c'` give `x_k = (s1 − s1')/(c − c')` and `r = (s2 − s2')/(c − c')`, satisfying all three equations. So a verified sealed share proves that `B − r·X_T` is exactly `x_k·R`, the sender's decryption share, and that `B − x_T·A = x_k·R` for the recipient (since `x_T·A = r·X_T`). With Fiat–Shamir in the random-oracle model this is a non-interactive proof of knowledge (forking lemma).
- **Zero knowledge:** the transcript is simulated by picking `c, s1, s2` and solving for `T1, T2, T3` (honest-verifier ZK, statistically). The pair `(A, B)` is an ElGamal ciphertext of `D` under `X_T`, so under DDH it hides `D` from everyone but T. A verifier learns nothing about `D` or the card.
- **Binding to the recipient.** `X_T` is in the relation and in the hash. Re-targeting to T' needs a new pair under `X_T'` and a proof of knowledge of `x_k`: only seat k can make one. T, after opening, knows `D` but not `x_k`, so it cannot seal `D` to anyone (tested). It can tell `D` to anyone off-protocol, as any colluder can tell a card.
- **Binding to the position, deck and game.** `pos`, `deckId`, `rootId` and the whole ciphertext `(R, S)` are hashed, and `R` is in the relation: a proof for position j fails at j′, even with j′'s own ciphertext (tested), and in another deck or game.
- **Malleability.** Re-randomizing `(A, B)` to `(A + δ·G, B + δ·X_T)` keeps the plaintext but changes the hashed points, so the proof fails (tested). Swapping fields fails.
- **The opening is not an oracle.** T's transferable opening proves `x_T·A` for an `A` whose discrete log the sender proved it knows, so the sender learns nothing new and everyone else learns only `D`. T MUST open only verified sealed shares: proving `x_T·P` for an arbitrary `P` (say a deck position's `a`) would reveal T's own decryption share of that position.
- **Key reuse.** The deck key is used for decryption shares, sealed-share decryption, and (proposed) the dice beacon. The transcripts are domain-separated; the sealed-share decryption is never exposed as an oracle (above). The adversarial review should confirm the reuse, or the Join gains a separate key (GAME-SYSTEMS §4.3.3 asks the same of the beacon).
- **Timing** is the protocol's business, not the primitive's: a sealed share is readable by T as soon as it is published, so it is a prompt release and falls under §5, rule 5.

## 8. Attacks considered (K6)
Each was tried against "final, or stop", by hand and, where marked, in the model.

| # | Attack | Outcome |
|---|---|---|
| 1 | **D039**: draw, read the prompt shares, sign a lower-id rival | No release before every seat vouches for the draw; once it is final, the rival is evidence only. Model: no exposure. |
| 2 | **Late Ack** (colluder withholds, honest seats move to the rival, Ack arrives later) | Honest seats never move to the rival: the fork stops the game. A late Ack can only resume the side every honest seat already vouched for. Model: no exposure. |
| 3 | **Fake split** (a colluder Acks the rival so that honest seats release their locks) | No locks to release and no fork choice: a split stops. Model: no exposure. |
| 4 | **Honest split** (rivals delivered to different honest seats) | Neither side can be vouched by every seat; the game stops at the fork when the halves meet (A3); the equivocator is last, unrated. Model: no divergence. |
| 5 | **Claim race** (a stalled colluder's move delivered just after one client accepts a claim) | Known v1 residual; the claiming honest seat never vouches past its end, so no prompt release happens past it. Model: claim-race reported, no exposure. |
| 6 | **Resign race and F8** (resign on one branch, rival on another) | Rule 9: a stop dominates a counted resign at or past the fork. Model: no honest forfeit. |
| 7 | **Seat Acks, then goes offline** | The move is final; the offline seat's share is missing; it rides on its next move (slow path). Model (honest-only, lazy seat): no fallback failure. |
| 8 | **Withheld Acks** (a colluder never Acks) | Nothing becomes final; everything falls back to the slow path. A denial of speed, not of safety. |
| 9 | **Relay partition** between honest seats | As 4 if combined with equivocation; otherwise only delay. A partition longer than the deadline breaks A3, as it already breaks today's timeouts. |
| 10 | **Old fork, re-signed late** (void a finished or advanced game) | A side vouched by every seat is never stopped: the rival is evidence (Ruling 5). A stop is possible only inside the vouching window. |
| 11 | **Foresight on a roll or a play** (see the value, then re-decide) | Releases wait for the deciding move to be final; a rival then stops the game or is evidence. Model (`public` mode): no exposure. |
| 12 | **Equivocate after reading a value, to abort** ("draw and quit") | Impossible: nothing is readable before the move is final, and then it cannot be stopped. The equivocator can still stop a game inside the window for no information, like a resign (unrated, last, recorded). |
| 13 | **Ack floods, Acks of unknown or invalid moves** | An Ack counts only for a valid, linked move; caps per seat as for claims (PROTOCOL §8.1). To be specified with the code. |
| 14 | **Shuffle fork and F7** | A shuffle fork stops the setup (cancelled); deal shares wait for the last step to be final. |
| 15 | **Sealed-share misbinding** (retarget, replay at another position, re-randomize) | Rejected by the proof (§7.2, tested). |
| 16 | **Device duplication** (A2) | The duplicated seat is the equivocator: the game stops on it. Its own fault, not a protocol game against it. |

## 9. Residuals and open questions

**Residuals of "final, or stop":**
1. **Post-end learning.** After a stop, slow-path shares released on the stopped sides can combine so that a value never dealt on the final chain becomes readable (the model's `post-end` count). Every such release postdates every move of the final chain, so it cannot change the result. With audit mode `'reveal'` every card is public at the end anyway; with `'none'` (poker) it can show a card that was dealt only on a voided branch.
2. **The claim and resign races** below any fork (PROTOCOL §11), unchanged.
3. **A3** (gossip within the deadline). A relay that withholds a fork's second half from some honest seats for longer than the deadline breaks S2 and S3, as withholding a move breaks today's timeouts.
4. **A2** (key hygiene): one key on two devices stops the game on its owner.
5. **Stopping is griefing-capable** inside the vouching window, like a resign: the equivocator is last, the game unrated, the cheat recorded.
6. **Model limits.** Small scope (3 seats, at most 6 moves, small budgets), abstract crypto, one pending seat per prev, and a game shape (draw or pass) that captures "a rival changes who draws which position" but not every game's mechanics (mergers, several draws per move, out-of-turn decisions; fast-reveal.md §7 point 4). A hash collision could hide a state (odds in §6.1).

**For the independent review, press on:**
- The model's game shape: moves that draw several positions, out-of-turn decisions (merger disposals), and the rival mechanics of fast-reveal.md §7 point 4; deeper scopes with 4 seats.
- Rule 4's "valid-looking" test for game actions whose validity waits on shares (R4), and its cost bounds (the trial folds of PROTOCOL §11).
- Rules 8 and 10 (progress and stall attribution with Acks), which the model covers only through its deadline abstraction.
- The stop result: `standings` at the fork, the Secret phase and partial audit after a stop (Phase G's machinery), and attestations that change when a stop lifts (R12).
- Ack caps and floods (§8, 13), and Ack persistence across devices.

**Open questions for the owner:**
1. Approve "final, or stop" for an independent adversarial review, then for building (protocol version 2)?
2. The policy for an equivocation inside the vouching window: the game stops, unrated, the equivocator last and recorded. Should the equivocator's result count as a rated loss for it alone?
3. Fix F7 in v1 now (never deal twice; or any shuffle fork cancels)?
4. Phase G and F8: count a Resign only when the head it names has no held rival, or wait for rule 9?
5. Roll points bound to the requesting move (U4, defence in depth): adopt when the beacon is built?
