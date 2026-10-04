import { chainReaction } from '@bored-games/chain-reaction';
import { G } from '@bored-games/deck';
import { canonicalJson, createRng, shuffle } from '@bored-games/game-kit';
import {
  type EventTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  joinTemplate,
  makeJoinPok,
  type NostrEvent,
  type ParsedTable,
  parseJoin,
  parseRoot,
  parseTable,
  rulesHash,
  signSession,
  tableTemplate,
  validateRoot,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildJoinTemplate,
  buildRootTemplate,
  ClientError,
  foldLobby,
  type GameKeys,
  GameSession,
  newGameKeys,
  rootSeatOrder,
} from '../src/index.ts';
import { MODULES, RELAYS, seededRandom, T0 } from './helpers.ts';

const rnd = seededRandom('client-lobby');
const rules = chainReaction.defaultRules();

interface Player {
  sk: Uint8Array;
  npub: Hex;
  keys: GameKeys;
}
const player = (): Player => {
  const sk = newGameKeys(rnd).sessionSk;
  return { sk, npub: getPublicKey(sk), keys: newGameKeys(rnd) };
};
const creator = player();
const invited = player();
const open1 = player();
const open2 = player();

const tableEv = (invitedNpubs: Hex[], open: number, tableId = 'lobby-table') =>
  finalizeEvent(
    tableTemplate(
      {
        tableId,
        game: chainReaction.id,
        version: chainReaction.version,
        seats: 1 + invitedNpubs.length + open,
        deadline: 259200,
        invited: invitedNpubs,
        open,
        relays: RELAYS,
        status: 'open',
        rules,
      },
      T0,
    ),
    creator.sk,
    rnd,
  );

const table = tableEv([invited.npub], 1);
const parsed = parseTable(table);

const joinEv = (p: Player, createdAt: number, t: EventTemplate | null = null): NostrEvent =>
  finalizeEvent(t ?? buildJoinTemplate(parsed, p.npub, p.keys, RELAYS, rnd, createdAt), p.sk, rnd);

const fold = (events: NostrEvent[], tbl: NostrEvent = table) => foldLobby(tbl, events, MODULES);
const npubsOf = (v: ReturnType<typeof fold>) => v.joins.map((j) => j.npub);

describe('newGameKeys', () => {
  it('derives matching public keys deterministically', () => {
    const k = newGameKeys(seededRandom('keys'));
    expect(k.sessionPub).toBe(getPublicKey(k.sessionSk));
    expect(k.sessionSk).toHaveLength(32);
    expect(k.deckKey.equals(newGameKeys(seededRandom('keys')).deckKey)).toBe(true);
  });
});

describe('foldLobby', () => {
  const cJoin = joinEv(creator, T0 + 1);
  const iJoin = joinEv(invited, T0 + 2);
  const o1Join = joinEv(open1, T0 + 3);

  it('is full once the creator, the invited player and an open-seat player joined', () => {
    const partial = fold([cJoin, o1Join]);
    expect(partial.full).toBe(false);
    expect(partial.seatsFilled).toBe(2);
    const v = fold([o1Join, iJoin, cJoin]);
    expect(v.full).toBe(true);
    expect(v.seatsFilled).toBe(3);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub, open1.npub]);
    expect(v.root).toBeNull();
  });

  it('ignores a join beyond the open seats', () => {
    const o2Join = joinEv(open2, T0 + 4);
    const v = fold([cJoin, iJoin, o1Join, o2Join]);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub, open1.npub]);
    // An earlier open join takes the seat whatever the arrival order.
    const early = joinEv(open2, T0 + 2);
    expect(npubsOf(fold([early, o1Join, iJoin, cJoin]))).toEqual([creator.npub, invited.npub, open2.npub]);
  });

  it('ignores a join with a bad proof of knowledge', () => {
    const other = newGameKeys(rnd);
    const bad = joinEv(
      open1,
      T0 + 1,
      joinTemplate(
        {
          tableAddress: parsed.address,
          creator: parsed.creator,
          deckKey: open1.keys.deckKey,
          pok: makeJoinPok(other.deckSecret, parsed.address, open1.npub, open1.keys.sessionPub, rnd),
          relays: RELAYS,
          session: open1.keys.sessionPub,
          sessionSig: signSession(open1.keys.sessionSk, parsed.address, open1.npub, rnd),
          rulesHash: parseJoin(o1Join).rulesHash,
          version: parsed.version,
        },
        T0 + 1,
      ),
    );
    const v = fold([cJoin, iJoin, bad]);
    expect(v.full).toBe(false);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub]);
  });

  it('keeps the earliest of duplicate joins from one npub, the lowest id on a tie', () => {
    const later = joinEv({ ...open1, keys: newGameKeys(rnd) }, T0 + 9);
    const v = fold([cJoin, iJoin, later, o1Join]);
    expect(v.joins.find((j) => j.npub === open1.npub)?.id).toBe(o1Join.id);
    const a = joinEv({ ...open1, keys: newGameKeys(rnd) }, T0 + 3);
    const lowest = a.id < o1Join.id ? a : o1Join;
    expect(fold([cJoin, iJoin, a, o1Join]).joins.at(-1)?.id).toBe(lowest.id);
    expect(fold([cJoin, iJoin, o1Join, a]).joins.at(-1)?.id).toBe(lowest.id);
  });

  it('ignores garbage, other tables, and joins committed to other rules or another version', () => {
    const otherTable = parseTable(tableEv([invited.npub], 1, 'another-table'));
    const forged = (t: typeof parsed) =>
      joinEv(open1, T0 + 3, buildJoinTemplate(t, open1.npub, open1.keys, RELAYS, rnd, T0 + 3));
    const wrongTable = forged(otherTable);
    const wrongRules = forged({ ...parsed, rules: { ...(rules as object), x: 1 } });
    const wrongVersion = forged({ ...parsed, version: '9.9.9' });
    const v = fold([
      { nonsense: true } as unknown as NostrEvent,
      { ...cJoin, sig: 'f'.repeat(128) },
      table,
      wrongTable,
      wrongRules,
      wrongVersion,
      cJoin,
    ]);
    expect(npubsOf(v)).toEqual([creator.npub]);
  });

  it('puts the creator first even when it joins last, and is not full without the creator', () => {
    expect(npubsOf(fold([o1Join, iJoin, cJoin]))[0]).toBe(creator.npub);
    const noCreator = fold([o1Join, iJoin]);
    expect(noCreator.full).toBe(false);
    expect(() => buildRootTemplate(noCreator, RELAYS, T0 + 10)).toThrow(ClientError);
  });

  it('throws ClientError for an invalid table', () => {
    expect(() => foldLobby({ ...table, sig: '0'.repeat(128) }, [], MODULES)).toThrow(ClientError);
  });
});

describe('root assembly', () => {
  const events = [joinEv(creator, T0 + 1), joinEv(invited, T0 + 2), joinEv(open1, T0 + 3)];
  const view = fold(events);

  it('orders seats with the creator first', () => {
    expect(rootSeatOrder(view).map((j) => j.npub)).toEqual([creator.npub, invited.npub, open1.npub]);
  });

  it('builds a root that validates and starts a session', () => {
    expect(view.full).toBe(true);
    const root = finalizeEvent(buildRootTemplate(view, RELAYS, T0 + 10), creator.sk, rnd);
    const joinsById = new Map(view.joins.map((j) => [j.id, j]));
    expect(validateRoot(parseRoot(root), view.table, joinsById, MODULES)).toEqual([]);

    const session = GameSession.create({
      modules: MODULES,
      table,
      joins: events,
      root,
      me: { seat: 2, sessionSk: open1.keys.sessionSk, deckSecret: open1.keys.deckSecret },
      rootSeenAt: T0 + 10,
    });
    expect(session.view().seats).toBe(3);
    expect(session.view().mySeat).toBe(2);
    expect(session.view().rootId).toBe(root.id);

    expect(fold([...events, root]).root?.id).toBe(root.id);
  });

  it('ignores a root that does not validate, and picks the first valid one', () => {
    const t = buildRootTemplate(view, RELAYS, T0 + 10);
    const tampered = finalizeEvent(
      { ...t, tags: t.tags.map((x) => (x[0] === 'deadline' ? ['deadline', '86400'] : x)) },
      creator.sk,
      rnd,
    );
    const good = finalizeEvent(t, creator.sk, rnd);
    const later = finalizeEvent({ ...t, created_at: T0 + 20 }, creator.sk, rnd);
    expect(fold([...events, tampered]).root).toBeNull();
    expect(fold([...events, later, tampered, good]).root?.id).toBe(good.id);
    expect(fold([...events, finalizeEvent(t, open1.sk, rnd)]).root).toBeNull();
  });
});

/* ---------------------------------------------------------------- collisions, recovery and order (D033) */

/** 32 big-endian bytes of a scalar. */
const scalarBytes = (x: bigint): Uint8Array =>
  Uint8Array.from(Buffer.from(x.toString(16).padStart(64, '0'), 'hex'));

interface RawKeys {
  sessionSk: Uint8Array;
  deckSecret: bigint;
}

/** A Join by `p` with arbitrary keys, bypassing `buildJoinTemplate`'s checks: valid PoK and session signature. */
const rawJoin = (p: Player, k: RawKeys, createdAt: number, t: ParsedTable = parsed): NostrEvent => {
  const session = getPublicKey(k.sessionSk);
  const template = joinTemplate(
    {
      tableAddress: t.address,
      creator: t.creator,
      deckKey: G.multiply(k.deckSecret),
      pok: makeJoinPok(k.deckSecret, t.address, p.npub, session, rnd),
      relays: RELAYS,
      session,
      sessionSig: signSession(k.sessionSk, t.address, p.npub, rnd),
      rulesHash: rulesHash(t.rules),
      version: t.version,
    },
    createdAt,
  );
  return finalizeEvent(template, p.sk, rnd);
};

/** A plain-JSON digest of a lobby view, for canonical comparison. */
const digest = (v: ReturnType<typeof fold>): string =>
  canonicalJson({
    joins: v.joins.map((j) => ({
      id: j.id,
      npub: j.npub,
      session: j.session,
      deckKey: j.deckKey.toHex(true),
    })),
    candidates: v.candidates.map((j) => j.id),
    seatsFilled: v.seatsFilled,
    full: v.full,
    root: v.root?.id ?? null,
  });

const seatOf = (v: ReturnType<typeof fold>, p: Player) => v.joins.find((j) => j.npub === p.npub)?.id ?? null;

describe('foldLobby: collisions', () => {
  const cJoin = joinEv(creator, T0 + 1);
  const iJoin = joinEv(invited, T0 + 2);
  const fresh = (p: Player, createdAt: number) => joinEv({ ...p, keys: newGameKeys(rnd) }, createdAt);

  it('drops a Join whose session key is its own npub', () => {
    const self = rawJoin(open1, { sessionSk: open1.sk, deckSecret: open1.keys.deckSecret }, T0 + 3);
    const v = fold([cJoin, iJoin, self]);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub]);
    expect(v.candidates.map((j) => j.id)).not.toContain(self.id);
    // A later Join with proper keys takes the seat.
    const again = fresh(open1, T0 + 9);
    expect(seatOf(fold([cJoin, iJoin, self, again]), open1)).toBe(again.id);
  });

  it("drops a Join whose session key is its deck key's x-coordinate", () => {
    const x = open1.keys.deckSecret;
    const self = rawJoin(open1, { sessionSk: scalarBytes(x), deckSecret: x }, T0 + 3);
    expect(parseJoin(self).session).toBe(G.multiply(x).toHex(true).slice(2));
    const v = fold([cJoin, iJoin, self]);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub]);
    expect(v.candidates.map((j) => j.id)).not.toContain(self.id);
  });

  it("skips a Join that reuses a seated session key, and seats the npub's later Join in its slot", () => {
    // open1 holds the creator's session key (a shared or buggy client): the signature is valid, the seat is not.
    const clash = rawJoin(
      open1,
      { sessionSk: creator.keys.sessionSk, deckSecret: open1.keys.deckSecret },
      T0 + 3,
    );
    expect(npubsOf(fold([cJoin, iJoin, clash]))).toEqual([creator.npub, invited.npub]);
    const later = fresh(open1, T0 + 9);
    const o2 = joinEv(open2, T0 + 5);
    const v = fold([cJoin, iJoin, clash, o2, later]);
    // open1's slot is its earliest Join (T0 + 3), ahead of open2's (T0 + 5).
    expect(seatOf(v, open1)).toBe(later.id);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub, open1.npub]);
    expect(v.full).toBe(true);
  });

  it('skips a Join that reuses a seated deck key', () => {
    const clash = rawJoin(
      open1,
      { sessionSk: open1.keys.sessionSk, deckSecret: creator.keys.deckSecret },
      T0 + 3,
    );
    expect(npubsOf(fold([cJoin, iJoin, clash]))).toEqual([creator.npub, invited.npub]);
    const later = fresh(open1, T0 + 9);
    expect(seatOf(fold([cJoin, iJoin, clash, later]), open1)).toBe(later.id);
  });

  it('skips a Join whose session key is a seated npub', () => {
    const clash = rawJoin(open1, { sessionSk: creator.sk, deckSecret: open1.keys.deckSecret }, T0 + 3);
    expect(npubsOf(fold([cJoin, iJoin, clash]))).toEqual([creator.npub, invited.npub]);
    const later = fresh(open1, T0 + 9);
    expect(seatOf(fold([cJoin, iJoin, clash, later]), open1)).toBe(later.id);
  });

  it('skips a Join whose npub is a seated session key, and the open seat goes to the next joiner', () => {
    const sk = creator.keys.sessionSk;
    const twin: Player = { sk, npub: getPublicKey(sk), keys: newGameKeys(rnd) };
    expect(twin.npub).toBe(creator.keys.sessionPub);
    const clash = joinEv(twin, T0 + 3);
    expect(npubsOf(fold([cJoin, iJoin, clash]))).toEqual([creator.npub, invited.npub]);
    const o2 = joinEv(open2, T0 + 5);
    expect(npubsOf(fold([cJoin, iJoin, clash, o2]))).toEqual([creator.npub, invited.npub, open2.npub]);
  });

  it('an invited player whose earlier Join collides re-joins with fresh keys and is seated', () => {
    const clash = rawJoin(
      invited,
      { sessionSk: invited.keys.sessionSk, deckSecret: creator.keys.deckSecret },
      T0 + 2,
    );
    const o1 = joinEv(open1, T0 + 3);
    const before = fold([cJoin, clash, o1]);
    expect(npubsOf(before)).toEqual([creator.npub, open1.npub]);
    expect(before.full).toBe(false);
    const again = fresh(invited, T0 + 20);
    const after = fold([cJoin, clash, o1, again]);
    expect(seatOf(after, invited)).toBe(again.id);
    expect(after.full).toBe(true);
    // The root built from it validates.
    const root = finalizeEvent(buildRootTemplate(after, RELAYS, T0 + 30), creator.sk, rnd);
    expect(fold([cJoin, clash, o1, again, root]).root?.id).toBe(root.id);
  });
});

describe('foldLobby: the session-copy attack (D033)', () => {
  const cJoin = joinEv(creator, T0 + 1);
  const iJoin = joinEv(invited, T0 + 2);

  it('cannot evict a player by copying their session key: the copied Join does not parse', () => {
    const victim = parseJoin(iJoin);
    // open2 copies invited's session and sessionSig, with its own deck key and a PoK bound to the copied session,
    // and backdates the Join so it would come first.
    const copy = finalizeEvent(
      joinTemplate(
        {
          tableAddress: parsed.address,
          creator: parsed.creator,
          deckKey: open2.keys.deckKey,
          pok: makeJoinPok(open2.keys.deckSecret, parsed.address, open2.npub, victim.session, rnd),
          relays: RELAYS,
          session: victim.session,
          sessionSig: victim.sessionSig,
          rulesHash: victim.rulesHash,
          version: victim.version,
        },
        T0 - 100,
      ),
      open2.sk,
      rnd,
    );
    expect(() => parseJoin(copy)).toThrow(/sessionSig/);
    const v = fold([copy, cJoin, iJoin]);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub]);
    expect(v.candidates.map((j) => j.id)).not.toContain(copy.id);
  });
});

describe('foldLobby: order and hostile input', () => {
  const cJoin = joinEv(creator, T0 + 1);
  const iJoin = joinEv(invited, T0 + 2);
  const o1Join = joinEv(open1, T0 + 3);
  const o2Join = joinEv(open2, T0 + 3);
  const clash = rawJoin(
    open1,
    { sessionSk: creator.keys.sessionSk, deckSecret: open1.keys.deckSecret },
    T0 + 1,
  );
  const iAgain = joinEv({ ...invited, keys: newGameKeys(rnd) }, T0 + 2);

  it('gives an identical result for the same events in any order', () => {
    const base = fold([cJoin, iJoin, o1Join, o2Join, clash, iAgain]);
    const root = finalizeEvent(buildRootTemplate(base, RELAYS, T0 + 10), creator.sk, rnd);
    const events = [cJoin, iJoin, o1Join, o2Join, clash, iAgain, root, cJoin, table];
    const prng = createRng('lobby-permutations');
    const orders = [0, 1, 2].map(() => shuffle(events, prng));
    expect(new Set(orders.map((o) => o.map((e) => e.id).join())).size).toBe(3);
    const digests = orders.map((o) => digest(fold(o)));
    expect(new Set(digests).size).toBe(1);
    expect(digests[0]).toBe(digest(fold(events)));
    expect(fold(events).root?.id).toBe(root.id);
  });

  it('never lets a backdated open Join displace an invited player', () => {
    const early1 = joinEv(open1, T0 - 10_000);
    const early2 = joinEv(open2, T0 - 9_000);
    const lateInvited = joinEv(invited, T0 + 500);
    const v = fold([early1, early2, cJoin, lateInvited]);
    expect(npubsOf(v)).toEqual([creator.npub, invited.npub, open1.npub]);
    expect(v.full).toBe(true);
    // With no open seat, an uninvited joiner is never seated at all.
    const closed = tableEv([invited.npub, open2.npub], 0, 'closed-table');
    const t = parseTable(closed);
    const joins = [
      rawJoin(open1, open1.keys, T0 - 10_000, t),
      rawJoin(creator, creator.keys, T0 + 1, t),
      rawJoin(invited, invited.keys, T0 + 2, t),
    ];
    expect(npubsOf(fold(joins, closed))).toEqual([creator.npub, invited.npub]);
  });

  it('ignores hostile entries without throwing', () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    const junk = [
      null,
      undefined,
      7,
      'join',
      [],
      {},
      { kind: 7451 },
      { kind: 7450, tags: 5 },
      { ...cJoin, created_at: 'soon' },
      throwing,
    ] as unknown as NostrEvent[];
    const v = fold([...junk, cJoin]);
    expect(npubsOf(v)).toEqual([creator.npub]);
    expect(v.root).toBeNull();
  });
});

describe('buildJoinTemplate: key checks', () => {
  it("refuses a session public key that is not the secret key's", () => {
    const keys = { ...open1.keys, sessionPub: open2.keys.sessionPub };
    expect(() => buildJoinTemplate(parsed, open1.npub, keys, RELAYS, rnd, T0)).toThrow(ClientError);
    const badSk = { ...open1.keys, sessionSk: new Uint8Array(32) };
    expect(() => buildJoinTemplate(parsed, open1.npub, badSk, RELAYS, rnd, T0)).toThrow(ClientError);
  });

  it("refuses a session key equal to the npub or to the deck key's x-coordinate", () => {
    const asNpub = { ...open1.keys, sessionSk: open1.sk, sessionPub: open1.npub };
    expect(() => buildJoinTemplate(parsed, open1.npub, asNpub, RELAYS, rnd, T0)).toThrow(ClientError);
    const x = open1.keys.deckSecret;
    const asDeck = { ...open1.keys, sessionSk: scalarBytes(x), sessionPub: getPublicKey(scalarBytes(x)) };
    expect(() => buildJoinTemplate(parsed, open1.npub, asDeck, RELAYS, rnd, T0)).toThrow(ClientError);
  });
});

describe('buildRootTemplate: an explicit seat list', () => {
  const cJoin = joinEv(creator, T0 + 1);
  const iJoin = joinEv(invited, T0 + 2);
  const o1Join = joinEv(open1, T0 + 3);
  const o2Join = joinEv(open2, T0 + 4);
  const clash = rawJoin(
    open2,
    { sessionSk: invited.keys.sessionSk, deckSecret: open2.keys.deckSecret },
    T0 + 5,
  );
  const events = [cJoin, iJoin, o1Join, o2Join, clash];
  const view = fold(events);

  it('lets the creator pick another open joiner, in any order after its own seat', () => {
    expect(npubsOf(view)).toEqual([creator.npub, invited.npub, open1.npub]);
    for (const ids of [
      [cJoin.id, iJoin.id, o2Join.id],
      [cJoin.id, o2Join.id, iJoin.id],
    ]) {
      const root = finalizeEvent(buildRootTemplate(view, RELAYS, T0 + 10, ids), creator.sk, rnd);
      const parsedRoot = parseRoot(root);
      expect(parsedRoot.joinIds).toEqual(ids);
      const joinsById = new Map(view.candidates.map((j) => [j.id, j]));
      expect(validateRoot(parsedRoot, view.table, joinsById, MODULES)).toEqual([]);
      expect(fold([...events, root]).root?.id).toBe(root.id);
    }
  });

  it('works on a lobby that is not full by default, and still checks collisions', () => {
    const partial = fold([cJoin, iJoin, clash]);
    expect(partial.full).toBe(false);
    expect(() => buildRootTemplate(partial, RELAYS, T0 + 10)).toThrow(ClientError);
    expect(() => buildRootTemplate(partial, RELAYS, T0 + 10, [cJoin.id, iJoin.id, clash.id])).toThrow(
      /collides/,
    );
    const late = fold([cJoin, iJoin, o2Join]);
    expect(late.full).toBe(true);
    expect(
      parseRoot(
        finalizeEvent(
          buildRootTemplate(late, RELAYS, T0 + 10, [cJoin.id, o2Join.id, iJoin.id]),
          creator.sk,
          rnd,
        ),
      ).joinIds,
    ).toEqual([cJoin.id, o2Join.id, iJoin.id]);
  });

  it('rejects an invalid list', () => {
    const again = joinEv({ ...creator, keys: newGameKeys(rnd) }, T0 + 6);
    const v = fold([...events, again]);
    const bad: [Hex[], RegExp][] = [
      [[iJoin.id, cJoin.id, o2Join.id], /creator/],
      [[cJoin.id, o1Join.id, o2Join.id], /invited/],
      [[cJoin.id, iJoin.id], /2 seats listed/],
      [[cJoin.id, iJoin.id, o1Join.id, o2Join.id], /4 seats listed/],
      [[cJoin.id, iJoin.id, 'f'.repeat(64)], /not a valid Join/],
      [[cJoin.id, iJoin.id, iJoin.id], /listed twice/],
      [[cJoin.id, iJoin.id, again.id], /collides/],
      [[cJoin.id, iJoin.id, clash.id], /collides/],
    ];
    for (const [ids, why] of bad) {
      expect(() => buildRootTemplate(v, RELAYS, T0 + 10, ids), ids.join()).toThrow(ClientError);
      expect(() => buildRootTemplate(v, RELAYS, T0 + 10, ids), ids.join()).toThrow(why);
    }
  });
});

describe('protocol versions in the lobby (PROTOCOL-v2 §2)', () => {
  const v2Table = finalizeEvent(
    tableTemplate(
      {
        tableId: 'lobby-table',
        game: chainReaction.id,
        version: chainReaction.version,
        seats: 3,
        deadline: 259200,
        invited: [invited.npub],
        open: 1,
        relays: RELAYS,
        status: 'open',
        rules,
        proto: '2',
      },
      T0,
    ),
    creator.sk,
    rnd,
  );
  const parsed2 = parseTable(v2Table);
  const join2 = (p: Player, at: number) =>
    finalizeEvent(buildJoinTemplate(parsed2, p.npub, p.keys, RELAYS, rnd, at), p.sk, rnd);
  const v2Joins = [join2(creator, T0 + 1), join2(invited, T0 + 2), join2(open1, T0 + 3)];
  const v1Joins = [joinEv(creator, T0 + 1), joinEv(invited, T0 + 2), joinEv(open1, T0 + 3)];

  it("V2-01 (partial) Joins and roots carry the table's proto, and a Join of another proto is ignored (V2-02)", () => {
    // One table address, two protos: each fold seats only the Joins of its own table's proto.
    expect(parsed2.address).toBe(parsed.address);
    expect(v2Joins.map((j) => j.tags.filter((t) => t[0] === 'proto'))).toEqual(
      v2Joins.map(() => [['proto', '2']]),
    );
    const v2 = foldLobby(v2Table, [...v1Joins, ...v2Joins], MODULES);
    expect(v2.full).toBe(true);
    expect(v2.candidates.map((j) => j.proto)).toEqual(['2', '2', '2']);
    const v1 = fold([...v1Joins, ...v2Joins]);
    expect(v1.candidates.map((j) => j.proto)).toEqual(['1', '1', '1']);
    expect(foldLobby(v2Table, v1Joins, MODULES).seatsFilled).toBe(0);

    const root2 = finalizeEvent(buildRootTemplate(v2, RELAYS, T0 + 10), creator.sk, rnd);
    expect(root2.tags.filter((t) => t[0] === 'proto')).toEqual([['proto', '2']]);
    expect(
      validateRoot(parseRoot(root2), v2.table, new Map(v2.joins.map((j) => [j.id, j])), MODULES),
    ).toEqual([]);
    expect(foldLobby(v2Table, [...v2Joins, root2], MODULES).root?.id).toBe(root2.id);
    // A v1 table's fold never takes the v2 root.
    expect(fold([...v1Joins, root2]).root).toBeNull();
  });

  it('the v1 session refuses a proto-2 root: v1 folds only proto-1 games', () => {
    const v2 = foldLobby(v2Table, v2Joins, MODULES);
    const root2 = finalizeEvent(buildRootTemplate(v2, RELAYS, T0 + 10), creator.sk, rnd);
    expect(() =>
      GameSession.create({
        modules: MODULES,
        table: v2Table,
        joins: v2Joins,
        root: root2,
        me: null,
        rootSeenAt: T0 + 10,
      }),
    ).toThrow(new ClientError('the root is proto 2, not a v1 game'));
  });
});
