import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodePoint, initialDeck, verifyShuffle } from '@bored-games/deck';
import { canonicalJson } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import {
  generateLogHashVectors,
  generateParserVectors,
  type LogHashLine,
  type ParserCase,
  verdictOf,
} from '../scripts/vectors-v2.ts';
import { logHash, type ParsedMove, parseAttestV2, parseMove } from '../src/game.ts';
import { type Hex, type NostrEvent, verifyEvent } from '../src/nostr.ts';

/* PROTOCOL-v2 §12.2 items 3 (parser vectors) and 4 (log hashes), written by scripts/vectors-v2.ts. */

const PARSERS = new URL('./vectors/v2-parsers.json', import.meta.url);
const LOGHASH = new URL('./vectors/loghash.json', import.meta.url);

describe('protocol v2 parser vectors (§12.2 item 3)', () => {
  const text = readFileSync(PARSERS, 'utf8');
  const v = JSON.parse(text) as { version: number; cases: ParserCase[] };

  it('regenerating gives the file byte for byte', () => {
    expect(`${canonicalJson(generateParserVectors())}\n`).toBe(text);
  });

  it('every case parses to its listed verdict and summary, from the JSON alone', () => {
    expect(v.version).toBe(1);
    expect(new Set(v.cases.map((c) => c.name)).size).toBe(v.cases.length);
    for (const c of v.cases) {
      expect(verifyEvent(c.event), `${c.name}: a signed NOSTR event`).toBe(true);
      expect(verdictOf(c.parser, c.game, c.event), c.name).toEqual({ verdict: c.verdict, parsed: c.parsed });
    }
  });

  it('covers every listed accepted and rejected case', () => {
    const verdicts = (prefix: string) =>
      Object.fromEntries(v.cases.filter((c) => c.name.startsWith(prefix)).map((c) => [c.name, c.verdict]));
    const accepted = (prefix: string) =>
      Object.values(verdicts(prefix)).filter((x) => x === 'accepted').length;
    expect(accepted('shares:')).toBe(3);
    expect(accepted('end attestation:')).toBe(5);
    expect(accepted('stats attestation')).toBe(3);
    expect(accepted('device note:')).toBe(2);
    expect(verdicts('shares:')).toMatchObject({
      'shares: missing anchor tag': 'bad-tag',
      'shares: doubled anchor tag': 'bad-tag',
      'shares: a third e tag': 'bad-tag',
      'shares: empty list (card)': 'bad-content',
      'shares: descending pos': 'bad-content',
      'shares: card variant with a move key': 'bad-content',
      'shares: non-hex move': 'bad-content',
    });
    expect(verdicts('end attestation:')).toMatchObject({
      'end attestation: missing head tag': 'bad-tag',
      'end attestation: over with a forfeit': 'bad-content',
      'end attestation: unsorted forfeit': 'bad-content',
      'end attestation: an extra key in end': 'bad-content',
    });
    expect(verdicts('stats attestation:')).toMatchObject({
      'stats attestation: endedBy fork (no frozen ends in v2)': 'bad-content',
      'stats attestation: with a head tag': 'bad-tag',
    });
    expect(verdicts('device note:')).toMatchObject({
      'device note: device of 31 hex characters': 'bad-content',
      'device note: n = 0': 'bad-content',
    });
    // Proto: each in-game kind is accepted exactly at its own game's proto, and nowhere else.
    const proto = v.cases.filter((c) => c.name.startsWith('proto:'));
    expect(proto.length).toBe(6 * 7 * 2);
    for (const c of proto) {
      const own = c.name.includes(`with "${c.game}", in a v${c.game} game`);
      const v1SharesForm = c.game === '1' && (c.parser === 'shares' || c.parser === 'attest');
      expect(c.verdict === 'accepted', c.name).toBe(own && !v1SharesForm);
      if (!own) expect(c.verdict, c.name).toBe('bad-proto');
    }
  });
});

describe('end attestation log hashes (§12.2 item 4)', () => {
  const text = readFileSync(LOGHASH, 'utf8');
  const v = JSON.parse(text) as {
    rootId: Hex;
    deckId: string;
    size: number;
    seats: { seat: number; session: Hex }[];
    jointKey: string;
    moves: NostrEvent[];
    lines: LogHashLine[];
    endAttestation: NostrEvent;
  };

  it('regenerating gives the file byte for byte', () => {
    expect(`${canonicalJson(generateLogHashVectors())}\n`).toBe(text);
  });

  it('each line is the prev chain from its head down to the root, hashed as PROTOCOL §4.8 says', () => {
    const moves = new Map<Hex, ParsedMove>();
    for (const ev of v.moves) {
      expect(verifyEvent(ev)).toBe(true);
      const m = parseMove(ev, v.size, '2');
      expect(m.rootId).toBe(v.rootId);
      moves.set(m.id, m);
    }
    // The shuffle steps are real: each verifies against the one before it, so the line is a real game's.
    const X = decodePoint(v.jointKey);
    let deck = initialDeck(v.deckId, v.size);
    for (const m of moves.values()) {
      if (m.content.type !== 'shuffle') continue;
      const seat = m.seq - 1;
      expect(m.pubkey).toBe(v.seats[seat]?.session);
      expect(
        verifyShuffle(deck, m.content.deck, X, m.content.proof, { rootId: v.rootId, seat, deckId: v.deckId }),
      ).toBe(true);
      deck = m.content.deck;
    }

    expect(v.lines.map((l) => l.name)).toEqual([
      'the empty line (the root)',
      'a shuffle-only line',
      'a line through game actions',
    ]);
    for (const line of v.lines) {
      const ids: Hex[] = [];
      for (let at = line.head; at !== v.rootId; ) {
        const m = moves.get(at);
        if (m === undefined) throw new Error(`${line.name}: ${at} is not a held move`);
        ids.unshift(m.id);
        at = m.prevId;
      }
      expect(ids.map((id) => moves.get(id)?.seq)).toEqual(ids.map((_, i) => i + 1));
      expect(ids, line.name).toEqual(line.moveIds);
      const independent = createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');
      expect(line.logHash, line.name).toBe(independent);
      expect(logHash(ids), line.name).toBe(independent);
    }
    const [empty, shuffles, actions] = v.lines as [LogHashLine, LogHashLine, LogHashLine];
    expect(empty.logHash).toBe(createHash('sha256').update('').digest('hex'));
    expect(shuffles.moveIds.every((id) => moves.get(id)?.content.type === 'shuffle')).toBe(true);
    expect(actions.moveIds.map((id) => moves.get(id)?.content.type)).toEqual([
      'shuffle',
      'shuffle',
      'action',
      'action',
    ]);
  });

  it('the end attestation names the line through game actions by its head and log hash', () => {
    const last = v.lines[2] as LogHashLine;
    const a = parseAttestV2(v.endAttestation);
    expect(a).toMatchObject({
      variant: 'end',
      rootId: v.rootId,
      headId: last.head,
      end: { kind: 'over', forfeit: [], logHash: last.logHash },
    });
  });
});
