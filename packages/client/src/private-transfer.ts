import { b64u, encodeScalar, G, hs, type RandomBytes } from '@bored-games/deck';
import { faces } from '@bored-games/dice';
import { canonicalJson, type Learn } from '@bored-games/game-kit';
import { getConversationKey, isNip44Payload, nip44Decrypt, nip44Encrypt } from '@bored-games/protocol';

/** Private supply delivery, authenticated during play and checked against released deck keys at audit. */
export interface Selection {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly index: number;
  readonly labels: readonly number[] | null;
}
export interface TransferEnvelope {
  readonly type: 'transfer';
  readonly actor: number;
  readonly id: number;
  readonly root: string;
  /** The request before contributors disclose the random choice. */
  readonly anchor: string;
  /** The actual parent of this delivery, checked against the signed move. */
  readonly after: string;
  readonly packets: readonly { readonly to: number; readonly ciphertext: string }[];
}
const secretBytes = (secret: bigint) => b64u.decode(encodeScalar(secret));
const context = (p: Selection, root: string, anchor: string, after: string) => ({
  root,
  anchor,
  after,
  id: p.id,
  from: p.from,
  to: p.to,
  index: p.index,
});
const validPlan = (p: Selection) =>
  Number.isSafeInteger(p.id) &&
  p.id >= 0 &&
  Number.isSafeInteger(p.index) &&
  p.index >= 0 &&
  Number.isSafeInteger(p.from) &&
  p.from >= 0 &&
  Number.isSafeInteger(p.to) &&
  p.to >= 0 &&
  p.from !== p.to;

/** Cryptographic Fisher–Yates. Neither the revealed index nor delivery nonces affect the private order. */
export function selectedLabel(p: Selection, secret: bigint, root: string, anchor: string): number {
  if (
    !validPlan(p) ||
    !p.labels?.length ||
    p.labels.length > 95 ||
    p.index >= p.labels.length ||
    p.labels.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 4)
  )
    throw new Error('Invalid private hand.');
  const order = [...p.labels];
  for (let i = order.length - 1; i > 0; i--) {
    const seed = secretBytes(hs('driftwrights/private-hand/v1', secret, root, anchor, p.id, i));
    const j = (faces(seed, 1, i + 1)[0] as number) - 1;
    const previous = order[i] as number;
    order[i] = order[j] as number;
    order[j] = previous;
  }
  return order[p.index] as number;
}
export function transferEnvelope(
  raw: unknown,
  p: Selection,
  root: string,
  anchor: string,
  after: string,
): raw is TransferEnvelope {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validPlan(p)) return false;
    const a = raw as TransferEnvelope;
    return (
      Object.keys(a).sort().join(',') === 'actor,after,anchor,id,packets,root,type' &&
      a.type === 'transfer' &&
      a.actor === p.from &&
      a.id === p.id &&
      a.root === root &&
      a.anchor === anchor &&
      a.after === after &&
      Array.isArray(a.packets) &&
      a.packets.length === 2 &&
      a.packets.every(
        (packet, i) =>
          packet &&
          Object.keys(packet).sort().join(',') === 'ciphertext,to' &&
          packet.to === [p.from, p.to].sort((a, b) => a - b)[i] &&
          typeof packet.ciphertext === 'string' &&
          packet.ciphertext.length < 2048 &&
          isNip44Payload(
            packet.ciphertext,
            canonicalJson({ ...context(p, root, anchor, after), card: 0 }).length,
          ),
      )
    );
  } catch {
    return false;
  }
}
export function makeTransfer(
  p: Selection,
  secret: bigint,
  keys: readonly string[],
  root: string,
  anchor: string,
  after: string,
  rnd: RandomBytes,
): TransferEnvelope {
  const card = selectedLabel(p, secret, root, anchor);
  const text = canonicalJson({ ...context(p, root, anchor, after), card });
  return {
    type: 'transfer',
    actor: p.from,
    id: p.id,
    root,
    anchor,
    after,
    packets: [p.from, p.to]
      .sort((a, b) => a - b)
      .map((to) => ({
        to,
        ciphertext: nip44Encrypt(text, getConversationKey(secretBytes(secret), keys[to] as string), rnd(32)),
      })),
  };
}
export function readTransfer(
  raw: TransferEnvelope,
  p: Selection,
  seat: number,
  secret: bigint,
  keys: readonly string[],
): Learn {
  const packet = raw.packets.find((packet) => packet.to === seat);
  if (!packet) throw new Error('Transfer is not addressed to this seat.');
  const data = JSON.parse(
    nip44Decrypt(packet.ciphertext, getConversationKey(secretBytes(secret), keys[p.from] as string)),
  ) as Record<string, unknown>;
  if (
    !data ||
    Object.keys(data).sort().join(',') !== 'after,anchor,card,from,id,index,root,to' ||
    Object.entries(context(p, raw.root, raw.anchor, raw.after)).some(([k, v]) => data[k] !== v) ||
    !Number.isSafeInteger(data.card) ||
    (data.card as number) < 0 ||
    (data.card as number) > 4
  )
    throw new Error('Private transfer context or resource is invalid.');
  return { deck: 'supplies', pos: p.id, card: data.card as number };
}

/** End-game verification checks both recipients and the committed, uniformly permuted victim hand. */
export function auditTransfer(
  raw: unknown,
  p: Selection,
  secrets: readonly bigint[],
  root: string,
  anchor: string,
  after: string,
): Learn {
  if (!transferEnvelope(raw, p, root, anchor, after)) throw new Error('Invalid private envelope.');
  const keys = secrets.map((x) => G.multiply(x).toHex(true).slice(2));
  const expected = selectedLabel(p, secrets[p.from] as bigint, root, anchor);
  const deliveries = [p.from, p.to].map((seat) => readTransfer(raw, p, seat, secrets[seat] as bigint, keys));
  if (deliveries.some((l) => l.card !== expected))
    throw new Error('Private delivery differs from the committed selection.');
  return deliveries[0] as Learn;
}
