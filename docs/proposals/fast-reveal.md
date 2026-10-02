# Proposal: a cheat-proof fast tile reveal ("acknowledge, then share")

**Status: Proposal, not built.** Recorded by D042 (2026-10-02). It needs an adversarial review of the protocol and of the code before it ships, and a protocol version bump, since it changes fork choice.

## 1. The problem

A seat that draws a tile (Chain Reaction's End turn) owns its bag position at once, but reads the tile only once every other seat's decryption share for that position is in (PROTOCOL §5.4, §6.4). Today those shares ride on each other seat's next move (§6.2), so in async play a new tile shows "?" for hours. The game screen explains why (the "?" popover, D042).

**D039 tried prompt sharing and was reverted.** There, every other seat's client published its share in a Shares event (7453) as soon as it saw the draw, with no human action. A share is a value, `D = x·R`, that is not bound to a branch, so one seat E could, alone:
1. sign branch A on prev `h`, a move that draws position p for E;
2. wait a few seconds for the other clients to share p, and decrypt it;
3. sign a rival branch B on the same prev, of equal length and with a lower id (D030 tie-break), in which p is dealt to the next seat N instead.

Every client switches to B, so E knows N's tile. Worse, N's own share of p went out on branch A, so once the others share p for N on B, all S shares are public and everyone can read N's tile. E is caught (two signed moves on one prev) and ranked last, but the tile is exposed. The owner rejected that residual risk (D039, Reverted).

**Why the old path is safe.** Before D039, a seat's share of p went out only inside its own next move, which builds on branch A and makes A longer than any rival E could sign later. Exposing N's tile then needed honest seats to build on both branches, which they never do. A fast reveal has to keep that property: **no honest seat releases a share for a draw that could still be replaced by a rival.**

## 2. The design

### 2.1 A new event: Acknowledgement
- **Kind:** to be assigned (7458 suggested; 7457 is reserved for Resign).
- **Signed by** the seat's session key, like Moves and Shares.
- **Tags:** `["e", <rootId>, "", "root"]`, `["e", <moveId>, "", "ack"]`, `["proto", "2"]`.
- **Content:** `{"type":"ack"}`.
- Parsed strictly as in PROTOCOL §4 (D027). It is about 400 bytes signed.

An Ack by seat j of move M says: "M is on my chain, and I will never acknowledge a move that conflicts with it." Two moves **conflict** when neither is an ancestor of the other.

### 2.2 When an honest seat acknowledges
Seat j publishes an Ack of a game-action move M when all of these hold:
1. M is on j's chain (fork choice selects it), and j did not sign it.
2. M **draws**: `dealt` assigns, at M's resulting state, at least one position to M's signer that it did not have at M's parent. Moves that draw nothing need no Ack, which keeps the volume down.
3. j has never signed an Ack of any move that conflicts with M. This **ack consistency** is persisted with the seat's game secrets before the Ack is published, like the build-once rule (§6.5), so a reload cannot forget it.

### 2.3 When an honest seat releases a share
Seat j publishes the shares it owes for the positions M dealt to its signer d (one Shares event, 7453, exactly as today) when all of these hold:
1. j holds valid Acks of M from **every seat other than d** (its own included).
2. M is still on j's chain.
3. **Self-guard:** j never signed or acknowledged a move on any branch where one of those positions was dealt to j itself. (This only matters if every other seat colludes; see §4.3.)

Nothing else changes for shares. The liveness rule (§6.2) stays: a move must still carry every share its seat owes and has not yet published, so a draw whose Acks never complete is revealed exactly as it is today.

### 2.4 Finality
- **Definition.** A game-action move M is **final** for a client when the client holds valid Acks of M from every seat other than M's signer.
- **Fork choice, new first rule.** A branch that does not contain every final move is not a candidate. The existing rules (reaching `over`, then length, then the lowest id, §6.6) rank the candidates that remain.
- **Rivals at or below a final move** are never chosen. They are kept and still prove equivocation (§6.6), so their signer is flagged and forfeits at the end as today.

**Order independence.** Whether M is final depends only on which Ack events a client holds, never on the order they arrived in, and holding more events can only make more moves final (the rule is monotone in the event set). Fork choice was already a function of the event set; with a filter that is itself a function of the event set, it still is. Two clients holding the same events pick the same chain, and as events arrive the final prefix only grows, so the chain never moves back past a final move.

**Final moves never conflict while one honest seat exists outside the pair.** Suppose two final moves M1 and M2 conflict, signed by s1 and s2. Each needed an Ack from every seat other than its signer. Any seat that is neither s1 nor s2 therefore acknowledged both, which ack consistency forbids, so every such seat is dishonest. With three or more seats, two conflicting final moves therefore need every seat other than s1 and s2 to collude. The remaining corner, an honest s1 that acknowledged M2 before its chain switched and it signed M1, is covered by a deterministic tie-break (prefer the final move with the lower `seq`, then the lower id), which keeps fork choice a function of the event set, and by the self-guard (§2.3), which keeps that honest seat's own tiles private whatever the chain does. The adversarial review must check this corner first (§6).

## 3. A turn when everyone is online
1. E publishes its End turn move M (it draws p).
2. Each other seat's client sees M on its chain and publishes an Ack (2.2).
3. Each client that holds all S−1 Acks treats M as final and publishes its share of p for E (2.3).
4. E's client holds every share and reads its tile.

Two extra relay round trips: about a second when every window is open and in view. A background tab is throttled by the browser (a minute or more), and a closed window acknowledges when it opens again.

## 4. Analysis

### 4.1 The single-cheater attack (D039's)
E signs A (drawing p), then a rival B on the same prev.
- **B is published after A is final** (every other seat acknowledged A, so shares may already be out). No client can ever choose B: it lies at or below the final move A. B is only equivocation evidence. E's tile on A is its legitimate tile; N's tile on B is never dealt.
- **B is published before A is final.** Some honest seats may see B first and acknowledge it instead. Each honest seat acknowledges at most one of the two (ack consistency), so neither branch can collect every Ack: **no share is released for either**. Fork choice picks between them by the existing rules, and the draw is revealed on the slow path, by shares on moves, with exactly today's (pre-D039) safety.
- **Grinding ids, timing B, or withholding it** changes nothing above: E cannot make an honest seat acknowledge both branches, and without every Ack nothing is shared.

### 4.2 Colluders
E and a colluder C. C may acknowledge both A and B. An honest seat H acknowledges only one, so only the branch H acknowledged can become final, and B (which deals p to N) can be final only if every honest seat, N included, acknowledged B and not A. Then A was never final, nobody released a share of p for E, and N's tile is safe. Colluders can always show each other their own tiles; that is out of scope, as today (PROTOCOL §11, "Collusion").

If every seat but N colludes with E: A needs N's Ack. If N acknowledged A, N never acknowledges B, so B never becomes final, A is final, and the chain contains A for every client. N's tile on B is never dealt. If N's chain had switched away from A before A became final, N released nothing for A (rule 2.3.2), and N's own tiles are protected by the self-guard.

### 4.3 Network partitions and offline seats
If any seat is offline, partitioned, or simply has the game closed, its Ack is missing and **no share is released early**. Play falls back to today's slower path, where each seat's next move carries its shares (§6.2). Liveness is unchanged: no seat is ever needed online outside its own turn, and Acks and early shares never move a deadline (Ruling 11: they do not change who is stalled). A split vote (4.1) falls back the same way.

### 4.4 Timeouts, equivocation and the audit
- **Timeouts** (§8) are unchanged: an Ack is not progress, and finality does not move the head.
- **Equivocation** (§6.6) is unchanged: a rival below a final move still flags its signer.
- **The audit** (§7) replays the action log of the chosen chain, which now always contains every final move.
- **Alternative endings** (§11): a final move can no longer be bypassed by a rival ending, which only narrows what a last mover can choose.

## 5. Costs
- **Events.** About 2(S−1) extra small events per drawing turn: S−1 Acks and S−1 Shares events (under 1 KB each). With 6 seats, about 10 per turn, a few hundred per game.
- **Latency.** One extra relay round trip over D039: about a second when everyone is online.
- **Code.** A new event kind and its strict parser (`packages/protocol`); Ack and release duties, persisted ack consistency and the finality filter in fork choice (`packages/client`); a quiet duty and outbox slots in the web controller, with delivery confirmed by a table relay, as D039 needed.
- **Consensus change.** Old clients do not apply the finality filter and could choose differently after a fork, so this needs a protocol version bump and every seat on the new client.
- **State.** Each seat persists the moves it acknowledged per game, and every client keeps the Acks it holds.
- **Tests.** Session tests for every case in §4, adversaries in the simulator that equivocate around draws (before, during and after the Acks), and fuzzing of arrival orders to show that clients converge.

## 6. Before it ships: adversarial review
- An adversarial review of this design and of its code is **required** before it is merged, by a reviewer who did not write it, with the explicit goal of exposing a tile no honest rule would reveal.
- Points to attack first:
  1. The corner in §2.4: an honest seat that acknowledged one move and later, after its chain switched, signed a conflicting one.
  2. Ack consistency across devices: a seat playing one game from two browsers with one session key, or restoring an old backup, could acknowledge two conflicting moves.
  3. Out-of-turn decisions (merger disposals) and multi-tile draws (dead tiles replaced at End turn).
  4. The interaction with the rival shuffle-step rule (§6.6) and with timeout finality (§8.2).
  5. Denial of service: Ack floods, Acks of moves never published, Acks of invalid moves.
- The simulator's adversaries (`packages/client/test/adversaries.ts`) gain an equivocating drawer and a colluding acknowledger, and the review is recorded in DECISIONS before the feature ships.

## 7. Alternatives considered
- **Prompt sharing without Acks (D039).** Reverted: one seat alone can expose another's tile.
- **A grace delay before sharing.** A deliberate attacker simply waits for the shares.
- **Changing the fork tie-break** so a later rival of equal length never wins. It needs a notion of "later" that every client agrees on, which `created_at` cannot give (§11), and on its own it does not stop a rival published before the shares.
- **Threshold or verifiable-delay tricks.** Much more cryptography for the same guarantee that one round of signed Acks gives.
