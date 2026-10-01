import type { Hex } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { npubEncode, nsecEncode } from '../src/bech32.ts';
import {
  attentionBadge,
  checkNewTable,
  defaultPicks,
  freeOpenSeats,
  joinCheck,
  type LobbyLike,
  needsPicker,
  openCandidates,
  openSeats,
  parseInvitees,
  seatListFor,
  seatOptions,
  seatRows,
  shareUrl,
  splitInvitees,
  tableChip,
} from '../src/lobby-model.ts';

const key = (n: number): Hex => n.toString(16).padStart(64, '0') as Hex;
const [ME, B, C, D, E] = [1, 2, 3, 4, 5].map(key) as [Hex, Hex, Hex, Hex, Hex];
const range = { min: 3, max: 6 };

describe('seat options and open seats', () => {
  it('lists the seat counts of the module range', () => {
    expect(seatOptions(range)).toEqual([3, 4, 5, 6]);
  });
  it('computes open seats as seats - 1 - invited', () => {
    expect(openSeats(3, 0)).toBe(2);
    expect(openSeats(4, 2)).toBe(1);
    expect(openSeats(6, 5)).toBe(0);
    expect(openSeats(3, 3)).toBe(-1);
  });
});

describe('invited players box', () => {
  it('splits on lines, commas, semicolons and spaces', () => {
    expect(splitInvitees('a, b\nc;d  e\n\n')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitInvitees('  ')).toEqual([]);
  });

  it('decodes an npub and a hex key (any case) to the pubkey, with a short form', () => {
    const [byNpub, byHex, byUpper] = parseInvitees(`${npubEncode(B)}\n${C}, ${key(255).toUpperCase()}`, ME);
    expect(byNpub?.hex).toBe(B);
    expect(byNpub?.short).toMatch(/^npub1.+…\w{6}$/);
    expect(byHex?.hex).toBe(C);
    expect(byUpper?.hex).toBe(key(255));
    expect([byNpub, byHex, byUpper].map((e) => e?.error)).toEqual([null, null, null]);
  });

  it('rejects text that is not a key, bad checksums, wrong-length hex and other prefixes', () => {
    const good = npubEncode(B);
    const bad = `${good.slice(0, -1)}${good.endsWith('q') ? 'p' : 'q'}`;
    for (const text of ['hello', bad, 'abcd', key(1).slice(1), `${key(1)}0`, 'nprofile1qqqqqq']) {
      const [e] = parseInvitees(text, ME);
      expect(e?.hex, text).toBeNull();
      expect(e?.error, text).toMatch(/valid npub/);
    }
  });

  it('refuses a secret key without echoing it', () => {
    const nsec = nsecEncode(B);
    const [e] = parseInvitees(nsec, ME);
    expect(e?.hex).toBeNull();
    expect(e?.error).toMatch(/secret key/);
    expect(e?.input).toBe('');
    expect(JSON.stringify(e)).not.toContain(nsec);
  });

  it('flags a duplicate (npub and hex of the same key) and a self-invite', () => {
    const entries = parseInvitees(`${npubEncode(B)} ${B} ${ME} ${npubEncode(ME)}`, ME);
    expect(entries.map((e) => e.error)).toEqual([
      null,
      'Listed more than once.',
      'That is you: you already hold a seat.',
      'That is you: you already hold a seat.',
    ]);
  });
});

describe('new table check', () => {
  const base = { seats: 4, deadline: 259200, inviteText: '', me: ME, range };
  it('accepts an empty invitation list: every other seat is open', () => {
    expect(checkNewTable(base)).toMatchObject({ ok: true, invited: [], open: 3, errors: [] });
  });
  it('counts invited players against the seats', () => {
    expect(checkNewTable({ ...base, inviteText: `${npubEncode(B)}\n${C}` })).toMatchObject({
      ok: true,
      invited: [B, C],
      open: 1,
    });
    expect(checkNewTable({ ...base, seats: 3, inviteText: `${B} ${C}` })).toMatchObject({
      ok: true,
      open: 0,
    });
  });
  it('rejects more invitees than seats - 1, with the number to remove', () => {
    const c = checkNewTable({ ...base, seats: 3, inviteText: `${B} ${C} ${D}` });
    expect(c.ok).toBe(false);
    expect(c.open).toBe(-1);
    expect(c.errors.join(' ')).toMatch(/Too many invited players.*remove 1/);
  });
  it('is not ok while any entry is bad, and does not count it', () => {
    const c = checkNewTable({ ...base, inviteText: `${B} nonsense` });
    expect(c.ok).toBe(false);
    expect(c.open).toBe(2);
    expect(c.invited).toEqual([B]);
  });
  it('checks the seat count and deadline', () => {
    expect(checkNewTable({ ...base, seats: 2 }).ok).toBe(false);
    expect(checkNewTable({ ...base, seats: 7 }).ok).toBe(false);
    expect(checkNewTable({ ...base, deadline: 5 }).ok).toBe(false);
    for (const deadline of [86400, 259200, 604800])
      expect(checkNewTable({ ...base, deadline }).ok).toBe(true);
  });
});

/** A lobby view of a 4-seat table: creator ME, invited B, 2 open seats. */
function lobby(over: Partial<LobbyLike> = {}, joined: Hex[] = [ME], extra: Hex[] = []): LobbyLike {
  const joins = joined.map((npub) => ({ npub, id: `j${npub.slice(-2)}` as Hex }));
  const candidates = [...joins, ...extra.map((npub) => ({ npub, id: `j${npub.slice(-2)}` as Hex }))];
  return {
    table: { creator: ME, invited: [B], seats: 4, open: 2, status: 'open' },
    joins,
    candidates,
    full: false,
    root: null,
    ...over,
  };
}

describe('status chip and badges', () => {
  it('derives open, full, started, done and cancelled', () => {
    const open = { status: 'open' } as const;
    expect(tableChip(open, lobby())).toBe('open');
    expect(tableChip(open, null)).toBe('open');
    expect(tableChip(open, lobby({ full: true }))).toBe('full');
    expect(tableChip(open, lobby({ root: { id: 'r' as Hex } }))).toBe('started');
    expect(tableChip({ status: 'started' }, null)).toBe('started');
    expect(tableChip({ status: 'started' }, lobby(), 'done')).toBe('done');
    expect(tableChip({ status: 'started' }, lobby(), 'cancelled')).toBe('cancelled');
    expect(tableChip({ status: 'cancelled' }, lobby())).toBe('cancelled');
  });

  it('shows "your turn" when the game waits on the player, and "ready to start" for the creator of a full table', () => {
    expect(attentionBadge('player', 'started', 'your-turn')).toEqual({ kind: 'turn', label: 'Your turn' });
    expect(attentionBadge('player', 'started', 'waiting')).toBeNull();
    expect(attentionBadge('player', 'started')).toBeNull();
    expect(attentionBadge('creator', 'full')?.kind).toBe('start');
    expect(attentionBadge('player', 'full')).toBeNull();
    expect(attentionBadge('creator', 'open')).toBeNull();
  });
});

describe('join eligibility', () => {
  it('lets an invited player who has not joined join', () => {
    expect(joinCheck(lobby(), B)).toEqual({ eligible: true, reason: 'invited', why: '' });
  });
  it('lets a visitor take a free open seat', () => {
    expect(joinCheck(lobby(), C)).toMatchObject({ eligible: true, reason: 'open' });
    expect(joinCheck(lobby({}, [ME, B, C]), D)).toMatchObject({ eligible: true, reason: 'open' });
  });
  it('refuses the creator and anyone already seated', () => {
    expect(joinCheck(lobby(), ME).eligible).toBe(false);
    expect(joinCheck(lobby({}, [ME, B, C]), C).why).toMatch(/seated/);
    expect(joinCheck(lobby({}, [ME, B]), B).eligible).toBe(false);
  });
  it('refuses a visitor when the open seats are taken, but still lets the invited join', () => {
    const l = lobby({}, [ME, C, D]);
    expect(freeOpenSeats(l)).toBe(0);
    expect(joinCheck(l, E)).toMatchObject({ eligible: false, why: 'All open seats are taken.' });
    expect(joinCheck(l, B).eligible).toBe(true);
  });
  it('refuses on an invitation-only table, a started game and a cancelled table', () => {
    const closed = lobby();
    closed.table = { ...closed.table, open: 0, seats: 2 };
    expect(joinCheck(closed, C).why).toMatch(/invitation-only/);
    expect(joinCheck(lobby({ root: { id: 'r' as Hex } }), B).why).toMatch(/started/);
    const started = lobby();
    started.table = { ...started.table, status: 'started' };
    expect(joinCheck(started, C).eligible).toBe(false);
    const cancelled = lobby();
    cancelled.table = { ...cancelled.table, status: 'cancelled' };
    expect(joinCheck(cancelled, C).why).toMatch(/cancelled/);
    expect(joinCheck(null, C).eligible).toBe(false);
  });
});

describe('seat rows', () => {
  it('lists the creator, the invited players, then the open seats, claimed or waiting', () => {
    const rows = seatRows(lobby({}, [ME, C]), C);
    expect(rows.map((r) => [r.kind, r.npub, r.joined, r.isMe])).toEqual([
      ['creator', ME, true, false],
      ['invited', B, false, false],
      ['open', C, true, true],
      ['open', null, false, false],
    ]);
    expect(rows[3]?.short).toBeNull();
    expect(rows[0]?.short).toMatch(/^npub1/);
  });
});

describe('the creator seat picker', () => {
  // ME creator, B invited; open joiners C, D, E (C and D seated by the fold).
  const l = lobby({ full: true }, [ME, B, C, D], [E]);
  it('is needed only when more players claimed open seats than there are', () => {
    expect(needsPicker(l)).toBe(true);
    expect(needsPicker(lobby({ full: true }, [ME, B, C, D]))).toBe(false);
  });
  it('lists open joiners once each, the seated ones first', () => {
    expect(openCandidates(l).map((x) => [x.npub, x.seated])).toEqual([
      [C, true],
      [D, true],
      [E, false],
    ]);
    expect(defaultPicks(l)).toEqual([C, D]);
  });
  it('builds the seat list: creator, invited, then the chosen joiners', () => {
    const id = (p: Hex) => `j${p.slice(-2)}`;
    expect(seatListFor(l, [E, C])).toEqual([id(ME), id(B), id(E), id(C)]);
    expect(seatListFor(l, [key(99)])).toBeNull();
    expect(seatListFor(lobby({}, [ME]), [])).toBeNull();
  });
});

describe('share link', () => {
  it('keeps the page but drops ?profile and any old hash', () => {
    expect(shareUrl('https://x.example/play/?profile=bob&lang=en#/g/abc', ME, 'tbl1')).toBe(
      `https://x.example/play/?lang=en#/t/${ME}/tbl1`,
    );
    expect(shareUrl('http://localhost:5173/?profile=a', ME, 't')).toBe(`http://localhost:5173/#/t/${ME}/t`);
  });
});
