NIP-XX
======

Dealer-Refereed Games
---------------------

`draft` `optional`

This NIP lets a **dealer**, a trusted key usually run beside a relay, deal hidden cards, roll dice, order moves and keep time for a turn-based game played over NOSTR. Players sign their own moves. The dealer commits to its randomness before the game and reveals it at the end, so every client can check that each card and die was fair and that each move was judged correctly.

It suits card games, tile games and dice games played asynchronously, where waiting for every player to come online for each reveal is impractical. Players trust the dealer not to peek at hidden cards and not to delay moves; everything else is checked.

Kind numbers below are proposals, to be checked against the kinds registry before submission.

## Roles

- **Seats:** the players' keys. A client MAY use a per-game key for its seat.
- **Dealer:** a key named by the game. A relay that runs a dealer SHOULD publish the dealer's pubkey as `self` in its NIP-11 document.
- **Ruleset:** an identifier, chosen by the game application, that fixes the game's rules, its card list, and how actions draw cards and request rolls. Clients and the dealer MUST run the same ruleset.

## Events

| Kind | Name | Signed by |
|---|---|---|
| `7460` | Dealer commitment | dealer |
| `7461` | Receipt | dealer |
| `7462` | Seed reveal | dealer |

Game setup events (a table, joins) and action events are defined by the application. This NIP adds tags to them and specifies how the dealer orders them.

### Dealer commitment (`kind:7460`)

Published by the dealer for one game, before any seat joins.

```jsonc
{
  "kind": 7460,
  "pubkey": "<dealer pubkey>",
  "tags": [
    ["a", "<address of the application's game/table event>"],
    ["commit", "<hex SHA-256 of the 32-byte dealer seed>"],
    ["ruleset", "<ruleset identifier>"]
  ],
  "content": ""
}
```

The dealer MUST draw a fresh, uniformly random 32-byte seed for each game, and MUST NOT publish two commitments for one game.

### Seat entropy

Each seat's join event (application-defined) MUST carry:
- `["e", "<commitment event id>", "", "commitment"]`: the seat accepts this dealer and this commitment;
- `["seed", "<64 hex chars>"]`: 32 random bytes, drawn fresh by the client.

The application's start event fixes the seats and their order, and so the seed list. Its id is the **game id**.

### Actions

A seat's action event (application-defined) MUST carry `["e", <game id>, "", "game"]` and SHOULD reference the last receipt the seat had seen, `["e", <receipt id>, "", "after"]`. Clients publish actions to the dealer's relay and MAY publish them elsewhere too. Only receipted actions count.

### Receipt (`kind:7461`)

```jsonc
{
  "kind": 7461,
  "pubkey": "<dealer pubkey>",
  "created_at": <dealer clock, strictly greater than the previous receipt's>,
  "tags": [
    ["e", "<game id>", "", "game"],
    ["e", "<previous receipt id>", "", "prev"],   // absent on the first receipt
    ["e", "<action event id>", "", "action"],     // absent on a timeout receipt
    ["n", "<receipt number, 0 for the first>"],
    ["p", "<recipient pubkey>"]                   // one per private delivery
  ],
  "content": "<JSON, below>"
}
```

Content:

```jsonc
{
  "status": "accepted" | "rejected" | "timeout" | "end",
  "reason": "<string, rejected only>",
  "seats": [<seat index>, …],                    // timeout: the stalled seats
  "public": [{"pos": <deck position>, "card": <card>}, …],
  "rolls": [{"n": <roll index>, "faces": [<int>, …]}, …],
  "private": [{"p": "<recipient pubkey>", "c": "<NIP-44 v2 payload>"}, …]
}
```

- Each `private` payload is encrypted from the dealer's key to the recipient's key and decrypts to `{"pos": <deck position>, "card": <card>}` or a list of them.
- The first receipt (`n` = 0) receipts the start event, and carries the opening hands.
- `rejected` receipts consume a number but change no game state.
- An `end` receipt closes the game when the ruleset declares it over, after a resignation, or after a timeout that ends it; the seed reveal follows.

**Dealer rules:**
- Receipt actions in the order received. Accept an action only if it is legal on the state after the previous accepted receipt, and the signer is the seat the ruleset expects.
- Deliver every card a move draws in the same receipt that accepts the move.
- Publish a `timeout` receipt once a stalled seat's deadline has passed on the dealer's clock, measured from the receipt that made it stalled.
- Never publish two receipts with the same `n` or the same `prev`.

### Seed reveal (`kind:7462`)

```jsonc
{
  "kind": 7462,
  "pubkey": "<dealer pubkey>",
  "tags": [["e", "<game id>", "", "game"], ["e", "<end receipt id>", "", "end"]],
  "content": "<hex dealer seed>"
}
```

Published once the game has ended.

## Randomness

- **Game seed:** `S = SHA-256("deal" ‖ dealerSeed ‖ seed_0 ‖ … ‖ seed_{k−1})`, with the seat seeds in seat order, each as 32 raw bytes.
- **Stream:** block `i` of the stream for a label `L` is `SHA-256(S ‖ L ‖ uint32be(i))`. It is read as a sequence of big-endian `uint32` words.
- **Uniform integer in `[0, m)`:** take the next word `w`; reject it if `w ≥ 2^32 − (2^32 mod m)`; otherwise return `w mod m`.
- **Deck order:** a Fisher–Yates shuffle of the ruleset's card list, for `i` from `len − 1` down to `1`, swapping `i` with a uniform integer in `[0, i]`, using the stream with label `"deck"`. A ruleset with several piles shuffles each with label `"deck:" + pile name`.
- **Rolls:** roll `n` requested by the action receipted as action id `A` uses the stream with label `"roll:" + A + ":" + n` (`A` as lowercase hex), one uniform integer per die.

The dealer commits before any seat seed exists, so it cannot choose `S`; the seats do not know the dealer seed, so they cannot compute `S` before the reveal.

## Client behaviour

1. **Order.** Fold the game in receipt order (`n`), applying only `accepted`, `timeout` and `end` receipts. Ignore actions without an accepted receipt.
2. **Hidden values.** Decrypt the private deliveries addressed to the seat's key; take public cards and rolls from the receipt.
3. **Equivocation.** If a client holds two receipts for one game with the same `n` or the same `prev`, it MUST stop the game and show both as proof that the dealer equivocated. Clients SHOULD rebroadcast every receipt they hold to the game's relays so that equivocation is found.
4. **Verification at the end.** On the seed reveal, a client MUST check `SHA-256(seed)` against the commitment, recompute the deck order and every roll, check every delivery it holds against them, and replay the game with full information to check every receipt's status. Any mismatch, or no seed reveal after an `end` receipt, makes the game a **dealer fault**; clients SHOULD show the failing receipt.
5. **Time.** Receipt `created_at` is the game's clock. Clients MUST NOT use their own clocks to end a game.

## Security considerations

- **Trusted:** the dealer can see every hidden card and could tell a player. It can delay or refuse to receipt an action, and so time a seat out unfairly; that cannot be proven. If it goes offline, the game pauses.
- **Checked:** the dealer cannot choose the cards or dice, change a delivered card, accept an illegal action or reject a legal one without the end-of-game check catching it, and cannot show different histories without leaving two signed receipts.
- **Grinding by seat choice:** a dealer colluding with whoever fixes the seats could try several seat sets against its known seed. Applications SHOULD fix the seat order from the joins' own data (for example, by join id), not by choice.
- **Seed reveal discloses everything:** at the end every hand and the undealt cards become public. Games that must keep unplayed cards private need another reveal policy (for example, sending the seed only to the seats).
- **Seat keys:** private deliveries are only as safe as the recipient's key. A per-game key limits exposure to one game.

## Relation to other NIPs

- **NIP-01:** all events are regular events; receipts are never replaced.
- **NIP-11:** the dealer's key SHOULD be the relay's `self`.
- **NIP-29:** like relay-based groups, the relay holds authority, but here it signs a receipt for each member event, and the receipts form a verifiable chain.
- **NIP-44:** private deliveries.
