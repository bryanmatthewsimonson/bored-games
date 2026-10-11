/*
 * Each game's cover art, by module id: the catalog tile (`thumb`, cropped square) and the picture at the top of its
 * rules page. A game without one gets a tile generated from its id and initials (`GameTile`).
 */
import type { ComponentType } from 'preact';
import { BankCover } from './bank/cover.tsx';
import { ChainReactionCover } from './chain-reaction/cover.tsx';
import { ChessCover } from './chess/cover.tsx';
import { DriftwrightsArt } from './driftwrights/art.tsx';
import { StageArt } from './gilt-and-guile/art.tsx';
import { HollerCover } from './holler/cover.tsx';
import { LusterCover } from './luster/cover.tsx';
import { QuarryArt } from './quill-and-quarry/art.tsx';
import { RightOfWayCover } from './right-of-way/cover.tsx';
import { RoomForDoubtCover } from './room-for-doubt/cover.tsx';
import './quill-and-quarry/quill.css';

export const GAME_COVERS: Readonly<Record<string, ComponentType<{ thumb?: boolean }>>> = {
  'chain-reaction': ChainReactionCover,
  chess: ChessCover,
  bank: BankCover,
  luster: LusterCover,
  holler: HollerCover,
  'right-of-way': RightOfWayCover,
  'room-for-doubt': RoomForDoubtCover,
  'quill-and-quarry': QuarryArt,
  driftwrights: DriftwrightsArt,
  'gilt-and-guile': () => <StageArt kind="grandstage" />,
};
