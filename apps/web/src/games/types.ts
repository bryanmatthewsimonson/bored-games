/*
 * What a game brings to the web app (D045). The platform screens (lobby, game chrome, rules route) know games
 * only through these shapes; each game's folder under games/ implements them, and registry.ts lists them.
 */
import type { SessionView } from '@bored-games/client';
import type { ComponentChildren, ComponentType } from 'preact';

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
}

/** The setup copy for a game with a deck; deckless games have no setup phase (D045). */
export interface SetupCopy {
  /** "Shuffling the deck", followed by the progress. */
  shuffling: string;
  /** "Dealing the tiles…". */
  dealing: string;
}

/** One game in the web registry. */
export interface WebGame extends GameMeta {
  /** The in-game component. */
  Component: ComponentType<GameViewProps>;
  /** The rules route `#/rules/<id>[/<section>]`. */
  RulesPage: ComponentType<{ section: string | null }>;
  /** Copy for the shuffle and deal steps, or null when the game has no deck. */
  setupCopy(hasDeck: boolean): SetupCopy | null;
}
