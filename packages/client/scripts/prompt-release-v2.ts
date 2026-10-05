/**
 * pnpm --filter @bored-games/client vectors
 *
 * Writes `test/vectors/prompt-release-v2.json`, PROTOCOL-v2 §12.2 item 6: a seeded 3-seat Chain Reaction game and,
 * under `luster`, a seeded 2-seat Luster game (T18), each at protocol 2 played by real `GameSessionV2`s, with what
 * each seat must release at each checkpoint. Chain Reaction:
 * - `deal`: after the last shuffle step, each seat's deal (the `deal` duty), anchored on that step: every position
 *   dealt to another seat or to nobody;
 * - `draw`: after the first move that deals a tile to its actor, the other seats' `release` duties, anchored on
 *   that move, holding the drawn position, and none for the drawer (never its own position);
 * - `fork`: the next seat then signs two moves on that head, so every client holds a fork: the game stops there
 *   (PROTOCOL-v2 §5.6), and no release is owed, the owed one included; the only duty is the after-stop Secret
 *   reveal (§7.3).
 *
 * Luster (its partitioned 100-card packet, PROTOCOL-v2 §6.3), the same `deal`, then:
 * - `refill`: after a reservation from the display, the market refills from the top of tier 1, a public reveal: every
 *   seat releases that position, the actor included, anchored on that move;
 * - `blind`: after a blind reservation of the top of tier 1, the other seat releases it, and its owner nothing (its
 *   own card);
 * - `fork`: the next seat signs two moves on that head, one a reservation from the display (a new refill, so a new
 *   grant): no release is owed, the new refill's included; the only duty is the after-stop Secret reveal.
 *
 * The file holds every signed event, so it is reproducible outside this repository (review of T8, L4): the table,
 * the Joins and the root, then `events`, every event delivered to the seats in order (shuffle steps, deals, moves,
 * the fork's two moves). Each checkpoint names how many of `events` were delivered when it was taken
 * (`delivered`), and each seat's built Shares event is included in full (`signed`; the `draw` releases are built but
 * not delivered). An implementation folds `events[0 … delivered)` from the root and must owe exactly the duties
 * listed, and build events with the same positions and anchors.
 *
 * Secrets are included on purpose: these are test vectors. Shuffle proofs are made and trusted while generating
 * (the deck vectors cover them); `test/v2/prompt-release.test.ts` verifies them when it folds the file's events,
 * and checks that regenerating gives the file byte for byte.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chainReaction } from '@bored-games/chain-reaction';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import { type LusterState, luster } from '@bored-games/luster';
import type { Hex, NostrEvent } from '@bored-games/protocol';
import type { Duty, Identity } from '../src/types.ts';
import { GameSessionV2 } from '../src/v2/session.ts';
import { MODULES, makeModuleGame, NOW, ROOT_SEEN, type TestGame } from '../test/helpers.ts';

export const PROMPT_RELEASE_SEED = 'prompt-release-v2';
export const LUSTER_RELEASE_SEED = 'prompt-release-v2-luster';

interface Released {
  seat: number;
  duty: Duty[];
  /** The positions and anchor of the event the duty builds. */
  event: { positions: number[]; anchor: Hex } | null;
  /** That event, signed. */
  signed: NostrEvent | null;
}

export interface Checkpoint {
  label: 'deal' | 'draw' | 'refill' | 'blind' | 'fork';
  /** How many of the file's `events` had been delivered to every seat when the checkpoint was taken. */
  delivered: number;
  head: { id: Hex; seq: number };
  /** The dealt entries the head's move added (`draw`, `refill`, `blind`), or every dealt entry (`deal`). */
  dealt: { pos: number; to: number | null }[];
  fork: { at: Hex; seat: number } | null;
  seats: Released[];
}

/** One seeded game's vectors. */
export interface ReleaseGame {
  seed: string;
  game: string;
  engine: string;
  seats: number;
  identities: { seat: number; sessionSk: Hex; deckSecret: string }[];
  table: NostrEvent;
  joins: NostrEvent[];
  root: NostrEvent;
  /** Every event delivered to the seats, in order. */
  events: NostrEvent[];
  checkpoints: Checkpoint[];
}

export interface PromptReleaseVectors extends ReleaseGame {
  version: 2;
  /** Luster's cases (T18): a refill, a blind reservation and a fork with a fresh grant. */
  luster: ReleaseGame;
}

const hex = (b: Uint8Array): Hex => Buffer.from(b).toString('hex');

function contentOf(ev: NostrEvent): { positions: number[]; anchor: Hex } {
  const positions = (JSON.parse(ev.content) as { shares: { pos: number }[] }).shares.map((s) => s.pos);
  const anchor = ev.tags.find((t) => t[0] === 'e' && t[3] === 'anchor')?.[1] as Hex;
  return { positions, anchor };
}

/** A table of real sessions over `game`, recording every delivered event and the checkpoints taken. */
function harness(
  game: TestGame,
  modules: TestGame['modules'],
  module: { dealt(s: never): readonly { pos: number; to: number | null }[] },
) {
  const players = game.ids.map((id) =>
    GameSessionV2.create({
      modules,
      table: game.table,
      joins: game.joins,
      root: game.root,
      me: id as Identity,
      rootSeenAt: ROOT_SEEN,
    }),
  );
  const events: NostrEvent[] = [];
  const checkpoints: Checkpoint[] = [];
  const send = (ev: NostrEvent): void => {
    events.push(ev);
    for (const s of players) s.receive(ev, NOW);
  };
  const view = (): ReturnType<GameSessionV2['view']> =>
    players[0]?.view() as ReturnType<GameSessionV2['view']>;
  const dealtNow = (): { pos: number; to: number | null }[] =>
    module.dealt(view().state as never).map((d) => ({ pos: d.pos, to: d.to }));
  const snapshot = (
    label: Checkpoint['label'],
    dealt: Checkpoint['dealt'],
    build: (seat: number, d: Duty) => NostrEvent | null,
  ): NostrEvent[] => {
    const v = view();
    const built: NostrEvent[] = [];
    const seats = players.map((s, seat) => {
      const duty = s.duties();
      const auto = duty.find((d) => d.kind === 'deal' || d.kind === 'release');
      const ev = auto === undefined ? null : build(seat, auto);
      if (ev !== null) built.push(ev);
      return { seat, duty, event: ev === null ? null : contentOf(ev), signed: ev };
    });
    checkpoints.push({
      label,
      delivered: events.length,
      head: { ...v.head },
      dealt,
      fork: v.fork === null ? null : { at: v.fork.at, seat: v.fork.seat },
      seats,
    });
    return built;
  };
  /** The shuffle, each step trusted, then every seat's deal (checkpoint `deal`), delivered. */
  const shuffleAndDeal = (): void => {
    for (;;) {
      const k = players.findIndex((s) => s.duties().some((d) => d.kind === 'shuffle'));
      if (k < 0) break;
      const ev = (players[k] as GameSessionV2).buildShuffle(game.rnd, NOW);
      for (const s of players)
        (s as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches.shuffleOk.set(ev.id, true);
      send(ev);
    }
    for (const ev of snapshot('deal', dealtNow(), (seat) => players[seat]?.buildDeal(game.rnd, NOW) ?? null))
      send(ev);
  };
  const decider = (): GameSessionV2 => {
    const s = players.find((x) => x.duties().some((d) => d.kind === 'decide'));
    if (s === undefined) throw new Error('no decision is due');
    return s;
  };
  const result = (): ReleaseGame => ({
    seed: '',
    game: '',
    engine: '',
    seats: players.length,
    identities: game.ids.map((id) => ({
      seat: id.seat,
      sessionSk: hex(id.sessionSk),
      deckSecret: id.deckSecret.toString(16),
    })),
    table: game.table,
    joins: [...game.joins],
    root: game.root,
    events,
    checkpoints,
  });
  return { players, send, snapshot, dealtNow, shuffleAndDeal, decider, result };
}

export function generatePromptReleaseVectors(): PromptReleaseVectors {
  const game = makeModuleGame(chainReaction, 3, PROMPT_RELEASE_SEED, chainReaction.defaultRules(), '2');
  const t = harness(game, game.modules, chainReaction);
  t.shuffleAndDeal();

  // Play until a move deals a tile to its actor.
  const rng = createRng(PROMPT_RELEASE_SEED);
  for (let i = 0; i < 200; i++) {
    const s = t.decider();
    const legal = s.legalActions() as readonly { declareEnd?: boolean }[];
    const before = t.dealtNow().length;
    t.send(s.buildAction(rng.pick(legal), game.rnd, NOW));
    const after = t.dealtNow();
    if (after.length === before) continue;
    // The other seats release the drawn position at once; the drawer releases nothing of its own.
    t.snapshot('draw', after.slice(before), (seat) => t.players[seat]?.buildRelease(game.rnd, NOW) ?? null);
    break;
  }
  // The next seat signs two moves on the head (its owed share rides on each): every client holds a fork.
  const s = t.decider();
  const legal = s.legalActions();
  const a = s.buildAction(legal[0], game.rnd, NOW);
  const b = s.buildAction(legal[legal.length - 1], game.rnd, NOW);
  t.send(a);
  t.send(b);
  t.snapshot('fork', [], () => null);
  return {
    version: 2,
    ...t.result(),
    seed: PROMPT_RELEASE_SEED,
    game: chainReaction.id,
    engine: chainReaction.version,
    luster: generateLusterCases(),
  };
}

type LusterAction = { type: string; deck?: string; pos?: number };

/** Luster's cases of vector 6 (T18): a 2-seat game, its refill, a blind reservation, and a fork with a fresh grant. */
function generateLusterCases(): ReleaseGame {
  const modules = new Map([...MODULES, [luster.id, luster]]) as TestGame['modules'];
  const game = makeModuleGame(luster, 2, LUSTER_RELEASE_SEED, luster.defaultRules(), '2');
  const t = harness(game, modules, luster);
  t.shuffleAndDeal();
  const stateOf = (s: GameSessionV2): LusterState => s.view().state as LusterState;
  const reserve = (s: GameSessionV2, blind: boolean): LusterAction => {
    const next = stateOf(s).decks['tier-1'].next;
    const a = (s.legalActions() as LusterAction[]).find(
      (x) => x.type === 'reserve' && x.deck === 'tier-1' && (x.pos === next) === blind,
    );
    if (a === undefined) throw new Error('no reservation of tier 1');
    return a;
  };
  /** The seat to move reserves from tier 1; returns the dealt entries it added. */
  const play = (blind: boolean): Checkpoint['dealt'] => {
    const s = t.decider();
    const before = t.dealtNow().length;
    t.send(s.buildAction(reserve(s, blind), game.rnd, NOW));
    return t.dealtNow().slice(before);
  };
  // A reservation from the display: every seat releases the refill (the top of tier 1, now public).
  const refill = play(false);
  for (const ev of t.snapshot(
    'refill',
    refill,
    (seat) => t.players[seat]?.buildRelease(game.rnd, NOW) ?? null,
  ))
    t.send(ev);
  // A blind reservation of the top of tier 1: the other seat releases it; its owner releases nothing.
  const blind = play(true);
  for (const ev of t.snapshot('blind', blind, (seat) => t.players[seat]?.buildRelease(game.rnd, NOW) ?? null))
    t.send(ev);
  // The next seat signs two rival moves: a reservation from the display (a new refill) and a take.
  const s = t.decider();
  const take = (s.legalActions() as LusterAction[]).find((x) => x.type === 'take');
  const a = s.buildAction(reserve(s, false), game.rnd, NOW);
  const b = s.buildAction(take, game.rnd, NOW);
  t.send(a);
  t.send(b);
  t.snapshot('fork', [], () => null);
  return { ...t.result(), seed: LUSTER_RELEASE_SEED, game: luster.id, engine: luster.version };
}

/** The file's bytes: canonical JSON, one trailing newline. */
export function promptReleaseFile(): string {
  return `${canonicalJson(generatePromptReleaseVectors())}\n`;
}

const FILE = new URL('../test/vectors/prompt-release-v2.json', import.meta.url);

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  mkdirSync(new URL('.', FILE), { recursive: true });
  writeFileSync(FILE, promptReleaseFile());
  console.log(`wrote ${fileURLToPath(FILE)}`);
}
