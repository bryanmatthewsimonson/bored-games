# Proposal: dealer tables (a trusted relay deals, rolls and orders moves)

**Status: Proposal, for the owner's decision. Not built.** It adds a second kind of table beside today's trustless tables. If adopted, it amends D003 ("no referee, dealer or stats server") for the tables that choose it. The NOSTR-facing part is drafted as a NIP in [`nip-dealer-games.md`](nip-dealer-games.md).

## 1. Why

Trustless tables hide cards with mental poker: every card is locked by every seat, and a card is read only once every other seat has released its share. That keeps the deck secret from everyone, but it has practical costs:
- **Reveals wait for other players to open the app.** A refill in Luster or a roll in Bank waits for every seat (PROTOCOL-v2 §6.4); a drawn tile shows "?" until the others move.
- **Setup is slow.** A 6-seat shuffle takes seconds of proof checking, more on a phone (D019).
- **Forks need heavy machinery.** Fork choice in v1, and v2's fork stop with its attestation cutoff (PROTOCOL-v2 §5), exist because nobody is trusted to say which move came first.
- **Timeouts depend on each client's own clock**, so clients can disagree in the claim race (PROTOCOL §11).

A trusted dealer removes all four. It is the model of every card room and most online game sites: players trust the house to deal fairly and keep the deck private. Here the house is a relay that anyone can run, the table names which one, and its dealing is checked by every client at the end of the game.

## 2. The design

### 2.1 The dealer
A **dealer** is a NOSTR key, run as a service beside a relay (its key published as the relay's NIP-11 `self`). It holds one secret per game: the **dealer seed**. It runs the same pure game engines as the clients (`packages/games/*`), so it knows every hand and can check every move.

### 2.2 Setup
1. **The table names a dealer.** The Table (37450) carries `["dealer", <dealer pubkey>, <relay url>]`. A table without it is a trustless table, unchanged.
2. **The dealer commits.** It draws a dealer seed and publishes a **commitment** event: `SHA-256(dealerSeed)`, tagged with the Table's address. Joins name the commitment, so every seat accepts the same dealer and the same commitment.
3. **Seats add entropy.** Each Join carries a random 32-byte `seed`, in public.
4. **The root fixes the seats** as today (7450), and with them the set of seeds.
5. **The deck order** is a deterministic shuffle of the game's card list driven by `SHA-256("deal" ‖ dealerSeed ‖ the seated seeds in seat order)` (exact algorithm in the NIP draft, "Randomness").

The dealer committed before it saw the seats' seeds, so it cannot pick the order. The seats do not know the dealer seed, so they cannot compute it. There is no shuffle phase and no deal phase: play starts with the root.

### 2.3 Play
- **A seat moves** by publishing its Move (7452) as today, to the dealer's relay and its own relays.
- **The dealer receipts it.** It checks the move against the full state (hidden hands included) and publishes a **receipt** naming the move, numbered `n`, chained to the previous receipt by its id. A receipt says `accepted` or `rejected` (with a reason).
- **Only receipted moves count.** Each client folds the game in receipt order. A rival move, a move published elsewhere and a junk move never get an accepted receipt, so there are no forks to resolve.
- **Hidden outputs ride in the receipt.** When a move draws a card for a seat, the receipt carries it NIP-44-encrypted to that seat's session key, so only that seat reads it. A public reveal (a refill) and dice faces are in plain text. Reveals are therefore immediate: no other player's app is involved.
- **Dice** are derived from the game seed, the requesting move's id and the roll index (the NIP draft's "Randomness" section), so the dealer cannot choose them either.
- **Engines are unchanged.** The session feeds the engine the same inputs it does now (`learn` for a private card, the derived reveal, `{type:'rolled'}`), taken from receipts instead of decrypted shares.

### 2.4 Time and timeouts
The dealer's receipt dates (`created_at`, strictly increasing) are the game's clock. When a seat's deadline passes on that clock, the dealer publishes a `timeout` receipt naming the stalled seats; a Resign is receipted like a move. Timeout claims (7454) are not used. Every client sees the same order and the same times, so the claim race and the resign race are gone.

### 2.5 End of game
When the module is over (or a timeout or a resign ends it), the dealer publishes the **dealer seed**. Every client then:
1. checks it against the commitment;
2. recomputes the deck order and every roll;
3. checks every card and die the dealer handed out, private ones included (each seat checks its own deliveries, and the full replay checks the rest);
4. replays the game with full information to check that every accepted move was legal and every rejection was justified.

A mismatch marks the game **dealer fault**: the result is void, and the client shows the evidence. Shares, secrets, Secret reveals (7455) and the hidden-claim audit are not needed on dealer tables.

### 2.6 Dealer misbehaviour that clients detect
- **Two receipts with the same `n` or the same previous receipt**: the dealer showed two histories. Clients rebroadcast receipts (as v2 §9.1 does for moves), stop the game and show both receipts as proof.
- **A dealt card or roll that does not match the revealed seed**, or no seed reveal after the end: dealer fault.
- **An illegal move accepted, or a legal one rejected**: found by the replay at the end.

## 3. Trust model

| The dealer can | The dealer cannot |
|---|---|
| See every hand and the whole deck order, and tell a player | Choose the deck order or the dice (the commitment and the seats' seeds fix them) |
| Delay or refuse to receipt a move (not provable) | Change a card or die once dealt without being caught at the end |
| Stop serving: games pause | Show two histories without leaving signed proof |
| Time a seat out unfairly by delaying its move | Forge a seat's move (moves are signed by the seats) |

**What the players supply:** nothing beyond what clients already do automatically (a random seed in the Join). No key escrow: the dealer never holds a player's key.

**Who should run a dealer:** the owner, a friend group, or later a paid service. For friends, a dealer is plainly enough. For rated or paid play, the trust is the same as on any hosted game site; the end-of-game check makes the dealer's honesty about the deck and dice verifiable, and leaves only peeking and timing to trust.

## 4. Compared with trustless tables

| | Trustless (v1/v2) | Dealer table |
|---|---|---|
| Reveals and dice | Wait for every other seat's app | Immediate |
| Setup | Shuffle and deal, seconds per seat | None |
| Forks | Fork choice (v1) or fork stop with cutoff (v2) | Impossible: one receipt chain |
| Timeouts | Each client's clock; claim race | Dealer's clock; one answer |
| Trust | One honest seat protects its own cards | The dealer does not peek or stall |
| Runs on | Any relays | Needs its dealer online |

## 5. What changes in the code

- **`packages/protocol`:** the `dealer` Table tag, the Join `seed`, and strict parsers for the commitment, receipt and seed-reveal events.
- **`packages/client`:** a dealer-mode fold: order by receipts, take hidden values from receipts (decrypting the seat's own), dealer timeouts, the end-of-game verification, and dealer-fault results. The trustless fold stays for trustless tables.
- **`packages/game-kit`:** the deterministic deck shuffle from a seed (pure, beside the PRNG).
- **`apps/dealer` (new):** a Node service that watches tables naming its key, commits, receipts moves with the pure engines, delivers cards, runs the clock and publishes the seed at the end. It reuses `packages/games/*`, `packages/client` and `packages/dice`. It can run beside `tools/dev-relay` in development and in `pnpm dev`.
- **`apps/web`:** a "Dealer" option on the New table form (default: the owner's dealer), dealer status on the game screen (online, last receipt), and the dealer-fault display.
- **Tests:** the fold on receipt logs in every arrival order; dealer equivocation; a bad card, a bad roll and a missing seed reveal; a dealer that accepts an illegal move; timeouts on the dealer's clock; one e2e spec per game on a dealer table.

## 6. Rollout

1. Owner decision on this proposal (it amends D003 for dealer tables).
2. Protocol events and the seeded shuffle, with test vectors.
3. The dealer service and the dealer-mode fold, Chess first (no cards: ordering and clock only), then Bank (dice), Chain Reaction and Luster.
4. Web table option and e2e specs.
5. Publish the NIP draft for community review once the events have run in real games.

## 7. Open questions for the owner

1. **Adopt dealer tables?** And should they be the default for new tables?
2. **Trustless tables:** keep them beside dealer tables, and if so, does the protocol v2 build continue now or wait?
3. **Revealing the seed reveals every hand and the rest of the deck at the end.** Fine for the current games (every card is public at the end). For games whose policy hides unplayed cards (PLAN item 12), the seed could be sent only to the seats, or the dealer could open only dealt positions (which loses the check of the shuffle). Decide per game when one needs it.
4. **Dealer outage:** games pause. Is that acceptable, or should a table be able to name a backup dealer (which needs a handover rule)?
5. **Ratings:** do dealer-table results count toward the same ratings as trustless ones?
