import { b64u, encodeScalar, G } from '@bored-games/deck';
import type { GameModule } from '@bored-games/game-kit';
import { getConversationKey, nip44Encrypt } from '@bored-games/protocol';
import { expect, it } from 'vitest';
import { auditGame } from '../src/audit.ts';
import { makeTransfer, type Selection } from '../src/private-transfer.ts';

const secrets = [3n, 5n, 7n];
const keys = secrets.map((x) => G.multiply(x).toHex(true).slice(2));
const root = 'ab'.repeat(32),
  request = 'cd'.repeat(32),
  parent = 'ef'.repeat(32);
const plan: Selection = { id: 0, from: 0, to: 1, index: 0, labels: [1] };
const outcome = { scores: [1, 0, 0], places: [1, 2, 2], reason: 'test' };
type State = { phase: number; card: number | null };
// A small audit fixture isolates context, both encrypted packets, and attribution from board gameplay.
const module: GameModule<State, { type: string }, null> = {
  id: 'private-audit-fixture',
  version: '1',
  defaultRules: () => null,
  validateRules: () => ({ ok: true, value: null }),
  seatRange: () => ({ min: 3, max: 3 }),
  decks: () => [],
  setup: () => ({ ok: true, value: { phase: 0, card: null } }),
  pending: () => ({ type: 'player', seat: 0, decision: 'test' }),
  legalActions: () => [],
  apply: (s) => ({ ok: true, state: { ...s, phase: s.phase + 1 }, events: [] }),
  learn: (s, l) => ({ ok: true, state: { ...s, card: l.card }, events: [] }),
  privateSelection: (s) => (s.phase === 1 ? plan : null),
  rolls: (s) => (s.phase > 0 ? [{ id: 0, last: 0 }] : []),
  view: (s) => s,
  knownTo: () => [],
  dealt: () => [],
  revealsOf: () => [],
  outcome: () => outcome,
  standings: () => outcome.scores,
  invariants: () => [],
};
it('fails the sender when either private packet or the request/parent binding is dishonest', () => {
  const transfer = makeTransfer(plan, 3n, keys, root, request, parent, (n) => new Uint8Array(n).fill(41));
  const check = (action: unknown) =>
    auditGame({
      module: module as GameModule<unknown, { type: string }, unknown>,
      rules: null,
      seats: 3,
      deckId: null,
      deck: [],
      cards: new Map(),
      secrets,
      rootId: root,
      outcome,
      log: [
        { actor: 0, seq: 1, id: request, prev: root, action: { type: 'request' } },
        { actor: 0, seq: 2, id: '11'.repeat(32), prev: parent, action },
      ],
    });
  expect(check(transfer)).toBe('pass');
  for (const to of [0, 1]) {
    const text = JSON.stringify({
      root,
      anchor: request,
      after: parent,
      id: 0,
      from: 0,
      to: 1,
      index: 0,
      card: 2,
    });
    const ciphertext = nip44Encrypt(
      text,
      getConversationKey(b64u.decode(encodeScalar(3n)), keys[to] as string),
      new Uint8Array(32).fill(99),
    );
    expect(
      check({ ...transfer, packets: transfer.packets.map((p) => (p.to === to ? { ...p, ciphertext } : p)) }),
    ).toMatchObject({ fail: [0] });
  }
  expect(check({ ...transfer, anchor: root })).toMatchObject({ fail: [0] });
  expect(check({ ...transfer, after: root })).toMatchObject({ fail: [0] });
});
