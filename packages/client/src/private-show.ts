import {
  b64u,
  type Ciphertext,
  cardOf,
  decodePoint,
  decodeScalar,
  decryptWithSecrets,
  encodePoint,
  encodeScalar,
  G,
  type RandomBytes,
  type Share,
  verifyShare,
} from '@bored-games/deck';
import { canonicalJson, type Learn, type PrivateShow, SHOW_DECK } from '@bored-games/game-kit';
import { getConversationKey, isNip44Payload, nip44Decrypt, nip44Encrypt } from '@bored-games/protocol';

/*
 * Private shows (PROTOCOL §14, D075): seat `from` shows seat `to` one card it holds, and nobody else learns the card
 * or its deck position. The shower's decryption share of the position rides inside its own `show` move, in one
 * NIP-44 packet under the conversation key of the two seats' deck keys, which only they can open: the other seats'
 * shares of a hand position are public since the deal, so with it either of them decrypts the card. Deck keys are
 * released at the end, so the audit opens every packet. The packet's length is fixed by public data, so two shows of
 * one position cannot be told apart from two shows of two positions.
 */

/** The wire form of a show: the module's own action, with exactly these keys. */
export interface ShowWire {
  readonly type: 'show';
  readonly actor: number;
  readonly id: number;
  readonly packet: string;
}

/** A deck secret as the 32 big-endian bytes of a NIP-44 secret key. */
const secretBytes = (secret: bigint): Uint8Array => b64u.decode(encodeScalar(secret));

/** An event id: what `root` and `after` always are. */
const EVENT_ID = /^[0-9a-f]{64}$/;

const isIndex = (k: unknown): k is number => Number.isSafeInteger(k) && (k as number) >= 0;

const validPlan = (p: PrivateShow): boolean =>
  isIndex(p.id) && isIndex(p.from) && isIndex(p.to) && p.from !== p.to;

const validDeck = (deckSize: number): boolean => Number.isSafeInteger(deckSize) && deckSize >= 1;

/** The digit count of a position in the plaintext: that of the deck's last position, zero-padded to it. */
const posWidth = (deckSize: number): number => String(deckSize - 1).length;

/** The packet's plaintext: canonical JSON of the context, the position and the share's encoded fields. */
function plaintext(
  p: PrivateShow,
  root: string,
  after: string,
  pos: string,
  share: { readonly d: string; readonly c: string; readonly s: string },
): string {
  return canonicalJson({
    after,
    c: share.c,
    d: share.d,
    from: p.from,
    id: p.id,
    pos,
    root,
    s: share.s,
    to: p.to,
  });
}

/**
 * The plaintext length every packet of this show has, from public data alone: the context with event-id-length
 * placeholders, the padded position and share fields of their encoded lengths (a point 44 characters, a scalar 43).
 */
function plaintextLength(p: PrivateShow, deckSize: number): number {
  const id = '0'.repeat(64);
  const share = { d: 'A'.repeat(44), c: 'A'.repeat(43), s: 'A'.repeat(43) };
  return plaintext(p, id, id, '0'.repeat(posWidth(deckSize)), share).length;
}

/**
 * Whether `raw` is the wire form of show `plan` in a deck of `deckSize` cards: exactly the keys `actor`, `id`,
 * `packet` and `type`, of type `show`, from `plan.from`, with `plan.id`, and a packet that is a NIP-44 v2 payload of
 * exactly the plaintext length this show fixes. Public: every client checks it before `apply`. Never throws.
 */
export function showEnvelope(raw: unknown, plan: PrivateShow, deckSize: number): boolean {
  try {
    if (!validPlan(plan) || !validDeck(deckSize)) return false;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
    const a = raw as Record<string, unknown>;
    return (
      Object.keys(a).sort().join(',') === 'actor,id,packet,type' &&
      a.type === 'show' &&
      a.actor === plan.from &&
      a.id === plan.id &&
      isNip44Payload(a.packet, plaintextLength(plan, deckSize))
    );
  } catch {
    return false;
  }
}

/**
 * The wire form of show `plan` of position `pos`, built by its shower: `share` is the shower's decryption share of
 * the position (`makeShare` with its deck secret), `secret` its deck secret, `keys` every seat's x-only deck key in
 * seat order, `root` the game root's id and `after` the move's `prev`. Throws on a plan, position or context it cannot
 * encode.
 */
export function makeShow(
  plan: PrivateShow,
  pos: number,
  secret: bigint,
  share: Share,
  keys: readonly string[],
  root: string,
  after: string,
  deckSize: number,
  rnd: RandomBytes,
): ShowWire {
  if (!validPlan(plan) || !validDeck(deckSize) || !isIndex(pos) || pos >= deckSize)
    throw new Error('Invalid private show.');
  if (!EVENT_ID.test(root) || !EVENT_ID.test(after)) throw new Error('Invalid private show context.');
  const to = keys[plan.to];
  if (to === undefined) throw new Error('The private show has no recipient key.');
  const text = plaintext(plan, root, after, String(pos).padStart(posWidth(deckSize), '0'), {
    d: encodePoint(share.D),
    c: encodeScalar(share.c),
    s: encodeScalar(share.s),
  });
  const packet = nip44Encrypt(text, getConversationKey(secretBytes(secret), to), rnd(32));
  return { type: 'show', actor: plan.from, id: plan.id, packet };
}

/**
 * Open show `plan`'s packet as `seat` (its shower or its submitter) with that seat's deck `secret`: the shown
 * position and the shower's share, its proof not yet verified. Throws unless `raw` passes `showEnvelope` and the
 * plaintext is canonical, holds exactly the keys `after`, `c`, `d`, `from`, `id`, `pos`, `root`, `s` and `to`,
 * matches the context (`root`, `after`, the plan's `id`, `from` and `to`), and holds a padded position in the deck
 * and a well-encoded share.
 */
export function readShow(
  raw: unknown,
  plan: PrivateShow,
  seat: number,
  secret: bigint,
  keys: readonly string[],
  root: string,
  after: string,
  deckSize: number,
): { pos: number; share: Share } {
  if (!showEnvelope(raw, plan, deckSize)) throw new Error('The private show is malformed.');
  if (seat !== plan.from && seat !== plan.to) throw new Error('The private show is not for this seat.');
  const other = keys[seat === plan.from ? plan.to : plan.from];
  if (other === undefined) throw new Error('The private show has no counterpart key.');
  const text = nip44Decrypt((raw as ShowWire).packet, getConversationKey(secretBytes(secret), other));
  const data: unknown = JSON.parse(text);
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new Error('The private show holds no object.');
  const d = data as Record<string, unknown>;
  if (Object.keys(d).sort().join(',') !== 'after,c,d,from,id,pos,root,s,to' || canonicalJson(d) !== text)
    throw new Error('The private show plaintext is not canonical.');
  if (d.root !== root || d.after !== after || d.id !== plan.id || d.from !== plan.from || d.to !== plan.to)
    throw new Error('The private show context does not match.');
  const width = posWidth(deckSize);
  if (typeof d.pos !== 'string' || d.pos.length !== width || !/^[0-9]+$/.test(d.pos))
    throw new Error('The private show position is not padded.');
  const pos = Number(d.pos);
  if (pos >= deckSize) throw new Error('The private show position is outside the deck.');
  const share: Share = {
    D: decodePoint(d.d as string),
    c: decodeScalar(d.c as string),
    s: decodeScalar(d.s as string),
  };
  return { pos, share };
}

/**
 * The end-game check of show `plan` with every seat's released deck secret (`secrets`, in seat order): open the
 * packet with the shower's secret (`readShow`, so the envelope, the plaintext and the context), check that
 * `holderOf(pos)` (the latest `dealt` entry of the position before the show) is the shower, that the share is the
 * shower's own (`D = x_from · a`), and, given `deckId`, that its proof verifies as the submitter's client checked it
 * in play, then decrypt the position with every secret. Returns the learn `{deck: SHOW_DECK, pos: plan.id, card}`
 * for the full-mode state; throws on any mismatch, which fails the shower.
 */
export function auditShow(
  raw: unknown,
  plan: PrivateShow,
  secrets: readonly bigint[],
  root: string,
  after: string,
  deck: readonly Ciphertext[],
  cards: ReadonlyMap<string, number>,
  holderOf: (pos: number) => number | null,
  deckId?: string,
): Learn {
  const secret = secrets[plan.from];
  if (secret === undefined) throw new Error('No deck secret for the shower.');
  const keys = secrets.map((x) => G.multiply(x).toHex(true).slice(2));
  const { pos, share } = readShow(raw, plan, plan.from, secret, keys, root, after, deck.length);
  if (holderOf(pos) !== plan.from) throw new Error('The shown position is not held by the shower.');
  const ct = deck[pos] as Ciphertext;
  if (!share.D.equals(ct.a.multiply(secret)))
    throw new Error('The share is not made with the shower secret.');
  if (deckId !== undefined && !verifyShare(G.multiply(secret), ct, share, { rootId: root, deckId, pos }))
    throw new Error('The share proof does not verify.');
  const card = cardOf(cards, decryptWithSecrets(ct, secrets));
  if (card === null) throw new Error('The shown position decrypts to no card.');
  return { deck: SHOW_DECK, pos: plan.id, card };
}
