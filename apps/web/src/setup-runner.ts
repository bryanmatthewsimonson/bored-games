/*
 * The setup runner (D093): a page-wide service that does this seat's setup work, its shuffle blocks and its deal, from
 * whatever page of the app is open, so a game no longer strands when its players never have its page open at once.
 *
 * - It follows the page's lobby (`lobbyFor`) and takes the games this browser can play without a prompt: a root with a
 *   seat that the game keys saved here hold (`seatForGameKeys`), a cached status other than `done` or `cancelled`, a
 *   cached phase that is missing or `setup`, and no deal of this seat's already out.
 * - Each runs as a setup-mode `GameController` (the shuffle and the deal only, never a signer prompt), the oldest root
 *   first (its `created_at`, then its id), at most `SETUP_RUNNER_MAX` at once.
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

/** The most setup controllers the runner keeps at once (D093): each verifies every shuffle proof of its game on load. */
export const SETUP_RUNNER_MAX = 3;

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

/** A game the runner is setting up: its controller, and the effect that follows what the controller shows. */
interface Run {
  readonly ctl: GameController;
  stop: () => void;
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
    // The cached status changes without the lobby (a game page in another tab), and so may a controller's delivery.
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
   * Dispose the controllers whose setup work is done, then run the oldest `SETUP_RUNNER_MAX` games in line: one that
   * is no longer among them (claimed by its page, past its setup, or passed by an older game the lobby just found) is
   * disposed, and one that is new to them is started.
   */
  #plan(): void {
    const lobby = this.#lobby;
    if (this.#disposed || lobby === null) return;
    for (const [rootId, run] of [...this.#runs]) {
      if (!this.#finished(run.ctl)) continue;
      this.#stop(rootId);
      this.#done.add(rootId);
    }
    const wanted = this.#candidates(lobby.myTables.peek()).slice(0, SETUP_RUNNER_MAX);
    for (const rootId of [...this.#runs.keys()]) if (!wanted.includes(rootId)) this.#stop(rootId);
    for (const rootId of wanted) if (!this.#runs.has(rootId)) this.#run(rootId);
    this.#showLines();
  }

  /** The root ids of the games the runner may set up, oldest root first (`created_at`, then id). */
  #candidates(tables: readonly MyTable[]): string[] {
    const { profile, storage, modules } = this.#d;
    const out: { id: string; at: number }[] = [];
    for (const t of tables) {
      const root = t.lobby?.root ?? null;
      if (root === null || t.rootAt === null || !modules.has(root.game)) continue;
      if (this.#claims.has(root.id) || this.#done.has(root.id)) continue;
      const cached = loadGameStatus(profile, storage, root.id);
      if (cached?.status === 'done' || cached?.status === 'cancelled') continue;
      if (cached?.phase !== undefined && cached.phase !== 'setup') continue;
      if (dealOut(this.#d, root.id) || !this.#seatHere(root)) continue;
      out.push({ id: root.id, at: t.rootAt });
    }
    out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out.map((c) => c.id);
  }

  /**
   * Whether this browser plays a seat of `root` without a prompt: the game keys saved here for its table hold a seat
   * (`seatForGameKeys`), and it is the seat this profile's key joined with, if that key holds one. Otherwise only a
   * restore from the player's backup could play it, which may prompt the extension, so the game is left to its page.
   */
  #seatHere(root: ParsedRoot): boolean {
    if (this.#seated.has(root.id)) return true;
    const s = loadSecrets(this.#d.profile, this.#d.storage, root.tableAddress);
    if (s === null) return false;
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

  #run(rootId: string): void {
    const ctl = new GameController(rootId, this.#d, { mode: 'setup' });
    const run: Run = { ctl, stop: () => {} };
    this.#runs.set(rootId, run);
    // A change in what the controller shows queues a look: its line, and whether its work is done.
    run.stop = effect(() => {
      followed(ctl);
      this.#queue();
    });
    ctl.start();
  }

  #stop(rootId: string): void {
    const run = this.#runs.get(rootId);
    if (run === undefined) return;
    this.#runs.delete(rootId);
    run.stop();
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
  return [ctl.view.value, ctl.status.value, ctl.waiting.value, ctl.seats.value];
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
