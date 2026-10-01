import { chainReaction } from '@bored-games/chain-reaction';
import {
  type EventTemplate,
  finalizeEvent,
  getPublicKey,
  type Hex,
  joinTemplate,
  makeJoinPok,
  type NostrEvent,
  parseJoin,
  parseRoot,
  parseTable,
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
