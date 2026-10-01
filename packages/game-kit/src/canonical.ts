/**
 * Canonical JSON: object keys sorted, no whitespace. Rejects values that do not
 * survive a JSON round trip unchanged (undefined, NaN, Infinity, -0, Map, Set,
 * functions, class instances), so equal canonical strings mean equal data.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
      if (Object.is(value, -0)) throw new TypeError(`negative zero at ${path}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) throw new TypeError(`sparse array at ${path}[${i}]`);
          parts.push(encode(value[i], `${path}[${i}]`));
        }
        return `[${parts.join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`non-plain object at ${path}`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareCodeUnits);
      const parts: string[] = [];
      for (const key of keys) {
        const v = record[key];
        if (v === undefined) throw new TypeError(`undefined at ${path}.${key}`);
        parts.push(`${JSON.stringify(key)}:${encode(v, `${path}.${key}`)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`unsupported ${typeof value} at ${path}`);
  }
}

/** Locale-independent string ordering by UTF-16 code units. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deep equality of plain JSON data via canonical encoding. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
