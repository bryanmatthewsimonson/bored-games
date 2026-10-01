/*
 * Pure helpers for the Home and Table screens: the New table form's validation, the open-seat count, a table's
 * status chip, "your turn" badges, who may join, the seat rows and the creator's seat picker, and the share link.
 * No DOM, no clock, no storage: the screens read the controllers and pass plain values in.
 */
import type { Hex } from '@bored-games/protocol';
import { decodeNostrKey, npubEncode, shortNpub } from './bech32.ts';

/** The deadline choices of the New table form (PROTOCOL §4.1), in seconds. */
export const DEADLINE_CHOICES: readonly { seconds: number; label: string }[] = [
  { seconds: 86400, label: '1 day' },
  { seconds: 259200, label: '3 days' },
  { seconds: 604800, label: '7 days' },
];

/** "1 day", "3 days", "12 hours" for a deadline in seconds. */
export function deadlineLabel(seconds: number): string {
  const choice = DEADLINE_CHOICES.find((c) => c.seconds === seconds);
  if (choice !== undefined) return choice.label;
  if (seconds % 86400 === 0) return `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  return `${seconds} seconds`;
}

/** The seat counts a select offers, from a module's `seatRange`. */
export function seatOptions(range: { min: number; max: number }): number[] {
  const out: number[] = [];
  for (let n = range.min; n <= range.max; n++) out.push(n);
  return out;
}

/** Open seats of a table of `seats` with `invited` invitations: the creator holds one seat. May be negative. */
export const openSeats = (seats: number, invited: number): number => seats - 1 - invited;

/* ------------------------------------------------------------------------------------------ the form */

/** One line of the invited-players box. */
export interface InviteEntry {
  /** The text as typed, shortened when long; empty for a secret key (never echoed). */
  input: string;
  /** The pubkey, when the text decoded. */
  hex: Hex | null;
  /** The short npub shown for a decoded entry. */
  short: string | null;
  /** Why the entry is not usable, or null. */
  error: string | null;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

const clip = (s: string): string => (s.length <= 24 ? s : `${s.slice(0, 12)}…${s.slice(-6)}`);

/** Split the box into entries: separated by line breaks, commas, semicolons or spaces. */
export function splitInvitees(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Decode every entry of the invited-players box (npub or 64 hex characters), flagging an unreadable key, a secret
 * key (nsec), a repeat and the player's own key (`me`).
 */
export function parseInvitees(text: string, me: Hex): InviteEntry[] {
  const seen = new Set<string>();
  return splitInvitees(text).map((raw): InviteEntry => {
    let hex: Hex | null = null;
    if (HEX64.test(raw)) hex = raw.toLowerCase() as Hex;
    else {
      const k = decodeNostrKey(raw);
      if (k?.type === 'nsec')
        return {
          input: '',
          hex: null,
          short: null,
          error: 'That is a secret key (nsec). Never share it: invite players by their public npub.',
        };
      if (k !== null) hex = k.hex as Hex;
    }
    if (hex === null)
      return { input: clip(raw), hex: null, short: null, error: 'Not a valid npub or 64-character hex key.' };
    const short = shortNpub(npubEncode(hex));
    const base = { input: clip(raw), hex, short };
    if (hex === me) return { ...base, error: 'That is you: you already hold a seat.' };
    if (seen.has(hex)) return { ...base, error: 'Listed more than once.' };
    seen.add(hex);
    return { ...base, error: null };
  });
}

export interface NewTableInput {
  seats: number;
  deadline: number;
  inviteText: string;
  me: Hex;
  range: { min: number; max: number };
}

export interface NewTableCheck {
  ok: boolean;
  entries: InviteEntry[];
  /** The valid invited pubkeys, in order. Only meaningful when `ok`. */
  invited: Hex[];
  /** Seats minus one minus invited (negative when there are too many invitees). */
  open: number;
  /** Problems with the form as a whole (not with one entry). */
  errors: string[];
}

/** Validate the New table form. */
export function checkNewTable(input: NewTableInput): NewTableCheck {
  const entries = parseInvitees(input.inviteText, input.me);
  const invited = entries.flatMap((e) => (e.hex !== null && e.error === null ? [e.hex] : []));
  const open = openSeats(input.seats, entries.filter((e) => e.error === null).length);
  const errors: string[] = [];
  if (!Number.isInteger(input.seats) || input.seats < input.range.min || input.seats > input.range.max)
    errors.push(`Choose between ${input.range.min} and ${input.range.max} seats.`);
  if (!DEADLINE_CHOICES.some((c) => c.seconds === input.deadline)) errors.push('Choose a deadline.');
  if (open < 0)
    errors.push(
      `Too many invited players: ${input.seats} seats hold you and at most ${input.seats - 1} others. Choose more seats or remove ${-open}.`,
    );
  const bad = entries.some((e) => e.error !== null);
  return { ok: errors.length === 0 && !bad, entries, invited, open, errors };
}

/* ------------------------------------------------------------------------------- statuses and badges */

/** What the lobby view needs from a table; `LobbyView` and `MyTable.lobby` fit it. */
export interface TableLike {
  creator: Hex;
  invited: readonly Hex[];
  seats: number;
  open: number;
  status: 'open' | 'started' | 'cancelled';
}

export interface LobbyLike {
  table: TableLike;
  joins: readonly { npub: Hex; id: Hex }[];
  candidates: readonly { npub: Hex; id: Hex }[];
  full: boolean;
  root: { id: Hex } | null;
}

/** What a game controller can say about one game. */
export type KnownGameStatus = 'syncing' | 'working' | 'waiting' | 'your-turn' | 'done' | 'cancelled';

export type TableChip = 'open' | 'full' | 'started' | 'done' | 'cancelled';

export const CHIP_LABEL: Record<TableChip, string> = {
  open: 'Open',
  full: 'Full',
  started: 'Started',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * The status chip of a table: `open` while seats are free, `full` once every seat is claimed but no root exists,
 * `started` once a root exists (or the Table says so), `done` when the game reports it has ended, `cancelled`
 * when the table or the game was cancelled.
 */
export function tableChip(
  table: Pick<TableLike, 'status'>,
  lobby: Pick<LobbyLike, 'full' | 'root'> | null,
  game?: KnownGameStatus | null,
): TableChip {
  if (table.status === 'cancelled' || game === 'cancelled') return 'cancelled';
  if (game === 'done') return 'done';
  if (lobby?.root != null || table.status === 'started') return 'started';
  return lobby?.full === true ? 'full' : 'open';
}

export interface TurnBadge {
  kind: 'turn' | 'start';
  label: string;
}

/**
 * The badge asking for the player's attention. The lobby alone can tell when the creator should start a full
 * table; it cannot tell whose move a started game is waiting for, so `game` (a game controller's status, when one
 * is running) supplies that.
 */
export function attentionBadge(
  role: 'creator' | 'player',
  chip: TableChip,
  game?: KnownGameStatus | null,
): TurnBadge | null {
  if (game === 'your-turn') return { kind: 'turn', label: 'Your turn' };
  if (role === 'creator' && chip === 'full') return { kind: 'start', label: 'Ready to start' };
  return null;
}

/* ------------------------------------------------------------------------------------------ joining */

export type JoinReason = 'invited' | 'open';

export interface JoinCheck {
  eligible: boolean;
  /** Why the visitor may join. */
  reason: JoinReason | null;
  /** Why not, for the visitor. Empty when eligible. */
  why: string;
}

const isUninvited = (t: TableLike, npub: Hex): boolean => npub !== t.creator && !t.invited.includes(npub);

/** Open seats not yet claimed. */
export function freeOpenSeats(lobby: LobbyLike): number {
  const taken = lobby.joins.filter((j) => isUninvited(lobby.table, j.npub)).length;
  return Math.max(0, lobby.table.open - taken);
}

/** May `me` join: an invited player who has not joined, or anyone while an open seat is free. */
export function joinCheck(lobby: LobbyLike | null, me: Hex): JoinCheck {
  const no = (why: string): JoinCheck => ({ eligible: false, reason: null, why });
  if (lobby === null) return no('');
  const t = lobby.table;
  if (lobby.root !== null || t.status === 'started') return no('This game has already started.');
  if (t.status === 'cancelled') return no('This table was cancelled.');
  if (me === t.creator) return no('You created this table.');
  if (lobby.joins.some((j) => j.npub === me)) return no('You are seated at this table.');
  if (t.invited.includes(me)) return { eligible: true, reason: 'invited', why: '' };
  if (freeOpenSeats(lobby) > 0) return { eligible: true, reason: 'open', why: '' };
  return no(
    t.invited.length > 0 && t.open === 0
      ? 'This table is invitation-only and your key is not on the list.'
      : 'All open seats are taken.',
  );
}

/* ------------------------------------------------------------------------------------------ seats */

export interface SeatRow {
  kind: 'creator' | 'invited' | 'open';
  /** The player's pubkey; null for an open seat nobody has claimed. */
  npub: Hex | null;
  short: string | null;
  joined: boolean;
  isMe: boolean;
}

/** The seat rows of a table: the creator, the invited players in list order, then the open seats. */
export function seatRows(lobby: LobbyLike, me: Hex): SeatRow[] {
  const t = lobby.table;
  const joined = new Set(lobby.joins.map((j) => j.npub));
  const row = (kind: SeatRow['kind'], npub: Hex | null): SeatRow => ({
    kind,
    npub,
    short: npub === null ? null : shortNpub(npubEncode(npub)),
    joined: npub !== null && joined.has(npub),
    isMe: npub !== null && npub === me,
  });
  const rows: SeatRow[] = [row('creator', t.creator), ...t.invited.map((p) => row('invited', p))];
  const claimed = lobby.joins.filter((j) => isUninvited(t, j.npub)).map((j) => j.npub);
  for (let i = 0; i < t.open; i++) rows.push(row('open', claimed[i] ?? null));
  return rows;
}

/**
 * The creator's choice among open joiners: one entry per uninvited npub with a valid Join, in lobby order
 * (seated ones first, then the rest by time). `chosen` is the default pick: the first `open`.
 */
export interface OpenCandidate {
  npub: Hex;
  joinId: Hex;
  short: string;
  /** Whether the default fill order seats this player. */
  seated: boolean;
}

export function openCandidates(lobby: LobbyLike): OpenCandidate[] {
  const t = lobby.table;
  const seated = new Map(lobby.joins.map((j) => [j.npub, j.id]));
  const out = new Map<Hex, OpenCandidate>();
  const add = (npub: Hex, joinId: Hex, isSeated: boolean): void => {
    if (!isUninvited(t, npub) || out.has(npub)) return;
    out.set(npub, { npub, joinId, short: shortNpub(npubEncode(npub)), seated: isSeated });
  };
  for (const j of lobby.joins) add(j.npub, j.id, true);
  for (const j of lobby.candidates) add(j.npub, seated.get(j.npub) ?? j.id, seated.has(j.npub));
  return [...out.values()];
}

/** A picker is needed when more players claimed open seats than there are seats. */
export const needsPicker = (lobby: LobbyLike): boolean => openCandidates(lobby).length > lobby.table.open;

/**
 * The Join ids in seat order for an explicit start: the creator, the invited players that joined, then the chosen
 * open joiners. Null when the creator's or an invited player's Join is missing.
 */
export function seatListFor(lobby: LobbyLike, chosen: readonly Hex[]): Hex[] | null {
  const t = lobby.table;
  const byNpub = new Map(lobby.joins.map((j) => [j.npub, j.id]));
  const ids: Hex[] = [];
  for (const npub of [t.creator, ...t.invited]) {
    const id = byNpub.get(npub);
    if (id === undefined) return null;
    ids.push(id);
  }
  const open = new Map(openCandidates(lobby).map((c) => [c.npub, c.joinId]));
  for (const npub of chosen) {
    const id = open.get(npub);
    if (id === undefined) return null;
    ids.push(id);
  }
  return ids;
}

/** The default picks: the open joiners the fold seats, then the earliest others, up to the open count. */
export function defaultPicks(lobby: LobbyLike): Hex[] {
  return openCandidates(lobby)
    .slice(0, lobby.table.open)
    .map((c) => c.npub);
}

/* ------------------------------------------------------------------------------------------ links */

/** The full URL of a table's page with `?profile=` removed: profiles are local to a browser. */
export function shareUrl(currentHref: string, creator: string, tableId: string): string {
  const u = new URL(currentHref);
  u.searchParams.delete('profile');
  u.hash = `#/t/${creator}/${tableId}`;
  return u.toString();
}
