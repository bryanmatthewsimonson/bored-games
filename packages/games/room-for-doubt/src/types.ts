import type { DealtPosition, DiceRoll, Outcome } from '@bored-games/game-kit';
import type { Place } from './board.ts';
import type { ExhibitId, PartyId, SceneId } from './ids.ts';

/** The rule option (RULES.md, "Rule options"): whether a seat that enters a room must submit there. */
export interface RfdRules {
  readonly submit: 'optional' | 'required';
}

/**
 * Where the game stands. `reveal`: the room cards that place the Exhibits are being revealed. Then, on a turn:
 * `start` (roll, take a passage, stay when walled in, submit when summoned, or indict); `roll` (the seats add their
 * shares to the dice, then the faces are derived); `walk` (move); `moved` (submit if a room was entered, or end the
 * turn); `rebut` (the asked seat shows a card or says none); `answered` (end the turn or indict); `verdict` (the
 * indicter announces the Verdict it has read). `over` once a winner is declared.
 */
export type Stage =
  | 'reveal'
  | 'start'
  | 'roll'
  | 'walk'
  | 'moved'
  | 'rebut'
  | 'answered'
  | 'verdict'
  | 'over';

/** A deck position and its card number, or null where this state does not know it. */
export interface Slot {
  readonly pos: number;
  readonly card: number | null;
}

export interface RfdPlayer {
  /** The index of the Party this seat plays, into `PARTIES` (P1). */
  readonly party: number;
  /** The seat's cards, by deck position ascending. */
  readonly hand: readonly Slot[];
  /** Its indictment was wrong: it takes no more turns, though it still rebuts and adds dice shares. */
  readonly dismissed: boolean;
  /** It has indicted (once per game). */
  readonly indicted: boolean;
  /**
   * RULES "the moved Party": another seat's submission moved this seat's pawn into a room since its last turn, so
   * at the start of its next turn it may submit there instead of moving.
   */
  readonly summoned: boolean;
}

export interface Submission {
  readonly by: number;
  readonly party: PartyId;
  readonly exhibit: ExhibitId;
  /** The room the submitter stood in. */
  readonly scene: SceneId;
  /** The seats that said none, in the order they were asked. */
  readonly passed: readonly number[];
  /** The seat that showed a card, or null (not yet, or nobody could). */
  readonly shownBy: number | null;
  /** The shown card: known to `by`, `shownBy` and the full state only. */
  readonly card: number | null;
}

export interface Indictment {
  readonly by: number;
  readonly party: PartyId;
  readonly exhibit: ExhibitId;
  readonly scene: SceneId;
  /** The indicter's announcement, or null until it is made. */
  readonly upheld: boolean | null;
}

export interface RfdState {
  readonly game: 'room-for-doubt';
  readonly rules: RfdRules;
  readonly seats: number;
  readonly mode: 'full' | 'view';
  /** The seat whose view this is, or null (full mode, or a spectator). */
  readonly viewer: number | null;
  /** The whole case order (full mode), else null. */
  readonly order: readonly number[] | null;
  /** Every deck position assigned so far, in assignment order (PROTOCOL §6.1). */
  readonly dealt: readonly DealtPosition[];
  readonly players: readonly RfdPlayer[];
  /** Where each Party's pawn stands, by Party index (all six, played or not): a square name or a room. */
  readonly pawns: readonly Place[];
  /** The room each Exhibit's token stands in, by Exhibit index; null until its room card is revealed. */
  readonly exhibits: readonly (SceneId | null)[];
  /** The room cards at `ROOM_POSITIONS`: public once revealed. */
  readonly roomCards: readonly Slot[];
  /** The Verdict at `VERDICT_POSITIONS`: known in full mode, and in the view of a seat that has indicted. */
  readonly verdict: readonly Slot[];
  /** The seat whose turn it is. */
  readonly turn: number;
  readonly stage: Stage;
  /** The faces rolled this turn, or null. */
  readonly dice: readonly number[] | null;
  /** The turn seat entered a room this turn (by walking or by a passage) and has not submitted since. */
  readonly entered: boolean;
  /** The seat asked to rebut (stage `rebut`), else null. */
  readonly asking: number | null;
  readonly submissions: readonly Submission[];
  readonly indictments: readonly Indictment[];
  /** Every roll committed (D058), one per `roll` action, never dropped. */
  readonly rolls: readonly DiceRoll[];
  /** The roll whose faces are awaited (stage `roll`), else null. */
  readonly roll: number | null;
  /** The seats still to add their share to the open roll, in order: from the seat after the roller round to it. */
  readonly contributors: readonly number[];
  readonly result: Outcome | null;
  /** The number of accepted actions. */
  readonly seq: number;
}

/** Each action has exactly one accepted encoding: exactly these keys. */
export type RfdAction =
  | {
      readonly type: 'reveal';
      readonly actor: 'deck';
      readonly deck: string;
      readonly pos: number;
      readonly card: number;
    }
  | { readonly type: 'roll'; readonly actor: number }
  | { readonly type: 'contribute'; readonly actor: number; readonly id: number }
  | {
      readonly type: 'rolled';
      readonly actor: 'beacon';
      readonly id: number;
      readonly dice: readonly number[];
    }
  | { readonly type: 'move'; readonly actor: number; readonly to: Place }
  | { readonly type: 'passage'; readonly actor: number }
  | { readonly type: 'stay'; readonly actor: number }
  | { readonly type: 'submit'; readonly actor: number; readonly party: PartyId; readonly exhibit: ExhibitId }
  /** The show marker (D077): listed for the shower only, never applied. The session sends the wire instead. */
  | { readonly type: 'show'; readonly actor: number; readonly pos: number }
  /** The show wire (D077): its packet, which only the shower and the submitter can open, names the card. */
  | { readonly type: 'show'; readonly actor: number; readonly id: number; readonly packet: string }
  | { readonly type: 'none'; readonly actor: number }
  | {
      readonly type: 'indict';
      readonly actor: number;
      readonly party: PartyId;
      readonly exhibit: ExhibitId;
      readonly scene: SceneId;
    }
  | { readonly type: 'verdict'; readonly actor: number; readonly upheld: boolean }
  | { readonly type: 'endTurn'; readonly actor: number };

/** How a pawn moved: a walk of the whole roll or into a room, a P4 shortfall, a passage, or a stay (P5). */
export type MoveHow = 'walk' | 'shortfall' | 'passage' | 'stay';

export type RfdEvent =
  /** A room card was revealed: Exhibit `exhibit` starts in `room`. */
  | { readonly type: 'revealed'; readonly exhibit: ExhibitId; readonly room: SceneId }
  | { readonly type: 'rolled'; readonly seat: number; readonly dice: readonly number[] }
  | { readonly type: 'moved'; readonly seat: number; readonly to: Place; readonly how: MoveHow }
  /** `summoned`: the submission was made under a summons, at the start of the turn, without moving. */
  | {
      readonly type: 'submitted';
      readonly seat: number;
      readonly party: PartyId;
      readonly exhibit: ExhibitId;
      readonly scene: SceneId;
      readonly summoned: boolean;
    }
  | { readonly type: 'passed'; readonly seat: number }
  /** `seat` showed `to` a card; only the two of them learn which. */
  | { readonly type: 'shown'; readonly seat: number; readonly to: number }
  /** Every other seat said none to `seat`'s submission. */
  | { readonly type: 'unrebutted'; readonly seat: number }
  /** `again`: an earlier indictment was dismissed, so the Verdict is dealt once more. */
  | {
      readonly type: 'indicted';
      readonly seat: number;
      readonly party: PartyId;
      readonly exhibit: ExhibitId;
      readonly scene: SceneId;
      readonly again: boolean;
    }
  | { readonly type: 'verdict'; readonly seat: number; readonly upheld: boolean }
  /** `seat`'s turn begins. */
  | { readonly type: 'turn'; readonly seat: number };
