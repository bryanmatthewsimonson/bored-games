/** NOSTR event kinds of the Bored Games protocol (PROTOCOL §4). The table is addressable (parameterized replaceable). */
export const KIND = {
  table: 37450,
  join: 7451,
  root: 7450,
  move: 7452,
  shares: 7453,
  timeout: 7454,
  reveal: 7455,
  attest: 7456,
} as const;

/** Protocol version, carried as `["proto","1"]` on every game event. */
export const PROTO = '1';

/** Allowed move deadlines in seconds: one day, three days (the default) and one week (D020). */
export const DEADLINES = [86400, 259200, 604800] as const;
export const DEFAULT_DEADLINE = 259200;

/** The largest accepted event: the UTF-8 length of its serialized JSON (PROTOCOL §11). */
export const MAX_EVENT_BYTES = 262144;
