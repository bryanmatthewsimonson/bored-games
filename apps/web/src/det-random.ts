/*
 * Deterministic randomness for automatic events that two devices of one seat may build at the same moment (D059
 * item 2, audit-bank F3). A shuffle step and a public dice contribution are each one statement fixed by the head
 * they are built on: the same input deck, or the same roll. Built from this stream, keyed on the seat's own game
 * secrets and labelled with the game, the head and the slot, the two devices sign byte-identical events (one event
 * id), so the seat does not sign two rival moves on one parent. Pure.
 *
 * Safety: every nonce drawn here is a PRF of secrets no one else holds and of a label that fixes the statement
 * proven, so a nonce is never reused for a different statement. Only builders whose statement the label fixes may
 * use it: never a player's decision, whose action (and the cards it reveals) the label does not cover.
 */
import { sha256Hex } from '@bored-games/protocol';
import { hexToBytes } from './hex.ts';
import type { RandomBytes } from './random.ts';

const BLOCK = 64;

function sha256(bytes: Uint8Array): Uint8Array {
  return hexToBytes(sha256Hex(bytes));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** HMAC-SHA256 (RFC 2104). */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const k = new Uint8Array(BLOCK);
  k.set(key.length > BLOCK ? sha256(key) : key);
  const inner = k.map((b) => b ^ 0x36);
  const outer = k.map((b) => b ^ 0x5c);
  return sha256(concat(outer, sha256(concat(inner, message))));
}

/** The 32-byte key of a seat's deterministic streams, from its session key and deck secret (both secret). */
export function seatStreamKey(sessionSk: Uint8Array, deckSecret: bigint): Uint8Array {
  const x = hexToBytes(deckSecret.toString(16).padStart(64, '0'));
  return sha256(concat(utf8('bored-games:deterministic-build:v1\0'), sessionSk, x));
}

/**
 * An endless byte stream for `label` under `key`: block i is HMAC(HMAC(key, label), i as 4 big-endian bytes). The
 * same key and label always give the same bytes, in the same order, however they are asked for.
 */
export function deterministicRandom(key: Uint8Array, label: string): RandomBytes {
  const k = hmacSha256(key, utf8(label));
  let counter = 0;
  let buf: Uint8Array = new Uint8Array(0);
  return (n: number): Uint8Array => {
    while (buf.length < n) {
      const c = new Uint8Array(4);
      new DataView(c.buffer).setUint32(0, counter++);
      buf = concat(buf, hmacSha256(k, c));
    }
    const out = buf.slice(0, n);
    buf = buf.slice(n);
    return out;
  };
}
