/*
 * Room for Doubt's line art (D072): the 21 glyphs the board, the cards and the pieces share. Each is markup for a
 * 64 x 64 box, drawn in `currentColor`; `glyph()` places one, sets its colour and gives every glyph the same stroke
 * (3 units, round caps and joins). A part meant to read as solid says `fill="currentColor"` itself.
 */
import type { RoomId } from './board.ts';
import type { EmblemId, ExhibitId } from './data.ts';
import { el } from './svg.ts';

const SOLID = 'fill="currentColor" stroke="none"';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** A row of `n` curls, each `w` wide and `h` high, starting at (x, y). */
const scallop = (x: number, y: number, n: number, w = 7, h = 4): string =>
  `<path d="M${x} ${y}${`q${w / 2} -${h} ${w} 0`.repeat(n)}"/>`;

/** Twelve chairs at 30 degree steps round the jury table, each a small block facing in, 25 units from the middle. */
const juryChairs = Array.from({ length: 12 }, (_, k) => {
  const deg = k * 30;
  const a = (deg * Math.PI) / 180;
  const at = `translate(${round1(32 + 25 * Math.cos(a))} ${round1(32 + 25 * Math.sin(a))}) rotate(${deg + 90})`;
  return `<rect x="-4" y="-3" width="8" height="6" rx="1.5" transform="${at}" ${SOLID}/>`;
}).join('');

/** The six party emblems: pieces' faces and the corners of the party cards. */
export const EMBLEMS: Readonly<Record<EmblemId, string>> = {
  // A judge's wig in profile: rows of curls over the dome, buckles at the ear and the queue hanging tied behind.
  wig: [
    '<path d="M8 40C6 20 16 8 30 8C44 8 52 16 53 30L53 38Q30 46 8 40Z"/>',
    scallop(17, 18, 4),
    scallop(13, 27, 5),
    scallop(10, 36, 6, 6.2),
    '<path d="M53 34C61 36 63 50 56 61C52 55 52 44 53 34Z"/>',
    '<path d="M51 46H60"/>',
  ].join(''),
  bowler: [
    '<path d="M17 38.4C16 24 21 14 32 14C43 14 48 24 47 38.4"/>',
    '<path d="M17 38.4A25 7 0 0 0 7 44A25 7 0 0 0 57 44A25 7 0 0 0 47 38.4"/>',
    `<path d="M17.1 33.5Q32 41 46.9 33.5L47 38.4Q32 48 17 38.4Z" ${SOLID}/>`,
  ].join(''),
  pincenez: [
    '<circle cx="19" cy="30" r="11"/>',
    '<circle cx="45" cy="30" r="11"/>',
    '<path d="M30 27Q32 23 34 27"/>',
    '<path d="M9.5 38C8 54 22 58 32 58C42 58 56 54 54.5 38" stroke-dasharray="0.1 6"/>',
  ].join(''),
  whistle: [
    '<path d="M26.5 44A13 13 0 1 0 26.5 32H23L20 27H15L13 32H10Q6 32 6 36V40Q6 44 10 44H26.5"/>',
    `<circle cx="38" cy="38" r="4" ${SOLID}/>`,
    '<circle cx="40" cy="12" r="6"/>',
    '<path d="M40 18V25"/>',
  ].join(''),
  broadarrow: [
    '<path d="M32 4Q36 32 55 49L32 34L9 49Q28 32 32 4Z" fill="currentColor"/>',
    '<path d="M32 34V60"/>',
  ].join(''),
  quill: [
    '<g transform="rotate(38 32 32)">',
    '<path d="M32 3C46 9 47 29 32 47C17 29 18 9 32 3Z"/>',
    '<path d="M32 3V54"/>',
    '<path d="M32 13L39 9M32 21L40.5 15M32 29L39.5 24M32 13L25 9M32 21L23.5 15M32 29L24.5 24"/>',
    `<path d="M29.5 52L32 62L34.5 52Z" ${SOLID}/>`,
    '</g>',
  ].join(''),
};

/** The six exhibits (weapon cards). */
export const EXHIBIT_GLYPHS: Readonly<Record<ExhibitId, string>> = {
  // A mallet tilted over its sound block.
  gavel: [
    '<g transform="rotate(-40 32 22)">',
    '<rect x="16" y="12" width="32" height="16" rx="3.5"/>',
    '<path d="M23 12V28M41 12V28"/>',
    '<rect x="29" y="28" width="6" height="28" rx="2"/>',
    '</g>',
    '<path d="M8 58H34L32 47H10Z"/>',
  ].join(''),
  // Balance scales: pillar, beam, pivot and two hanging pans.
  scales: [
    '<circle cx="32" cy="10" r="3.5"/>',
    '<path d="M32 13.5V58M20 58H44"/>',
    '<path d="M11 18H53"/>',
    '<path d="M11 18L4.5 38M11 18L17.5 38M3 38H19Q11 49 3 38Z"/>',
    '<path d="M53 18L46.5 38M53 18L59.5 38M45 38H61Q53 49 45 38Z"/>',
  ].join(''),
  // A thick bound volume: spine bands, a title label and a ribbon marker hanging from the foot.
  reports: [
    '<rect x="12" y="6" width="40" height="46" rx="3"/>',
    '<path d="M12 14H52M12 44H52"/>',
    '<rect x="20" y="21" width="24" height="15" rx="1.5"/>',
    '<path d="M25 26H39M25 31H34"/>',
    '<path d="M38 52V62L41 59L44 62V52"/>',
  ].join(''),
  // A water carafe with a ball stopper and a wavy waterline.
  carafe: [
    '<circle cx="32" cy="9" r="5"/>',
    '<path d="M25 14L28 30C28 34 13 38 13 47C13 55 20 58 32 58C44 58 51 55 51 47C51 38 36 34 36 30L39 14Z"/>',
    '<path d="M15.5 45q4.25 -3 8.5 0t8.5 0t8.5 0t8.5 0"/>',
  ].join(''),
  // Two open cuffs joined by a two-link chain.
  manacles: [
    '<path d="M8.3 23.8A10 10 0 1 0 19.7 23.8"/>',
    '<path d="M44.3 23.8A10 10 0 1 0 55.7 23.8"/>',
    `<circle cx="8.3" cy="23.8" r="2.2" ${SOLID}/>`,
    `<circle cx="19.7" cy="23.8" r="2.2" ${SOLID}/>`,
    `<circle cx="44.3" cy="23.8" r="2.2" ${SOLID}/>`,
    `<circle cx="55.7" cy="23.8" r="2.2" ${SOLID}/>`,
    '<ellipse cx="28.5" cy="32" rx="5" ry="3"/>',
    '<ellipse cx="35.5" cy="32" rx="5" ry="3"/>',
    `<circle cx="14" cy="42" r="2.5" ${SOLID}/>`,
    `<circle cx="50" cy="42" r="2.5" ${SOLID}/>`,
  ].join(''),
  // An ornate spade-shaped clock hand over its hub.
  clockhand: [
    '<g transform="rotate(32 32 32)">',
    '<path d="M32 3V9"/>',
    '<path d="M32 9C38 15 47 20 45 28C43 35 36 33 32 38C28 33 21 35 19 28C17 20 26 15 32 9Z"/>',
    '<path d="M32 38V41.5M32 54.5V60"/>',
    '<circle cx="32" cy="48" r="6.5"/>',
    `<circle cx="32" cy="48" r="1.6" ${SOLID}/>`,
    '</g>',
  ].join(''),
};

/** The nine scenes (room cards). */
export const SCENE_GLYPHS: Readonly<Record<RoomId, string>> = {
  // The judge's bench with its high chair, and the witness rail beside it.
  courtroom: [
    '<path d="M9 28V12Q9 6 15 6H27Q33 6 33 12V28"/>',
    '<path d="M15 28V14Q15 11 18 11H24Q27 11 27 14V28"/>',
    '<rect x="5" y="28" width="34" height="26"/>',
    '<path d="M2 28H42M17 28V54M27 28V54M2 58H42"/>',
    '<path d="M46 38H62M46 54H62M48 38V54M54 38V54M60 38V54"/>',
  ].join(''),
  // A high-backed chair behind a pedestal desk, a lamp on the desk.
  chambers: [
    '<path d="M18 40V18Q18 8 26 8H30Q38 8 38 18V40"/>',
    '<path d="M12 40V26Q12 22 16 22M44 40V26Q44 22 40 22"/>',
    '<rect x="6" y="40" width="16" height="18"/>',
    '<rect x="42" y="40" width="16" height="18"/>',
    '<path d="M6 49H22M42 49H58M3 40H61"/>',
    '<path d="M52 40V31M47 31H57L55 22H49Z"/>',
  ].join(''),
  // A round table ringed by twelve chairs, seen from above.
  jury: [`<circle cx="32" cy="32" r="14"/>`, juryChairs].join(''),
  // A rail with a gown hanging from a hook, and a wig on its stand.
  robing: [
    '<path d="M4 8H60"/>',
    '<path d="M22 8V13M10 21L22 13L34 21"/>',
    '<path d="M12 22L10 56H34L32 22M22 24V56"/>',
    '<path d="M12 22L4 40L10 45L13 34M32 22L40 40L34 45L31 34"/>',
    '<path d="M52 33V54M45 56H59M44 33Q44 16 52 16Q60 16 60 33Z"/>',
    scallop(45, 26, 2, 7, 3.5),
  ].join(''),
  // A filing cabinet: three labelled drawers with handles.
  registry: [
    '<rect x="14" y="4" width="36" height="56" rx="3"/>',
    '<path d="M14 23H50M14 42H50"/>',
    `<rect x="23" y="8" width="18" height="5" ${SOLID}/>`,
    `<rect x="23" y="27" width="18" height="5" ${SOLID}/>`,
    `<rect x="23" y="46" width="18" height="5" ${SOLID}/>`,
    '<path d="M27 18H37M27 37H37M27 55H37"/>',
  ].join(''),
  // Shelving with tagged boxes.
  store: [
    '<path d="M6 4V60M58 4V60M6 22H58M6 41H58M6 60H58"/>',
    '<rect x="11" y="9" width="18" height="13"/>',
    '<rect x="35" y="12" width="14" height="10"/>',
    '<rect x="11" y="28" width="12" height="13"/>',
    '<rect x="29" y="31" width="20" height="10"/>',
    '<rect x="11" y="47" width="22" height="13"/>',
    `<rect x="14" y="13" width="6" height="4" ${SOLID}/>`,
    `<rect x="14" y="32" width="5" height="4" ${SOLID}/>`,
    `<rect x="14" y="51" width="6" height="4" ${SOLID}/>`,
  ].join(''),
  // A barred, arched window set in a thick sill.
  cells: [
    '<path d="M14 58V28A18 18 0 0 1 50 28V58M8 58H56"/>',
    '<path d="M23 12.4V58M32 10V58M41 12.4V58M14 42H50"/>',
  ].join(''),
  // An arched louvred opening with the bell, its beam and its clapper.
  belfry: [
    '<path d="M8 58V28A24 24 0 0 1 56 28V58Z"/>',
    '<path d="M20 16H44M32 16V22"/>',
    '<path d="M28 22H36C36 32 40 38 45 46H19C24 38 28 32 28 22Z"/>',
    `<circle cx="32" cy="52" r="3.5" ${SOLID}/>`,
    '<path d="M11 30H17M11 38H17M11 46H17M47 30H53M47 38H53M47 46H53"/>',
  ].join(''),
  // Three figures behind the gallery's balustrade.
  gallery: [
    '<path d="M4 42H60M4 60H60M10 42V60M21.5 42V60M32 42V60M42.5 42V60M54 42V60"/>',
    '<circle cx="16" cy="22" r="5"/>',
    '<circle cx="32" cy="22" r="5"/>',
    '<circle cx="48" cy="22" r="5"/>',
    '<path d="M8 40Q16 29 24 40M24 40Q32 29 40 40M40 40Q48 29 56 40"/>',
  ].join(''),
};

/**
 * Places a glyph: a group that moves it to (x, y), scales its 64-unit box to `size`, and sets the colour and the
 * stroke every glyph is drawn with.
 */
export function glyph(markup: string, x: number, y: number, size: number, color: string): string {
  return el(
    'g',
    {
      transform: `translate(${x} ${y}) scale(${size / 64})`,
      color,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 3,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    markup,
  );
}
