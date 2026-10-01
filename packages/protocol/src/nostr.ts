import type { RandomBytes } from '@bored-games/deck';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/** Lowercase hex text: ids and pubkeys are 64 characters, signatures 128 (D025). */
export type Hex = string;

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface NostrEvent extends EventTemplate {
  id: Hex;
  pubkey: Hex;
  sig: Hex;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const EVENT_KEYS = ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'];

export function isHex64(s: unknown): s is Hex {
  return typeof s === 'string' && HEX64.test(s);
}

/** The x-only BIP-340 public key of a 32-byte secret key, as 64 lowercase hex characters. */
export function getPublicKey(sk: Uint8Array): Hex {
  return bytesToHex(schnorr.getPublicKey(sk));
}

/** NIP-01 id: SHA-256 of the UTF-8 of `[0, pubkey, created_at, kind, tags, content]` serialized as JSON. */
export function eventId(pubkey: Hex, t: EventTemplate): Hex {
  const text = JSON.stringify([0, pubkey, t.created_at, t.kind, t.tags, t.content]);
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/**
 * Sign a template with `sk`. The BIP-340 auxiliary randomness is 32 bytes from `rnd`, so signing is
 * reproducible under a seeded source. Throws a `RangeError` when `rnd` returns the wrong length (caller error).
 */
export function finalizeEvent(t: EventTemplate, sk: Uint8Array, rnd: RandomBytes): NostrEvent {
  const aux = rnd(32);
  if (aux.length !== 32) throw new RangeError('random source returned the wrong number of bytes');
  const pubkey = getPublicKey(sk);
  const id = eventId(pubkey, t);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk, aux));
  return { kind: t.kind, created_at: t.created_at, tags: t.tags, content: t.content, id, pubkey, sig };
}

/**
 * Arrays of arrays of strings. Indexed loops, never `.every`: `.every` skips holes, so a sparse array would
 * pass, and `JSON.stringify` would then serialize each hole as `null`.
 */
function wellFormedTags(tags: unknown): tags is string[][] {
  if (!Array.isArray(tags)) return false;
  for (let i = 0; i < tags.length; i++) {
    if (!(i in tags)) return false;
    const tag: unknown = tags[i];
    if (!Array.isArray(tag)) return false;
    for (let j = 0; j < tag.length; j++) {
      if (!(j in tag) || typeof tag[j] !== 'string') return false;
    }
  }
  return true;
}

/**
 * Full NIP-01 validity: exact key set, field types and hex forms, the id recomputed from the fields, and the
 * BIP-340 signature over the id. Returns false for anything else and never throws.
 *
 * It is meant for `JSON.parse` output: plain data, read once. A hostile in-memory object (getters, proxies)
 * can still make it return false, but its fields may read differently on a later access. Callers that receive
 * raw events SHOULD check the size cap (`eventBytes(ev) ≤ MAX_EVENT_BYTES`) first, so an oversized event is
 * dropped before it is hashed.
 */
export function verifyEvent(ev: unknown): ev is NostrEvent {
  try {
    if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) return false;
    const keys = Object.keys(ev).sort();
    if (keys.length !== EVENT_KEYS.length || keys.some((k, i) => k !== EVENT_KEYS[i])) return false;
    const e = ev as Record<string, unknown>;
    const { id, pubkey, created_at, kind, tags, content, sig } = e;
    if (!isHex64(id) || !isHex64(pubkey)) return false;
    if (typeof sig !== 'string' || !HEX128.test(sig)) return false;
    if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0 || kind > 65535) return false;
    if (typeof created_at !== 'number' || !Number.isSafeInteger(created_at) || created_at < 0) return false;
    if (!wellFormedTags(tags) || typeof content !== 'string') return false;
    if (eventId(pubkey, { kind, created_at, tags, content }) !== id) return false;
    return schnorr.verify(hexToBytes(sig), hexToBytes(id), hexToBytes(pubkey));
  } catch {
    return false;
  }
}

/** The UTF-8 length of the event's serialized JSON, the quantity `MAX_EVENT_BYTES` caps. */
export function eventBytes(ev: NostrEvent): number {
  return utf8ToBytes(JSON.stringify(ev)).length;
}
