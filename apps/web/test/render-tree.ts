/*
 * Rendered output without a DOM library: `renderTree` expands vnodes the way Preact would (function components
 * called with their props, Fragments flattened) into a plain element tree. Only for components that use no hooks.
 */
import type { ComponentChildren, VNode } from 'preact';

export interface El {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly children: readonly Node[];
}
export type Node = El | string;

export function renderTree(node: ComponentChildren): Node[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return [String(node)];
  if (Array.isArray(node)) return node.flatMap((n) => renderTree(n as ComponentChildren));
  const v = node as VNode<Record<string, unknown>>;
  if (typeof v.type === 'function') {
    const component = v.type as (props: unknown) => ComponentChildren;
    return renderTree(component(v.props));
  }
  const { children, ...attrs } = v.props;
  return [{ tag: String(v.type), attrs, children: renderTree(children as ComponentChildren) }];
}

export const isEl = (n: Node): n is El => typeof n !== 'string';
export const classOf = (el: El): string[] => String(el.attrs.class ?? '').split(/\s+/);

export function findAll(nodes: readonly Node[], pred: (el: El) => boolean): El[] {
  return nodes.filter(isEl).flatMap((el) => [...(pred(el) ? [el] : []), ...findAll(el.children, pred)]);
}

const BLOCK = new Set([
  'article',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'h1',
  'h2',
  'h3',
  'header',
  'li',
  'nav',
  'ol',
  'p',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

/**
 * The text a screen reader speaks, as one line: inline pieces run together as in the browser, block elements are
 * set apart by a space, and `aria-hidden` subtrees are left out (sr-only text stays in).
 */
export function spokenText(nodes: readonly Node[]): string {
  const walk = (ns: readonly Node[]): string =>
    ns
      .map((n) => {
        if (!isEl(n)) return n;
        if (n.attrs['aria-hidden'] === 'true' || n.attrs['aria-hidden'] === true) return '';
        const inner = walk(n.children);
        return BLOCK.has(n.tag) ? ` ${inner} ` : inner;
      })
      .join('');
  return walk(nodes).replace(/\s+/g, ' ').trim();
}

/** Everything a reader or screen reader gets: text (sr-only included), aria-labels and titles. */
export function textOf(nodes: readonly Node[]): string {
  return nodes
    .map((n) =>
      isEl(n)
        ? [n.attrs['aria-label'], n.attrs.title, textOf(n.children)]
            .filter((x) => typeof x === 'string')
            .join(' ')
        : n,
    )
    .join(' ');
}
