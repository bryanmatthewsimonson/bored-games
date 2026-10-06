import { b64u, encodeScalar, G } from '@bored-games/deck';
import { getConversationKey, nip44Encrypt } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import {
  auditTransfer,
  makeTransfer,
  readTransfer,
  type Selection,
  selectedLabel,
  transferEnvelope,
} from '../src/private-transfer.ts';

const secrets = [3n, 5n, 7n];
const keys = secrets.map((x) => G.multiply(x).toHex(true).slice(2));
const plan: Selection = { id: 9, from: 0, to: 1, index: 2, labels: [0, 0, 1, 3, 4] };
const root = 'ab'.repeat(32),
  anchor = 'cd'.repeat(32),
  after = 'ef'.repeat(32);
const randomness = () => {
  let n = 0;
  return (size: number) => new Uint8Array(size).fill(++n);
};

describe('standalone private resource transfer codec', () => {
  it('delivers the same selected resource only to the two participants', () => {
    const envelope = makeTransfer(plan, 3n, keys, root, anchor, after, randomness());
    expect(transferEnvelope(envelope, plan, root, anchor, after)).toBe(true);
    const expected = { deck: 'supplies', pos: 9, card: selectedLabel(plan, 3n, root, anchor) };
    expect(readTransfer(envelope, plan, 0, 3n, keys)).toEqual(expected);
    expect(readTransfer(envelope, plan, 1, 5n, keys)).toEqual(expected);
    expect(auditTransfer(envelope, plan, secrets, root, anchor, after)).toEqual(expected);
    expect(() => readTransfer(envelope, plan, 2, 7n, keys)).toThrow();
    expect(() => readTransfer(envelope, plan, 1, 7n, keys)).toThrow();
    expect(JSON.stringify(envelope)).not.toContain('"card":');
    expect(JSON.stringify(envelope)).not.toContain('"labels":');
  });
  it('rejects replay across roots, requests, parents, recipients or selection ids', () => {
    const envelope = makeTransfer(plan, 3n, keys, root, anchor, after, randomness());
    for (const [r, a, p] of [
      ['00'.repeat(32), anchor, after],
      [root, '00'.repeat(32), after],
      [root, anchor, '00'.repeat(32)],
    ])
      expect(transferEnvelope(envelope, plan, r as string, a as string, p as string)).toBe(false);
    expect(transferEnvelope(envelope, { ...plan, id: 10 }, root, anchor, after)).toBe(false);
    expect(
      transferEnvelope({ ...envelope, packets: [...envelope.packets].reverse() }, plan, root, anchor, after),
    ).toBe(false);
    expect(transferEnvelope({ ...envelope, extra: 1 }, plan, root, anchor, after)).toBe(false);
    expect(transferEnvelope(null, plan, root, anchor, after)).toBe(false);
    expect(() => readTransfer({ ...envelope, anchor: '00'.repeat(32) }, plan, 1, 5n, keys)).toThrow();
  });
  it('uses one immutable private permutation for every public index', () => {
    const before = JSON.stringify(plan);
    const selected = plan.labels?.map((_, index) => selectedLabel({ ...plan, index }, 3n, root, anchor));
    expect(selected?.sort()).toEqual([0, 0, 1, 3, 4]);
    expect(JSON.stringify(plan)).toBe(before);
    const delivered = makeTransfer(plan, 3n, keys, root, anchor, after, randomness());
    const later = makeTransfer(plan, 3n, keys, root, anchor, '11'.repeat(32), randomness());
    expect(readTransfer(delivered, plan, 1, 5n, keys).card).toBe(readTransfer(later, plan, 1, 5n, keys).card);
    expect(() => selectedLabel({ ...plan, index: 5 }, 3n, root, anchor)).toThrow();
    expect(() => selectedLabel({ ...plan, labels: null }, 3n, root, anchor)).toThrow();
    expect(() => selectedLabel({ ...plan, labels: [9] }, 3n, root, anchor)).toThrow();
  });
  it('makes inconsistent or dishonest deliveries detectable by full-information verification', () => {
    const envelope = makeTransfer(plan, 3n, keys, root, anchor, after, randomness());
    const wrong = (selectedLabel(plan, 3n, root, anchor) + 1) % 5;
    const text = JSON.stringify({ root, anchor, after, id: 9, from: 0, to: 1, index: 2, card: wrong });
    const sk = b64u.decode(encodeScalar(3n));
    const packets = envelope.packets.map((p) => ({
      ...p,
      ciphertext: nip44Encrypt(
        text,
        getConversationKey(sk, keys[p.to] as string),
        new Uint8Array(32).fill(99),
      ),
    }));
    const forged = { ...envelope, packets };
    expect(transferEnvelope(forged, plan, root, anchor, after)).toBe(true);
    // Encryption authenticates the sender; it is not a proof that the sender chose honestly.
    expect(readTransfer(forged, plan, 1, 5n, keys).card).not.toBe(selectedLabel(plan, 3n, root, anchor));
    expect(() => auditTransfer(forged, plan, secrets, root, anchor, after)).toThrow(/committed selection/);
    expect(() =>
      auditTransfer(
        { ...envelope, packets: [envelope.packets[0], forged.packets[1]] },
        plan,
        secrets,
        root,
        anchor,
        after,
      ),
    ).toThrow(/committed selection/);
  });
});
