/**
 * pnpm --filter @bored-games/client vectors
 *
 * Writes `test/vectors/prompt-release-v2.json`, PROTOCOL-v2 §12.2 item 6 for Chain Reaction (Luster's refill and
 * blind reservation follow with T18): a seeded 3-seat protocol 2 game played by real `GameSessionV2`s, with what
 * each seat must release at each checkpoint:
 * - `deal`: after the last shuffle step, each seat's deal (the `deal` duty), anchored on that step: every position
 *   dealt to another seat or to nobody;
 * - `draw`: after the first move that deals a tile to its actor, the other seats' `release` duties, anchored on
 *   that move, holding the drawn position, and none for the drawer (never its own position);
 * - `fork`: the next seat then signs two moves on that head, so every client holds a fork: the game stops there
 *   (PROTOCOL-v2 §5.6), and no release is owed, the owed one included; the only duty is the after-stop Secret
 *   reveal (§7.3).
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
import type { Hex, NostrEvent } from '@bored-games/protocol';
import type { Duty, Identity } from '../src/types.ts';
import { GameSessionV2 } from '../src/v2/session.ts';
import { makeModuleGame, NOW, ROOT_SEEN } from '../test/helpers.ts';

export const PROMPT_RELEASE_SEED = 'prompt-release-v2';

interface Released {
  seat: number;
  duty: Duty[];
  /** The positions and anchor of the event the duty builds. */
  event: { positions: number[]; anchor: Hex } | null;
  /** That event, signed. */
  signed: NostrEvent | null;
}

export interface Checkpoint {
  label: 'deal' | 'draw' | 'fork';
  /** How many of the file's `events` had been delivered to every seat when the checkpoint was taken. */
  delivered: number;
  head: { id: Hex; seq: number };
  /** The dealt entries the head's move added (`draw`), or every dealt entry (`deal`). */
  dealt: { pos: number; to: number | null }[];
  fork: { at: Hex; seat: number } | null;
  seats: Released[];
}

export interface PromptReleaseVectors {
  version: 2;
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

const hex = (b: Uint8Array): Hex => Buffer.from(b).toString('hex');

function contentOf(ev: NostrEvent): { positions: number[]; anchor: Hex } {
  const positions = (JSON.parse(ev.content) as { shares: { pos: number }[] }).shares.map((s) => s.pos);
  const anchor = ev.tags.find((t) => t[0] === 'e' && t[3] === 'anchor')?.[1] as Hex;
  return { positions, anchor };
}

export function generatePromptReleaseVectors(): PromptReleaseVectors {
  const game = makeModuleGame(chainReaction, 3, PROMPT_RELEASE_SEED, chainReaction.defaultRules(), '2');
  const players = game.ids.map((id) =>
    GameSessionV2.create({
      modules: game.modules,
      table: game.table,
      joins: game.joins,
      root: game.root,
      me: id as Identity,
      rootSeenAt: ROOT_SEEN,
    }),
  );
  const events: NostrEvent[] = [];
  const send = (ev: NostrEvent): void => {
    events.push(ev);
    for (const s of players) s.receive(ev, NOW);
  };
  const trust = (ev: NostrEvent): void => {
    for (const s of players)
      (s as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches.shuffleOk.set(ev.id, true);
  };
  const view = (): ReturnType<GameSessionV2['view']> =>
    players[0]?.view() as ReturnType<GameSessionV2['view']>;
  const dealtNow = (): { pos: number; to: number | null }[] =>
    chainReaction.dealt(view().state as never).map((d) => ({ pos: d.pos, to: d.to }));
  const checkpoints: Checkpoint[] = [];
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

  // The shuffle, each step trusted.
  for (let k = 0; k < 3; k++) {
    const ev = (players[k] as GameSessionV2).buildShuffle(game.rnd, NOW);
    trust(ev);
    send(ev);
  }
  // The deal: every seat's deal, anchored on the last shuffle step.
  for (const ev of snapshot('deal', dealtNow(), (seat) => players[seat]?.buildDeal(game.rnd, NOW) ?? null))
    send(ev);

  // Play until a move deals a tile to its actor.
  const rng = createRng(PROMPT_RELEASE_SEED);
  for (let i = 0; i < 200; i++) {
    const k = players.findIndex((s) => s.duties().some((d) => d.kind === 'decide'));
    if (k < 0) throw new Error('no decision is due');
    const s = players[k] as GameSessionV2;
    const legal = s.legalActions() as readonly { declareEnd?: boolean }[];
    const before = dealtNow().length;
    send(s.buildAction(rng.pick(legal), game.rnd, NOW));
    const after = dealtNow();
    if (after.length === before) continue;
    // The other seats release the drawn position at once; the drawer releases nothing of its own.
    snapshot('draw', after.slice(before), (seat) => players[seat]?.buildRelease(game.rnd, NOW) ?? null);
    break;
  }
  // The next seat signs two moves on the head (its owed share rides on each): every client holds a fork.
  const k = players.findIndex((s) => s.duties().some((d) => d.kind === 'decide'));
  const s = players[k] as GameSessionV2;
  const legal = s.legalActions();
  const a = s.buildAction(legal[0], game.rnd, NOW);
  const b = s.buildAction(legal[legal.length - 1], game.rnd, NOW);
  send(a);
  send(b);
  snapshot('fork', [], () => null);
  return {
    version: 2,
    seed: PROMPT_RELEASE_SEED,
    game: chainReaction.id,
    engine: chainReaction.version,
    seats: 3,
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
  };
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
