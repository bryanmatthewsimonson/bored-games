import { finalizeEvent, getPublicKey, type NostrEvent, sha256Hex, verifyEvent } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import {
  AUTH_TTL_S,
  type FetchLike,
  parseBlossomServer,
  UPLOAD_ERRORS,
  uploadAuthTemplate,
  uploadBlob,
} from '../src/blossom.ts';

const SK = new Uint8Array(32).fill(9);
const rnd = (n: number) => new Uint8Array(n).fill(3);
const sign = async (t: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(t, SK, rnd);
const BYTES = Uint8Array.from({ length: 500 }, (_, i) => (i * 13) & 0xff);
const SHA = sha256Hex(BYTES);
const NOW = 1_800_000_000;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

function fakeFetch(answer: (call: Call) => { status: number; body?: unknown } | 'network'): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, ...init };
      calls.push(call);
      const a = answer(call);
      if (a === 'network') throw new TypeError('Failed to fetch');
      return {
        ok: a.status >= 200 && a.status < 300,
        status: a.status,
        json: async () => {
          if (a.body === undefined) throw new SyntaxError('no body');
          return a.body;
        },
      };
    },
  };
}

const good = () => ({
  status: 200,
  body: {
    url: `https://blossom.primal.net/${SHA}.webp`,
    sha256: SHA,
    size: BYTES.length,
    type: 'image/webp',
  },
});

function decodeAuth(header: string): NostrEvent {
  expect(header.startsWith('Nostr ')).toBe(true);
  return JSON.parse(atob(header.slice(6))) as NostrEvent;
}

describe('parseBlossomServer', () => {
  it('accepts https servers and drops a trailing slash', () => {
    expect(parseBlossomServer('https://blossom.primal.net/')).toBe('https://blossom.primal.net');
    expect(parseBlossomServer(' https://cdn.example.com/blossom/ ')).toBe('https://cdn.example.com/blossom');
  });

  it('refuses plain http, local hosts and query strings', () => {
    for (const bad of [
      'http://blossom.primal.net',
      'https://localhost:3000',
      'https://a.example/?x=1',
      'blossom',
    ])
      expect(parseBlossomServer(bad), bad).toBeNull();
  });
});

describe('uploadAuthTemplate', () => {
  it('is kind 24242 for one blob, expiring in five minutes', () => {
    expect(uploadAuthTemplate(SHA, 'https://blossom.primal.net', NOW)).toEqual({
      kind: 24242,
      created_at: NOW,
      tags: [
        ['t', 'upload'],
        ['x', SHA],
        ['expiration', String(NOW + AUTH_TTL_S)],
        ['server', 'blossom.primal.net'],
      ],
      content: 'Upload profile picture',
    });
  });
});

describe('uploadBlob', () => {
  it('PUTs the bytes with only Authorization and Content-Type, signed for this blob', async () => {
    const f = fakeFetch(good);
    const d = await uploadBlob({
      server: 'https://blossom.primal.net/',
      bytes: BYTES,
      type: 'image/webp',
      sign,
      now: NOW,
      fetch: f.fetch,
    });
    expect(d).toEqual({
      url: `https://blossom.primal.net/${SHA}.webp`,
      sha256: SHA,
      size: 500,
      type: 'image/webp',
    });
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0] as Call;
    expect(call.url).toBe('https://blossom.primal.net/upload');
    expect(call.method).toBe('PUT');
    expect(Object.keys(call.headers).sort()).toEqual(['Authorization', 'Content-Type']);
    expect(call.headers['Content-Type']).toBe('image/webp');
    expect(call.body).toBe(BYTES);
    const auth = decodeAuth(call.headers.Authorization as string);
    expect(verifyEvent(auth)).toBe(true);
    expect(auth.pubkey).toBe(getPublicKey(SK));
    expect(auth.kind).toBe(24242);
    expect(auth.tags).toContainEqual(['x', SHA]);
    expect(auth.tags).toContainEqual(['t', 'upload']);
  });

  it('throws when the descriptor does not match the bytes', async () => {
    for (const body of [
      { ...good().body, sha256: 'ab'.repeat(32) },
      { ...good().body, size: 499 },
      { ...good().body, url: `http://blossom.primal.net/${SHA}.webp` },
      { ...good().body, url: 'https://127.0.0.1/x.webp' },
      { ...good().body, url: `https://blossom.primal.net/${'ab'.repeat(32)}.webp` },
      { ...good().body, url: `https://blossom.primal.net/${SHA}/other.webp` },
      'nope',
    ]) {
      const f = fakeFetch(() => ({ status: 200, body }));
      await expect(
        uploadBlob({
          server: 'https://blossom.primal.net',
          bytes: BYTES,
          type: 'image/webp',
          sign,
          now: NOW,
          fetch: f.fetch,
        }),
      ).rejects.toThrow(UPLOAD_ERRORS.mismatch);
    }
  });

  it('turns failures into plain messages', async () => {
    const cases: [ReturnType<Parameters<typeof fakeFetch>[0]>, string][] = [
      ['network', UPLOAD_ERRORS.network],
      [{ status: 401 }, UPLOAD_ERRORS.auth],
      [{ status: 413 }, UPLOAD_ERRORS.tooLarge],
      [{ status: 500 }, 'The picture server refused the upload (error 500).'],
      [{ status: 200 }, UPLOAD_ERRORS.mismatch],
    ];
    for (const [answer, message] of cases) {
      const f = fakeFetch(() => answer);
      await expect(
        uploadBlob({
          server: 'https://blossom.primal.net',
          bytes: BYTES,
          type: 'image/webp',
          sign,
          now: NOW,
          fetch: f.fetch,
        }),
      ).rejects.toThrow(message);
    }
    const f = fakeFetch(good);
    await expect(
      uploadBlob({
        server: 'http://insecure.example',
        bytes: BYTES,
        type: 'image/webp',
        sign,
        now: NOW,
        fetch: f.fetch,
      }),
    ).rejects.toThrow('https://');
    expect(f.calls).toHaveLength(0);
  });
});
