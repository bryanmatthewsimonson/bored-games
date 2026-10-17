/*
 * What a game brings to the web app (D045). The platform screens (lobby, game chrome, rules route) know games
 * only through these shapes; each game's folder under games/ implements them, and registry.ts lists them.
 */
import type { SessionView } from '@bored-games/client';
import type { ComponentChildren, ComponentType } from 'preact';
import type { AutoMove } from '../game-controller.ts';
import type { Cue } from '../sound.ts';
import type { ShareWords } from '../waiting-model.ts';

/** A game's names: light, so cards and pickers can use them without loading the game's components. */
export interface GameMeta {
  /** The rules module id (`GameModule.id`). */
  readonly id: string;
  /** The player-facing title, from the game's theme. */
  title(): string;
  /** One line about the game, for the picker and the rules page. */
  tagline(): string;
}

/** The audit as the session reports it. */
export type Audit = 'pending' | 'pass' | { readonly fail: readonly number[]; readonly reason: string };

/** What the generic game screen passes to a game's component once the game is in play (or over). */
export interface GameViewProps {
  /** The session view; `state` is the module state as this viewer sees it. */
  view: SessionView;
  mySeat: number | null;
  /** The viewer's legal actions (empty unless it is their decision). */
  legal: readonly unknown[];
  /** False while the viewer may not act (out of turn, still syncing, a move already sent). */
  canAct: boolean;
  /** Why the viewer may not act, for a disabled decision form. */
  lockedReason: string;
  /** True while a submitted move is being signed and published. */
  busy: boolean;
  /** Submits a move; a rejected promise releases the controls so the player can retry. */
  onAct: (action: unknown) => Promise<void>;
  /** Display name per seat. */
  names: readonly string[];
  /** An avatar per seat. */
  avatars: readonly ComponentChildren[];
  /** The audit once the game is over, else undefined. */
  audit: Audit | undefined;
  /** A protocol note for the status line ("waiting for shares", "not delivered yet"). */
  notice: string | undefined;
  /** The current deadline, formatted ("2h 14m left"), while in play. */
  deadline: string | undefined;
  /** Shown as a button, with a confirm step, when a timeout may be claimed. */
  onClaimTimeout: (() => void) | undefined;
  timeoutExplanation: string | undefined;
  /** True once the game left play (over, or ended by a timeout or resign). */
  ended: boolean;
  /**
   * What to highlight as the latest play (D095), from the game's `recap`: undefined for a game without one, and
   * where the screen is drawn without a session (previews, tests). A game keeps its own last-move marks then.
   */
  recent?: Recent | undefined;
}

/**
 * One step of a game's recap (D095): a play by one seat, in words, with the board marks it touched (game-specific
 * ids: a square "e4", a tile "7C") and the sound it makes. Only what the viewer's view shows: never a hidden card,
 * and never another player's count or amount the game's log would hide.
 */
export interface RecapStep {
  /** The seat that played, or null for a step of the game itself. */
  readonly seat: number | null;
  /** "Bo (Black) played Nc6." */
  readonly text: string;
  readonly marks: readonly string[];
  readonly cue: Cue | null;
}

/** The marks a game's board highlights (D095). */
export interface Recent {
  /** Every mark of the plays since the viewer's own last one (or of the replay step), oldest first. */
  readonly marks: ReadonlySet<string>;
  /** The newest play's marks (during a replay, the step's). */
  readonly latest: ReadonlySet<string>;
  /** Whether the newest play (during a replay, the step) is the viewer's own: it needs no slide into place. */
  readonly mine: boolean;
  /** Changes with every play that arrives and every replay step, to restart an animation (a `key`). */
  readonly pulse: number;
}

/** The setup copy for a game with a deck; deckless games have no setup phase (D045). */
export interface SetupCopy {
  /** "Shuffling the deck", followed by the progress. */
  shuffling: string;
  /** "Dealing the tiles…". */
  dealing: string;
  /**
   * How a share owed out of turn is named (D060): "send their share of a tile" / "a share of a tile". Neutral
   * wording when left out.
   */
  share?: ShareWords;
}

/** One game in the web registry. */
export interface WebGame extends GameMeta {
  /** The in-game component. */
  Component: ComponentType<GameViewProps>;
  /** The rules route `#/rules/<id>[/<section>]`. */
  RulesPage: ComponentType<{ section: string | null }>;
  /** Copy for the shuffle and deal steps, or null when the game has no deck. */
  setupCopy(hasDeck: boolean): SetupCopy | null;
  /**
   * The move the app sends for the player without a click, if the game has one (`AutoMove`): the game controller
   * sends it once the decision is the seat's, and retries a failed send on its tick. Right of Way has a forced
   * sift (D066), and Room for Doubt a lone none (D078 ruling 7, amended).
   */
  autoMove?: AutoMove;
  /**
   * The plays in the session's module events (oldest first), for the highlights, sounds and the "Since your last
   * move" recap (D095). Games without one get the turn alerts and a tick per move.
   */
  recap?: (events: readonly unknown[], names: readonly string[]) => RecapStep[];
}
