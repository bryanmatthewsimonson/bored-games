/*
 * Where each city sits on the drawing of the Wide World (D096): a new drawing, mirrored east for west from the
 * reference board's layout and redrawn, on a 1060 × 548 sea chart. Pure data for the web app's map and art; the
 * engine never reads it.
 */

export const ATLAS_WIDTH = 1060;
export const ATLAS_HEIGHT = 548;

/** `[x, y]` per city index (map.ts). */
export const CITY_POINTS: readonly (readonly [number, number])[] = [
  [1000, 180],
  [910, 150],
  [830, 130],
  [760, 160],
  [890, 215],
  [790, 220],
  [630, 120],
  [640, 205],
  [560, 165],
  [555, 95],
  [485, 135],
  [445, 80],
  [990, 265],
  [910, 300],
  [810, 285],
  [810, 365],
  [845, 435],
  [830, 505],
  [740, 485],
  [690, 425],
  [580, 345],
  [530, 405],
  [475, 475],
  [465, 335],
  [560, 255],
  [480, 265],
  [475, 195],
  [395, 145],
  [410, 225],
  [400, 305],
  [335, 170],
  [330, 255],
  [260, 215],
  [315, 325],
  [245, 365],
  [195, 235],
  [190, 135],
  [120, 125],
  [75, 180],
  [180, 200],
  [170, 275],
  [100, 260],
  [60, 235],
  [220, 315],
  [165, 360],
  [90, 340],
  [210, 415],
  [85, 490],
];

/**
 * The links drawn across the map's edge (the world wraps east to west): each runs off one side and on at the other.
 */
export const EDGE_LINKS: readonly (readonly [number, number])[] = [
  [0, 38],
  [0, 45],
  [12, 47],
];
