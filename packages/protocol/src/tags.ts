import { ProtocolError } from './errors.ts';
import { PROTOS, type Proto } from './kinds.ts';

/*
 * Strict tag helpers. A protocol tag has exactly the items PROTOCOL §4 lists: `one` and `many` read
 * `[name, value]` pairs and reject a tag of that name with any other length. Tags with names the parser does not
 * ask for are ignored.
 */

/** Every tag named `name`, in event order. */
export function named(tags: readonly (readonly string[])[], name: string): string[][] {
  const out: string[][] = [];
  for (const tag of tags) if (tag[0] === name) out.push([...tag]);
  return out;
}

/** The value of the one `[name, value]` tag. Throws `bad-tag` when it is missing, repeated or not a pair. */
export function one(tags: readonly (readonly string[])[], name: string): string {
  const found = named(tags, name);
  if (found.length !== 1) {
    throw new ProtocolError('bad-tag', `expected exactly one "${name}" tag, found ${found.length}`);
  }
  return pairValue(found[0] as string[], name);
}

/** The values of every `[name, value]` tag, in event order (possibly none). Throws `bad-tag` on a non-pair. */
export function many(tags: readonly (readonly string[])[], name: string): string[] {
  return named(tags, name).map((tag) => pairValue(tag, name));
}

/**
 * The one `["proto", <version>]` tag, returned. With `expected` (an in-game parser: the game's proto), the value
 * must be `expected`; without it (a lobby parser), any of `PROTOS`. Throws `bad-proto` on a missing, repeated or
 * malformed tag and on any other value (PROTOCOL-v2 §2). With `expected` the message is v1's, naming that value.
 */
export function requireProto(tags: readonly (readonly string[])[], expected?: Proto): Proto {
  const found = named(tags, 'proto');
  const tag = found[0];
  const value = tag?.[1];
  const ok =
    found.length === 1 &&
    tag !== undefined &&
    tag.length === 2 &&
    (PROTOS as readonly unknown[]).includes(value) &&
    (expected === undefined || value === expected);
  if (!ok) {
    const want =
      expected === undefined ? PROTOS.map((p) => `["proto","${p}"]`).join(' or ') : `["proto","${expected}"]`;
    throw new ProtocolError('bad-proto', `expected exactly one ${want} tag`);
  }
  return value as Proto;
}

function pairValue(tag: string[], name: string): string {
  if (tag.length !== 2) throw new ProtocolError('bad-tag', `a "${name}" tag must have exactly 2 items`);
  return tag[1] as string;
}
