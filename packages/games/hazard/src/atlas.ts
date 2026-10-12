/*
 * The atlas of the Meridian as a hex grid (docs/games/hazard/RULES.md, "The map"): pointy-top hexes, odd rows
 * shifted half a hex to the east. Each letter is one province (ATLAS_KEY), `.` is sea. Provinces that share a hex
 * edge are linked by land; every other link is a sea lane (ATLAS_LANES), drawn as a dotted route. A test proves the
 * two together are exactly the engine's links (map.ts). Pure data: the web atlas draws from it.
 */
import { PROVINCES, type ProvinceId } from './map.ts';

export const ATLAS_ROWS: readonly string[] = [
  '...................................CCC.BBBBAAA...',
  '.......................PPP...NN....CCCBBBBBAAAA..',
  '.dddccccbbbbbaaa......PPPPPNNNN.....CCEEBBDDAAA..',
  '.dddccccbbbbbaaaa....TTTPPP.NN......FFEEEDDDAA...',
  '.gdddeeeebbbbaaaa....TTTPQQOO.......FFFEEGGDD....',
  '.ggddeeeebbbbaaahh...TTTQQQOOO......FFHHEGGG.....',
  '.ggffffffbbbiiaahhh..TTTQQQROO.......HHHHGGG.....',
  '.ggffffffiiiiiihhhhj.TTTSSRRR........HHHIIGG.....',
  '....fffiiiiiiikhhjjj..TSSSRRR.........HHII.......',
  '.......liiiikkkkkjjj...SSSRR...........II........',
  '......llllikkkkkkjj.....SSR............I.........',
  '.......llllkkkk..................................',
  '.................................................',
  '........................VVVUUUUU..........JJJJ...',
  '......mmm..nnn.........VVVVUUUUUU........KJJJJJ..',
  '.....mmmmmnnnn.........VVVUUUUUUU.......KKKKJLL..',
  '......mmmonnnnn........WWWWUUUUU.......KKKKKLLL..',
  '.......oooooppp........WWWWWUXX.........KKKKLL...',
  '.......oooopppp.........WWWWXXX.........KKKMLL...',
  '........oooppp..........WWWYXXX..........KMML....',
  '.........oopp.........ZZ.WYYXX............MMM....',
  '......................ZZ..YYYY............MMM....',
  '......................ZZ..YYY.............MM.....',
  '..........................YY...............M.....',
  '.................................................',
];

/** The letter of each province, in PROVINCES order: A–I, J–M, N–T, U–Z, a–l, m–p. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';

export const ATLAS_KEY: Readonly<Record<string, ProvinceId>> = Object.fromEntries(
  PROVINCES.map((p, i) => [LETTERS[i] as string, p]),
);

/** The sea lanes: every link that is not a shared hex edge. The first runs off the west and east edges. */
export const ATLAS_LANES: readonly (readonly [ProvinceId, ProvinceId])[] = [
  ['a1', 'e4'],
  ['a3', 'c1'],
  ['a9', 'b1'],
  ['b2', 'd1'],
  ['c5', 'd1'],
  ['c6', 'd1'],
  ['c6', 'd2'],
  ['c6', 'e10'],
  ['c7', 'e1'],
  ['c7', 'e8'],
  ['c7', 'e10'],
  ['d2', 'e10'],
  ['d3', 'd6'],
  ['d3', 'e10'],
  ['d5', 'd6'],
  ['e12', 'f1'],
];

/** The six hexes around (x, y): odd rows sit half a hex east of even ones. */
export function hexNeighbors(x: number, y: number): [number, number][] {
  return y % 2 === 1
    ? [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x + 1, y - 1],
        [x, y + 1],
        [x + 1, y + 1],
      ]
    : [
        [x - 1, y],
        [x + 1, y],
        [x - 1, y - 1],
        [x, y - 1],
        [x - 1, y + 1],
        [x, y + 1],
      ];
}
