import { createHash } from 'node:crypto';
import { createRng } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors.ts';
import { DEADLINES, DEFAULT_DEADLINE, KIND, MAX_EVENT_BYTES, PROTO } from '../src/kinds.ts';
import {
  type EventTemplate,
  eventBytes,
  eventId,
  finalizeEvent,
  getPublicKey,
  isHex64,
  type NostrEvent,
  sha256Hex as sha256OfBytes,
  verifyEvent,
} from '../src/nostr.ts';

function seededRandom(seed: string) {
  const rng = createRng(seed);
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

/** BIP-340 test vector 0: secret key 0x…03. */
const SK3 = Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 3 : 0));
const PK3 = 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9'.toLowerCase();
/** BIP-340 test vector 1's secret key and public key. */
const SK_B = Uint8Array.from(
  Buffer.from('B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF', 'hex'),
);
const PK_B = 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659'.toLowerCase();

const template: EventTemplate = {
  kind: 7452,
  created_at: 1_790_000_000,
  tags: [
    ['proto', '1'],
    ['e', 'a'.repeat(64)],
  ],
  content: '{"a":1,"b":"é\\n"}',
};

const rnd = seededRandom('protocol-nostr');
const ev = finalizeEvent(template, SK3, rnd);

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Same as ev with one field replaced, id recomputed and sig left as it was. */
function restamped(patch: Partial<NostrEvent>): NostrEvent {
  const e = { ...ev, ...patch };
  return { ...e, id: eventId(e.pubkey, e) };
}

describe('keys', () => {
  it('getPublicKey matches the BIP-340 vectors (x-only, lowercase hex)', () => {
    expect(getPublicKey(SK3)).toBe(PK3);
    expect(getPublicKey(SK_B)).toBe(PK_B);
  });
});

describe('event ids (NIP-01)', () => {
  it('the id is the sha256 of the serialized array, matching an independent node:crypto computation', () => {
    const serialized = JSON.stringify([
      0,
      PK3,
      template.created_at,
      template.kind,
      template.tags,
      template.content,
    ]);
    expect(eventId(PK3, template)).toBe(sha256Hex(serialized));
    expect(ev.id).toBe(sha256Hex(serialized));
  });

  it('pins the id of a known event', () => {
    const t: EventTemplate = { kind: 1, created_at: 1700000000, tags: [], content: 'hello' };
    expect(eventId(PK3, t)).toBe(sha256Hex(`[0,"${PK3}",1700000000,1,[],"hello"]`));
    expect(eventId(PK3, t)).toBe('a9d53fee641fe563de947fa330a3b4902e52e249894660aaa521cd039e896128');
  });

  it('pins an independent NIP-01 escaping vector (newline, quote, backslash, tab, é, emoji)', () => {
    // Hand-written serialization: NIP-01 escapes \n, \", \\ and \t, and leaves non-ASCII characters raw.
    // The pinned id was computed by node:crypto and by shell sha256sum over this exact text.
    const serialized = String.raw`[0,"f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",1700000000,1,[["t","x"]],"line\n\"quoted\" back\\slash\ttab é 😀"]`;
    const pinned = '04f3bc9285792a551d19075c8c6fab8ec0aafda5cc2f6e757c48f6199f165084';
    expect(sha256Hex(serialized)).toBe(pinned);
    const t: EventTemplate = {
      kind: 1,
      created_at: 1700000000,
      tags: [['t', 'x']],
      content: 'line\n"quoted" back\\slash\ttab é 😀',
    };
    expect(eventId(PK3, t)).toBe(pinned);
  });

  it('finalizeEvent fills pubkey, id and sig, and keeps the template fields', () => {
    expect(ev.pubkey).toBe(PK3);
    expect(ev.kind).toBe(template.kind);
    expect(ev.created_at).toBe(template.created_at);
    expect(ev.tags).toEqual(template.tags);
    expect(ev.content).toBe(template.content);
    expect(ev.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(Object.keys(ev).sort()).toEqual(['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags']);
  });

  it('is deterministic for the same random bytes and differs for different ones', () => {
    expect(finalizeEvent(template, SK3, seededRandom('x')).sig).toBe(
      finalizeEvent(template, SK3, seededRandom('x')).sig,
    );
    expect(finalizeEvent(template, SK3, seededRandom('x')).sig).not.toBe(
      finalizeEvent(template, SK3, seededRandom('y')).sig,
    );
  });

  it('draws 32 bytes of auxiliary randomness and throws a RangeError on a short source', () => {
    const sizes: number[] = [];
    finalizeEvent(template, SK3, (n) => {
      sizes.push(n);
      return new Uint8Array(n);
    });
    expect(sizes).toEqual([32]);
    expect(() => finalizeEvent(template, SK3, () => new Uint8Array(31))).toThrow(RangeError);
  });
});

describe('verifyEvent', () => {
  it('accepts a finalized event, for both vector keys', () => {
    expect(verifyEvent(ev)).toBe(true);
    expect(verifyEvent(finalizeEvent(template, SK_B, rnd))).toBe(true);
    expect(verifyEvent(finalizeEvent({ ...template, tags: [], content: '' }, SK3, rnd))).toBe(true);
  });

  it('rejects an altered content, tag or created_at', () => {
    expect(verifyEvent({ ...ev, content: `${ev.content} ` })).toBe(false);
    expect(verifyEvent({ ...ev, tags: [['proto', '2'], ev.tags[1]] })).toBe(false);
    expect(verifyEvent({ ...ev, created_at: ev.created_at + 1 })).toBe(false);
  });

  it('rejects a recomputed id with a stale signature', () => {
    expect(verifyEvent(restamped({ content: '{}' }))).toBe(false);
    expect(verifyEvent(restamped({ created_at: ev.created_at + 1 }))).toBe(false);
  });

  it('rejects a pubkey swapped for another valid key', () => {
    expect(verifyEvent(restamped({ pubkey: PK_B }))).toBe(false);
    expect(verifyEvent({ ...ev, pubkey: PK_B })).toBe(false);
  });

  it('rejects malformed hex: uppercase id, uppercase sig, 63-character pubkey, non-hex pubkey', () => {
    expect(verifyEvent({ ...ev, id: ev.id.toUpperCase() })).toBe(false);
    expect(verifyEvent({ ...ev, sig: ev.sig.toUpperCase() })).toBe(false);
    expect(verifyEvent({ ...ev, pubkey: ev.pubkey.slice(1) })).toBe(false);
    expect(verifyEvent({ ...ev, pubkey: `g${ev.pubkey.slice(1)}` })).toBe(false);
    expect(verifyEvent({ ...ev, sig: ev.sig.slice(2) })).toBe(false);
  });

  it('rejects malformed tags', () => {
    expect(verifyEvent({ ...ev, tags: [['proto', 1]] })).toBe(false);
    expect(verifyEvent({ ...ev, tags: ['proto'] })).toBe(false);
    expect(verifyEvent({ ...ev, tags: 'proto' })).toBe(false);
    expect(verifyEvent({ ...ev, tags: [[null]] })).toBe(false);
  });

  it('rejects sparse tag arrays (holes), inner and outer, even when finalized over them', () => {
    const inner: string[] = ['proto'];
    inner.length = 2;
    expect(verifyEvent(finalizeEvent({ ...template, tags: [inner] }, SK3, rnd))).toBe(false);
    const outer: string[][] = [['proto', '1']];
    outer.length = 2;
    expect(verifyEvent(finalizeEvent({ ...template, tags: outer }, SK3, rnd))).toBe(false);
  });

  it('rejects an extra key and a missing key', () => {
    expect(verifyEvent({ ...ev, extra: 1 })).toBe(false);
    const { sig: _sig, ...noSig } = ev;
    expect(verifyEvent(noSig)).toBe(false);
  });

  it('rejects non-objects without throwing', () => {
    for (const bad of [null, undefined, 7, 'ev', true, [], [ev], () => ev, 7n])
      expect(verifyEvent(bad), String(bad)).toBe(false);
  });

  it('rejects bad kind and created_at values', () => {
    for (const kind of [-1, 65536, 1.5, Number.NaN, '7452', null])
      expect(verifyEvent(restamped({ kind: kind as number })), String(kind)).toBe(false);
    for (const created_at of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '1', null])
      expect(verifyEvent({ ...ev, created_at }), String(created_at)).toBe(false);
    // The boundaries are valid kinds; the signature is what is checked.
    expect(verifyEvent(finalizeEvent({ ...template, kind: 0 }, SK3, rnd))).toBe(true);
    expect(verifyEvent(finalizeEvent({ ...template, kind: 65535 }, SK3, rnd))).toBe(true);
    expect(verifyEvent(finalizeEvent({ ...template, created_at: 0 }, SK3, rnd))).toBe(true);
    expect(verifyEvent(finalizeEvent({ ...template, created_at: Number.MAX_SAFE_INTEGER }, SK3, rnd))).toBe(
      true,
    );
  });

  it('rejects a non-string content', () => {
    expect(verifyEvent({ ...ev, content: 7 })).toBe(false);
    expect(verifyEvent({ ...ev, content: null })).toBe(false);
  });

  it('never throws on hostile objects (throwing getters, proxies, a pubkey off the curve)', () => {
    const getter = { ...ev };
    Object.defineProperty(getter, 'content', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(verifyEvent(getter)).toBe(false);
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    expect(verifyEvent(proxy)).toBe(false);
    expect(verifyEvent(restamped({ pubkey: 'f'.repeat(64) }))).toBe(false);
    expect(verifyEvent({ ...ev, sig: '0'.repeat(128) })).toBe(false);
    expect(verifyEvent({ ...ev, sig: 'f'.repeat(128) })).toBe(false);
  });
});

describe('helpers and constants', () => {
  it('isHex64 accepts only 64 lowercase hex characters', () => {
    expect(isHex64('0'.repeat(64))).toBe(true);
    expect(isHex64('abcdef0123456789'.repeat(4))).toBe(true);
    expect(isHex64('A'.repeat(64))).toBe(false);
    expect(isHex64('a'.repeat(63))).toBe(false);
    expect(isHex64('a'.repeat(65))).toBe(false);
    expect(isHex64(`${'a'.repeat(63)}\n`)).toBe(false);
    expect(isHex64(7)).toBe(false);
    expect(isHex64(null)).toBe(false);
  });

  it('eventBytes is the UTF-8 length of the serialized event', () => {
    expect(eventBytes(ev)).toBe(Buffer.byteLength(JSON.stringify(ev), 'utf8'));
    const wide = finalizeEvent({ ...template, content: '"é€😀"' }, SK3, rnd);
    expect(eventBytes(wide)).toBe(Buffer.byteLength(JSON.stringify(wide), 'utf8'));
    expect(eventBytes(wide)).toBeGreaterThan(JSON.stringify(wide).length);
  });

  it('exports the protocol constants', () => {
    expect(KIND).toEqual({
      table: 37450,
      join: 7451,
      root: 7450,
      move: 7452,
      shares: 7453,
      timeout: 7454,
      reveal: 7455,
      attest: 7456,
    });
    expect(PROTO).toBe('1');
    expect(DEADLINES).toEqual([86400, 259200, 604800]);
    expect(DEFAULT_DEADLINE).toBe(259200);
    expect(DEADLINES).toContain(DEFAULT_DEADLINE);
    expect(MAX_EVENT_BYTES).toBe(262144);
  });

  it('ProtocolError carries a code and a name and is an Error', () => {
    const e = new ProtocolError('bad-thing', 'it went wrong');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ProtocolError);
    expect(e.name).toBe('ProtocolError');
    expect(e.code).toBe('bad-thing');
    expect(e.message).toBe('it went wrong');
  });
});

describe('sha256Hex', () => {
  it('hashes bytes to lowercase hex, matching node:crypto', () => {
    expect(sha256OfBytes(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
    expect(sha256OfBytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
