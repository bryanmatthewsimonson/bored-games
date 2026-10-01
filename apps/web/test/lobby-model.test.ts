import type { Hex } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { npubEncode, nsecEncode } from '../src/bech32.ts';
import {
  attentionBadge,
  cardGameStatus,
  checkNewTable,
  defaultPicks,
  freeOpenSeats,
  joinButtonLabel,
  joinCheck,
  joinRequestPending,
  type LobbyLike,
  needsPicker,
  openCandidates,
  openSeats,
  parseInvitees,
  REQUEST_PENDING,
  STATUS_FRESH_S,
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

describe('a game status saved by the game screen, on a Home card', () => {
  const at = 10_000;
  const entry = (status: string, age: number) => ({ status, updatedAt: at - age });

  it('shows "Your turn", "Done" and "Cancelled" from the saved status', () => {
    const started = { status: 'started' } as const;
    const lobbyView = lobby({ root: { id: 'r' as Hex } });
    const turn = cardGameStatus(entry('your-turn', 5), at);
    expect(turn).toEqual({ status: 'your-turn', check: false });
    expect(attentionBadge('player', tableChip(started, lobbyView, turn.status), turn.status)).toEqual({
      kind: 'turn',
      label: 'Your turn',
    });
    const done = cardGameStatus(entry('done', 5), at);
    expect(tableChip(started, lobbyView, done.status)).toBe('done');
    const cancelled = cardGameStatus(entry('cancelled', 5), at);
    expect(tableChip(started, lobbyView, cancelled.status)).toBe('cancelled');
    const waiting = cardGameStatus(entry('waiting', 5), at);
    expect(waiting).toEqual({ status: 'waiting', check: false });
    expect(
      attentionBadge('player', tableChip(started, lobbyView, waiting.status), waiting.status),
    ).toBeNull();
  });
  it('asks to open the game when nothing is saved, or a passing status is older than ten minutes', () => {
    expect(cardGameStatus(null, at)).toEqual({ status: null, check: true });
    expect(cardGameStatus(entry('waiting', STATUS_FRESH_S), at).check).toBe(false);
    expect(cardGameStatus(entry('waiting', STATUS_FRESH_S + 1), at)).toEqual({ status: null, check: true });
    expect(cardGameStatus(entry('working', 3600), at).check).toBe(true);
  });
  it('keeps a turn that waits on the player and a game that has ended, however old', () => {
    expect(cardGameStatus(entry('your-turn', 86_400), at)).toEqual({ status: 'your-turn', check: false });
    expect(cardGameStatus(entry('done', 86_400), at)).toEqual({ status: 'done', check: false });
    expect(cardGameStatus(entry('cancelled', 86_400), at)).toEqual({ status: 'cancelled', check: false });
  });
  it('ignores a status it does not know', () => {
    expect(cardGameStatus(entry('syncing', 1), at)).toEqual({ status: null, check: true });
    expect(cardGameStatus(entry('bogus', 1), at).check).toBe(true);
  });
});

describe('a join request waiting for the creator', () => {
  // ME creator, B invited; open joiners C and D are seated, E asked too and is not.
  const full = lobby({ full: true }, [ME, B, C, D], [E]);
  it('is pending for a valid Join that holds no seat', () => {
    expect(joinRequestPending(full, E)).toBe(true);
    expect(joinCheck(full, E)).toEqual({ eligible: false, reason: null, why: REQUEST_PENDING });
    expect(REQUEST_PENDING).toBe('Your request to join is in. The creator picks who plays.');
  });
  it('is not pending for the seated, the creator, the invited or a stranger', () => {
    expect(joinRequestPending(full, C)).toBe(false);
    expect(joinRequestPending(full, ME)).toBe(false);
    expect(joinRequestPending(full, B)).toBe(false);
    expect(joinRequestPending(full, key(99))).toBe(false);
    expect(joinCheck(full, key(99)).why).toBe('All open seats are taken.');
    expect(joinRequestPending(null, E)).toBe(false);
  });
  it('ends once the game has started or the table is cancelled', () => {
    expect(joinRequestPending({ ...full, root: { id: 'r' as Hex } }, E)).toBe(false);
    const cancelled = lobby({ full: true }, [ME, B, C, D], [E]);
    cancelled.table = { ...cancelled.table, status: 'cancelled' };
    expect(joinRequestPending(cancelled, E)).toBe(false);
  });
  it("is not offered Join again, and the creator's picker lists the request", () => {
    expect(joinCheck(full, E).eligible).toBe(false);
    expect(openCandidates(full).map((c) => c.npub)).toContain(E);
  });
});

describe('the join button name', () => {
  it("starts with the visible text and ends with the creator's short npub", () => {
    const short = npubEncode(ME);
    for (const text of ['Join', 'Accept invitation']) {
      const name = joinButtonLabel(text, ME);
      expect(name.startsWith(text)).toBe(true);
      expect(name).toContain(`${short.slice(0, 10)}…${short.slice(-6)}`);
      expect(name).not.toContain(ME.slice(0, 8));
    }
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

  it('drops a ?relays override', () => {
    expect(shareUrl('http://localhost:4173/?profile=a&relays=ws://localhost:9', ME, 't')).toBe(
      `http://localhost:4173/#/t/${ME}/t`,
    );
  });
});
