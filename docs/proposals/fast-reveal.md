# Proposal: a fast tile reveal ("acknowledge, then share")

**Superseded as the main document by [`prompt-reveal.md`](prompt-reveal.md) (Phase K, D055),** which keeps the Acks, drops fork choice in favour of fork stop, and closes the late-Ack and honest-split problems described here. This file is kept as history.

**Status: Proposal, not built, and not yet cheat-proof.** Recorded by D042 (2026-10-02). D050 supersedes D042's gate: no prompt duty ships in any game until the prompt-reveal protocol (Phase K, `docs/proposals/prompt-reveal.md`) passes adversarial review; this design is one of K's candidates. The goal is a reveal that no seat, alone or with colluders, can use to expose another player's tile. This design is a candidate for that goal, not an established result:
- The first review (Phase A) found a **late-Ack attack** (§4.2) that breaks the base design (§2).
- The recommended amendments (§5) close that attack as far as we can tell, but leave one case open: **honest splits** (§5.3).
- Nothing here ships until an adversarial review of the design and of its code signs it off (§7).
- It needs a protocol version bump, since it changes fork choice.

## 1. The problem

A seat that draws a tile (Chain Reaction's End turn) owns its bag position at once, but it can read the tile only when every other seat's decryption share for that position is in (PROTOCOL §5.4, §6.4). Today those shares ride on each other seat's next move (§6.2). So in async play a new tile shows "?" for hours; the "?" popover (D042) explains why.

**D039 tried prompt sharing and was reverted.** Every other seat's client published its share in a Shares event (7453) as soon as it saw the draw, with no human action. A share is a value, `D = x·R`, and it is not bound to a branch. So one seat E could, alone:
1. sign branch A on prev `h`, a move that draws position p for E;
2. wait a few seconds for the other clients to share p, and decrypt it;
3. sign a rival B on the same prev, of equal length and with a lower id (D030 tie-break), in which p is dealt to the next drawer N instead.

The rival works because the number of positions a turn consumes depends on its action. A forged `skipPlace` keeps E's hand full, so B draws nothing. A different placement or dead-tile discard changes the draw count. Every client switches to B, so E knows N's tile. N's own share of p went out on branch A, so once the others share p for N on B, everyone can read it. E is caught and ranked last, but the tile is exposed. The owner rejected that residual risk (D039, Reverted).

**Why today's path is safe.** A seat's share of p goes out only inside its own next move. That move builds on branch A and makes A longer than any rival E could sign later. Exposing N's tile then needs honest seats to build on both branches, and they never do. A fast reveal has to keep two properties:
- **No early share for a draw that could still be replaced.**
- **No rule that makes an honest seat build on two branches.** The base design breaks this second property (§4.2).

## 2. The base design

### 2.1 A new event: Acknowledgement
- **Kind:** to be assigned. 7458 is suggested, since 7457 is reserved for Resign.
- **Signed by** the seat's session key, like Moves and Shares.
- **Tags:** `["e", <rootId>, "", "root"]`, `["e", <moveId>, "", "ack"]`, `["proto", "2"]`.
- **Content:** `{"type":"ack"}`.
- Parsed strictly as in PROTOCOL §4 (D027). It is about 400 bytes signed.

By acknowledging a move M, a seat says: "M is on my chain, and I will never acknowledge a move that conflicts with it." Two moves **conflict** when neither is an ancestor of the other.

### 2.2 When an honest seat acknowledges
Seat j publishes an Ack of a game-action move M when all of these hold:
1. M is on j's chain, and j did not sign it.
2. M **draws**: at M's resulting state, `dealt` assigns at least one position to M's signer that it did not hold at M's parent.
3. **Ack consistency:** j has never acknowledged a move that conflicts with M. This is persisted with the seat's game secrets before the Ack is published, like the build-once rule (§6.5).

### 2.3 When an honest seat releases a share
Seat j publishes the shares it owes for the positions M dealt to its signer d (one Shares event, 7453, as today) when all of these hold:
1. j holds valid Acks of M from **every seat other than d**, its own included.
2. M is still on j's chain.
3. **Self-guard:** j never signed or acknowledged a move on a branch where one of those positions was dealt to j itself.

The liveness rule (§6.2) is unchanged: a move must still carry every share its seat owes and has not yet published. A draw whose Acks never complete is therefore revealed on today's path.

### 2.4 Finality
- **Definition.** A game-action move M is **final** for a client when the client holds valid Acks of M from every seat other than M's signer.
- **Fork choice, new first rule.** A branch that does not contain every final move is not a candidate. The existing rules then rank what remains: reaching `over`, then length, then the lowest id (§6.6).
- **Rivals at or below a final move** are never chosen. They are kept and still prove equivocation (§6.6).

**Order independence.** Whether M is final depends only on which Acks a client holds, not on their arrival order. Holding more events can only make more moves final, so the rule is monotone in the event set. Two clients holding the same events pick the same chain.

**What it does not give.** The chain never moves back past a final move. But it can **jump arbitrarily far**, to a branch containing a move that has just become final. When that happens, the head moves back to the end of that branch. Deadlines and timeout claims depend on the head, so they change after the fact. §4.2 shows how a cheater uses this.

**Final moves never conflict while one honest seat exists outside the pair.**
- Suppose two final moves M1 and M2 conflict, signed by s1 and s2. Any seat other than s1 and s2 has acknowledged both, which ack consistency forbids.
- The remaining corner: an honest s1 acknowledged M2, its chain later switched, and s1 signed M1. The self-guard protects s1's own tiles here. It does not stop the switch from costing s1 an equivocation or a timeout, nor the other seats' slow-path shares on the losing branch. The amendments in §5 remove this corner by forbidding the switch (lock).

## 3. A turn when everyone is online
1. E publishes its End turn move M, which draws p.
2. Each other seat's client sees M on its chain and publishes an Ack.
3. Each client that holds all S−1 Acks treats M as final and publishes its share of p for E.
4. E's client holds every share and reads its tile.

This adds two relay round trips: about a second when every window is open and in view. A background tab is throttled by the browser (a minute or more), and a closed window acknowledges when it opens again.

## 4. Analysis of the base design

### 4.1 The single-cheater attack (D039's), everyone online
E signs A, which draws p, then a rival B on the same prev.
- **B is published after A is final.** No client can choose B, since it lies at or below a final move. B is only equivocation evidence.
- **B is published before A is final.** Honest seats that see B first may acknowledge it instead. Each honest seat acknowledges at most one of the two, so with honest seats on both sides, neither branch can collect every Ack, and no early share is released for either. This holds only while no seat's Ack is withheld and released later; see §4.2.

### 4.2 The late-Ack attack (review finding I1): the base design is broken
This needs S ≥ 4 seats: one equivocator E and one colluder k.
1. E publishes A, which draws p. Every honest seat sees A first and acknowledges it. **k withholds its Ack.**
2. E publishes B, a rival on the same prev, with equal length and a lower id. A is not final, because k has not acknowledged it. Every honest chain switches to B, which is the allowed fork-choice outcome.
3. The game goes on along B for hours. Honest seats move on B and, on those moves, publish their slow-path shares for the positions B deals.
4. k acknowledges A. A now has an Ack from every seat but E, so it is final. Every client reorganizes from the long B chain back to A.

The consequences:
- **Tile exposure.** On A, positions go to different seats. Honest seats' slow-path shares for a position on B can be exactly the shares that, together with the shares released on A, make a victim's tile on A readable by everyone. Today a colluder cannot overtake a branch honest seats built on, by length or otherwise; the finality filter lets one late Ack do it.
- **Forced forfeit.** An honest seat that already built once on B now owes a move on A for the same turn. It either equivocates and is flagged, or stalls into a timeout. Either way a cheater makes an honest seat forfeit.
- **Head rewind.** The head jumps back to A's end, which retroactively changes deadlines and timeout claims.
- **Without a colluder, a mild version.** Relay latency alone can let one seat move on B while others already treat A as final.

The flaw is that an honest seat's Ack is irrevocable while its chain is not. §5 binds the two.

### 4.3 Colluders
E and a colluder C. C may acknowledge both A and B. An honest seat H acknowledges only one, so only the branch every honest seat acknowledged can become final. Under the base design, the timing of that finality is the attack in §4.2. Colluders can always show each other their own tiles; that is out of scope, as today (PROTOCOL §11, "Collusion").

### 4.4 Network partitions and offline seats
If any seat is offline, partitioned, or simply has the game closed, its Ack is missing and no share is released early. Play falls back to the slow path (§6.2). Liveness is unchanged: no seat is needed online outside its own turn. Acks and early shares never move a deadline (Ruling 11: they do not change who is stalled). But under the base design the fallback is not "exactly today's safety": a missing Ack that arrives late is the attack in §4.2.

### 4.5 Timeouts, equivocation and the audit
- **Timeouts** (§8): an Ack is not progress. Under the base design, a late finality can move the head back (§4.2). Under §5 it cannot (§5.2).
- **Equivocation** (§6.6) is unchanged: a rival below a final move still flags its signer.
- **The audit** (§7) replays the action log of the chosen chain.

## 5. Mitigations

### 5.1 The candidates
| Candidate | What it does | Verdict |
|---|---|---|
| **A. No early share once a rival is held** | A seat never releases an early share for M while it holds any move that conflicts with M. | Needed, but not enough on its own. It stops early shares from mixing with a rival, but not the reorg, the forced forfeit or the slow-path shares on B (§4.2). **Adopt.** |
| **B. Ack implies lock** | Once seat j acknowledges M, j's own chain (for building, sharing, its head and its timeout claims) keeps M unless a move conflicting with M is final. j never builds on, nor shares on, a branch without M. | Closes §4.2 (see §5.2). Opens honest splits (§5.3). **Adopt, as the core fix.** |
| **C. Ack equivocation is evidence** | Two Acks by one seat of conflicting moves, or an Ack of M plus that seat's own later move on a branch without M, prove misbehaviour. The seat is flagged and forfeits, like move equivocation. | Deters, does not prevent; D039 showed detection is not enough. **Adopt as a deterrent.** |
| **D. Acks carry the acker's head**, and count only when that head is M or a descendant | A colluder signs any head it likes. | Does not help against colluders. Rejected. |
| **E. Finality counts only acks from seats with no conflicting Ack** | Finality is no longer monotone. A colluder acknowledges A, the shares go out, then it acknowledges B: A stops being final and B wins on its lower id, which is D039 again. | Rejected. |
| **F. Ack deadlines** (an Ack counts only if it arrives soon enough) | Needs agreed time. `created_at` is self-reported and local first-seen times differ between clients (§8.1), so finality would depend on arrival times. | Rejected. |
| **G. Cap the reorg depth** (finality ignored past K moves) | Reorgs within K moves still force honest forfeits. | Rejected. |
| **H. Release (veto) events**: a seat publishes that it withdraws an Ack, and a vetoed move never becomes final | Non-monotone, and it races with finality: one seat releases shares on a final move while another vetoes it. | Rejected for now. The review may revisit it with a precise race argument. |

**Recommended: A + B + C on top of §2.** Lock (B) is the change that matters. A and C limit the damage if B has a hole.

### 5.2 Why the lock closes the late-Ack attack
- An honest seat acknowledges M only while M is on its chain (§2.2). With the lock, its chain keeps M from then on.
- So when M becomes final (every non-signer has acknowledged it), every honest non-signer's chain already contains M, and has contained it since its Ack. **Finality never pulls an honest seat off a branch it built on after acknowledging M.**
- An honest seat that built on a rival before ever acknowledging M acknowledges M only if its chain moves to M by today's rules (length, then id). Finality cannot be what moves it, because finality needs that very Ack.
- **In §4.2:** every honest seat acknowledged A, so none of them ever builds on B. The seat after E is the same on both branches.
  - **If that seat is honest,** it builds on A. A outgrows B and wins on length for every client, and k's late Ack changes nothing.
  - **If that seat is k,** k may build on B. The next seat on B is honest and locked, so B stops there, while every honest client sees k stalled on A, claims a timeout, and k forfeits.
  - No honest seat ever moves on B, so no honest slow-path share lands on B.
- **It also removes the §2.4 corner:** an honest s1 that acknowledged M2 never switches away from it, so it never signs a conflicting M1.

### 5.3 Open: honest splits
An honest split happens when E publishes A and B close together, so that some honest seats acknowledge A and others B. Then:
- Neither A nor B can ever become final, because each needs the other side's Acks.
- Without a release rule, the lock keeps honest seats on different branches. The seat after E builds on its own side. Honest seats on the other side see it stalled, and could claim a timeout that clients on its side reject: honest clients diverge.

The game needs a rule that releases a lock in a split. Each one found so far reopens a late-Ack reorg:
- **S1. Release when an Ack of a conflicting move by a seat other than both signers is held.**
  - In a genuine split this resolves the game on today's rules.
  - But a colluder k can fake a split: k acknowledges B while every honest seat acknowledged A.
    - Honest seats release their locks and follow the lower-id B, then build on it.
    - k later acknowledges A as well, A becomes final, and §4.2 recurs.
  - The difference from the base design: k is now caught by C. So the attack needs two cheaters, one of whom forfeits, and a tile can still be exposed. **This is not cheat-proof.**
- **S2. Release with a published veto (H above).** The finality race described in §5.1.
- **S3. Release after a local timeout.** It behaves like S1, since k just waits.

Until the review finds a sound split rule, or shows that S1's residual is acceptable to the owner, the fast reveal is not cheat-proof and must not ship. One narrower fallback the review could consider: on any detected split, every seat stops early sharing for the rest of the game, and the finality filter is suspended for moves at or below the split. That last part is non-monotone, so it needs the same race argument as S2.

## 6. Costs
- **Events.** About 2(S−1) extra small events per drawing turn: S−1 Acks and S−1 Shares events, each under 1 KB. With 6 seats that is about 10 per turn, a few hundred per game.
- **Latency.** One relay round trip more than D039: about a second with everyone online.
- **Code.**
  - `packages/protocol`: a new event kind and its strict parser.
  - `packages/client`:
    - the Ack and release duties;
    - persisted ack consistency and locks;
    - the finality filter in fork choice;
    - a lock-aware head and lock-aware timeout claims;
    - the ack-equivocation evidence.
  - Web controller: a quiet duty and outbox slots, with delivery confirmed by a table relay, as D039 needed.
- **Consensus change.** Old clients do not apply the finality filter or the locks, so this needs a protocol version bump and every seat on the new client.
- **State.** Each seat persists the moves it acknowledged, and every client keeps the Acks it holds.
- **Tests.**
  - Session tests for every case in §4 and §5, including §4.2 with and without the lock.
  - Simulator adversaries:
    - an equivocating drawer;
    - a withholding, late-acknowledging colluder;
    - a fake-split colluder.
  - Fuzzing of arrival orders, to show that clients converge.

## 7. Before it ships: adversarial review
- An adversarial review of this design, and then of its code, is **required** before anything is merged. The reviewer must not be its author, and must aim to expose a tile that no honest rule would reveal, or to make an honest seat forfeit.
- Points to attack first:
  1. **The late-Ack attack (§4.2) under the amendments (§5.2)**, including relay latency without a colluder, and seats that come online after both rivals exist.
  2. **Honest splits (§5.3):** find a release rule that is sound, or show that none exists without an honest-majority assumption.
  3. **Ack consistency across devices:** one session key used from two browsers, or an old backup restored, could acknowledge two conflicting moves.
  4. **Rival mechanics:** enumerate every way, in Chain Reaction, a rival move can change which seat draws a given position: placement or `skipPlace`, dead-tile discards, mergers and disposals, and declaring the end.
  5. **Out-of-turn decisions** (merger disposals) and multi-tile draws.
  6. **Interactions** with the rival shuffle-step rule (§6.6) and with timeout finality (§8.2).
  7. **Denial of service:** Ack floods, Acks of moves never published, Acks of invalid moves.
- The simulator's adversaries (`packages/client/test/adversaries.ts`) gain the attackers above. The review's verdict is recorded in DECISIONS before the feature ships.

## 8. Alternatives considered
- **Prompt sharing without Acks (D039).** Reverted: one seat alone can expose another's tile.
- **A grace delay before sharing.** A deliberate attacker simply waits for the shares.
- **A fork tie-break that favours the earlier rival.** It needs a notion of "earlier" that every client agrees on, which `created_at` cannot give (§11). On its own it does not stop a rival published before the shares.
- **A consensus protocol with an honest-majority quorum** (Tendermint-style lock and release). It resolves splits, but it assumes most seats are honest, which this platform does not (one honest seat must be enough to protect its own tiles).
- **Threshold or verifiable-delay cryptography.** Much more machinery, and it is not clear that it would fix the branch problem, since a share is valid on every branch.
- **Keep the slow reveal** and explain it (done, D042). This stays the shipped behaviour until a design passes review.
