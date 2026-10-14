/*
 * The setup runner (D093): a page-wide service that does this seat's setup work, its shuffle blocks and its deal, from
 * whatever page of the app is open, so a game no longer strands when its players never have its page open at once.
 *
 * - It follows the page's lobby (`lobbyFor`) and takes the games this browser can play without a prompt: a root with a
 *   seat that the game keys made here at the join hold (`seatForGameKeys`; keys restored from the backup are left to
 *   the game page, ruling 20), a cached status other than `done` or `cancelled`, a cached phase that is missing or
 *   `setup`, and no deal of this seat's already out.
 * - Each runs as a setup-mode `GameController` (the shuffle and the deal only, never a signer prompt, each after a
 *   grace that lets a game page of the same seat act first), taken in line oldest root first (its `created_at`, then
 *   its id). At most `SETUP_RUNNER_MAX` of them load or owe a setup duty at once (ruling 21): a run that waits on
 *   other seats stays open without counting. A free slot goes to the oldest game in line, and nothing running is
 *   disposed for an older one (ruling 22).
 * - A run with no view after `SETUP_LOAD_LIMIT_S`, or stuck, is disposed and its game parked for `SETUP_PARK_S`.
 * - A game's page claims the root while it is open (`claim`): the runner disposes its controller of that game at once,
 *   and takes the game back when the page closes, unless this seat's setup work is done.
 * - A controller is disposed once the game leaves its setup, or once this seat's deal is out (by then its blocks in
 *   every round are on the chain).
 * - `lines` holds what Home shows for each game the runner is setting up, in place of the cached detail.
 */
import { seatForGameKeys } from '@bored-games/client';
import type { ParsedRoot } from '@bored-games/protocol';
import { effect, type Signal, signal } from '@preact/signals';
import { GameController, loadOutbox, TICK_MS } from './game-controller.ts';
import { bytesToHex } from './hex.ts';
import type { LobbyController, MyTable } from './lobby-controller.ts';
import { lobbyFor } from './lobby-hooks.ts';
import type { ControllerDeps } from './net.ts';
import { loadGameStatus, loadSecrets } from './storage.ts';
import { listNames } from './waiting-model.ts';

/**
 * The most setup controllers the runner keeps loading, or owing a setup duty, at once (D093, ruling 21): each verifies
 * every shuffle proof of its game on load.
 */
export const SETUP_RUNNER_MAX = 3;

/** How long a run may go without a view of its game (seconds) before it is given up and parked (ruling 22). */
export const SETUP_LOAD_LIMIT_S = 120;

/** How long a game given up (never loaded, or stuck) stays out of line (seconds), before it is a candidate again. */
export const SETUP_PARK_S = 600;

/**
 * What Home shows for a game the runner is setting up (`setupLineText`): this seat shuffling its part or dealing, or
 * the game waiting for other seats to shuffle or to deal. `who` holds their npubs, for `waiting` only.
 */
export interface SetupLine {
  kind: 'shuffling' | 'dealing' | 'waiting';
  who: readonly string[];
  what: 'shuffle' | 'deal';
}

/** The line's copy, with each npub of `who` named by `names`. */
export function setupLineText(line: SetupLine, names: (npub: string) => string): string {
  if (line.kind === 'shuffling') return 'Shuffling your part…';
  if (line.kind === 'dealing') return 'Dealing…';
  return `Waiting for ${listNames(line.who.map(names))} to ${line.what}`;
}

/** The order the runner takes games in (D093, ruling 1): the oldest root first, by its `created_at`, then by its id. */
export function inLine(a: { rootId: string; rootAt: number }, b: { rootId: string; rootAt: number }): number {
  return a.rootAt - b.rootAt || (a.rootId < b.rootId ? -1 : a.rootId > b.rootId ? 1 : 0);
}

/**
 * A game the runner is setting up: its controller, when it started (Unix s), and what to stop with it (the effect that
 * follows what the controller shows, and the wake at its load limit).
 */
interface Run {
  readonly ctl: GameController;
  readonly since: number;
  readonly stops: (() => void)[];
}

export class SetupRunner {
  /** The line of each game the runner is setting up, by root id. */
  readonly lines: Signal<ReadonlyMap<string, SetupLine>> = signal(new Map());

  readonly #d: ControllerDeps;
  #lobby: LobbyController | null = null;
  /** The runner's controllers, by root id. */
  readonly #runs = new Map<string, Run>();
  /** The roots a game page holds open (`claim`), with how many claims each. */
  readonly #claims = new Map<string, number>();
  /** Roots whose setup work for this seat this page saw done: never taken again until a reload. */
  readonly #done = new Set<string>();
  /** Roots given up (never loaded, or stuck), with when they may be taken again (Unix s). */
  readonly #parked = new Map<string, number>();
  /** Roots with a seat this browser's saved game keys hold (`#seatHere`), kept once found. */
  readonly #seated = new Set<string>();
  readonly #stops: (() => void)[] = [];
  #queued = false;
  #started = false;
  #disposed = false;

  constructor(deps: ControllerDeps) {
    this.#d = deps;
  }

  /** Follow this player's tables in the page's lobby, and look again at every change and every `TICK_MS`. */
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    const lobby = lobbyFor(this.#d);
    this.#lobby = lobby;
    this.#stops.push(lobby.myTables.subscribe(() => this.#queue()));
    // The cached status changes without the lobby (a game page in another tab), and a parked game's time runs out.
    this.#stops.push(this.#d.timers.every(TICK_MS, () => this.#queue()));
  }

  /** Stop for good: every controller is disposed and no game is taken again (the page is blocked or closing). */
  dispose(): void {
    this.#disposed = true;
    for (const stop of this.#stops.splice(0)) stop();
    for (const rootId of [...this.#runs.keys()]) this.#stop(rootId);
    this.lines.value = new Map();
  }

  /**
   * Hold `rootId` for its game page while the page is open: the runner disposes its controller of the game at once,
   * before the page's own starts, and takes the game back once every claim is released, unless this seat's setup work
   * is done. Returns the release.
   */
  claim(rootId: string): () => void {
    this.#claims.set(rootId, (this.#claims.get(rootId) ?? 0) + 1);
    if (this.#runs.has(rootId)) {
      this.#stop(rootId);
      this.#showLines();
    }
    // A slot is free: the next game in line may start.
    this.#queue();
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const n = (this.#claims.get(rootId) ?? 1) - 1;
      if (n > 0) this.#claims.set(rootId, n);
      else this.#claims.delete(rootId);
      this.#queue();
    };
  }

  /**
   * Look at the games once the current task is over: a lobby update or a controller's refresh sets several signals in
   * a row, and the runner acts on where they end up (a controller is never disposed in the middle of its refresh).
   */
  #queue(): void {
    if (this.#queued || !this.#started || this.#disposed) return;
    this.#queued = true;
    this.#d.timers.later(0, () => {
      this.#queued = false;
      this.#plan();
    });
  }

  /**
   * Dispose the runs whose setup work is done, give up those that never load or are stuck, and those no longer in line
   * (claimed by their page, or past their setup by the cached status). Then fill the free slots, oldest game first:
   * only runs that load or owe a setup duty take one (ruling 21), and none is disposed for an older game (ruling 22).
   */
  #plan(): void {
    const lobby = this.#lobby;
    if (this.#disposed || lobby === null) return;
    const now = this.#d.now();
    for (const [rootId, run] of [...this.#runs]) {
      if (this.#finished(run.ctl)) {
        this.#stop(rootId);
        this.#done.add(rootId);
      } else if (
        (run.ctl.view.peek() === null && now - run.since >= SETUP_LOAD_LIMIT_S) ||
        run.ctl.status.peek() === 'stuck'
      ) {
        this.#stop(rootId);
        this.#parked.set(rootId, now + SETUP_PARK_S);
      }
    }
    const line = this.#candidates(lobby.myTables.peek(), now);
    for (const rootId of [...this.#runs.keys()]) if (!line.includes(rootId)) this.#stop(rootId);
    let busy = [...this.#runs.values()].filter((run) => busyRun(run.ctl)).length;
    for (const rootId of line) {
      if (busy >= SETUP_RUNNER_MAX) break;
      if (this.#runs.has(rootId)) continue;
      this.#run(rootId, now);
      busy++;
    }
    this.#showLines();
  }

  /** The root ids of the games the runner may set up, in line (`inLine`). */
  #candidates(tables: readonly MyTable[], now: number): string[] {
    const { profile, storage, modules } = this.#d;
    const out: { rootId: string; rootAt: number }[] = [];
    for (const t of tables) {
      const root = t.lobby?.root ?? null;
      if (root === null || t.rootAt === null || !modules.has(root.game)) continue;
      if (this.#claims.has(root.id) || this.#done.has(root.id)) continue;
      const parked = this.#parked.get(root.id);
      if (parked !== undefined && now < parked) continue;
      this.#parked.delete(root.id);
      const cached = loadGameStatus(profile, storage, root.id);
      if (cached?.status === 'done' || cached?.status === 'cancelled') continue;
      if (cached?.phase !== undefined && cached.phase !== 'setup') continue;
      if (dealOut(this.#d, root.id) || !this.#seatHere(root)) continue;
      out.push({ rootId: root.id, rootAt: t.rootAt });
    }
    return out.sort(inLine).map((c) => c.rootId);
  }

  /**
   * Whether this browser plays a seat of `root` without a prompt, and is the only device that does: the game keys
   * saved here for its table hold a seat (`seatForGameKeys`), the one this profile's key joined with if that key holds
   * one, and they were made here at the join. Keys restored from the player's backup (D065) are on another device too,
   * and two runners of one seat could sign rival steps (ruling 20); keys that are missing could only come from a
   * restore, which may prompt the extension. Either way the game is left to its page.
   */
  #seatHere(root: ParsedRoot): boolean {
    const s = loadSecrets(this.#d.profile, this.#d.storage, root.tableAddress);
    if (s === null || s.restored === true) return false;
    if (this.#seated.has(root.id)) return true;
    const seat = seatForGameKeys(root, s.sessionSk, BigInt(`0x${bytesToHex(s.deckSecret)}`));
    const own = root.seats.findIndex((x) => x.npub === this.#d.signer.pubkey);
    if (seat === null || (own >= 0 && own !== seat)) return false;
    this.#seated.add(root.id);
    return true;
  }

  /**
   * Whether this seat's setup work in the game is done: the game has left its setup, this client holds no seat in it
   * after all, or this seat's deal is out. A deal saved here is out once a relay took it. With none saved here, the
   * seat dealt from another device once the deal waits on it for nothing, unless a rival setup step is held: fork
   * choice could then still move the deal to another deck.
   */
  #finished(ctl: GameController): boolean {
    const v = ctl.view.peek();
    if (v === null) return false;
    if ((v.phase !== 'shuffle' && v.phase !== 'deal') || v.mySeat === null) return true;
    const saved = loadOutbox(this.#d.storage, this.#d.profile, ctl.rootId).get('deal');
    if (saved !== undefined) return saved.confirmed;
    return (
      v.phase === 'deal' &&
      ctl.status.peek() === 'waiting' &&
      !v.shuffleRivals &&
      v.equivocators.length === 0 &&
      !ctl.waiting.peek().includes(v.mySeat)
    );
  }

  #run(rootId: string, now: number): void {
    const ctl = new GameController(rootId, this.#d, { mode: 'setup' });
    const run: Run = { ctl, since: now, stops: [] };
    this.#runs.set(rootId, run);
    // A change in what the controller shows queues a look: its line, its slot, and whether its work is done.
    run.stops.push(
      effect(() => {
        followed(ctl);
        this.#queue();
      }),
    );
    // A look once its load limit is reached, should nothing else bring one.
    run.stops.push(this.#d.timers.later(SETUP_LOAD_LIMIT_S * 1000, () => this.#queue()));
    ctl.start();
  }

  #stop(rootId: string): void {
    const run = this.#runs.get(rootId);
    if (run === undefined) return;
    this.#runs.delete(rootId);
    for (const stop of run.stops) stop();
    run.ctl.dispose();
  }

  #showLines(): void {
    const next = new Map<string, SetupLine>();
    for (const [rootId, run] of this.#runs) {
      const line = lineOf(run.ctl);
      if (line !== null) next.set(rootId, line);
    }
    const shown = this.lines.peek();
    const same =
      next.size === shown.size &&
      [...next].every(([id, line]) => JSON.stringify(line) === JSON.stringify(shown.get(id)));
    if (!same) this.lines.value = next;
  }
}

/** What the runner follows of a controller: reading it inside an effect subscribes the effect to it. */
function followed(ctl: GameController): unknown[] {
  return [ctl.view.value, ctl.status.value, ctl.waiting.value, ctl.seats.value, ctl.setupDue.value];
}

/**
 * Whether a run takes one of the `SETUP_RUNNER_MAX` slots (ruling 21): it is loading (no view yet, or still syncing:
 * the proof checks the cap is for), or this seat owes a setup duty now, waiting its turn or its grace included.
 */
function busyRun(ctl: GameController): boolean {
  return ctl.view.peek() === null || ctl.status.peek() === 'syncing' || ctl.setupDue.peek();
}

/** Whether this seat's deal saved in this browser is out: a relay took it. */
function dealOut(deps: ControllerDeps, rootId: string): boolean {
  return loadOutbox(deps.storage, deps.profile, rootId).get('deal')?.confirmed === true;
}

/**
 * The line of a controller in setup: `shuffling` or `dealing` while this seat's duty is under way (`working`), or due
 * with no other seat to wait for; `waiting` with the npubs of the other seats the game waits on (`waitingFor`, D057).
 * None while it loads, is stuck, or is past the setup.
 */
function lineOf(ctl: GameController): SetupLine | null {
  const v = ctl.view.peek();
  const status = ctl.status.peek();
  if (v === null || (v.phase !== 'shuffle' && v.phase !== 'deal')) return null;
  const what = v.phase === 'shuffle' ? 'shuffle' : 'deal';
  const own: SetupLine = { kind: what === 'shuffle' ? 'shuffling' : 'dealing', who: [], what };
  if (status === 'working') return own;
  if (status !== 'waiting') return null;
  const waiting = ctl.waiting.peek();
  const seats = ctl.seats.peek();
  const who = waiting.filter((seat) => seat !== v.mySeat).flatMap((seat) => seats[seat] ?? []);
  if (who.length > 0) return { kind: 'waiting', who, what };
  return v.mySeat !== null && waiting.includes(v.mySeat) ? own : null;
}

const runners = new WeakMap<ControllerDeps, SetupRunner>();

/** The one SetupRunner of the page, made on first ask; `main.tsx` starts it after the first render. */
export function setupRunnerFor(deps: ControllerDeps): SetupRunner {
  let r = runners.get(deps);
  if (r === undefined) {
    r = new SetupRunner(deps);
    runners.set(deps, r);
  }
  return r;
}
