import type { DealtPosition, Outcome } from '@bored-games/game-kit';
import type { Kind } from './cards.ts';
export interface Rules {
  kingdom?: Kind[];
}
export interface Slot {
  pos: number;
  card: number | null;
}
export interface Player {
  hand: Slot[];
  draw: number[];
  discard: Slot[];
  played: Slot[];
  peek: Slot[];
  aside: Slot[];
  known: Record<number, number>;
  owned: Record<Kind, number>;
  turns: number;
}
export type Attack = 'rivalry' | 'headliner' | 'booking' | 'critic';
export type Task =
  | { type: 'draw'; seat: number; count: number; peek?: boolean }
  | { type: 'finish' }
  | { type: 'effect'; kind: Kind }
  | { type: 'rehearsal'; count: number }
  | { type: 'trash'; mode: 'investor' | 'renovation' | 'cuttingroom' | 'cashbox'; count?: number }
  | { type: 'gain'; max: number; treasure: boolean; hand: boolean }
  | { type: 'fixedgain'; kind: Kind; seat: number; destination: 'hand' | 'draw' | 'discard' }
  | { type: 'attack'; seat: number; attack?: Attack }
  | { type: 'discard'; seat: number; target?: number; remaining?: number }
  | { type: 'top'; source: 'hand' | 'discard' }
  | { type: 'repeat' }
  | { type: 'booking'; seat: number }
  | { type: 'expose'; seat: number; source: 'hand' | 'peek' | 'aside' }
  | { type: 'headliner'; seat: number }
  | { type: 'busker' }
  | { type: 'stagedoor'; phase: 'trash' | 'discard' | 'order' }
  | { type: 'readingroom' }
  | { type: 'readchoice' }
  | { type: 'readfinish' }
  | { type: 'cleanup'; seat: number };
export interface GiltState {
  game: 'gilt-and-guile';
  seats: number;
  mode: 'full' | 'view';
  viewer: number | null;
  kingdom: Kind[];
  players: Player[];
  supply: Record<Kind, number[]>;
  turn: number;
  phase: 'action' | 'treasure' | 'buy';
  actions: number;
  buys: number;
  coins: number;
  couriers: number;
  glintPlayed: boolean;
  tasks: Task[];
  epoch: number;
  orders: (number[] | null)[];
  shuffle: { seat: number; from: number[] } | null;
  gaining: {
    kind: Kind;
    pos: number;
    hand: boolean;
    seat?: number;
    destination?: 'hand' | 'draw' | 'discard';
  } | null;
  publicCards: number[];
  revealed: Record<number, number>;
  dealt: DealtPosition[];
  trash: Slot[];
  result: Outcome | null;
  log: { seat: number; text: string; kind: Kind | null }[];
}
export type GiltAction =
  | {
      type: 'play' | 'discard' | 'trash' | 'block' | 'top' | 'repeat' | 'peektrash' | 'peekdiscard' | 'busk';
      actor: number;
      pos: number;
      card: number;
    }
  | { type: 'put' | 'keep' | 'aside'; actor: number; pos: number }
  | { type: 'buy' | 'gain'; actor: number; kind: Kind }
  | { type: 'next' | 'done' | 'accept' | 'end' | 'novictory'; actor: number };
export interface GiltEvent {
  type: string;
}
