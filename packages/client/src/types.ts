import type { GameModule, Pending } from '@bored-games/game-kit';
import type { Hex, NostrEvent, Outcome } from '@bored-games/protocol';

/** This client's seat and the secrets it plays with: its session signing key and its deck secret `x`. */
export interface Identity {
  seat: number;
  sessionSk: Uint8Array;
  deckSecret: bigint;
}

/** Everything a session starts from: the rules modules, the signed lobby events and who is watching. */
export interface SessionInput {
  // biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
  modules: ReadonlyMap<string, GameModule<any, any, any>>;
  table: NostrEvent;
  joins: readonly NostrEvent[];
  root: NostrEvent;
  /** The seat this client plays, or null for a spectator. */
  me: Identity | null;
}

export type Phase = 'shuffle' | 'deal' | 'play' | 'end' | 'done' | 'cancelled';

/**
 * What `receive` did with an event:
 * - `accepted`: it was folded in (and anything it unblocked with it)
 * - `stored`: it is well formed and waits for events it depends on
 * - `duplicate`: it was seen before, or it adds nothing new
 * - `rejected`: it is invalid for this game; `reason` says why.
 */
export type ReceiveResult =
  | { status: 'accepted' | 'stored' | 'duplicate' }
  | { status: 'rejected'; reason: string };

/** What this seat must publish next. */
export type Duty =
  | { kind: 'shuffle' }
  | { kind: 'deal' }
  | { kind: 'decide' }
  | { kind: 'secret' }
  | { kind: 'attest' };

export type SessionAudit = 'pending' | 'pass' | { fail: number[]; reason: string };

/** A snapshot of the session. Every field is a copy or frozen. */
export interface SessionView {
  phase: Phase;
  rootId: Hex;
  seats: number;
  mySeat: number | null;
  /** The last accepted move, or the root (seq 0) before the first. */
  head: { id: Hex; seq: number };
  /** The module state as `mySeat` (or a spectator) sees it; null until the shuffle is complete. */
  state: unknown;
  pending: Pending;
  /** The largest `created_at` among accepted events: the game's last progress (D030 R3). */
  pendingSince: number;
  outcome: Outcome | null;
  forfeits: number[];
  audit: SessionAudit;
  logHash: Hex;
  /** The game's move deadline in seconds, from the root. */
  deadline: number;
}
