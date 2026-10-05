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
  resign: 7457,
  /** The Device note, protocol 2 only (PROTOCOL-v2 §4.4). */
  device: 7458,
  /** The encrypted self-backup of a seat's game keys (NIP-78 app data, PROTOCOL §3, D065). */
  backup: 30078,
} as const;

/** Protocol version 1, carried as `["proto","1"]` on every event of a v1 game; the default of every v1 caller. */
export const PROTO = '1';

/** A protocol version as the `proto` tag carries it (PROTOCOL-v2 §2). */
export type Proto = '1' | '2';

/** Every protocol version this client accepts (PROTOCOL-v2 §2 item 3). */
export const PROTOS: readonly Proto[] = ['1', '2'];

/** Allowed move deadlines in seconds: one day, three days (the default) and one week (D020). */
export const DEADLINES = [86400, 259200, 604800] as const;
export const DEFAULT_DEADLINE = 259200;

/** The largest accepted event: the UTF-8 length of its serialized JSON (PROTOCOL §11). */
export const MAX_EVENT_BYTES = 262144;
