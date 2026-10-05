/*
 * The protocol 2 lobby (v2 build T14; PROTOCOL-v2 §2): this build creates its tables, Joins and roots at proto 2;
 * it lists a protocol 1 Bank or Luster table as made by an older version and never joins or starts one; protocol 1
 * Chain Reaction and Chess tables stay joinable under v1; a table no engine here can play is not listed. Real lobby
 * controllers against the dev relay; "an older client" is a build from before protocol 2 (`ControllerDeps.olderClient`).
 */
import { BANK_V1_VERSION, BANK_VERSION, DEFAULT_RULES as BANK_RULES } from '@bored-games/bank';
import { DEFAULT_RULES as LUSTER_RULES } from '@bored-games/luster';
import { finalizeEvent, KIND, type NostrEvent, parseTable, tableTemplate } from '@bored-games/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { joinCheck, OLDER_VERSION_TABLE, olderTable } from '../src/lobby-model.ts';
import { MODULES } from '../src/net.ts';
import { Harness, now, OLDER, OLDER_BANK_CLIENT, pause, rnd, waitFor } from './net-harness.ts';

const h = new Harness();
beforeEach(() => h.setup());
afterEach(() => h.teardown());

/** The `proto` tags of an event. */
const protoTags = (ev: NostrEvent): string[][] => ev.tags.filter((t) => t[0] === 'proto');

/** Every Table, Join and root at `address` on the dev relay. */
async function lobbyEvents(address: string): Promise<NostrEvent[]> {
  const [, creator, tableId] = address.split(':') as [string, string, string];
  return h.query([
    { kinds: [KIND.table], authors: [creator], '#d': [tableId] },
    { kinds: [KIND.join, KIND.root], '#a': [address] },
  ]);
}

describe('The protocol 2 lobby (T14)', () => {
  it('V2-04, V2-01 (partial): new tables, their Joins, the root and the started Table carry exactly one ["proto","2"]; Bank 0.2.0 is creatable', async () => {
    const a = h.profile('a');
    const b = h.profile('b');
    const { rootId, address } = await h.start2('chess', a, b);
    const events = await lobbyEvents(address);
    const kinds = events.map((ev) => ev.kind).sort();
    // The open Table and the started one (replaceable: the relay keeps the latest), both Joins, the root.
    expect(kinds).toEqual([KIND.table, KIND.join, KIND.join, KIND.root].sort());
    for (const ev of events) expect(protoTags(ev)).toEqual([['proto', '2']]);
    expect(events.find((ev) => ev.kind === KIND.root)?.id).toBe(rootId);

    // Bank's current engine (0.2.0, protocol 2 only) from the web lobby, with the New table form's rules.
    const lobby = h.lobby(a);
    const bankAddress = await lobby.createTable({
      game: 'bank',
      seats: 2,
      deadline: 86400,
      invited: [],
      relays: [h.relay.url],
      rules: { ...BANK_RULES, rounds: 5 },
    });
    const bankTable = parseTable(lobby.tableEvent(bankAddress));
    expect(bankTable.version).toBe(BANK_VERSION);
    expect(bankTable.proto).toBe('2');
    const lb = h.lobby(b);
    await waitFor('the Bank table listed', () => lb.openTables.value.find((t) => t.address === bankAddress));
    expect(lb.openTables.value.find((t) => t.address === bankAddress)?.older).toBe(false);
  }, 60_000);

  it('V2-53: a protocol 1 Bank or Luster table is listed as made by an older version, and is never joined or started here', async () => {
    // Older clients' open tables: Bank 0.1.0 and Luster, both at proto 1.
    const oldBank = h.profile('old-bank', { modules: OLDER_BANK_CLIENT, older: true });
    const oldLuster = h.profile('old-luster', OLDER);
    const bankAddress = await h.lobby(oldBank).createTable({
      game: 'bank',
      seats: 2,
      deadline: 86400,
      invited: [],
      relays: [h.relay.url],
      rules: BANK_RULES,
    });
    const lusterAddress = await h.lobby(oldLuster).createTable({
      game: 'luster',
      seats: 2,
      deadline: 86400,
      invited: [],
      relays: [h.relay.url],
      rules: LUSTER_RULES,
    });
    const me = h.profile('me');
    const lobby = h.lobby(me);
    for (const address of [bankAddress, lusterAddress]) {
      const entry = await waitFor('the older table listed', () =>
        lobby.openTables.value.find((t) => t.address === address),
      );
      expect(entry.table.proto).toBe('1');
      expect(entry.older).toBe(true);
      expect(entry.problems).toEqual([]);
      expect(olderTable(entry.table)).toBe(true);
      // The table screen's check, and the controller's own refusal: nothing is signed or published.
      expect(joinCheck(await lobby.lobbyOf(address), me.deps.signer.pubkey)).toEqual({
        eligible: false,
        reason: null,
        why: OLDER_VERSION_TABLE,
      });
      await expect(lobby.join(address)).rejects.toThrow(OLDER_VERSION_TABLE);
    }
    expect(parseTable(lobby.tableEvent(bankAddress)).version).toBe(BANK_V1_VERSION);
    await pause(300);
    const joins = await h.query([{ kinds: [KIND.join], authors: [me.deps.signer.pubkey] }]);
    expect(joins).toEqual([]);

    // A full protocol 1 Bank table whose creator runs this build is never started here either (no new v1 game).
    const creator = h.profile('creator', { modules: OLDER_BANK_CLIENT, older: true });
    const joiner = h.profile('joiner', { modules: OLDER_BANK_CLIENT, older: true });
    const lc = h.lobby(creator);
    const full = await lc.createTable({
      game: 'bank',
      seats: 2,
      deadline: 86400,
      invited: [],
      relays: [h.relay.url],
      rules: BANK_RULES,
    });
    const lj = h.lobby(joiner);
    await waitFor('the table at the joiner', () => lj.openTables.value.find((t) => t.address === full));
    await lj.join(full);
    await waitFor('a full table', () => lc.table(full).value?.full);
    // The same player and browser after updating to this build.
    const updated = h.lobby({ ...creator, deps: { ...creator.deps, modules: MODULES, olderClient: false } });
    await waitFor('the full table at the updated client', () => updated.table(full).value?.full);
    await expect(updated.start(full)).rejects.toThrow(OLDER_VERSION_TABLE);
    expect(await h.query([{ kinds: [KIND.root], '#a': [full] }])).toEqual([]);
  }, 60_000);

  it('V2-53: protocol 1 Chain Reaction and Chess tables stay joinable, and their games start under v1', async () => {
    for (const game of ['chess', 'chain-reaction'] as const) {
      const seats = game === 'chess' ? 2 : 3;
      const old = h.profile(`old-${game}`, OLDER);
      const lo = h.lobby(old);
      const address = await lo.createTable({
        game,
        seats,
        deadline: 259200,
        invited: [],
        relays: [h.relay.url],
      });
      const joiners = Array.from({ length: seats - 1 }, (_, i) => h.profile(`${game}-${i}`));
      for (const p of joiners) {
        const l = h.lobby(p);
        const entry = await waitFor('the v1 table listed', () =>
          l.openTables.value.find((t) => t.address === address),
        );
        expect(entry.older).toBe(false);
        expect(joinCheck(await l.lobbyOf(address), p.deps.signer.pubkey).eligible).toBe(true);
        await l.join(address);
      }
      await waitFor('a full table', () => lo.table(address).value?.full);
      const rootId = await lo.start(address);
      for (const ev of await lobbyEvents(address)) expect(protoTags(ev)).toEqual([['proto', '1']]);
      expect((await h.query([{ ids: [rootId] }]))[0]?.tags).toContainEqual(['proto', '1']);
    }
  }, 60_000);

  it('V2-05: a table no engine here can play is not listed, and is never joined', async () => {
    const sk = rnd(32);
    // Bank 0.2.0 at proto 1, Bank 0.1.0 at proto 2, and an engine version this build does not have.
    const specs = [
      { version: BANK_VERSION, proto: '1' as const },
      { version: BANK_V1_VERSION, proto: '2' as const },
      { version: '9.9.9', proto: '2' as const },
    ];
    const addresses: string[] = [];
    for (const [i, s] of specs.entries()) {
      const ev = finalizeEvent(
        tableTemplate(
          {
            tableId: `bad-${i}`,
            game: 'bank',
            version: s.version,
            seats: 2,
            deadline: 86400,
            invited: [],
            open: 1,
            relays: [h.relay.url],
            status: 'open',
            rules: BANK_RULES,
            proto: s.proto,
          },
          now(),
        ),
        sk,
        rnd,
      );
      await h.pool().publish(ev);
      addresses.push(parseTable(ev).address);
    }
    // A playable one, published last, shows the lobby has caught up.
    const good = await h.lobby(h.profile('good')).createTable({
      game: 'chess',
      seats: 2,
      deadline: 86400,
      invited: [],
      relays: [h.relay.url],
    });
    const me = h.profile('me');
    const lobby = h.lobby(me);
    await waitFor('the playable table listed', () => lobby.openTables.value.find((t) => t.address === good));
    for (const address of addresses) {
      expect(lobby.openTables.value.find((t) => t.address === address)).toBeUndefined();
      // (Bank at proto 1 is refused as an older version's table first, V2-53.)
      await expect(lobby.join(address)).rejects.toThrow(/cannot be played here|older version/);
    }
    expect(await h.query([{ kinds: [KIND.join], authors: [me.deps.signer.pubkey] }])).toEqual([]);
  }, 60_000);
});
