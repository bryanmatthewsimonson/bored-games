/*
 * Blossom uploads (BUD-01/02): a picture is stored by its SHA-256 on a Blossom server, authorized by a signed
 * kind 24242 event, and the returned descriptor is checked against what was sent (D040).
 */
import { type EventTemplate, type Hex, type NostrEvent, sha256Hex } from '@bored-games/protocol';
import { safeImageUrl } from './profile-model.ts';

/** The default picture server: Primal's, which accepts uploads from any key with CORS open (D040 spike). */
export const DEFAULT_BLOSSOM = 'https://blossom.primal.net';

/** How long an upload authorization is valid (s). */
export const AUTH_TTL_S = 300;

/** A server URL as typed, cleaned to `https://host[/path]` without a trailing slash; null when unsafe. */
export function parseBlossomServer(text: string): string | null {
  const url = safeImageUrl(text);
  if (url === null) return null;
  const u = new URL(url);
  if (u.search !== '' || u.hash !== '') return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

/** The kind 24242 template that authorizes uploading the blob `sha256` to `server` (BUD-02, BUD-11). */
export function uploadAuthTemplate(sha256: Hex, server: string, now: number): EventTemplate {
  return {
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(now + AUTH_TTL_S)],
      ['server', new URL(server).hostname],
    ],
    content: 'Upload profile picture',
  };
}

function base64(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The `Authorization` header value for a signed auth event. */
export const authHeader = (ev: NostrEvent): string => `Nostr ${base64(JSON.stringify(ev))}`;

/** What a server returns for a stored blob. */
export interface BlobDescriptor {
  url: string;
  sha256: Hex;
  size: number;
  type: string;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface UploadRequest {
  server: string;
  bytes: Uint8Array;
  /** The MIME type, `image/webp` or `image/jpeg`. */
  type: string;
  sign: (t: EventTemplate) => Promise<NostrEvent>;
  now: number;
  fetch: FetchLike;
}

/** Messages for the Settings dialog. */
export const UPLOAD_ERRORS = {
  network:
    'Could not reach the picture server, or it refused the upload. Check your connection and the picture server in Settings, then try again.',
  auth: 'The picture server did not accept your signature. Try again, or choose another picture server.',
  tooLarge: 'The picture is too large for this picture server.',
  mismatch: 'The picture server returned something other than the picture. Try another picture server.',
} as const;

/**
 * Upload `bytes` and return the verified descriptor: the server must report the same SHA-256 and size and an
 * https URL that is safe to show. Throws an Error with a plain message otherwise. Only `Authorization` and
 * `Content-Type` are sent, which the server's CORS preflight allows.
 */
export async function uploadBlob(req: UploadRequest): Promise<BlobDescriptor> {
  const server = parseBlossomServer(req.server);
  if (server === null) throw new Error('The picture server must be an https:// address.');
  const sha256 = sha256Hex(req.bytes);
  const auth = await req.sign(uploadAuthTemplate(sha256, server, req.now));
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await req.fetch(`${server}/upload`, {
      method: 'PUT',
      headers: { Authorization: authHeader(auth), 'Content-Type': req.type },
      body: req.bytes,
    });
  } catch {
    // A refusal without CORS headers (Primal's 4xx answers have none) reaches the page as a network error.
    throw new Error(UPLOAD_ERRORS.network);
  }
  if (res.status === 401 || res.status === 403) throw new Error(UPLOAD_ERRORS.auth);
  if (res.status === 413) throw new Error(UPLOAD_ERRORS.tooLarge);
  if (!res.ok) throw new Error(`The picture server refused the upload (error ${res.status}).`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(UPLOAD_ERRORS.mismatch);
  }
  const d = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const url = safeImageUrl(d.url);
  // BUD-01: the blob's URL ends in `<sha256>[.ext]`, so a server cannot point the profile at another image.
  const last = url === null ? '' : (new URL(url).pathname.split('/').pop() ?? '');
  if (d.sha256 !== sha256 || d.size !== req.bytes.length || url === null || !last.startsWith(sha256))
    throw new Error(UPLOAD_ERRORS.mismatch);
  return { url, sha256, size: req.bytes.length, type: typeof d.type === 'string' ? d.type : req.type };
}
