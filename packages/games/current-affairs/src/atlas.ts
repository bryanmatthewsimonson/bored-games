/*
 * Where the map draws each city (docs/games/current-affairs/RULES.md, "The map"): a 1000 × 700 sheet, x to the east
 * and y to the south. Presentation only: the engine never reads it. A test checks that it has one point per city.
 */

export const ATLAS_WIDTH = 1000;
export const ATLAS_HEIGHT = 700;

/** Each city's [x, y], by city index (map.ts). */
export const CITY_POINTS: readonly (readonly [number, number])[] = [
  [912, 70],
  [741, 127],
  [918, 142],
  [844, 185],
  [690, 214],
  [593, 228],
  [700, 282],
  [510, 79],
  [582, 110],
  [523, 153],
  [450, 214],
  [367, 300],
  [486, 305],
  [364, 377],
  [222, 156],
  [98, 166],
  [361, 196],
  [140, 214],
  [306, 262],
  [145, 296],
  [226, 287],
  [767, 257],
  [918, 357],
  [826, 386],
  [707, 415],
  [894, 429],
  [767, 449],
  [844, 472],
  [166, 384],
  [230, 405],
  [356, 440],
  [267, 461],
  [273, 528],
  [294, 587],
  [234, 630],
  [568, 305],
  [597, 380],
  [486, 386],
  [418, 464],
  [584, 466],
  [486, 518],
  [578, 529],
];
