import { finalizeEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { loadOutbox, loadOutboxSlot, outboxKey } from '../src/game-controller.ts';
import { memoryStorage } from '../src/storage.ts';

const ROOT = 'f'.repeat(64);
const sk = new Uint8Array(32).fill(3);
const rnd = (n: number): Uint8Array => new Uint8Array(n).fill(1);
const ev = (content: string) => finalizeEvent({ kind: 1, created_at: 1, tags: [], content }, sk, rnd);

describe('loadOutboxSlot', () => {
  it('reads one slot as loadOutbox does, and only checks that slot', () => {
    const store = memoryStorage();
    const deal = ev('deal');
    const bad = { ...ev('move'), sig: '0'.repeat(128) };
    store.setItem(
      outboxKey('a', ROOT),
      JSON.stringify({ deal: { event: deal, confirmed: false, orphan: true }, 'move:1:x': { event: bad } }),
    );
    expect(loadOutboxSlot(store, 'a', ROOT, 'deal')).toEqual(loadOutbox(store, 'a', ROOT).get('deal'));
    expect(loadOutboxSlot(store, 'a', ROOT, 'deal')).toEqual({ event: deal, confirmed: false, orphan: true });
    // A slot whose event does not verify, a missing slot, an inherited name and nothing stored: none.
    expect(loadOutboxSlot(store, 'a', ROOT, 'move:1:x')).toBeUndefined();
    expect(loadOutboxSlot(store, 'a', ROOT, 'secret')).toBeUndefined();
    expect(loadOutboxSlot(store, 'a', ROOT, 'toString')).toBeUndefined();
    expect(loadOutboxSlot(store, 'b', ROOT, 'deal')).toBeUndefined();
  });
});
