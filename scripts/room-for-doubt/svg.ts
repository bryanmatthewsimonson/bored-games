/*
 * Small SVG helpers for Room for Doubt's art (D068): elements, escaped text, the document wrapper and a well-formedness
 * check. Pure string building, so every renderer is deterministic.
 */

export type Attrs = Record<string, string | number | undefined>;

const escapeText = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replaceAll('"', '&quot;');

function attrString(attrs: Attrs): string {
  return Object.entries(attrs)
    .flatMap(([k, v]) => (v === undefined ? [] : [` ${k}="${escapeAttr(String(v))}"`]))
    .join('');
}

/** An element. Attributes whose value is undefined are left out; an element with no children self-closes. */
export function el(tag: string, attrs: Attrs = {}, ...children: (string | undefined)[]): string {
  const inner = children.filter((c): c is string => c !== undefined).join('');
  return inner === '' ? `<${tag}${attrString(attrs)}/>` : `<${tag}${attrString(attrs)}>${inner}</${tag}>`;
}

/** A `<text>` element whose content is escaped. */
export function text(content: string, attrs: Attrs = {}): string {
  return el('text', attrs, escapeText(content));
}

/**
 * A whole SVG file: the XML declaration, a comment naming the CC0-1.0 dedication (and `comment`, when given), the
 * root with `role="img"`, `<title>` and `<desc>`, then `body`.
 */
export function svgDocument(
  opts: { width: number; height: number; title: string; desc: string; comment?: string },
  body: string,
): string {
  const note = [
    'Room for Doubt art (D068). Original work dedicated to the public domain: CC0-1.0, https://creativecommons.org/publicdomain/zero/1.0/',
    opts.comment,
  ]
    .filter((c): c is string => c !== undefined)
    .map((c) => c.replaceAll('--', '- -'))
    .join('. ');
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- ${note} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">`,
    el('title', {}, escapeText(opts.title)),
    el('desc', {}, escapeText(opts.desc)),
    body,
    '</svg>',
  ].join('\n')}\n`;
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
const STRAY = /<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/** Whether `svg` has balanced tags, no stray `<` and no unescaped `&`. */
export function isWellFormed(svg: string): boolean {
  const stack: string[] = [];
  let last = 0;
  for (const m of svg.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (STRAY.test(svg.slice(last, start))) return false;
    last = start + m[0].length;
    const name = m[2];
    if (name === undefined) continue;
    if (m[1] === '/') {
      if (stack.pop() !== name) return false;
    } else if (m[4] !== '/') {
      stack.push(name);
    }
  }
  return stack.length === 0 && !STRAY.test(svg.slice(last));
}
