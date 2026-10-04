import { readFileSync } from 'node:fs';
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { generatePartitionedVectors, PARTITION_GROUPS } from '../scripts/vectors-v2.ts';
import {
  type Ciphertext,
  cardOf,
  cardPoint,
  cardTable,
  decodePoint,
  decodeScalar,
  decodeShare,
  decodeShuffleProof,
  decryptPosition,
  decryptWithSecrets,
  encodePoint,
  G,
  hs,
  initialDeck,
  jointKey,
  type Point,
  type Share,
  verifyShare,
  verifyShuffle,
} from '../src/index.ts';
import { shuffleTranscript } from '../src/shuffle.ts';

const FILE = new URL('./vectors/partitioned-v1.json', import.meta.url);

/** A position still in its initial trivial encryption is its card index; any other is the wire pair. */
type Entry = number | [string, string];
interface Step {
  step: number;
  move: number;
  group: string;
  seat: number;
  domain: string;
  offset: number;
  size: number;
  input: Entry[];
  output: Entry[];
  proof: unknown;
  transcript: { d: string; u: string[]; ch: string };
  packet: Entry[];
}
interface PartitionedVectors {
  version: number;
  seed: string;
  rootId: string;
  deckId: string;
  size: number;
  groups: { id: string; size: number; offset: number; domain: string }[];
  cardPoints: string[];
  seats: { seat: number; secret: string; key: string }[];
  jointKey: string;
  steps: Step[];
  shares: { seat: number; share: unknown }[];
  cards: number[];
}

function decodeEntries(entries: readonly Entry[], deckId: string): Ciphertext[] {
  return entries.map((e) =>
    typeof e === 'number'
      ? (initialDeck(deckId, e + 1)[e] as Ciphertext)
      : { a: decodePoint(e[0]), b: decodePoint(e[1]) },
  );
}

const same = (x: readonly Ciphertext[], y: readonly Ciphertext[]): boolean =>
  x.length === y.length &&
  x.every((c, i) => c.a.equals((y[i] as Ciphertext).a) && c.b.equals((y[i] as Ciphertext).b));

describe('partitioned shuffle vectors (PROTOCOL-v2 §12.2 item 2; PROTOCOL §5.5)', () => {
  it('regenerating gives partitioned-v1.json byte for byte', () => {
    expect(`${canonicalJson(generatePartitionedVectors())}\n`).toBe(readFileSync(FILE, 'utf8'));
  });

  it('every step, packet, share and card verifies from the JSON alone', () => {
    const v = JSON.parse(readFileSync(FILE, 'utf8')) as PartitionedVectors;
    expect(v.version).toBe(1);
    const { rootId, deckId, size } = v;

    // The groups tile 0..size-1 in list order; domain = <deck id>/<group id>.
    expect(v.groups.map((g) => [g.id, g.size])).toEqual(PARTITION_GROUPS.map((g) => [g.id, g.size]));
    let offset = 0;
    for (const g of v.groups) {
      expect(g.offset).toBe(offset);
      expect(g.domain).toBe(`${deckId}/${g.id}`);
      offset += g.size;
    }
    expect(offset).toBe(size);
    expect(v.cardPoints).toEqual(Array.from({ length: size }, (_, m) => encodePoint(cardPoint(deckId, m))));

    const keys: Point[] = [];
    const secrets: bigint[] = [];
    for (const [k, s] of v.seats.entries()) {
      expect(s.seat).toBe(k);
      const x = decodeScalar(s.secret);
      expect(G.multiply(x).equals(decodePoint(s.key))).toBe(true);
      keys.push(decodePoint(s.key));
      secrets.push(x);
    }
    const X = decodePoint(v.jointKey);
    expect(jointKey(keys).equals(X)).toBe(true);

    // N = groups × seats steps. Step s shuffles group s mod G, signed by seat floor(s / G), on its slice of the
    // previous packet, proven with n = the group's size and deckId = the group's domain.
    const G_ = v.groups.length;
    expect(v.steps).toHaveLength(G_ * v.seats.length);
    let packet: Ciphertext[] = initialDeck(deckId, size);
    for (const [s, step] of v.steps.entries()) {
      const group = v.groups[s % G_] as PartitionedVectors['groups'][number];
      expect(step.step).toBe(s);
      expect(step.move).toBe(s + 1);
      expect(step.group).toBe(group.id);
      expect(step.seat).toBe(Math.floor(s / G_));
      expect([step.domain, step.offset, step.size]).toEqual([group.domain, group.offset, group.size]);
      const input = decodeEntries(step.input, deckId);
      expect(same(input, packet.slice(group.offset, group.offset + group.size)), `input ${s}`).toBe(true);
      const output = decodeEntries(step.output, deckId);
      expect(output).toHaveLength(group.size);
      expect(output.every((c) => !c.a.is0())).toBe(true);
      const proof = decodeShuffleProof(step.proof, group.size);
      const ctx = { rootId, seat: step.seat, deckId: group.domain };
      expect(verifyShuffle(input, output, X, proof, ctx), `shuffle ${s}`).toBe(true);
      // The proof is bound to its group's domain and step seat.
      const other = v.groups[(s + 1) % G_] as PartitionedVectors['groups'][number];
      expect(verifyShuffle(input, output, X, proof, { ...ctx, deckId: other.domain })).toBe(false);
      expect(verifyShuffle(input, output, X, proof, { ...ctx, deckId })).toBe(false);
      expect(verifyShuffle(input, output, X, proof, { ...ctx, seat: step.seat + 1 })).toBe(false);
      // Transcript, as the verifier computes it and as PROTOCOL §5.3 writes it.
      const listed = {
        d: decodeScalar(step.transcript.d),
        u: step.transcript.u.map(decodeScalar),
        ch: decodeScalar(step.transcript.ch),
      };
      expect(shuffleTranscript(input, output, X, proof, ctx)).toEqual(listed);
      const ab = (cts: readonly Ciphertext[]) => cts.flatMap((e) => [e.a, e.b]);
      expect(listed.d).toBe(
        hs('shuffle-ctx', rootId, step.seat, group.domain, X, ...ab(input), ...ab(output)),
      );
      expect(listed.u).toEqual(proof.c.map((_, i) => hs('shuffle-u', listed.d, ...proof.c, i + 1)));
      // E_{s+1}: E_s with the group's slice replaced, every other position unchanged.
      packet = [...packet.slice(0, group.offset), ...output, ...packet.slice(group.offset + group.size)];
      expect(same(decodeEntries(step.packet, deckId), packet), `packet ${s}`).toBe(true);
    }
    expect(packet.every((c) => !c.a.is0())).toBe(true);

    // One share per (seat, global position), bound to the deck id (not a domain); they decrypt every position.
    expect(v.shares).toHaveLength(v.seats.length * size);
    const bySeat = Array.from({ length: size }, () => new Map<number, Share>());
    for (const entry of v.shares) {
      const { pos, share } = decodeShare(entry.share);
      const ct = packet[pos] as Ciphertext;
      expect(verifyShare(keys[entry.seat] as Point, ct, share, { rootId, deckId, pos })).toBe(true);
      expect(
        verifyShare(keys[entry.seat] as Point, ct, share, { rootId, deckId: `${deckId}/large`, pos }),
      ).toBe(false);
      const at = bySeat[pos] as Map<number, Share>;
      expect(at.has(entry.seat)).toBe(false);
      at.set(entry.seat, share);
    }
    const table = cardTable(deckId, size);
    const viaShares = packet.map((ct, pos) =>
      decryptPosition(ct, { rootId, deckId, pos }, keys, bySeat[pos] as Map<number, Share>, table),
    );
    const viaSecrets = packet.map((ct) => cardOf(table, decryptWithSecrets(ct, secrets)));
    expect(viaShares).toEqual(v.cards);
    expect(viaSecrets).toEqual(v.cards);
    // A card never leaves its group: each group's slice holds a permutation of that group's cards.
    for (const g of v.groups) {
      const slice = v.cards.slice(g.offset, g.offset + g.size);
      expect([...slice].sort((a, b) => a - b)).toEqual(
        Array.from({ length: g.size }, (_, i) => g.offset + i),
      );
    }
  });
});
