import type { RandomBytes } from '@bored-games/deck';
import {
  type EventTemplate,
  type Hex,
  type NostrEvent,
  type ParsedRoot,
  parseRoot,
} from '@bored-games/protocol';
import { ClientError } from './errors.ts';
import { GameSession } from './session.ts';
import type { Duty, ReceiveResult, SessionInput, SessionView } from './types.ts';
import { GameSessionV2 } from './v2/session.ts';

/*
 * One interface over both protocol versions (build plan D-A, PROTOCOL-v2 §2). A game has one version for good: its
 * root says which, and `openSession` builds the class that folds it, `GameSession` for proto 1 (the frozen v1
 * rules) or `GameSessionV2` for proto 2. Each class refuses a root of the other version, so a v1 game never
 * reaches v2 rules, nor a v2 game v1 rules.
 *
 * `Session` is the public API both share. What only v1 has (`buildShares`, `buildBeacon` and the v1
 * `attestTemplate`) stays on `GameSession`; reach it through `v1Session`.
 */

/** A game session of either protocol version: the fold over one game's signed events, and its builders. */
export interface Session {
  /** The game's protocol version, from its root. */
  readonly proto: 1 | 2;
  receive(ev: unknown, now: number): ReceiveResult;
  tick(now: number): void;
  view(): SessionView;
  duties(): Duty[];
  legalActions(): readonly unknown[];
  waitingFor(): number[];
  buildShuffle(rnd: RandomBytes, createdAt: number): NostrEvent;
  buildDeal(rnd: RandomBytes, createdAt: number): NostrEvent;
  buildAction(action: unknown, rnd: RandomBytes, createdAt: number): NostrEvent;
  buildSecret(rnd: RandomBytes, createdAt: number): NostrEvent;
  buildResign(rnd: RandomBytes, createdAt: number): NostrEvent;
  buildTimeout(seat: number, rnd: RandomBytes, createdAt: number): NostrEvent;
  canResign(): boolean;
  timeoutTarget(now: number): number | null;
  deckSteps(): Hex[];
  chainSeq(id: Hex): number | null;
  branchOf(id: Hex): 'chain' | 'ahead' | 'side' | 'unknown';
  aheadOfHead(): boolean;
  missingParents(): Hex[];
  forkSteps(): Hex[];
}

/**
 * The session for the game `input.root` starts: a `GameSession` for a proto-1 root, a `GameSessionV2` for a proto-2
 * root. Throws `ClientError` when the table or root does not parse, and whatever the chosen class's `create`
 * throws (an invalid start, an identity that does not hold its seat).
 */
export function openSession(input: SessionInput): Session {
  let root: ParsedRoot;
  try {
    root = parseRoot(input.root);
  } catch (e) {
    throw new ClientError(`the root does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  return root.proto === '2' ? GameSessionV2.create(input) : GameSession.create(input);
}

/** The v1 session behind `session`, for the builders only protocol 1 has; throws `ClientError` for a v2 game. */
export function v1Session(session: Session): GameSession {
  if (session instanceof GameSession) return session;
  throw new ClientError(`a protocol ${session.proto} game has no v1 builders`);
}

/**
 * The unsigned Result attestation this seat's npub signs for the `attest` duty: v1's attestation (PROTOCOL §4.8),
 * or in protocol 2 the stats attestation (PROTOCOL-v2 §7.4). Throws `ClientError` unless the duty is due.
 */
export function statsAttestTemplate(session: Session, createdAt: number): EventTemplate {
  if (session instanceof GameSession) return session.attestTemplate(createdAt);
  throw new ClientError(`a protocol ${session.proto} session has no stats attestation yet`);
}
