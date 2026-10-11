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

/**
 * An image trailer binds to the IMAGE, not to the paragraph around it.
 *
 * markdown-it-attrs attaches `{...}` to the inline element it directly
 * follows, so `![art](a.png){.gp-pin .gp-bottom}` pins the IMAGE — and the
 * pin takes it out of flow, which is why the paragraph around it is zero
 * height in the book. Applying those classes to the paragraph instead left
 * the image in flow at full height: on the field guide's first chapter one
 * plate measured 581px in the editor against 260px in the book, and the two
 * paginated differently from that point on.
 *
 * A trailer separated from the image by whitespace is a BLOCK trailer (the
 * author wrote it as a line-level annotation), which is the other spelling
 * the same book uses.
 */
const IMAGE_TRAILER_RE = /!\[[^\]]*\]\([^)]*\)\{[^{}\n]*\}$/;

/** The inline elements markdown-it-attrs gives a `{...}` written straight after them. */
const INLINE_ATTRS_TARGETS = new Set(["A", "EM", "STRONG", "CODE", "IMG", "S", "DEL"]);
const LEADING_ATTRS_RE = /^\{[^{}\n]*\}/;

function applyParsedAttrs(target: Element, parsed: NonNullable<ReturnType<typeof parseAttrsTrailer>>): void {
  if (parsed.id) target.id = parsed.id;
  for (const cls of parsed.classes) target.classList.add(cls);
  for (const [k, v] of Object.entries(parsed.attrs)) target.setAttribute(k, v);
}

/**
 * `decorateInactiveBlock` for any block: a `{...}` written straight after a
 * link, emphasis, strong, code span or image (`[Alpha](#alpha){.toc}`) is
 * that element's, as markdown-it-attrs makes it on the page - a book's TOC
 * styles `a.toc::after` with the target's page number. The fork renders the
 * braces as the text right after the element; this applies them to the
 * element and hides them. A `{...}` after plain text or a space is the
 * block's, which `decorateAttrsTrailer` handles.
 */
export function decorateInlineAttrs(element: HTMLElement): void {
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const text of texts) {
    if (text.parentElement?.closest(".md-marker, .md-glue")) continue;
    const before = text.previousSibling;
    if (!before || before.nodeType !== 1 || !INLINE_ATTRS_TARGETS.has((before as Element).tagName)) continue;
    const braces = LEADING_ATTRS_RE.exec(text.data)?.[0];
    const parsed = braces ? parseAttrsTrailer(braces) : null;
    if (!braces || !parsed) continue;
    applyParsedAttrs(before as Element, parsed);
    text.data = text.data.slice(braces.length);
  }
}

/** `decorateInactiveBlock` for headings and paragraphs: apply the trailer, hide its text. */
export function decorateAttrsTrailer(element: HTMLElement, node: { readonly kind: string }, sourceText: string): void {
  if (node.kind !== "heading" && node.kind !== "paragraph") return;
  const parsed = parseAttrsTrailer(sourceText);
  if (!parsed) return;
  // An element's own trailer (`[A](#a){.toc}`), already applied by
  // `decorateInlineAttrs`, is not the block's.
  if (!(element.textContent ?? "").trimEnd().endsWith(parsed.trailer.trim())) return;
  const image = IMAGE_TRAILER_RE.test(sourceText.trimEnd())
    ? element.querySelector("img")
    : null;
  const target: HTMLElement = image ?? element;
  applyParsedAttrs(target, parsed);

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
