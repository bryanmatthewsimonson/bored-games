/*
 * Room for Doubt's shared data (spec sections 4.1, 4.3 and 6, D068): ids, display names, the palette and the seat
 * spread. Display names live here and in the docs only; the board checker, the glyphs and every renderer take them
 * from here, so a name is spelled once.
 */
import { ROOM_ORDER, type RoomId } from './board.ts';

export type PartyId = 'ashdown' | 'brine' | 'reeve' | 'crowther' | 'faulk' | 'quarrel';
export type ExhibitId = 'gavel' | 'scales' | 'reports' | 'carafe' | 'manacles' | 'clockhand';
export type EmblemId = 'wig' | 'bowler' | 'pincenez' | 'whistle' | 'broadarrow' | 'quill';
/** The palette colours a party pawn and its card band may take. */
export type Accent = 'oxblood' | 'umber' | 'ivory' | 'slate' | 'ochre' | 'teal';
export type PaletteName =
  | 'ink'
  | 'parchment'
  | 'oxblood'
  | 'brass'
  | 'slate'
  | 'teal'
  | 'ochre'
  | 'umber'
  | 'ivory';

export interface PartyInfo {
  readonly id: PartyId;
  readonly name: string;
  readonly role: string;
  readonly monogram: string;
  readonly emblem: EmblemId;
  readonly accent: Accent;
  /** The name of the Entrance the party starts on. */
  readonly entrance: string;
}

/** The six parties, in party order: the clockwise order of their Entrances, and the turn order. */
export const PARTIES: readonly PartyInfo[] = [
  {
    id: 'ashdown',
    name: 'Rosalind Ashdown',
    role: 'Crown prosecutor',
    monogram: 'RA',
    emblem: 'wig',
    accent: 'oxblood',
    entrance: "Counsel's Door",
  },
  {
    id: 'brine',
    name: 'Hartley Brine',
    role: 'jury foreman, a grocer',
    monogram: 'HB',
    emblem: 'bowler',
    accent: 'umber',
    entrance: "Jurors' Door",
  },
  {
    id: 'reeve',
    name: 'Octavia Reeve',
    role: 'court physician',
    monogram: 'OR',
    emblem: 'pincenez',
    accent: 'ivory',
    entrance: 'Infirmary Door',
  },
  {
    id: 'crowther',
    name: 'Barnaby Crowther',
    role: 'chief bailiff',
    monogram: 'BC',
    emblem: 'whistle',
    accent: 'slate',
    entrance: 'Staff Door',
  },
  {
    id: 'faulk',
    name: 'Lucian Faulk',
    role: 'the defendant',
    monogram: 'LF',
    emblem: 'broadarrow',
    accent: 'ochre',
    entrance: "Prisoners' Door",
  },
  {
    id: 'quarrel',
    name: 'Delphine Quarrel',
    role: 'court reporter',
    monogram: 'DQ',
    emblem: 'quill',
    accent: 'teal',
    entrance: 'Press Door',
  },
];

export const EXHIBITS: readonly { readonly id: ExhibitId; readonly name: string }[] = [
  { id: 'gavel', name: 'Gavel' },
  { id: 'scales', name: 'Brass Scales' },
  { id: 'reports', name: 'Law Reports' },
  { id: 'carafe', name: 'Water Carafe' },
  { id: 'manacles', name: 'Manacles' },
  { id: 'clockhand', name: 'Clock Hand' },
];

const SCENE_NAMES: Readonly<Record<RoomId, string>> = {
  courtroom: 'Courtroom',
  chambers: "Judge's Chambers",
  jury: 'Jury Room',
  robing: 'Robing Room',
  registry: 'Registry',
  store: 'Evidence Store',
  cells: 'Holding Cells',
  belfry: 'Belfry',
  gallery: 'Press Gallery',
};

const CORNER_ROOMS: ReadonlySet<RoomId> = new Set<RoomId>(['chambers', 'store', 'cells', 'belfry']);

/** The nine scenes (rooms), in ROOM_ORDER. A corner room has an Old Gaol Passage. */
export const SCENES: readonly { readonly id: RoomId; readonly name: string; readonly corner: boolean }[] =
  ROOM_ORDER.map((id) => ({ id, name: SCENE_NAMES[id], corner: CORNER_ROOMS.has(id) }));

/** The nine colours of the art (spec section 6); tints are made with opacity, never with new colours. */
export const PALETTE: Readonly<Record<PaletteName, string>> = {
  ink: '#241f2b',
  parchment: '#f0e6d0',
  oxblood: '#7a1f2b',
  brass: '#b08d3a',
  slate: '#4a5a6a',
  teal: '#2f6f73',
  ochre: '#c58a1f',
  umber: '#6b4a32',
  ivory: '#f6f1e4',
};

/** The text colour on each accent: the one that reads at WCAG AA (4.5). */
export const ON_ACCENT: Readonly<Record<Accent, 'ink' | 'ivory'>> = {
  oxblood: 'ivory',
  umber: 'ivory',
  slate: 'ivory',
  teal: 'ivory',
  ivory: 'ink',
  ochre: 'ink',
};

/** Every foreground and background pair the art sets text in; the data test holds each to 4.5. */
export const TEXT_PAIRS: readonly (readonly [PaletteName, PaletteName])[] = [
  ['ink', 'parchment'],
  ['ink', 'ivory'],
  ['ivory', 'ink'],
  ['parchment', 'ink'],
  ['ink', 'brass'],
  ['brass', 'ink'],
  ['oxblood', 'ivory'],
  ['slate', 'ivory'],
  ...(Object.keys(ON_ACCENT) as Accent[]).map((accent) => [ON_ACCENT[accent], accent] as const),
];

export const FONT_SERIF = "Georgia, 'Times New Roman', Times, serif";
export const FONT_SANS = "system-ui, 'Segoe UI', Arial, sans-serif";

/** Which parties are played at each seat count, in seat order (platform rule P1): spread evenly round the building. */
export const SEAT_PARTIES: Readonly<Record<3 | 4 | 5 | 6, readonly PartyId[]>> = {
  3: ['ashdown', 'reeve', 'faulk'],
  4: ['ashdown', 'brine', 'crowther', 'faulk'],
  5: ['ashdown', 'brine', 'reeve', 'crowther', 'faulk'],
  6: PARTIES.map((p) => p.id),
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** The WCAG 2 contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** A rough width of `s` set at `size` in a serif face (no font is measured, so the art stays deterministic). */
export const estimateWidth = (s: string, size: number): number => s.length * size * 0.56;

/**
 * The font size that fits `s` in `maxWidth`, shrinking one unit at a time to `minSize`; if even that is too wide,
 * the text is squeezed to `maxWidth` with `textLength`.
 */
export function fitText(
  s: string,
  size: number,
  maxWidth: number,
  minSize = 12,
): { size: number; textLength?: number } {
  let fitted = size;
  while (fitted > minSize && estimateWidth(s, fitted) > maxWidth) fitted -= 1;
  return estimateWidth(s, fitted) > maxWidth ? { size: fitted, textLength: maxWidth } : { size: fitted };
}
