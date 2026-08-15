/**
 * serialize-testkit.ts — TEST/GATE-ONLY helpers for the block serializer.
 *
 * Bun has no DOM, so serializer tests and the corpus round-trip gate
 * (`scripts/roundtrip-gate.ts`) parse renderer-emitted HTML with the strict
 * little parser here and feed it to the serializer through its
 * {@link ElementLike} interface. The parser accepts exactly what the
 * renderer (and disciplined author raw HTML) produces — well-formed tags,
 * quoted attributes, comments; anything else throws, which for gate purposes
 * is itself a useful signal.
 *
 * Never imported by runtime code — the live preview uses real DOM.
 */
import type { ElementLike, TextLike } from "./serialize";

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr",
]);

export interface TestElement extends ElementLike {
  tagName: string;
  attrs: Map<string, string>;
  childNodes: Array<TestElement | TextLike>;
  parent: TestElement | null;
}

export function isTestElement(n: TestElement | TextLike): n is TestElement {
  return n.nodeType === 1;
}

function makeElement(tag: string, parent: TestElement | null): TestElement {
  const attrs = new Map<string, string>();
  const el: TestElement = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    childNodes: [],
    parent,
    getAttribute: (name) => attrs.get(name.toLowerCase()) ?? null,
    getAttributeNames: () => [...attrs.keys()],
  };
  return el;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const TAG_RE =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Parse renderer-emitted HTML into a synthetic root ElementLike. */
export function parseHtml(html: string): TestElement {
  const root = makeElement("root", null);
  let current = root;
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    const text = html.slice(last, m.index);
    if (text) current.childNodes.push({ nodeType: 3, data: decodeEntities(text) });
    last = m.index + m[0].length;

    if (m[0].startsWith("<!--")) {
      current.childNodes.push({ nodeType: 8, data: m[0].slice(4, -3) });
      continue;
    }
    const [, close, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag!.toLowerCase();
    if (close) {
      if (current.tagName.toLowerCase() !== tag) {
        throw new Error(`test parser: </${tag}> closes <${current.tagName.toLowerCase()}>`);
      }
      current = current.parent!;
      continue;
    }
    const el = makeElement(tag, current);
    let a: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(rawAttrs ?? ""))) {
      el.attrs.set(a[1]!.toLowerCase(), decodeEntities(a[2] ?? a[3] ?? a[4] ?? ""));
    }
    current.childNodes.push(el);
    if (!selfClose && !VOID_TAGS.has(tag)) current = el;
  }
  const trailing = html.slice(last);
  if (trailing) current.childNodes.push({ nodeType: 3, data: decodeEntities(trailing) });
  if (current !== root) throw new Error(`test parser: unclosed <${current.tagName}>`);
  return root;
}

// ── source-slice helpers (line semantics match data-source-range) ──────────

export function sliceLines(src: string, range: [number, number]): string {
  return src.split("\n").slice(range[0], range[1]).join("\n");
}

export function substitute(src: string, range: [number, number], text: string): string {
  const lines = src.split("\n");
  return [...lines.slice(0, range[0]), ...text.split("\n"), ...lines.slice(range[1])].join("\n");
}

export function parseRange(raw: string): [number, number] {
  const [a, b] = raw.split(":").map(Number);
  return [a!, b!];
}
