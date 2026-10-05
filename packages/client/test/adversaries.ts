import { chainReaction } from '@bored-games/chain-reaction';
import { type Ciphertext, type Point, proveShuffle, type Share, shuffleDeck } from '@bored-games/deck';
import { canonicalJson, type Rng } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  type PosShare,
  parseMove,
} from '@bored-games/protocol';
import { type Session, v1Session } from '../src/session-api.ts';
import type { Adversary, SimPolicy, SimReport, SimTurn } from '../src/sim.ts';
import { forgeAction, lenientSkips } from './cheat.ts';

/*
 * Test-only cheating seats for `simulateGame` (Phase 2d Task 7). Each one plays honestly except where it cheats.
 * They build raw events with the protocol templates, or reach into a session's private fields as `cheat.ts` does:
 * nothing in src offers a way to publish these events.
 */

const DECK = 108;

/** A share that does not verify: the response `s` moved by one. */
function corrupt(share: Share): Share {
  return { ...share, s: share.s === 0n ? 1n : share.s - 1n };
}

/** The deck sizes and decks a session holds, for the shuffle cheat. */
interface ShuffleInternals {
  decks: Ciphertext[][];
  X: Point;
  root: { id: string };
  deckId: string;
}

/** `ev` re-signed by the seat with one share or reveal corrupted, or null when it carries none. */
function withBadShare(t: SimTurn, ev: NostrEvent): NostrEvent | null {
  const m = parseMove(ev, DECK);
  const c = m.content;
  if (c.type !== 'action') return null;
  const spoil = (list: readonly PosShare[]): PosShare[] =>
    list.map((x, i) => (i === 0 ? { pos: x.pos, share: corrupt(x.share) } : x));
  let content: MoveContent;
  if (c.shares.length > 0) content = { ...c, shares: spoil(c.shares) };
  else if (c.reveals.length > 0) content = { ...c, reveals: spoil(c.reveals) };
  else return null;
  const tmpl = moveTemplate({ rootId: m.rootId, prevId: m.prevId, seq: m.seq, content }, t.now);
  return finalizeEvent(tmpl, t.identity.sessionSk, t.rnd);
}

const decides = (s: Session): boolean => s.duties().some((d) => d.kind === 'decide');

/**
 * `badShare`: at its first decision whose move carries a share or a reveal, the seat publishes the move with one
 * share corrupted instead. Everyone rejects it; the seat then plays on honestly.
 */
export function badShare(seat: number): Adversary {
  let done = false;
  return {
    name: 'badShare',
    seat,
    turn(t) {
      if (done || !decides(t.session)) return 'honest';
      const honest = t.session.buildAction(t.choose(), t.rnd, t.now);
      const bad = withBadShare(t, honest);
      // The honest event is dropped unpublished; with nothing to spoil, the seat plays honestly this time.
      if (bad === null) return 'honest';
      done = true;
      t.publish(bad, 'badShare');
      return 'pass';
    },
  };
}

/**
 * `forgedSkip`: at its first placement while it holds a playable tile, the seat skips the placement. Peers cannot
 * see its hand and accept the move; the audit catches it. The seat's own session runs `lenientSkips`, so it keeps
 * playing.
 */
export function forgedSkip(seat: number): Adversary {
  let done = false;
  return {
    name: 'forgedSkip',
    seat,
    modules: new Map([[chainReaction.id, lenientSkips(seat)]]),
    turn(t) {
      if (done || !decides(t.session)) return 'honest';
      const legal = t.session.legalActions() as readonly { type: string }[];
      if (!legal.some((a) => a.type === 'place')) return 'honest';
      done = true;
      t.publish(
        forgeAction(v1Session(t.session), { type: 'skipPlace', actor: seat }, t.rnd, t.now),
        'forgedSkip',
      );
      return 'pass';
    },
  };
}

/**
 * `equivocate`: at its first decision the seat publishes two distinct valid moves on the same prev (two legal
 * actions when it has a choice), then plays on honestly from whichever the chain keeps.
 */
export function equivocate(seat: number): Adversary {
  let done = false;
  return {
    name: 'equivocate',
    seat,
    turn(t) {
      if (done || !decides(t.session)) return 'honest';
      done = true;
      const legal = t.session.legalActions();
      const first = t.choose();
      const other = legal.find((a) => JSON.stringify(a) !== JSON.stringify(first)) ?? first;
      const a = t.session.buildAction(first, t.rnd, t.now);
      const b = t.session.buildAction(other, t.rnd, t.now);
      t.publish(a, 'equivocate');
      t.publish(b, 'equivocate');
      return 'pass';
    },
  };
}

/**
 * `vanish`: the seat plays honestly until the chain reaches `atSeq` moves, then never acts again (it still
 * reads, so its session can be compared at the end). `atSeq` at or below the seat count vanishes before the
 * first game action.
 */
export function vanish(seat: number, atSeq: number): Adversary {
  return {
    name: 'vanish',
    seat,
    turn: (t) => (t.session.view().head.seq >= atSeq ? 'pass' : 'honest'),
  };
}

/**
 * `badShuffle`: on its shuffle step the seat shuffles and proves against the wrong input deck (its true input with
 * the first two ciphertexts swapped), publishes that step, and never acts again.
 */
export function badShuffle(seat: number): Adversary {
  let done = false;
  return {
    name: 'badShuffle',
    seat,
    turn(t) {
      if (done) return 'pass';
      if (!t.session.duties().some((d) => d.kind === 'shuffle')) return 'honest';
      done = true;
      const s = t.session as unknown as ShuffleInternals;
      const head = t.session.view().head;
      const input = s.decks[head.seq] as Ciphertext[];
      const wrong = [input[1], input[0], ...input.slice(2)] as Ciphertext[];
      const { out, psi, rPrime } = shuffleDeck(wrong, s.X, t.rnd);
      const ctx = { rootId: s.root.id, seat, deckId: s.deckId };
      const proof = proveShuffle(wrong, out, s.X, psi, rPrime, ctx, t.rnd);
      const tmpl = moveTemplate(
        {
          rootId: s.root.id,
          prevId: head.id,
          seq: head.seq + 1,
          content: { type: 'shuffle', deck: out, proof },
        },
        t.now,
      );
      t.publish(finalizeEvent(tmpl, t.identity.sessionSk, t.rnd), 'badShuffle');
      return 'pass';
    },
  };
}

/**
 * `resign`: the seat plays honestly until the chain reaches `atSeq` moves, then resigns on its own decision
 * (PROTOCOL §4.9, D045, D052; in a game with a deck the Resign carries its deck secret, and the others then publish
 * theirs) and only attests from then on. On its own turn no move can race the resign, and every client counts it at
 * the head it names, so every client must agree. Not a cheat: the resign is labelled so the report shows how every
 * client received it.
 */
export function resignAt(seat: number, atSeq: number): Adversary {
  let done = false;
  return {
    name: 'resign',
    seat,
    turn(t) {
      if (done) return 'honest';
      if (t.session.view().head.seq < atSeq || !t.session.canResign() || !decides(t.session)) return 'honest';
      done = true;
      t.publish(t.session.buildResign(t.rnd, t.now), 'resign');
      return 'honest';
    },
  };
}

/* ------------------------------------------------------------------------------------------ protocol 2 */

/**
 * `equivocateStop` (protocol 2, PROTOCOL-v2 §5): at its first decision the seat signs two distinct valid moves on the
 * same prev (two legal actions when it has a choice; the second dated a second later, so the two events differ even
 * in a game whose moves carry no randomness) and publishes both. Every client holds the fork and stops the game at
 * its prev, the seat last. The seat then plays on honestly: in a deck game, its Secret reveal after the stop.
 */
export function equivocateStop(seat: number): Adversary {
  let done = false;
  return {
    name: 'equivocateStop',
    seat,
    turn(t) {
      if (done || !decides(t.session)) return 'honest';
      done = true;
      const legal = t.session.legalActions();
      const first = t.choose();
      const other = legal.find((a) => JSON.stringify(a) !== JSON.stringify(first)) ?? first;
      const a = t.session.buildAction(first, t.rnd, t.now);
      const b = t.session.buildAction(other, t.rnd, t.now + 1);
      t.publish(a, 'equivocate');
      t.publish(b, 'equivocate');
      return 'pass';
    },
  };
}

/** Relay events a stale tablet waits for (times the seat count, plus a few) before it comes back. */
const AWAY_EVENTS = 3;
/** The fewest turns, and the most, a stale tablet stays away. */
const AWAY_MIN_TURNS = 4;
const AWAY_MAX_TURNS = 60;

/**
 * `staleOutbox` (protocol 2, PROTOCOL-v2 §9.2, D056's stale outbox): an honest seat on a phone (device 0) and a tablet
 * (device 1). Both play until the chain reaches `atSeq` moves; at the tablet's next decision after that, its
 * connection drops as it acts: it saves that decision (and whatever follows it at once) unsent, then stays away
 * while the game goes on, the phone playing that turn its own way. Much later the tablet reloads (a fresh session
 * fed what it saved, its unsent events held back), syncs, and republishes its saved events through the outbox rule:
 * the stale move is discarded, a move built on it with it, and nothing of the seat ever forks the game. The seat is
 * honest: every honest-seat check covers it.
 */
export function staleOutbox(seat: number, atSeq: number): Adversary {
  let state: 'with' | 'away' | 'back' = 'with';
  let relayEvents = 0;
  let left = 0;
  let idle = 0;
  return {
    name: 'staleOutbox',
    seat,
    honest: true,
    devices: 2,
    connect(t) {
      relayEvents = t.relayEvents;
      if (t.device === 0 || state !== 'away') return 'online';
      idle++;
      const waited = t.relayEvents >= left + AWAY_EVENTS * (t.session.view().seats + 1);
      if (idle < AWAY_MAX_TURNS && (idle < AWAY_MIN_TURNS || !waited)) return 'idle';
      state = 'back';
      return 'reload';
    },
    turn(t) {
      if (t.device === 0 || state !== 'with') return 'honest';
      if (t.session.view().head.seq < atSeq || !decides(t.session)) return 'honest';
      state = 'away';
      left = relayEvents;
      return 'offline';
    },
    done: () => state !== 'away',
  };
}

/** The chance a device of `twoDevices` goes offline, or reloads, at the start of a turn. */
const OFFLINE_RATE = 0.15;
const RELOAD_RATE = 0.05;

/**
 * `twoDevices` (protocol 2, PROTOCOL-v2 §9.2, §9.3): an honest seat played on two devices, both picked in rounds like
 * any client. At the start of a turn a device may go offline for 1 to 3 more of its turns, playing on its last
 * view and saving what it builds unsent, or reload. Back online (half the time by a reload) it syncs and vets its
 * saved events before it does anything else. Whatever the two devices built for the same turn, the seat never forks
 * itself and the game ends as an honest one.
 */
export function twoDevices(seat: number): Adversary {
  const away = [0, 0];
  return {
    name: 'twoDevices',
    seat,
    honest: true,
    devices: 2,
    connect(t) {
      const left = away[t.device] ?? 0;
      if (left > 0) {
        away[t.device] = left - 1;
        if (left > 1) return 'offline';
        return t.rng.float() < 0.5 ? 'reload' : 'online';
      }
      const r = t.rng.float();
      if (r < OFFLINE_RATE) {
        away[t.device] = 1 + t.rng.int(3);
        return 'offline';
      }
      return r < OFFLINE_RATE + RELOAD_RATE ? 'reload' : 'online';
    },
    turn: () => 'honest',
    done: () => away.every((n) => n === 0),
  };
}

/** The protocol 1 adversaries (each needs a protocol 1 table; `badShare` and `forgedSkip` Chain Reaction's). */
export const ADVERSARIES_V1 = ['badShare', 'forgedSkip', 'equivocate', 'vanish', 'badShuffle', 'resign'] as const;
/** The protocol 2 adversaries. */
export const ADVERSARIES_V2 = ['equivocateStop', 'staleOutbox', 'twoDevices'] as const;
export const ADVERSARIES = [...ADVERSARIES_V1, ...ADVERSARIES_V2] as const;
export type AdversaryName = (typeof ADVERSARIES)[number];

/**
 * The named adversary at `seat`. `vanish` vanishes, and `resign` resigns, before the first game action unless
 * `vanishAt` (a chain length) says otherwise; `staleOutbox`'s tablet leaves at its first decision once the chain
 * holds `vanishAt` moves.
 */
export function adversary(name: AdversaryName, seat: number, seats: number, vanishAt = seats): Adversary {
  switch (name) {
    case 'equivocateStop':
      return equivocateStop(seat);
    case 'staleOutbox':
      return staleOutbox(seat, vanishAt);
    case 'twoDevices':
      return twoDevices(seat);
    case 'badShare':
      return badShare(seat);
    case 'forgedSkip':
      return forgedSkip(seat);
    case 'equivocate':
      return equivocate(seat);
    case 'vanish':
      return vanish(seat, vanishAt);
    case 'badShuffle':
      return badShuffle(seat);
    case 'resign':
      return resignAt(seat, vanishAt);
  }
}

/** The uniform policy, except that it declares the end whenever it may, so games end quickly. */
export const quickPolicy: SimPolicy = (_state, _seat, legal, rng: Rng) =>
  (legal as readonly { declareEnd?: boolean }[]).find((a) => a.declareEnd === true) ?? rng.pick(legal);

/** Whether `seat` holds the last place alone: worse than every other seat. */
export function lastAlone(places: readonly number[], seat: number): boolean {
  const mine = places[seat];
  return mine !== undefined && places.every((p, k) => k === seat || p < mine);
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/**
 * How `report` departs from what its adversary at `seat` should cause (the Phase 2d brief, with Rulings 5 and
 * 7); empty when it matches. No adversary: the game is done, the audit passes, nobody forfeits.
 *
 * For a seat that vanishes after the first game action, the audit records the forfeit (Ruling 7):
 * `{fail: [seat], reason: 'timeout'}` during play, or `{fail: [seat], reason: 'withheld secret'}` when the seat
 * vanished at the end of the game.
 */
export function unexpected(report: SimReport, seat: number): string[] {
  const out: string[] = [];
  const want = (ok: boolean, what: string): void => {
    if (!ok) out.push(what);
  };
  // No other client may ever accept a cheat, and some must reject it. `rejected` is stricter: every other client
  // ends up rejecting it (a client may first store it while it waits for the cheat's prev). An invalid side move
  // is judged once its prev links, so this holds for a bad game action as for a bad shuffle step.
  const neverAccepted =
    report.cheats.length > 0 &&
    report.cheats.every(
      (c) =>
        Object.values(c.statuses).flat().includes('rejected') &&
        !Object.values(c.statuses).flat().includes('accepted'),
    );
  const rejected =
    neverAccepted &&
    report.cheats.every(
      (c) => Object.keys(c.last).length > 0 && Object.values(c.last).every((s) => s === 'rejected'),
    );
  const cheatStatuses = canonicalJson(report.cheats.map((c) => c.statuses));
  const places = report.outcome?.places ?? [];
  const failed = typeof report.audit === 'object' ? report.audit.fail : [];
  const audit = canonicalJson(report.audit);
  const all = Array.from({ length: report.seats }, (_, k) => k);
  switch (report.adversary) {
    case null:
    case 'staleOutbox':
    case 'twoDevices':
      want(report.phase === 'done', `phase ${report.phase}, not done`);
      want(report.audit === 'pass', `audit ${audit}`);
      want(report.forfeits.length === 0, `forfeits ${report.forfeits}`);
      want(report.equivocators.length === 0, `equivocators ${report.equivocators}`);
      if (report.proto === 2) {
        want(report.stop === null && report.fork === null, `a fork by seat ${report.fork}`);
        want(report.record?.ending === 'over', `record ending ${report.record?.ending}`);
        want(same(report.endAttested, all), `end attested by ${report.endAttested}`);
      }
      if (report.adversary === 'staleOutbox') {
        want(report.devices.saved > 0, 'the tablet saved nothing offline');
        want(report.devices.sent + report.devices.discarded > 0, 'the tablet never vetted its outbox');
      }
      break;
    case 'equivocateStop': {
      const rated = Array.from({ length: report.seats }, (_, k) => report.seats === 2 || k === seat);
      want(report.cheats.length === 2, 'it did not publish two moves');
      want(report.fork === seat, `fork by ${report.fork}`);
      want(report.stop?.seat === seat && !report.stop.cancelled, `stop ${canonicalJson(report.stop)}`);
      want(report.result === null, `result ${canonicalJson(report.result)}`);
      want(report.phase === 'done', `phase ${report.phase}, not done`);
      want(same(report.equivocators, [seat]), `equivocators ${report.equivocators}`);
      want(same(report.forfeits, [seat]), `forfeits ${report.forfeits}`);
      want(
        report.audit === 'pass' || same(report.audit, { fail: [seat], reason: 'stop' }),
        `audit ${audit}`,
      );
      want(lastAlone(places, seat), `places ${places}`);
      want(report.record?.ending === 'stop', `record ending ${report.record?.ending}`);
      want(report.record?.endedBy === seat, `record endedBy ${report.record?.endedBy}`);
      want(same(report.record?.rated, rated), `rated ${report.record?.rated}`);
      want(same(report.record?.secretWithheld, []), `secret withheld ${report.record?.secretWithheld}`);
      want(report.record?.auditIncomplete === false, 'audit incomplete');
      // A stop is never attested (PROTOCOL-v2 §5.6).
      want(report.endAttested.length === 0 && report.attested.length === 0, 'a stop was attested');
      break;
    }
    case 'badShare':
      want(report.cheats.length === 1, 'it never cheated');
      want(rejected, `cheat received as ${cheatStatuses}`);
      want(report.phase === 'done', `phase ${report.phase}, not done`);
      want(report.audit === 'pass', `audit ${audit}`);
      want(report.forfeits.length === 0, `forfeits ${report.forfeits}`);
      break;
    case 'badShuffle':
      want(report.cheats.length === 1, 'it never cheated');
      want(rejected, `cheat received as ${cheatStatuses}`);
      want(report.phase === 'cancelled', `phase ${report.phase}, not cancelled`);
      want(report.outcome === null, 'a cancelled game has an outcome');
      want(same(report.forfeits, [seat]), `forfeits ${report.forfeits}`);
      break;
    case 'forgedSkip':
      want(report.cheats.length === 1, 'it never cheated');
      want(report.phase === 'done', `phase ${report.phase}, not done`);
      want(same(failed, [seat]), `audit ${audit}`);
      want(same(report.forfeits, [seat]), `forfeits ${report.forfeits}`);
      want(lastAlone(places, seat), `places ${places}`);
      break;
    case 'equivocate':
      want(report.cheats.length === 2, 'it did not publish two moves');
      want(report.phase === 'done', `phase ${report.phase}, not done`);
      want(same(report.equivocators, [seat]), `equivocators ${report.equivocators}`);
      want(same(report.forfeits, [seat]), `forfeits ${report.forfeits}`);
      want(report.audit === 'pass', `audit ${audit}`);
      want(lastAlone(places, seat), `places ${places}`);
      break;
    case 'vanish':
      want(report.claims > 0, 'nobody claimed a timeout');
      want(same(report.forfeits, [seat]), `forfeits ${report.forfeits}`);
      if (report.actions === 0) {
        want(report.phase === 'cancelled', `phase ${report.phase}, not cancelled`);
        want(report.outcome === null, 'a cancelled game has an outcome');
      } else {
        want(report.phase === 'done', `phase ${report.phase}, not done`);
        want(report.outcome?.reason === 'forfeit', `outcome reason ${report.outcome?.reason}`);
        want(lastAlone(places, seat), `places ${places}`);
        want(
          same(report.audit, { fail: [seat], reason: 'timeout' }) ||
            same(report.audit, { fail: [seat], reason: 'withheld secret' }),
          `audit ${audit}`,
        );
      }
      break;
    case 'resign':
      want(report.cheats.length === 1, 'it never resigned');
      want(same(report.forfeits, [seat]), `forfeits ${report.forfeits}`);
      want(report.claims === 0, `${report.claims} timeout claims`);
      if (report.actions === 0) {
        want(report.phase === 'cancelled', `phase ${report.phase}, not cancelled`);
        want(report.outcome === null, 'a cancelled game has an outcome');
      } else {
        want(report.phase === 'done', `phase ${report.phase}, not done`);
        want(report.outcome?.reason === 'resign', `outcome reason ${report.outcome?.reason}`);
        want(lastAlone(places, seat), `places ${places}`);
        want(same(report.audit, { fail: [seat], reason: 'resign' }), `audit ${audit}`);
        // With 3 or more seats the result is unrated and records who ended it (D052); with 2 it is a plain loss.
        if (report.seats >= 3) {
          want(report.outcome?.unrated === true, 'the result is not unrated');
          want(same(report.outcome?.endedBy ?? null, { type: 'resign', seat }), 'endedBy is not the seat');
        } else {
          want(report.outcome !== null && !('unrated' in report.outcome), 'a 2-seat result is unrated');
          want(report.outcome !== null && !('endedBy' in report.outcome), 'a 2-seat result has endedBy');
        }
      }
      break;
    default:
      out.push(`unknown adversary ${report.adversary}`);
  }
  return out;
}
