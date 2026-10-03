# Proposal: a prompt reveal that cannot expose a hidden value ("plain stop" with a cutoff)

**Status: Proposal, round 3 (Phase K, D055). Research and design only: nothing here is wired into the session or the protocol.** Round 3 answers the independent review of round 2, which preferred candidate (e) but asked for five changes before it is approved to build: an attestation-and-anchor cutoff in place of "a fork below a finished game voids it", convergence when a timeout and a stop meet (A2), the stale outbox (A3), two devices with a resign (A1) and deeper model runs. They are in §5.1 (rules 5–9, marked) and §6.7. Round 2 answers an independent adversarial review of round 1 (verdicts: the protocol design PARTIAL, the model PARTIAL, sealed shares CONFIRMED with API caveats, F7 CONFIRMED, F8 PARTIAL) and the owner's question, *"are we constraining ourselves with the wrong mechanism?"* It was. The recommended design is now **candidate (e), "plain stop"** (§5): one shared pile, prompt shares with no Acks, and any proven equivocation stops the game as the equivocator's forfeit. Candidate (d), per-seat draw piles, was rejected by the owner (the shared pile must stay exact) and is kept only as a note (§4.5). Round 1's vouch-and-stop design, hardened against the review, is kept as an alternative (§5B) but is no longer needed. The review's text did not reach this author; its four attacks on round 1 are reconstructed from the coordinator's summary and reproduced by the model (§6.4), so a reviewer should check the reconstruction. This document replaces [`fast-reveal.md`](fast-reveal.md) as the main document on prompt reveals; that file stays as history.

**The owner's rule (2026-10-02):** no prompt shares in any game, co-op included, until a cheat-proof protocol exists; everything stays inside the platform and NOSTR (no third parties, owner answers §7 Q2 and Q6). Until the owner approves this design after an independent adversarial review, every game stays turn-piggybacked (PROTOCOL §6.2).

**Verdict, plainly (round 3).** Every exposure the model found needs a game to *continue* on a branch whose hidden values were shared out on a rival branch. To read N's card on rival B, the equivocator E needs every other seat's share for A, so every honest client holds A; any honest client that later sees B holds a fork, which is a signed proof of equivocation. **Candidate (e) stops the game at any held fork** and never picks a branch, so shares can go out the moment the drawing move is held: no Acks, no finality, no consensus. Round 3 adds **the cutoff** (§5.1, rule 6): a result that every seat but E attested, with nothing signed by another seat anchored off it, stands, and a later fork only records E; any other fork stops the game and **overrides a counted claim or resign** (rule 7), so all clients reach the same result from the same events. Round 2's "never override" made clients diverge for good (A2), which its model had filed as the claim race. With **the stop scored as E's rated last place** (rule 5) and **two device rules** (rule 9: the outbox rule and a check of the seat's own events before signing), the model (§6.7) finds **no exposure, honest forfeit, rating gain or divergence** in any explored scope, and with a single adversary **no attested result is ever voided and no counted forfeit is escaped**, including 4 seats at 8 moves with a claim and a deadline. It also shows each round-3 part is needed: without the anchor clause, an exposure; without the forfeiting seat's own attestation, an honest seat timed out; scored as an abort alone, a rating escape; without the device rules, honest forfeits and a 2-seat rating gain. What remains (§9): values read on a stopped branch (with two devices and audit `'none'`, a card and the decisions made with it); with 3 or more seats a coalition can void its member's counted timeout or a finished game while one colluder withholds its attestation (E then takes a rated last place); stops during play are unbounded in time, as a resign is; a seconds-long two-device race; the claim and resign races; the model's limits. It is not a proof.

**Two findings about the shipped protocol v1** came out of the survey (§3); both are fixed outside Phase K:
- **F7, deal-round translation** (review: CONFIRMED). An equivocating last shuffler can read other seats' starting hands from the deal round, because honest clients deal again on the rival deck and a share translates between the two decks (`packages/deck/test/fork-translation.test.ts`). **Fix, in v1:** never deal twice per game, and during the Deal a held shuffle fork stalls the shuffle equivocator.
- **F8, resign plus equivocation** (review: PARTIAL). With Resign allowed in games of 3 or more seats, a seat that resigns on one branch and equivocates can get an honest seat timed out on other clients (the model's v1 trace in §6.3). **Fix: Phase G** (the multi-seat Resign).

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
- **A2, honest seats sign once, per key.** An honest seat signs one move per turn and never Acks two conflicting moves, and it persists both before publishing (build once, PROTOCOL §6.5). **Round 2 no longer relies on it for safety:** session keys are backed up so that a game can resume on another device, so two live devices of one honest seat can each see a different side of a fork. Under (e) the only signed automatic events are Shares and the result attestation, and the risks are a human moving twice on one turn, or a device publishing an old saved move; round 3's device rules (§5.1, rule 9) handle both (§9, question 2). Under §5B, a double vouch stops the game (rule 4) and flags the seat.
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
| R5 | **Timeout claim racing a move** (the claim race, PROTOCOL §11) | no: the claiming client's chain ends early | A share is released on the continuing chain, past the claimant's end. In v1 and D039 the recipient is entitled there (post-end on the claimant's client). | A move past the claimant's end can never be final: the claimant's own honest seat never vouches for it (§5B.4), so no prompt share goes out for it. |
| R6 | **Resign racing a move** (PROTOCOL §8.3) | no | as R5 | as R5 |
| R7 | **Raced game-ending moves** (a mate or an accepted draw against a resign or a claim) | no, unless two endings are signed (R1) | as R5 | as R5 |
| R8 | **Relay withholding, delay, partition** | no, by itself | Only combined with R1 (a split). Withholding alone only delays. | A split is a fork with honest seats on both sides; neither side can become final, so the game stops when the halves meet (A3). |
| R9 | **The finality filter itself** (fast-reveal.md §2.4): a late Ack makes a far-back move final and pulls every chain to it | yes (R1 below it) | **Yes**: the late-Ack reorg | no fork choice to pull: a side is followed only if every seat other than the equivocator vouched for it, which no honest seat on the other side ever does |
| R10 | **One key on two devices, or an old backup** (A2 broken) | a double vouch (Acks or moves on both sides); a double move on one prev is R1 | Round 1: **yes** (review attack 1: both sides fully vouched, lowest id flips the chain). | Round 2: a double vouch stops the game (rule 4) and flags the seat; the device policy (§9) keeps honest seats from doing it |
| R11 | **Resign counted on a branch that later loses** (F8) | R1 plus a Resign | v1 with Phase G's multi-seat resign: an honest seat whose client counted the resign stops moving and is timed out on the other side. | Fixed in Phase G. In round 2 a stop never overrides a counted resign (rule 9); a client that holds the fork stops and claims nothing, so no honest seat is timed out (model, §6.5). |
| R12 | **Interim stops** (this design): a fork is seen before an Ack that makes one side final | no, a pause | | Resuming is safe for S1 (§5B.4). Round 1 timed out a human who left on seeing the stop (review attack 4); round 2's rule 10b gives every claim two deadlines once a fork is held. |

**F7, deal-round translation (v1 today).** The deal (PROTOCOL §6.1, step 3) is a prompt release: every seat shares the other seats' hand positions as soon as the shuffle ends. The last shuffler E signs two rival final steps A and B on the same prev. Both outputs re-encrypt the same input deck, and E keeps both randomizer vectors, so for a card at `A[i]` and `B[j]` E knows `δ = rA_i − rB_j` with `A[i].a = B[j].a + δ·G`. An honest seat's share of `A[i]` then gives its share of `B[j]`: `x·B[j].a = x·A[i].a − δ·X`. In v1 an honest client that dealt on A and is moved to B (a lower id) deals again on B; the web controller rebuilds an orphaned deal on purpose (`game-controller.ts`, "A deal … the session refused … is built anew"). E picks the B permutation so that each seat's B-hand cards were not in its A-hand, translates, and reads every honest seat's B-hand, then plays the whole game knowing them. It is flagged (two shuffle steps) and forfeits at the end, which is exactly the residual the owner rejected for D039. `packages/deck/test/fork-translation.test.ts` checks the algebra. **Fix (in v1, outside Phase K):** never deal twice per game, and during the Deal a held shuffle fork stalls the shuffle equivocator, so the game is cancelled before any hand matters.

**F8, resign plus equivocation (Phase G).** With Resign allowed in 3-seat games, E signs move A and a Resign naming A, and delivers both to honest seat H2 only; it signs a lower-id rival B and delivers it to H1. H2 counts the Resign (final), so it never moves; H1 is on B and waits for H2, then claims a timeout: H2 is timed out on H1's client. The model finds it in v1 (§6.3). **Fixed in Phase G** (the multi-seat Resign). Under round 2 the model finds no honest forfeit from resigns (§6.5).

## 4. Candidate designs (K3)

### 4.1 (a) "Acknowledge, then share" with "ack implies lock", lock release only on an equivocation certificate, and proven equivocation ends the game
The hypothesis: every exposure needs an equivocation, an honest split needs one too, and if a proven equivocation ends the game, any exposure happens only in a game that is already over.

**What holds.** The lemma of §3 confirms the first two parts: every branch switch is at a certified fork, and an honest split is a fork with honest Acks on both sides. Claims, resigns and raced endings never create a fork, so the non-equivocation reorgs of K2 (R5–R8) do not break the hypothesis: they end one client's chain early, and with unanimous finality (§5B.4) no prompt share is ever released past an honest client's early end.

**What breaks, and what fixes it.** "Ends the game" must say *where*.
- **At each client's current head:** heads differ between clients, so results differ (S3), and the side the client was on may be the one that loses, after shares went out on it.
- **At the fork, always:** monotone and deterministic, but a seat can then void any game, even a finished one, by re-signing a move from long ago (the reason Ruling 5 refused rollback), and a final move with prompt shares already out would be voided after the fact (post-end learning everywhere).
- **At the fork, unless one side is final:** this is §5B. A move every seat vouched for can never be voided, so an old rival is only evidence (as Ruling 5 has it), and the window in which an equivocation can stop the game closes as soon as the move is final (seconds online, one round otherwise).

The lock is no longer needed as a separate rule: with no fork choice, an honest seat never switches sides, which is what the lock was for, and a split simply stops. The "lock release on certificate" also disappears: the certificate ends the game unless a side is final, and a final side needs the vouch of every honest seat, which only one side can have.

**Attacks on the literal (a)** (the model's `ack-lock` design keeps fork choice under the lock): an honest split leaves honest clients locked on different sides (`divergence`), and the seat locked on the other side looks stalled and is timed out (`honest-forfeit`); see §6.

### 4.2 (b) Reveals gated on a unanimous Ack certificate, deterministic finality
Release only on a move with Acks from every other seat; fork choice keeps every final move. Finality is monotone in the event set, so clients agree. **Alone it fails:** finality jumps (R9). The model finds the late-Ack reorg with one honest seat and two colluders (§6.2): the honest seat Acks A, the colluder withholds, a lower-id rival B wins fork choice, the honest seat moves on B and its slow-path share of a later position goes out, then the late Ack makes A final, every client returns to A, and on A that position is dealt to the honest seat. Adding the lock gives (a). Adding fork stop gives §5.

### 4.3 (c) Per-mechanic fallbacks
- **Draw-ahead** (GAME-SYSTEMS §4.1.8): draw at the end of the previous turn, so the turn-piggybacked path is in time. No protocol change, no new risk; a rules variant, logged per game as OPEN.
- **The reveal rides on the next action:** a decide-then-roll or on-demand draw waits for the next seat's move (+1 async round).
- **Hanabi with 3 or more seats** has no fallback of this kind: a viewer must see a new card before its next turn, and the sealed shares it needs come from seats that move after it. It needs prompt releases (§5) or waits for every seat to be online.

These remain the shipped behaviour until the owner approves §5, and stay the fallback inside it.

### 4.4 Fork stop without Acks (`fs` in the model)
Prompt shares as in D039, but a fork with no side vouched by every other seat (by moves alone) stops the game. **No exposure** in the model: a value learned on a side that loses is learned only past the end of the final chain. But many **post-end** breaches: the equivocator can still read the value its own rival discards (it draws, reads the tile, then stops the game by equivocating), and a roll can be seen before a stopped decision. Acks remove those (§5).

### 4.5 (d) Fix ownership first (rejected by the owner)
Per-seat draw piles cut from the shuffled deck would make each position's owner the same on every branch, so a share could never reach the wrong seat. The model found it exposure-free, but **the owner rejected it: the shared draw pile must stay exact, because too many games depend on it.** It is not modelled further, and the `pile` design was removed from the model. Its insight survives in (e): what matters is that no game continues on a branch where a leaked value matters.

### 4.6 Frameworks considered
- **t-of-n threshold decryption** (a card opens with any t of n shares): faster (it waits for the quickest t seats), but any t colluding seats can open anything, including other players' hands. This platform must protect one honest seat against all the others, so t = n, which is what we have.
- **zk-shuffles and SNARK poker** (zkShuffle-style, Groth16 or PLONK circuits): smaller proofs and cheaper verification on chain, but heavier to prove on a phone, a trusted setup or large circuits, and they do not touch the problem: a decryption share is still a value released on a branch that can lose.
- **Chain finality** (post moves to a blockchain or any ordering service): it ends reorganisations, but it is a third party, which the owner excludes (owner answers §7 Q6).
- **General MPC, TEEs, time-lock puzzles and VDFs:** MPC between the seats is the same unanimity problem with more rounds; TEEs trust a hardware vendor (a third party); time-lock and VDFs cost minutes of phone CPU and are grindable (GAME-SYSTEMS §4.3.2), and none of them fixes who a released share is for.

Conclusion: the ElGamal deck with DLEQ shares and verifiable shuffles is the right primitive. What constrained us was the order of operations: releasing a share and then letting the game continue on a branch where that share's owner differed.

## 5. The recommended design: plain stop with a cutoff (candidate (e), round 3)

### 5.1 Rules
Round 3 changes are marked. They answer the review of round 2 (A1–A3 and the cutoff, §6.7).
1. **One shared pile, unchanged.** Draws come from the shared pile exactly as the game's rules say; `dealt` is unchanged.
2. **Prompt release.** When a client holds and validates (PROTOCOL §6.5) a move that grants a position, it releases at once, in a Shares event, every share its seat owes for it: a public share, or sealed shares (§7) within the viewer set. No Ack, no wait. The slow path (shares riding on one's own move, PROTOCOL §6.2) stays as the fallback for a seat that is offline.
   - **The anchor** *(round 3)*. Every Shares event, and so every prompt-share release, carries its releaser's head as an `e` tag: the chain the releaser was on when it released. A move is anchored on its prev, and a result attestation on the result's head.
3. **Rolls** bind their point to the requesting move: `H = h2c('roll:' + rootId + ':' + moveId + ':' + n)` (GAME-SYSTEMS §4.3). Contributions go out at once.
4. **Fork stop.** A held fork (two valid-looking moves signed by one seat E on one prev, an equivocation certificate) **stops the game at that prev**, unless a result stands against it (rule 6). Fork choice is gone: no branch is ever picked, and the game never resumes. Shuffle steps count when well-formed.
5. **The stop is E's forfeit.** In a 2-seat game it is a rated win for the opponent. With 3 or more seats *(round 3)*, **E takes a rated last place and is recorded, and the game is unrated for every other seat**: the owner's abort policy (D052), plus E's rated loss. Round 2 scored it as the abort policy alone; once a stop can override a counted timeout (rule 7), that lets a timed-out seat turn its rated last place into an unrated abort by forking at its own head (the model's `void-forfeit`, §6.7). Scoring the stop as E's timeout at the fork (rated last, the others by standings there) closes it too, but lets E choose the position the others are rated at. Before the first game action the game is cancelled.
6. **The cutoff** *(round 3; replaces round 2's "a fork found below a finished game's end voids it")*. A *result* is a natural end, a counted timeout claim or a counted resign. An honest client publishes a result attestation (PROTOCOL §4.8, naming the result's head by its log hash) as soon as it has a result **and holds no fork**. A result X **stands** against a fork by E when:
   - (a) **every seat other than E attested X**, including the forfeiting seat of a claim or resign (unless that seat is E);
   - (b) **no seat other than E signed a move, a Shares event or a result attestation anchored on another side of the fork from X**: on a head that is neither on X's path (the moves from the root to X's head) nor past X's head; and
   - (c) no other result meets (a) and (b).

   Events past X's head (a device that played on before it saw a resign) do not block X: the values they concern were granted after X's end, so any read of them is post-end (§2.2). Attestations count like Shares events *(round 3, after the battery)*: otherwise a seat's two devices that each attested a result on a different side let the side with no Shares event on the other stand over that device's counted claim or resign (a 2-seat `rating` gain, §6.7). The first wording of (b), "a move or Shares event anchored off X's path", left attestations out and also counted events past X's head.

   Then the fork only records E: the result is unchanged and nobody forfeits. Otherwise the fork stops the game (rule 4). The cutoff counts every attestation a seat signed, not only its latest (PROTOCOL §7 keeps the latest by `created_at`, which a seat sets itself), so a later attestation cannot withdraw an earlier one. Like every rule here it is a function of the held events: no clock, no grace period.
7. **A stop overrides any counted claim or resign that does not stand** *(round 3; replaces round 2's "a stop never overrides a counted claim or resign")*. Round 2's rule let clients diverge for good (A2, §6.7): a client that counted a timeout against C keeps it, while a client whose deadline had not passed when C forked stops, and their attestations never match. Under rules 6 and 7 every client reaches the same result from the same events: the claim if it stands, the stop otherwise.
8. **Gossip (A3).** Clients rebroadcast every move they hold (both events of any fork, at least) to the root's relays, so a fork reaches every honest client before any deadline can pass.
9. **Devices** *(round 3; client rules, documented here, built in v1 work after approval)*:
   - **The outbox rule (A3 of the review).** A saved (outbox) move is published only if its prev is the device's current head once it has synced with the relays, and the relays show no other move by its seat on that prev. Otherwise it is dropped. A move signed offline on a tablet and played differently on a phone is then never published weeks later.
   - **Check before signing.** Before signing a move, a device fetches its seat's own events (moves, claims, attestations and Shares events) from the relays, with the moves they build on and the claim or resign an attestation names, and acts on what it then holds. A client counts its own seat's timeout claims made on another device, and adopts a claim or resign result its own seat attested. With attestations in the anchor clause (rule 6(b)) the rule is no longer needed for safety in the model: without it, one device can count the opponent's timeout while the other plays on, and the two devices of one seat end on different results with no fork held (the claim race, between one seat's devices). Under the first wording of rule 6(b) it was needed (a `rating` gain for the opponent in a 2-seat game, §6.7).

Rules 6 and 9 need no new event kind: the result attestation exists (PROTOCOL §4.8), but it must be published as soon as the result is known, before the Secret phase, and it must be accepted from a seat's session key or its npub on any device. It needs a protocol version bump (fork stop replaces fork choice).

### 5.2 Why it is safe
- **The leak is never played on.** To read a value through D039, a coalition needs every honest seat's share of it, released on branch A. Each of those honest clients holds A. A rival B that would give the value a different owner is a fork with A: every honest client that sees B stops (rule 4), and A3 makes sure they all see it before a deadline. Honest seats never make a move on B after holding A, so the game the leak would affect is never played; it ends at the fork, as the equivocator's forfeit. Every value read this way was released past the end of the final chain (post-end, §2.2).
- **A standing result exposes nothing** *(round 3)*. An honest release is anchored on its releaser's head, and the grant it serves is on the path to that head. If the anchor is on X's path, the grant is on X's path; if it is past X's head, the value was granted after X's end (post-end, §2.2); otherwise it is on another side of the fork, and by rule 6(b) X cannot stand. So everything a coalition read from honest seats before X's end was granted on X's path. This holds for any coalition and any number of devices. Without the anchor clause it fails: a seat's second device attests side B while its first device released a share on side A, and B stands (an `exposure` in the model, §6.7).
- **What a single adversary can no longer do** *(round 3)*. An honest client attests only a chain with no fork, and its own anchors all lie on that chain or past its end. So once every honest seat has attested X from one device each, no honest event is anchored on another side, and with one equivocator X stands forever: E's later forks only record E. A seat's second device that saw E's rival first may have released a share there, which keeps X from standing (§9, residual 4). The window in which E can still stop a finished game is the time until every honest client has reached the end and attested, at most one deadline after the end (A3). During play a stop remains possible at any time, as a resign is.
- **An honest seat that never saw A** (a second device, a partitioned client) may move on B until A reaches it. Its moves lie past the fork, so they are voided by the stop, and its shares on B go to B's owners. Nothing it does on B survives, and its anchors on B keep any result on A from standing.
- **No branch is picked by the protocol.** A result stands only when every seat but E attested it and no seat but E acted off it; picking a side by any other test (a finished side, the lowest id) lets a coalition play out a rival with what it read on the other side (the model finds exposures, §6.4 and §6.7).
- **Ratings.** The stop is E's rated loss (rule 5). A lone timed-out seat that forks to void its counted timeout gets the same rated last place. In a 2-seat game nothing changes the result in E's favour. With 3 or more seats, a coalition can still void a colluder's counted timeout (residual 2, §9).
- **S3.** Stops, standing results and overrides are functions of the held events (rules 4, 6 and 7). What remains order-dependent is the claim and resign race with no fork held (PROTOCOL §11), unchanged.
- **Liveness.** With every seat online a value is readable about one relay round trip after the move; with a seat offline, by the viewer's next turn (slow path). Nothing waits forever, and there is no interim stop to resume from.

### 5.3 The uses, with one shared pile
- **U1, a private draw (Chain Reaction).** The drawn tile's other shares go out as soon as the End turn move is held; the drawer reads it about a second later.
- **U2, a viewer-set draw (Hanabi).** The owner's public share and the other viewers' sealed shares to each other (§7) go out at once. A rival that would put the card in another hand is a fork: stop.
- **U3, a public reveal of an unknown card (a Hanabi play).** Every seat's public share of the played card goes out at once. An equivocator who plays, reads its own card and plays something else instead stops the game on itself.
- **U4, dice.** Contributions to a roll bound to the requesting move go out at once; a re-roll needs a rival move, which is a provable forfeit.

### 5.4 The reviews' attacks under (e)
1. **One key on two devices.** No votes exist. A second device that never saw A may play on B, but the moment A surfaces every client stops at the fork; the leak is never played on. Model (two devices per honest seat, every coalition): no exposure. A human moving twice on one turn is prevented by rule 9 (check before signing), except within the seconds a move takes to reach the relays.
2. **A stop as a rating escape:** the stop is E's rated loss (rule 5). Model: no rating gain.
3. **Voiding a counted timeout or resign:** round 2 never overrode one, which diverged (A2). Round 3 overrides unless the result stands, and scores the stop as E's rated last place, so a lone seat gains nothing. Model: no rating gain or `void-forfeit` for a single adversary; a coalition can (residual 2).
4. **Resurrection after a stop:** there is no resume. Honest humans who leave on a stop are never timed out (model, with `absence`).
5. **Scapegoat abort.** With 3 or more seats E can stop the game during play at any of its earlier turns, as an unrated game for the others and a rated last place for itself. After the end, a single E can do so only until every other seat has attested (rule 6). A colluder who never attests keeps a finished game open to its partner's fork (residual 2).
6. **Round 2's A1, two devices and a resign.** Under round 2 one device froze on the resign while the other kept releasing shares, so a card of an ended game was read (an `exposure`). Under round 3 the resign stands only if every seat but the equivocator attested it and nothing by another seat is anchored off it; in A1's trace the honest seat's second device moved past the resign's head, so it does not stand, the fork stops the game on every client (no divergence), and the card is one read on a stopped branch (post-end, residual 1).
7. **Round 2's A3, the stale outbox.** A tablet's move saved offline and rebroadcast weeks later forks its own seat: under round 2 it voided the finished game as that honest seat's forfeit. Under round 3 the result stands if every other seat attested it, but the honest seat is then recorded as an equivocator; rule 9's outbox rule drops the saved move instead. Model: honest forfeits and honest seats recorded without the rule, none with it.

### 5.5 Complexity, compared with "final, or stop" (§5B)
| | (e) plain stop with a cutoff | final, or stop (§5B, round 2) |
|---|---|---|
| New event kinds | none (the result attestation exists) | Ack |
| Automatic signed events per move | 0 (shares are values, not votes); one attestation per seat at the end | S−1 Acks, debounced |
| Prompt latency | one relay round trip | two |
| Fork rule | any held fork stops, unless a result stands (rule 6) | follow the side every other seat vouched for, unless two are, or a seat vouched for two |
| Extra rules | the anchor tag, the cutoff, two device rules | vouch, finality, double-vouch flags, two deadlines after a fork, Hanabi stall attribution for missing Acks |
| Multi-device | a device checks its own seat's events before signing; the outbox rule | also automatic Acks from two devices (needs a device policy) |
| Model state space | complete at 4 seats with single adversaries and 8 moves (§6.7) | did not complete at 4 seats |
| Old forks | during play, any equivocation stops; after the end, only until every other seat attested | a side every seat vouched for is never stopped |
| Claims after a fork | the cutoff decides, on every client alike | round 2's rule 9 diverges as (e) round 2 did (A2, §6.7) |

### 5.6 Costs
- **Events:** up to S−1 Shares events per granting move (as D039), each with one more tag; one result attestation per seat, published at the result. No Acks.
- **Latency:** one relay round trip after the move.
- **Policy:** any proven equivocation during play ends the game as the equivocator's forfeit; after the end, only before every other seat attested.
- **Code** (after approval): fork stop, the cutoff and the stop result in `packages/client` (replacing fork choice); the anchor tag on Shares events in `packages/protocol`; the prompt share duty, the early attestation, the outbox rule and the check before signing in the web controller; the roll binding when the beacon is built; rebroadcast of held moves; simulator adversaries for every trace of §6.

## 5B. The alternative: final, or stop (round 2)
Kept as the alternative to (e), and the place to start if the owner wants a bounded window for equivocation stops during play (§5.5). Round 2 hardened it against the review; it gets no further model work while (e) holds. **Round 3:** its rule 9 ("a stop never overrides a counted claim or resign") diverges exactly as round 2's (e) did (A2, §6.7); it would need (e)'s cutoff and override (§5.1, rules 6 and 7).

### 5B.1 Rules (round 2; the changes from round 1 are marked)
1. **Ack (new kind, 7458 suggested).** `{"type":"ack"}` with tags `["e", <rootId>, "", "root"]`, `["e", <moveId>, "", "ack"]`, signed by the seat's session key, strictly parsed. An honest client acks **every move** on its chain that it did not sign *(round 2; round 1 acked only moves with a prompt duty)*, once its chain is live (not over, stopped or frozen). An Ack of a move vouches for all its ancestors, so a client acks the head when it has been stable for a moment (debounced, about a second), not every move of a burst. It never Acks a move that conflicts with one its seat signed or acknowledged, and it persists the Ack before publishing (A2). Acking every move, Chess included, closes the window in which an equivocation can stop the game to seconds when the seats are online.
2. **Vouch.** Seat k vouches for move M if it signed M or a descendant of M, or published an Ack of M or of a descendant of M. A function of the event set.
3. **Final.** M is final when every seat vouches for it (its signer by signing it). Monotone, except that a later double vouch (rule 4) can still stop the game below it; then every value released for M is post-end (§2.2).
4. **Fork stop (replaces fork choice).** From the root, follow the unique valid-looking successor. At a prev P with two or more (signed by the pending seat E, an equivocation certificate):
   - follow a side only if **exactly one** side is vouched for by every seat other than E **and no seat vouched for two sides**; E is flagged (forfeits at the end, as Ruling 5);
   - otherwise the game **stops at P** *(round 2: round 1 picked one side, by lowest id, when several were vouched for, which a seat on two devices turned into an exposure, review attack 1)*.
   - **A seat that vouched for two sides is flagged as an equivocator** too *(round 2)*.
   Shuffle steps count as successors when well-formed (no proof check needed to stop).
5. **Prompt release.** An honest client releases a share it owes for a grant made by M outside its own moves (a Shares event: public shares, sealed shares §7, roll contributions, public-reveal shares, deal shares) only when M is final, on its chain, and the chain is live.
6. **Slow path, unchanged.** A move carries every share its seat owes as of the head (PROTOCOL §6.2). It needs no finality.
7. **Gossip** (A3). Clients rebroadcast both events of any fork they hold, and the game events they hold, to the root's relays.
8. **Progress** (Ruling 11, extended). An event that starts or ends a stop, or makes a move final in a way that changes the stalled set, is progress. Acks are otherwise not progress.
9. **A stop never overrides a counted claim or resign** *(round 2; round 1 let a stop at or below the head override it, which let a timed-out seat void its loss by forking at its own head, review attack 3)*. The review proposed overriding only for forks strictly below the head; the model shows that still lets a colluder void a counted timeout (§6.4, attack 3b), so round 2 drops the override. A client that counted a claim or resign keeps it; a client that had not, and holds the fork, stops. The two disagree like the existing claim and resign races (PROTOCOL §11), and neither ranks an honest seat last.
10. **Stalls, for games that need prompt reveals to proceed** (Hanabi with 3 or more seats): when the pending decision needs a value that is not readable yet, the stalled seats are those missing an Ack of the granting move, and once it is final, those missing a release. Games that do not need them (Chain Reaction) keep today's attribution, since the slow path reveals in time.
   - **10b, two deadlines after a fork** *(round 2)*. Once a client holds a fork on its chain, a claim there counts only after two full deadlines, and a client that resumes from a stop notifies its human at once. A human who saw "game over" on a stop and left is then back in time (review attack 4). The review's version (only the first claim against the seat pending at the stop) depends on which client saw the stop, which other clients cannot know: the model finds the absent seat timed out by a client that never stopped. Keying the rule to "a fork is held" is a function of the events. Cost: after an equivocation, timeouts in that game take twice as long.
11. **The stop is the equivocator's forfeit** *(round 2)*, scored like E's timeout at P: in a 2-seat game a rated win for the opponent; with 3 or more seats, the owner's abort policy (unrated, the aborter recorded, as for a multi-seat Resign, D052). A stop never leaves E better off than losing on time. Before the first game action the game is cancelled, as today.
12. **Vouch evidence.** An Ack and a move, or two Acks, by one seat on both sides of a fork prove misbehaviour (rule 4 flags it).

### 5B.2 A turn with everyone online (Chain Reaction)
1. E's End turn move M draws position p.
2. Every other client sees M on its chain and publishes an Ack. (One relay round trip.)
3. Each client holding all S−1 Acks sees M final and publishes its share of p in a Shares event. (A second round trip.)
4. E reads its tile, about a second after its move when every window is open and in view; a background tab is throttled.
If any seat is offline, M is not final, nothing is released early, and the shares ride on each seat's next move as today.

### 5B.3 The uses
- **U1, a private draw** (Chain Reaction): as above. Grant `{d}`; every other seat owes a public share.
- **U2, a viewer-set draw** (Hanabi: everyone but the owner Q). Q owes a public share, and every other viewer owes a sealed share (§7) to each other viewer. All of them wait for M to be final (Q's included: releasing it inside M itself looks harmless, since only entitled viewers can use it, but it is one more value out before finality, and the model checks the uniform rule). Each viewer opens and reads the card about a second after M.
- **U3, a public reveal of an unknown card** (a Hanabi play): the play move M requests a public reveal; every seat's public share waits for M to be final; then every client derives the reveal (PROTOCOL §6.3). Without finality, D039 returns in a Hanabi form: play, read your own card from the prompt shares, then sign a rival that keeps it (the model's `public` mode, §6).
- **U4, a dice or beacon roll** (GAME-SYSTEMS §4.3, key-committed beacon): the move that schedules the roll is M; the other seats' contributions are released when M is final, so no seat sees a roll before the move that requests it is fixed (the foresight rule). Binding the roll point to M's id as well (`H_i = h2c('roll:' + rootId + ':' + moveId)`) is cheap defence in depth: a contribution released on a rival then says nothing about this branch's roll.

### 5B.4 Why it holds (argument; the model checks it in scope)
1. **No side is followed with an honest seat on both sides.** A side is followed only if no seat vouched for two sides. An honest seat on one device vouches for a side only while it is on its chain, and once it holds both sides it stops (it vouched for at most one, so neither can be vouched by every seat but E); a seat on two devices may vouch for both, but then rule 4 stops. Event sets only grow, so a client never returns to a side it left.
2. **Prefix relation.** For an honest client's chain L at any time and the final chain F (on all events), one is a prefix of the other. Walk both from the root: where L has one successor and F has several, F either stops (F is a prefix of L) or follows the one side vouched for by every seat but E with no double vouch. If that side were not L's, the honest seat that released on L would have vouched for both sides, which is a double vouch and a stop. Claims, resigns and natural ends only end a chain where it stands.
3. **S1.** A prompt release for a grant by M happens only when M is final, so every seat vouched for M and every honest seat had M on its chain. M is then on every honest client's final chain F unless (a) F stops below M, which needs a later double vouch: every release for M then lies past the end of F (post-end); or (b) that client's chain ended before M by a claim or resign, in which case its own seat never vouched for M (rule 1 needs a live chain), so M is not final: contradiction. Grants are append-only along a chain, so the grant on F is the one the release was for. Foresight: M exists before the release. Slow-path releases satisfy 2 only: they can be learned past the end of F, never on F.
4. **S2.** Honest seats never sign two moves on one prev, so a stop never names an honest seat as E (a seat on two devices can be flagged, §9). By A3 and rule 7 a fork reaches every honest client before any deadline can pass; while stopped no seat is stalled; and rule 10b gives a human who left on a stop a full notified deadline to return. Rule 9 never removes a counted forfeit, so no claim against an honest seat is created by a stop elsewhere.
5. **Ratings.** A stop is E's forfeit (rule 11), and no stop overrides a counted claim or resign (rule 9), so no stop leaves E or its coalition better off than a forfeit.
6. **S3.** The chain, finality, stops and releases are functions of the held events. What remains order-dependent is today's claim and resign race, now also between a client that counted a claim or resign and one that stops at a fork below it (rule 9).
7. **The late-Ack and split attacks** need an honest seat to move to the other side, which 1 rules out: the honest seats stop instead, and a late Ack can only resume the side they all vouched for.

### 5B.5 Costs
- **Events.** Acks of every move, debounced to the head (rule 1): about S−1 Acks per burst of moves, so per turn in Chain Reaction (a turn's place, buy and End turn arrive together), and one Ack per move in Chess (about 80 extra events of about 400 bytes in a 40-move game, roughly 32 KB). Plus up to S−1 Shares events per granting move. At 6 seats, about 10 extra events per drawing turn, as fast-reveal.md §6 estimated.
- **Latency.** Two relay round trips after the move.
- **Deadlines.** After an equivocation, claims in that game need two deadlines (rule 10b).
- **Consensus change.** Fork stop replaces fork choice, and finality is new: a protocol version bump, every seat on the new client.
- **Policy.** An equivocation inside the vouching window stops the game, as E's forfeit (rule 11). The window is about a second when every seat is online (every move is acked), and one round otherwise; past it, equivocation stays a flag and a forfeit at the end.
- **Code** (later, after approval): the Ack kind and parser in `packages/protocol`; vouches, finality, fork stop, flags, the release duty, the stop result and rules 10 and 10b in `packages/client`; a quiet, debounced Ack duty and the device policy (§9) in the web controller; simulator adversaries for every trace of §6.

## 6. The executable model (`tools/protocol-model`)

### 6.1 What it is
`tools/protocol-model/src/model.ts` explores every ordering of events, within a bound, for 3 seats (4 with options) and every coalition of 1 or 2 seats. It is test tooling only.
- **Game.** Round-robin seats; a move is `draw` or `pass`; the game is over after `length` moves. Grants: `private` (U1), `viewers` (U2) or `public` (U3, U4). Honest seats draw; the adversary picks.
- **Crypto, abstracted.** A value is readable by a set of seats once every seat outside it has released its share to it, publicly or sealed to a member.
- **Adversary.** Signs any move its seats may sign (rivals included, choosing which rival gets the lower id), Acks anything, claims timeouts at any head, resigns naming any head, and delivers every event to each honest client in any order. Honest moves are scheduler steps (the human chooses when). A deadline passes on a client only when honest gossip is complete and no honest seat has a move to make (A3, A5).
- **Checks** at every state where every event has reached every honest client: S1 (with the foresight rule, and post-end breaches reported apart), S2, S3 (the claim race reported apart), and liveness in honest-only runs.
- **Designs:** `v1`, `d039`, `ack` (fast-reveal.md §2), `ack-lock` (fast-reveal.md §5 A and B), `fs` (§4.4), `fgr` (§5B as of round 1), `fgr2` (§5B, round 2), `stop` (candidate (e) as of round 2) and `stop3` (candidate (e), round 3, §5). Candidate (d)'s `pile` design was removed after the owner rejected per-seat piles.
- **Round-2 options:** two devices per honest seat sharing one key, with independent delivery and a device policy (`devices`, `ackDevice`: `all`, `first`, `checked`, §9); moves that draw two positions (`multiDraw`); humans who leave when their client shows a stop and return one deadline after being notified (`absence`); and which stops may override a counted claim or resign (`rule9`).
- **Round-2 checks:** `rating` (a stop, or a stop that overrides a counted claim or resign, leaves the equivocator or its coalition better off than a forfeit; a 2-seat game is rated, and with 3 or more seats a timeout is rated while a resign or a stop is an unrated abort with the aborter recorded) and `honest-flagged` (an honest seat vouched for two sides). An honest seat timed out by a client after its own client accepted a claim against someone else is the existing claim race and is reported as such.
- **Round-3 options and checks** (`stop3`): result attestations (an honest client attests its result once it has one and holds no fork; the adversary attests any valid result, `advAttests`), Shares events anchored on their releaser's head (and attestations on the result's head), the stop's scoring (`stopScore`: `abort`, `timeout` or `last`), the device check before signing (`ownCheck`), stale outboxes (`stale`: a device signs its move offline, its human plays that turn again on another device, and the saved move is published later; `outboxRule`: the controller rule), and three regression variants of the cutoff (`cutoff: 'attest'` drops the anchor clause; `cutoff: 'path'` is its first wording, which counts moves and Shares events past the result's head but not attestations; `exemptLoser` does not ask a claim's or resign's forfeiting seat to attest). With `ownCheck`, a device also adopts a claim or resign its own seat attested. Results are scored per seat. New checks: `attested-void` (a result every honest seat attested, and no honest seat attested another, is not the final result on some honest client; a 2-seat result that becomes the equivocator's loss is fine) and `void-forfeit` (with 3 or more seats, a stop voids a coalition seat's counted timeout or resign and leaves a coalition seat with another score than the same or a rated last place). **S3 is stricter:** a difference between honest results while some honest client holds a fork is a `divergence`; only a difference with no fork held is the claim race. Round 2 filed both as the claim race, which hid A2.
- **Exhaustive within the bound,** with states deduplicated by a 64-bit hash of their canonical form (a collision could only prune a state; the odds are about n²/2⁶⁵ for n states, `exactKeys` turns it off). Two reductions, both sound for the properties checked: a move is delivered only after its prev (a pooled move changes nothing until then), and standalone Shares events reach every honest client at once (they change no honest decision, and the adversary sees them at once anyway).

**Run it:** `pnpm model --design stop3 --stop-score last --own-check --mode private,roll --length 4 --moves 3 --traces` (see `src/cli.ts`); `pnpm vitest run --project protocol-model` runs the CI scope; `PROTOCOL_MODEL_BIG=1` adds the larger scope.

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

**Round 1's big scope** (the `fgr` runs below are now part of `PROTOCOL_MODEL_BIG=1`; CI runs the round-2 and (e) scopes of §6.5 and §6.6): the bigger scope (about 16 minutes on a shared machine), every run complete, all for `fgr`, all with **no exposure, honest forfeit or divergence**:

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

### 6.4 Round 2: the review's attacks on round 1
Reconstructed from the coordinator's summary of the review (its text did not reach this author). Each is a CI regression against `fgr` (round 1), and each is gone in `fgr2` (round 2).

**Attack 1, one key on two devices (coalition {0, 2}; honest seat 1 on devices 1a and 1b).** Seat 0 signs a pass `0p1` and a draw `0d0` (the lower id). Device 1b sees the pass first and acks it; device 1a sees the draw first and acks it, and seat 2 acks both. Device 1a releases its share of position 0, which the draw dealt to seat 0, once the draw is final. Both sides are now vouched for by every seat but seat 0, and round 1 picks one of them (the model breaks the tie by length, then lowest id, as fork choice does): it follows the pass, on which device 1b drew position 0 for seat 1. The coalition reads seat 1's tile. Round 2 stops instead (a double vouch), and flags seat 1: the device-policy question of §9.
```
seat 0 signs 0p1 → 1b;  seat 2 acks 0p1;  seat 0 signs 0d0 → 1a;  seat 2 acks 0d0;  1b moves on 0p1
deliveries …   ⇒ fgr: exposure (position 0 read by {0,2}, seat 1's on the final chain)
               ⇒ fgr2: stop at the root, seat 1 flagged, no exposure
```

**Attack 2, a stop as a rating escape (2 seats, coalition {0}).** Seat 0 signs two rivals on the root: round 1 stops the game unrated, which beats a rated loss. Round 2 scores the stop as seat 0's forfeit (rule 11).

**Attack 3, voiding one's own timeout (coalition {1}).** Seat 1 is stalled at `0d0`; seat 2's deadline passes and it accepts a claim (seat 1 times out, a rated last place). Seat 1 then signs two rivals on `0d0`: round 1's rule 9 lets the stop at the claim's own head override the timeout, so the game becomes an unrated abort. Round 2 never overrides (rule 9).
```
seat 0 moves;  seat 1 acks 0d0;  deadline passes for seat 2 at 0d0 (claim)
seat 1 signs 0d0/1p1, then 0d0/1p0   ⇒ fgr: rating (the stop voids seat 1's counted timeout)
```

**Attack 3b, the review's proposed fix (rule 9 "strictly below the head") is not enough (coalition {0, 1}).** Seat 1 is timed out at `0p1` on seat 2's client. Seat 1 then acks `0p1`, seat 0 signs a rival `0p0` at the root, and seat 1 builds on it: seat 1 vouched for both sides, so the game stops at the root, strictly below the claim's head, and the stop overrides seat 1's counted timeout. Hence round 2's rule 9: never override.
```
seat 0 signs 0p1;  deadline passes for seat 2 at 0p1 (seat 1 timed out);  seat 1 acks 0p1
seat 0 signs 0p0;  seat 1 signs 0p0/1p1   ⇒ fgr2 with rule9 = strict: rating (stop at the root voids the timeout)
```

**Attack 4, absence after a stop (coalition {0}, humans may leave).** Seat 0 signs a draw `0d1` and a pass `0p0`. Seat 2's client sees both before the side it is on is fully vouched for, shows a stop, and its human leaves. A late Ack resumes play with seat 2 to move; seat 1's client never stopped, its deadline passes, and it times seat 2 out. Round 2's rule 10b: once a fork is held, every claim needs two deadlines, and the resuming client notifies its human, who is back in time. (Keying the rule to "the client resumed", as first proposed, fails exactly here: seat 1's client never resumed.)
```
seat 0 signs 0d1, 0p0 → seat 2 … seat 1 moves …  seat 2 sees the stop and leaves
the side resumes;  deadline passes for seat 1;  seat 1 claims   ⇒ fgr: honest seat 2 timed out
```

### 6.5 Round 2 results for the fallback (`fgr2`)
Every run complete; **no exposure, honest forfeit, rating gain, flagged honest seat or divergence** (other than the claim and resign races):
- every mode and coalition, 3 moves, 2 adversary moves, an Ack, a claim and a deadline: 464,863 / 746,426 / 861,416 states (private / viewers / public); claim race and post-end only;
- every coalition, 4 moves, 3 adversary moves, multi-draw: 1,278,091 states (private) and 2,702,846 (viewers); post-end only;
- two colluders at the late-Ack depth with a claim (6 moves, 5 adversary moves): 942,375 states, post-end only (with `rule9 = strict`, the same scope shows the rating flip of attack 3b);
- the review's attacks (§6.4), multi-draw, absent humans with two deadlines, resigns, and two devices per honest seat: in CI. With two devices, the `all` and `first` policies produce flagged honest seats (no exposure); `checked` produces none.
- 4 seats with a single adversary did not complete (over 6 million states at 3 moves), because every move is acked; the largest completed is 2 moves (546,909 states for seat 0).

### 6.6 Results for candidate (e) as of round 2 (`stop`)
**Round 3 correction:** round 2's model filed any difference involving a client that had counted a claim or resign as the claim race, even while another client held a fork. Under round 3's stricter S3 (§6.1), every `stop` and `fgr2` scope below with a claim or a resign shows `divergence`: A2 (§6.7). The "no divergence" claims of this section hold only for the scopes without claims or resigns.

Every run complete unless marked; **no exposure, no honest forfeit, no rating gain and no divergence** other than the claim and resign races. `post-end` (values read on a stopped branch) and `ended-void` (residual 2 of §9: a stop below an end, with 3 or more seats) are reported apart.

| Scope (design `stop`, rule 9 = never override) | States | Reported |
|---|---|---|
| 3 seats, 3 moves, 2 adversary moves, every coalition, private / viewers / public / roll (CI) | about 1,000 per mode | post-end, ended-void |
| 3 seats, claims, resigns and a deadline, every coalition, private / viewers / public / roll | 324,210 / 372,014 / 432,138 / 427,458 | claim race, post-end |
| 3 seats, 4 moves, 3 adversary moves, multi-draw, a claim, a resign, a deadline, every coalition: private / viewers / public / roll | 6,149,535 / 5,819,864 / 8,858,592 / 8,818,896 | claim race, post-end, ended-void |
| 4 seats, 4 moves, 2 adversary moves, **every coalition of 1 or 2 seats, single adversaries included**, private / viewers / public / roll | 15,484 / 49,297 / 65,913 / 62,621 | post-end, ended-void |
| 4 seats, the same with a claim and a deadline, private | 1,419,099 | claim race, post-end, ended-void |
| The late-Ack scope (6 moves, 6 adversary moves) with a claim, every colluder pair | 2,119,022 | post-end, ended-void |
| Two devices per honest seat, a claim and a deadline, colluder pairs | complete (CI) | post-end |
| Two devices per honest seat, single adversaries (four honest devices) | over 17 million states: **not completed** (no violation in the part explored) | |
| Absent humans, two deadlines, 4 moves, every coalition | 38,554 | claim race, post-end, ended-void |
| 2 seats, 4 moves, 3 adversary moves, a claim, a resign | 12,960 | post-end only (no ended-void: a 2-seat stop is a rated loss) |
| Liveness, honest seats, every mode, with and without a lazy seat | small | none: every grant readable once the network is quiet |

**The owner's sketch, as written, fails two checks** (both CI regressions): with a stop allowed to override a counted claim at forks strictly above its head, a colluder voids a counted timeout (`rating`, 3 seats, 389 states); and with "a finished side stands", a coalition finishes its rival after reading on the other side (`exposure`, two colluders at 5 moves). Hence rules 4 and 6 of §5.1.

### 6.7 Round 3: candidate (e) with the cutoff (`stop3`)
**Regressions first** (each a CI test):
- **A2.** `stop` and `fgr2`, coalition {1}, 3 moves, a deadline: seat 2's deadline passes and it counts seat 1's timeout at `0d0`; seat 1 then signs `0d0/1p1` and `0d0/1p0`, and seat 0, whose deadline had not passed, stops. Results `stop:0d0` and `claim:0d0` forever: a `divergence`. Under `stop3` the stop overrides the timeout on every client.
  ```
  seat 0 moves;  deliver 0d0 to seat 2;  deadline passes for seat 2 at 0d0 (claim)
  seat 1 signs 0d0/1p1, then 0d0/1p0;  deliver both, and seat 2's claim, to seat 0
  ⇒ stop: divergence (seat 0 stop:0d0, seat 2 claim:0d0);  stop3: stop:0d0 on both
  ```
- **The stop scored as an abort alone** (3 seats): the same trace turns seat 1's rated last place into an unrated abort (`void-forfeit`, 7,296 states over the three single adversaries of the scope below). Scored as E's rated last place (`last`) or E's timeout at the fork (`timeout`): none.
- **The cutoff without the anchor clause** (`cutoff: 'attest'`, coalition {0, 2}, honest seat 1 on two devices): seat 0 signs a pass `0p1` to device 1b and a draw `0d0` to device 1a, which releases its share of position 0; on `0p1`, 1b draws position 0 and seat 2 finishes the game; 1b and seat 2 attest the end, which stands: `exposure`. With the anchor clause, 1a's share anchored on `0d0` keeps it from standing, and the game stops.
- **The cutoff without the forfeiting seat's attestation** (`exemptLoser`, coalition {0, 1}): seat 1 claims a timeout against seat 2 at `0p1/1p1` and attests it, seat 0 forks at the root, and the claim stands with no honest attestation: `honest-forfeit`.
- **A3, the stale outbox** (2 or 3 seats, honest seats on two devices): device 0b saves `0d1` offline, 0a plays `0d0`, and 0b publishes later: the game stops on honest seat 0's fork (`honest-forfeit`), or after the end is recorded against it (`honest-flagged`). With the outbox rule: no violation.
- **Two devices and a claim** (2 seats, coalition {1}): device 0b counts seat 1's timeout at `0d0`; seat 1 signs two rivals on `0d0`; device 0a, which never saw the claim, plays on one of them to the end and attests; the end stands over the counted timeout (`rating`). With the check before signing, 0a fetches its seat's claim first and ends there: no violation.
- **A1** (`stop`, coalition {0, 1}, honest seat 2 on two devices, a resign): `exposure` and `divergence` under round 2's rule; under `stop3`, post-end only.

**Results.** Design `stop3`, an adversary attestation, the check before signing; every run complete. Counts are states showing the report, summed over the coalitions. The three-seat runs used `timeout` scoring, the CI and the 4-seat runs `last`; for a single adversary the two give the same reports (a lone E's voided forfeit becomes E's own rated last place under both, and an attested result stands under both), and the private row was also run with `last` (identical) and with `abort` (7,296 `void-forfeit` states).

| Scope (3 seats unless marked) | States | Single adversaries | Coalitions of two |
|---|---|---|---|
| 3 moves, 2 adversary moves, a claim, a resign, a deadline: private / viewers / public / roll | 1,474,578 / 1,718,260 / 1,949,332 / 1,932,260 | claim race, post-end, ended-void | `void-forfeit`, `attested-void`, post-end |
| 4 moves, 3 adversary moves, multi-draw, a claim, a resign, a deadline (private) | B2_STATES | B2_SINGLE | `void-forfeit`, `attested-void`, ended-void, post-end |
| 2 seats, 4 moves, 3 adversary moves, a claim, a resign, a deadline | 51,274 | post-end only | |
| Absent humans, 4 moves, two deadlines, a claim | 115,462 | claim race, post-end, ended-void | `void-forfeit`, `attested-void`, post-end |
B5_ROWS
**Never reported anywhere:** `exposure`, `honest-forfeit`, `rating`, `divergence`, `honest-flagged`. **Never for a single adversary:** `attested-void`, `void-forfeit`. `ended-void` with a single adversary is a stop below an end that not every honest seat had attested yet, the window of §5.2. `void-forfeit` and `attested-void` with two colluders are residual 2 (§9).

## 7. Sealed shares (K5)
Reference implementation: `packages/deck/src/sealed.ts`, codecs in `wire.ts`, tests in `test/sealed.test.ts`, vectors in `test/vectors/sealed-v1.json` (`test/sealed-vectors.test.ts`). **Unused by gameplay** until the owner approves; nothing in `packages/client` or `packages/protocol` imports it.

### 7.1 Construction
Seat k (secret `x_k`, key `X_k = x_k·G`) seals its decryption share of position j (ciphertext `(R, S)`) to seat T (key `X_T`):
- `D = x_k·R`; `A = r·G`, `B = D + r·X_T` (ElGamal encryption of `D` under `X_T`).
- **Hedged nonces** *(round 2)*: `r, w1, w2 = HS("sealed-nonce", "seal", i, x_k, rootId, deckId, pos, X_k, X_T, R, S, z)` for i = 0, 1, 2, with 32 fresh random bytes `z`; the opening's `w` likewise (label `"open"`, over `x_T` and the whole opening context). A broken or repeating random source cannot repeat a nonce across statements or secrets (tested with an all-zero source); a good one keeps the nonces unpredictable. The package's older proofs (`dleq.ts`, `pok.ts`, `shuffle.ts`) still draw nonces from the random source alone: a follow-up listed in D055.
- **Proof** of knowledge of `(x_k, r)` with `X_k = x_k·G`, `A = r·G`, `B = x_k·R + r·X_T`: `T1 = w1·G`, `T2 = w2·G`, `T3 = w1·R + w2·X_T`;
  `c = HS("sealed", rootId, deckId, pos, X_k, X_T, R, S, A, B, T1, T2, T3)`; `s1 = w1 + c·x_k`, `s2 = w2 + c·r`. The proof is `(c, s1, s2)`.
- **Verify:** `T1 = s1·G − c·X_k`, `T2 = s2·G − c·A`, `T3 = s1·R + s2·X_T − c·B`, recompute `c`. Reject the identity for any point, `X_k = X_T`, and scalars outside `[0, q)`.
- **Open** *(round 2: one call)*: `openAndVerify(x_T, X_k, ct, sealed, ctx)` verifies the sealed proof against the recipient's own key and returns `D = B − x_T·A`, or null. The bare `B − x_T·A` is not in the module at all *(round 3: `openSealedShare` was removed, so the unverified path is not API)*.
- **Transferable opening** *(round 2: guarded and bound)*: `proveOpening(x_T, X_k, ct, sealed, ctx, rnd)` verifies the sealed share first and throws if it does not verify, then publishes `E = x_T·A` with a DLEQ proof (`log_G X_T = log_A E`), label `sealed-open`, bound to the context, `X_k`, `X_T`, the whole ciphertext `(R, S)`, `A`, `B` and the sealed proof's challenge `c`. `verifyOpening` checks the sealed share and the opening together and returns `D = B − E`. Anyone reads `D` without k or T online: a passed card can be played by its new owner.
- `HS` is the package's hash to scalar (length-prefixed parts, SHA-256, mod q; PROTOCOL §2). The labels `sealed` and `sealed-open` separate these transcripts from `dleq`, `pok` and `shuffle-*`.
- **Wire:** `{"a", "b", "pos", "proof": {"c", "s1", "s2"}, "to"}` and `{"e", "from", "pos", "proof": {"c", "s"}}`, strict like every deck codec. The sender is the event's signer.

### 7.2 Security argument
- **Completeness:** `s1·G − c·X_k = w1·G`, `s2·G − c·A = w2·G`, `s1·R + s2·X_T − c·B = w1·R + w2·X_T`.
- **Special soundness:** two accepting transcripts with the same commitments and challenges `c ≠ c'` give `x_k = (s1 − s1')/(c − c')` and `r = (s2 − s2')/(c − c')`, satisfying all three equations. So a verified sealed share proves that `B − r·X_T` is exactly `x_k·R`, the sender's decryption share, and that `B − x_T·A = x_k·R` for the recipient (since `x_T·A = r·X_T`). With Fiat–Shamir in the random-oracle model this is a non-interactive proof of knowledge (forking lemma).
- **Zero knowledge:** the transcript is simulated by picking `c, s1, s2` and solving for `T1, T2, T3` (honest-verifier ZK, statistically). The pair `(A, B)` is an ElGamal ciphertext of `D` under `X_T`, so under DDH it hides `D` from everyone but T. A verifier learns nothing about `D` or the card.
- **Binding to the recipient.** `X_T` is in the relation and in the hash. Re-targeting to T' needs a new pair under `X_T'` and a proof of knowledge of `x_k`: only seat k can make one. T, after opening, knows `D` but not `x_k`, so it cannot seal `D` to anyone (tested). It can tell `D` to anyone off-protocol, as any colluder can tell a card.
- **Binding to the position, deck and game.** `pos`, `deckId`, `rootId` and the whole ciphertext `(R, S)` are hashed, and `R` is in the relation: a proof for position j fails at j′, even with j′'s own ciphertext (tested), and in another deck or game.
- **Malleability.** Re-randomizing `(A, B)` to `(A + δ·G, B + δ·X_T)` keeps the plaintext but changes the hashed points, so the proof fails (tested). Swapping fields fails.
- **The opening is not an oracle** *(round 2: enforced by the API, not by the caller)*. `proveOpening` refuses any sealed share that does not verify, so it only ever proves `x_T·A` for an `A` whose discrete log the sender proved it knows: the sender learns nothing new and everyone else learns only `D`. A forged "share" whose `A` is a deck position's `a` (which would publish T's own decryption share of that position) is refused (tested). Binding the opening to `(R, S)` and to the sealed challenge `c` ties it to exactly one verified sealed share: a second sealed share of the same position to the same recipient, or the same pair under another ciphertext, does not accept it (tested).
- **Key reuse.** The deck key is used for decryption shares, sealed-share decryption, and (proposed) the dice beacon. The transcripts are domain-separated; the sealed-share decryption is never exposed as an oracle (above). The adversarial review should confirm the reuse, or the Join gains a separate key (GAME-SYSTEMS §4.3.3 asks the same of the beacon).
- **Timing** is the protocol's business, not the primitive's: a sealed share is readable by T as soon as it is published, so it is a prompt release: under §5 it may go out at once only for a position whose viewer set is fixed, and otherwise falls under §5B, rule 5.

## 8. Attacks considered (K6)
Rows 1–16 were tried against "final, or stop" (§5B), by hand and, where marked, in the model; rows 17–25 against candidate (e) as of round 2; rows 26–33 against round 3 (§5.1 as amended).

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
| 16 | **Device duplication** (A2) | Round 2: any double vouch stops the game and flags the seat; the device policy (§9) keeps honest seats out of it. Model: no exposure under any policy; flags only without the `checked` policy. |
| 17 | **(e) D039** (draw, read the prompt shares, sign a lower-id rival) | Every honest client holds the draw, so the rival is a held fork: stop, the equivocator's forfeit. Model: no exposure. |
| 18 | **(e) Late-Ack reorg and honest splits** | No Acks and no fork choice: any fork stops. Model (late-Ack depth, every coalition): no exposure, no divergence. |
| 19 | **(e) Re-roll by equivocating** | A rival move has its own roll point, and is a forfeit. Model (`roll`): no exposure. |
| 20 | **(e) Read one's own card through a played rival** (Hanabi) | The rival stops the game on the player. Model (`public`): no exposure. |
| 21 | **(e) Claim and resign races** with prompt shares | Unchanged from v1; a stop never overrides a counted claim or resign. Model: claim race only, no exposure or honest forfeit. *Round 3: with a fork held this diverges (row 26).* |
| 22 | **(e) A colluder voids a counted timeout** with a fork below its head | Possible if a stop may override a claim at forks strictly above its head (the owner's sketch); closed by never overriding (round 2's rule 6). Model: regression. *Round 3 overrides again, but only where the result does not stand, and scores the stop as E's rated last place (rows 26, 27, 29).* |
| 23 | **(e) "A finished ending stands"** | Picking a branch: a coalition finishes its rival after reading on the other side. Model: exposure (regression). Not adopted. |
| 24 | **(e) Void a finished game** by re-signing an old move (3+ seats) | Works: an unrated, recorded abort after the end (`ended-void`). Owner question (§9). |
| 25 | **(e) One key on two devices** | A device that never saw A plays on B until A surfaces, then the game stops; the leak is never played on. Model: no exposure. A human moving twice on one turn is an equivocation (§9). |
| 26 | **A2: timeouts disagree across clients** (round 2's rule 6: one client counted C's timeout, C forks, a client whose deadline had not passed stops) | Round 2: a `divergence` for good, hidden in round 2's model as the claim race (`stop` and `fgr2`). Round 3: the cutoff decides from the events (rules 6 and 7), so every client agrees. Model: no divergence. |
| 27 | **A timed-out seat forks at its own head** to turn its rated timeout into an unrated abort (3+ seats), now that a stop overrides | Works if a stop is scored as the owner's abort alone (`void-forfeit`). Closed by scoring the stop as E's rated last place (rule 5). Model: no `void-forfeit` for a single adversary. |
| 28 | **Void a finished game after the end** (a single equivocator) | Only until every other seat has attested; then the fork only records E. Model: no `attested-void` for a single adversary. |
| 29 | **A colluder never attests**, so its partner's later fork can still void a finished game or the colluder's counted timeout (3+ seats) | Works (residual 2): E is rated last and recorded, the others are unrated. Model: `void-forfeit` and `attested-void` with coalitions only. |
| 30 | **The cutoff without the anchor clause** ("every seat but E attested" alone): a seat's second device attests side B while its first released a share on side A | B stands and the coalition reads a tile that is the honest seat's on B: `exposure` (regression). The anchor clause blocks it. |
| 31 | **The cutoff without the loser's attestation**: two colluders claim a timeout against the honest seat, attest it, and fork | The claim stands with no honest attestation: `honest-forfeit` (regression). The forfeiting seat must attest too (rule 6(a)). |
| 32 | **A3: a stale outbox** (a tablet's offline move, played differently on the phone, rebroadcast weeks later) | Without the controller rule: the honest seat's own fork stops the game or records it as an equivocator (model: `honest-forfeit`, `honest-flagged`). With the outbox rule (rule 9): none. |
| 33 | **Two devices and a claim** (one device counts the opponent's timeout, the other plays on after the opponent's late move; the opponent forks) | Without the check before signing, the finished side stands over the counted timeout: a `rating` gain in a 2-seat game. With it (rule 9), and a client counting its own seat's claims: none. |

## 9. Residuals and open questions

**Residuals of candidate (e), round 3:**
1. **Values read on a stopped branch** (post-end, §2.2). An equivocator, or a coalition, can read values released before its fork surfaced: its own draw, or a card that would have gone to another seat on the rival. The game stops at the fork as the equivocator's forfeit, so nothing is played with them. With audit `'reveal'` every card is public at the end anyway. With audit `'none'` (poker) a card of the voided deal becomes known; with one device per seat no honest player ever saw or played that card, but **with two devices (the review's A1)** an honest player's second device may have played on the voided branch with it, so the coalition learns a card and the decisions made with it. One active device per seat per game (question 2) removes that part.
2. **Coalitions with 3 or more seats.** A colluder that never attests keeps a finished game open to its partner's fork, and the coalition can void a colluder's counted timeout before it stands (§8, row 29). The partner E takes a rated last place and is recorded; the others are unrated. The model reports these as `void-forfeit` and `attested-void`, with coalitions only.
3. **Stops during play are unbounded in time.** While the game is live, a seat can fork at any of its earlier turns, as it could resign. After the end, a single equivocator has until every other seat attested, about one deadline (A3).
4. **Two devices.** The check before signing leaves a race of seconds (both devices sign before either's move reaches the relays). Shares and attestations are automatic on every device, so a seat's second device acting on the other side keeps an attested result from standing; the stop is then E's forfeit (harmless in a 2-seat game; with 3 or more seats the others' result becomes unrated).
5. **The claim and resign races** with no fork held (PROTOCOL §11), unchanged.
6. **Assumptions.** A3: every held move, and every fork, reaches every honest client within the deadline (honest clients rebroadcast). New, **A6**: the relays a device queries before signing return its own seat's published events (at least one honest relay among the root's relays).
7. **Model limits:** small scope, abstract crypto, one pending seat per prev, a draw/pass game shape, hash compaction (§6.1), attestations delivered to every honest client at once (sound for the checks: they only matter at a fork, where an honest client makes no move, share or claim), and the review's round-1 attacks are reconstructed.

**For the independent review, press on:**
- The cutoff's safety argument (§5.2) and rule 6(c) (several standing results stop the game).
- Rule 4's "valid-looking" test for a rival whose validity waits on shares (R4): a stop may come late, when the shares that make the rival valid arrive.
- The stop's scoring per game (`standings` at the fork, the Secret phase and partial audit after a stop, Phase G's machinery).
- Out-of-turn decisions (merger disposals), several draws per move, mid-game reshuffles.

**Open questions for the owner:**
1. **A1's leak in games with audit `'none'`** (residual 1): accept it, or require one active device per seat per game in those games? Recommendation: require it for audit-`'none'` games (poker), accept it elsewhere, where every card is public at the end anyway.
2. **Multi-device policy.** Round 3 needs two client rules (§5.1, rule 9): the outbox rule and the check before signing. Options beyond them: (i) one designated playing device per seat per game, others view-only until handed over (a signed "this device now plays" note); (ii) the two rules alone. Recommendation: (ii) everywhere now, (i) for audit-`'none'` games.
3. **Should a stop ever be time-limited beyond the cutoff?** Recommendation: no. After the end the cutoff already closes the window once every other seat attested. During play a stop is like a resign; any further limit needs clocks (which diverge across clients) or Acks (§5B).
4. **How a stop scores with 3 or more seats** (rule 5): (a) E rated last and recorded, the game unrated for the others (recommended: the owner's abort policy plus E's rated loss); (b) E's timeout at the fork, the others rated by standings there (E then chooses the position the others are rated at); (c) the abort policy alone (unrated for all), which the model shows reopens a rating escape for a timed-out seat.
5. Approve candidate (e) as amended in round 3 for another independent adversarial review, then for building as protocol version 2?
6. Roll points bound to the requesting move (U4): adopt when the beacon is built?

**Residuals of the alternative §5B** (round 2), for the record: post-end learning when a later double vouch stops the game below a final move; two deadlines for claims after any fork; honest seats on two devices can be flagged unless one device acks and every device checks the seat's own published events before acting (the model's `checked` policy).
