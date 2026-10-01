import { ProtocolError } from './errors.ts';
import { PROTO } from './kinds.ts';

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

/** Exactly one `["proto", "1"]` tag. Throws `bad-proto` otherwise. */
export function requireProto(tags: readonly (readonly string[])[]): void {
  const found = named(tags, 'proto');
  const tag = found[0];
  if (found.length !== 1 || tag === undefined || tag.length !== 2 || tag[1] !== PROTO) {
    throw new ProtocolError('bad-proto', `expected exactly one ["proto","${PROTO}"] tag`);
  }
}

function pairValue(tag: string[], name: string): string {
  if (tag.length !== 2) throw new ProtocolError('bad-tag', `a "${name}" tag must have exactly 2 items`);
  return tag[1] as string;
}
