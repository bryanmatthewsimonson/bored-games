/*
 * Where the map draws each city (docs/games/current-affairs/RULES.md, "The map"): a 1000 × 700 sheet, x to the east
 * and y to the south. Presentation only: the engine never reads it. A test checks that it has one point per city.
 */

export const ATLAS_WIDTH = 1000;
export const ATLAS_HEIGHT = 700;

/** Each city's [x, y], by city index (map.ts). */
export const CITY_POINTS: readonly (readonly [number, number])[] = [
  [110, 95],
  [235, 80],
  [330, 120],
  [95, 215],
  [210, 190],
  [300, 255],
  [160, 300],
  [445, 80],
  [560, 70],
  [400, 185],
  [510, 165],
  [615, 175],
  [450, 275],
  [570, 270],
  [700, 85],
  [830, 70],
  [920, 150],
  [715, 195],
  [820, 200],
  [690, 300],
  [860, 300],
  [85, 400],
  [210, 385],
  [320, 400],
  [120, 510],
  [250, 490],
  [175, 610],
  [310, 590],
  [420, 370],
  [540, 380],
  [400, 470],
  [505, 480],
  [615, 455],
  [440, 590],
  [570, 575],
  [700, 390],
  [820, 395],
  [925, 430],
  [730, 500],
  [850, 510],
  [690, 605],
  [830, 615],
];
