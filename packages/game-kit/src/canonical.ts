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

/**
 * Structural equality of plain JSON data (object key order ignored). Faster
 * than comparing encodings; both sides are assumed JSON-safe.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  if (ka.length !== Object.keys(rb).length) return false;
  for (const k of ka) if (!Object.hasOwn(rb, k) || !jsonEqual(ra[k], rb[k])) return false;
  return true;
}

/** Throws (like canonicalJson) on any value that would not survive a JSON round trip, without encoding. */
export function assertJsonSafe(value: unknown): void {
  const path: (string | number)[] = [];
  const where = (): string => `$${path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('')}`;
  const walk = (v: unknown): void => {
    if (v === null) return;
    switch (typeof v) {
      case 'boolean':
      case 'string':
        return;
      case 'number':
        if (!Number.isFinite(v)) throw new TypeError(`non-finite number at ${where()}`);
        if (Object.is(v, -0)) throw new TypeError(`negative zero at ${where()}`);
        return;
      case 'object': {
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            path.push(i);
            if (!(i in v)) throw new TypeError(`sparse array at ${where()}`);
            walk(v[i]);
            path.pop();
          }
          return;
        }
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null)
          throw new TypeError(`non-plain object at ${where()}`);
        for (const k in v as Record<string, unknown>) {
          path.push(k);
          const child = (v as Record<string, unknown>)[k];
          if (child === undefined) throw new TypeError(`undefined at ${where()}`);
          walk(child);
          path.pop();
        }
        return;
      }
      default:
        throw new TypeError(`unsupported ${typeof v} at ${where()}`);
    }
  };
  walk(value);
}
