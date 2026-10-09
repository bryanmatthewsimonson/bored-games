import type { DealtPosition, Outcome } from '@bored-games/game-kit';
export interface Rules {
  dictionary: 'table';
  challenge: 'double';
}
export interface Slot {
  pos: number;
  card: number | null;
  open: boolean;
}
export interface Tile {
  pos: number;
  card: number;
  letter: string;
  seat: number;
}
export interface Placement {
  cell: number;
  pos: number;
  card: number;
  letter: string;
}
export interface Word {
  text: string;
  cells: number[];
  points: number;
}
export interface Play {
  actor: number;
  tiles: Placement[];
  words: Word[];
  points: number;
}
export type Action =
  | { type: 'place'; actor: number; tiles: Placement[] }
  | { type: 'exchange'; actor: number; positions: number[] }
  | { type: 'pass' | 'accept' | 'challenge' | 'finish'; actor: number }
  | { type: 'judge'; actor: number; valid: boolean }
  | { type: 'epoch'; actor: 'deck'; epoch: number; size: number }
  | { type: 'reveal'; actor: 'deck'; deck: 'pile'; pos: number; card: number };
export interface RecordEntry {
  seat: number;
  text: string;
  points: number;
  cells: number[];
}
export interface State {
  game: 'quill-and-quarry';
  rules: Rules;
  mode: 'full' | 'view';
  viewer: number | null;
  seats: number;
  phase: 'start' | 'shuffle' | 'turn' | 'review' | 'judge' | 'ending' | 'over';
  turn: number;
  hands: Slot[][];
  board: (Tile | null)[];
  bag: number[];
  scores: number[];
  dealt: DealtPosition[];
  orders: (number[] | null)[];
  epoch: number;
  shuffle: number[];
  shuffleFor: 'start' | 'exchange' | null;
  drawSeats: number[];
  draws: Slot[];
  drawCursor: number;
  first: number | null;
  play: Play | null;
  reviewers: number[];
  scoreless: number;
  out: number | null;
  result: Outcome | null;
  history: RecordEntry[];
  skips: number[];
}
export interface Event {
  type: string;
  seat: number | null;
  points: number;
}
