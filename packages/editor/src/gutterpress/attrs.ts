/**
 * markdown-it-attrs on the rich surface (fork Patch 4 host side).
 *
 * Gutterpress books write `# Title {#ch-1 .x key=v}` and the pipeline
 * (markdown-it-attrs) turns the trailer into real attributes on the
 * heading. The editor's own parser has no attrs syntax, so it renders the
 * trailer as heading text. While a block is INACTIVE (its markers are
 * hidden, the reader's view) this applies the trailer's `id`/`class`/data
 * attributes to the rendered element and removes the trailer text from
 * the rendering; when the author activates the block, the fork rebuilds
 * it from source and the trailer is back, editable. The source is never
 * touched.
 */
const TRAILER_RE = /\s*\{([^{}\n]*)\}\s*$/;
const TOKEN_RE = /([.#]?[^\s=]+)(?:=("[^"]*"|'[^']*'|[^\s]+))?/g;

export function parseAttrsTrailer(sourceText: string): { readonly attrs: Record<string, string>; readonly classes: string[]; readonly id?: string; readonly trailer: string } | null {
  const m = TRAILER_RE.exec(sourceText.trimEnd());
  if (!m) return null;
  const classes: string[] = [];
  const attrs: Record<string, string> = {};
  let id: string | undefined;
  for (const t of m[1]!.matchAll(TOKEN_RE)) {
    const key = t[1]!;
    const raw = t[2];
    const value = raw === undefined ? "" : raw.replace(/^["']|["']$/g, "");
    if (key.startsWith(".")) classes.push(key.slice(1));
    else if (key.startsWith("#")) id = key.slice(1);
    else if (raw !== undefined && !/^on/i.test(key)) attrs[key] = value;
  }
  if (!classes.length && !id && !Object.keys(attrs).length) return null;
  return { attrs, classes, id, trailer: m[0] };
}

/** `decorateInactiveBlock` for headings and paragraphs: apply the trailer, hide its text. */
export function decorateAttrsTrailer(element: HTMLElement, node: { readonly kind: string }, sourceText: string): void {
  if (node.kind !== "heading" && node.kind !== "paragraph") return;
  const parsed = parseAttrsTrailer(sourceText);
  if (!parsed) return;
  if (parsed.id) element.id = parsed.id;
  for (const cls of parsed.classes) element.classList.add(cls);
  for (const [k, v] of Object.entries(parsed.attrs)) element.setAttribute(k, v);

  // Remove the trailer from the LAST text node(s). The text before it keeps
  // its node identity, so the fork's click-to-caret mapping for that text
  // is unchanged; the trailer itself is not clickable while hidden.
  const trailer = parsed.trailer.trimStart();
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  let remaining = trailer.length;
  for (let i = texts.length - 1; i >= 0 && remaining > 0; i--) {
    const t = texts[i]!;
    if (!t.data.trim() && remaining === trailer.length) continue; // trailing whitespace nodes
    const cut = Math.min(remaining, t.data.length);
    t.data = t.data.slice(0, t.data.length - cut);
    remaining -= cut;
  }
  if (texts.length) {
    const last = texts.find((t) => t.data.length > 0);
    void last;
  }
  const lastNonEmpty = [...texts].reverse().find((t) => t.data.length > 0);
  if (lastNonEmpty) lastNonEmpty.data = lastNonEmpty.data.replace(/\s+$/, "");
}
