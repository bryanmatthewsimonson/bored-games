import { chainSizes, flood } from './board.ts';
import { chainId } from './rules.ts';
import { NEIGHBORS, TILE_COUNT, tileId } from './tiles.ts';
import { type ChainReactionState, LOOSE, PENDING } from './types.ts';

/** Structural invariants of a Chain Reaction state. Returns human-readable violations. */
export function checkInvariants(s: ChainReactionState): string[] {
  const out: string[] = [];
  const rules = s.rules;
  const n = rules.chains.length;

  // Board cells and chain geometry.
  if (s.board.length !== TILE_COUNT) out.push('board must have 108 cells');
  let pendingCells = 0;
  for (let t = 0; t < s.board.length; t++) {
    const cell = s.board[t];
    if (cell === undefined) out.push(`cell ${t} missing`);
    else if (cell === PENDING) pendingCells++;
    else if (cell !== null && cell !== LOOSE && !(Number.isInteger(cell) && cell >= 0 && cell < n)) {
      out.push(`cell ${tileId(t)} has invalid value ${cell}`);
    }
  }
  const expectPending = s.phase.kind === 'found' || s.phase.kind === 'merger' ? 1 : 0;
  if (pendingCells !== expectPending)
    out.push(`expected ${expectPending} pending tile(s), found ${pendingCells}`);

  const sizes = chainSizes(s.board, n);
  for (let c = 0; c < n; c++) {
    const size = sizes[c] ?? 0;
    if (size === 0) continue;
    const id = chainId(rules, c);
    if (size < 2) out.push(`chain ${id} has ${size} tile`);
    const first = s.board.indexOf(c);
    if (flood(s.board, first, (cell) => cell === c).length !== size) out.push(`chain ${id} is not connected`);
  }
  for (let t = 0; t < s.board.length; t++) {
    const cell = s.board[t];
    if (cell === null || cell === undefined || cell === PENDING) continue;
    for (const nb of NEIGHBORS[t] ?? []) {
      const other = s.board[nb];
      if (other === null || other === undefined || other === PENDING) continue;
      if (cell === LOOSE && other >= 0)
        out.push(`unincorporated ${tileId(t)} touches chain ${chainId(rules, other)}`);
      if (cell >= 0 && other >= 0 && other !== cell) {
        out.push(`chains ${chainId(rules, cell)} and ${chainId(rules, other)} touch at ${tileId(t)}`);
      }
    }
  }

  // Shares and cash.
  for (let c = 0; c < n; c++) {
    const bank = s.bank[c] ?? -1;
    const held = s.players.reduce((sum, p) => sum + (p.shares[c] ?? 0), 0);
    if (bank < 0 || s.players.some((p) => (p.shares[c] ?? 0) < 0))
      out.push(`negative shares of ${chainId(rules, c)}`);
    if (bank + held !== rules.sharesPerChain) {
      out.push(`shares of ${chainId(rules, c)}: bank ${bank} + players ${held} != ${rules.sharesPerChain}`);
    }
  }
  s.players.forEach((p, seat) => {
    if (!Number.isSafeInteger(p.cash) || p.cash < 0 || p.cash % 100 !== 0)
      out.push(`seat ${seat} cash ${p.cash}`);
    if (p.shares.length !== n) out.push(`seat ${seat} share vector length`);
    if (p.hand.length > rules.handSize) out.push(`seat ${seat} holds ${p.hand.length} tiles`);
    for (let i = 1; i < p.hand.length; i++) {
      if ((p.hand[i]?.pos ?? 0) <= (p.hand[i - 1]?.pos ?? 0))
        out.push(`seat ${seat} hand not sorted by position`);
    }
    for (const h of p.hand) {
      if (h.pos < s.seats || h.pos >= s.deck.next) out.push(`seat ${seat} holds undealt position ${h.pos}`);
      if (s.deck.order && h.tile !== s.deck.order[h.pos])
        out.push(`seat ${seat} slot ${h.pos} disagrees with deck`);
    }
  });

  // Every tile is in exactly one place: board, a hand, the discard pile, or the bag.
  const count = new Array<number>(TILE_COUNT).fill(0);
  s.board.forEach((cell, t) => {
    if (cell !== null) count[t] = (count[t] ?? 0) + 1;
  });
  for (const p of s.players)
    for (const h of p.hand) if (h.tile !== null) count[h.tile] = (count[h.tile] ?? 0) + 1;
  for (const t of s.discard) count[t] = (count[t] ?? 0) + 1;
  for (let i = 1; i < s.discard.length; i++) {
    if ((s.discard[i] ?? 0) <= (s.discard[i - 1] ?? 0)) out.push('discard pile not sorted');
  }
  if (s.deck.order) {
    for (let pos = s.deck.next; pos < TILE_COUNT; pos++) {
      const t = s.deck.order[pos] as number;
      count[t] = (count[t] ?? 0) + 1;
    }
    // Setup tiles not yet revealed are still "in the deck" at their positions.
    s.setupTiles.forEach((t, pos) => {
      if (t === null) {
        const card = s.deck.order?.[pos] as number;
        count[card] = (count[card] ?? 0) + 1;
      }
    });
    count.forEach((c, t) => {
      if (c !== 1) out.push(`tile ${tileId(t)} appears ${c} times`);
    });
  } else {
    count.forEach((c, t) => {
      if (c > 1) out.push(`tile ${tileId(t)} appears ${c} times`);
    });
  }
  if (s.deck.next < s.seats || s.deck.next > TILE_COUNT) out.push(`deck.next ${s.deck.next} out of range`);

  // A chain on the board always has a shareholder: its founder took a share,
  // or the bank had none because players already held them all.
  // (Final scoring sells every share back to the bank, so this holds until the game is over.)
  if (rules.founderShares > 0 && s.phase.kind !== 'over') {
    const resolving = s.phase.kind === 'merger' ? s.phase.merger.chains : [];
    for (let c = 0; c < n; c++) {
      if ((sizes[c] ?? 0) === 0 || resolving.includes(c)) continue;
      if (s.players.every((p) => (p.shares[c] ?? 0) === 0))
        out.push(`active chain ${chainId(rules, c)} has no shareholder`);
    }
  }

  // Decision state.
  if (s.phase.kind === 'merger') {
    const m = s.phase.merger;
    const head = m.defuncts?.[0];
    if (m.holders && head !== undefined) {
      for (const seat of m.holders) {
        if ((s.players[seat]?.shares[head] ?? 0) === 0)
          out.push(`disposal queued for seat ${seat} without shares`);
      }
    }
  }
  if (s.phase.kind !== 'setup' && s.phase.kind !== 'over' && s.turn === null) out.push('turn missing');
  return out;
}
