/**
 * `data-name` — a stable hook for targeting ONE block from a stylesheet.
 *
 * A book's markdown holds content and semantic markers; its look lives in the
 * plugin's and the book's CSS. What CSS needs, to restyle a single block
 * without a markdown edit, is something on that block to select by. Class
 * names are shared by every instance, an `id` is something the author must
 * type, and position selectors break on any insertion. So every block this
 * pipeline can name gets a `data-name`:
 *
 *   [data-name="sporos"] { break-inside: avoid; }
 *   img[data-name="founder-house"] { float: right; width: 40%; }
 *
 * Plain HTML: a `data-*` attribute is standard, selected with the standard
 * attribute selector, and nothing here is a behaviour a future browser
 * feature would replace. The viewer never reads it; it exists for the
 * author's CSS.
 *
 * WHAT GETS A NAME
 *
 *   Marker-opened blocks (`.chapter`, `.spread`, `.page`, `.section`, every
 *   declared marker, `@columns` included, their variants too) take, in order:
 *     1. the marker's explicit `name=` (core already emits it as `data-name`);
 *     2. its `label=`, slugged;
 *     3. the slug of the block's OWN first heading: the first heading whose
 *        innermost marker block is this one, so a `@page` that holds a
 *        `@section` does not borrow the section's title and the two never
 *        share a name;
 *     4. nothing. A block with no explicit name, label or own heading stays
 *        unnamed rather than getting a position-based name that moves when
 *        a block is inserted.
 *   Headings take an explicit `{name=…}`, else the slug of their own text.
 *   Images take an explicit `{name=…}`, else the slug of the file's basename
 *   without its extension (see {@link nameFromSrc}, applied in images.ts).
 *
 * SLUGS: lower-case, accents folded to ASCII, every run of other characters
 * becomes one `-`, trimmed. `slug.ts`'s `slugify` plus a few letters NFKD
 * does not decompose.
 *
 * COLLISIONS. Names are unique within one source file, because a file is
 * rendered on its own (a book is the concatenation of its files):
 *   - blocks share ONE namespace, so `[data-name="x"]` is exactly one block
 *     in a file whatever its kind; headings have their own namespace, so a
 *     section and its title can both be `sporos`. Pair the attribute with an
 *     element (`h3[data-name="sporos"]`) or a class to say which;
 *   - a later duplicate gets `-2`, `-3`, … in document order. Explicit names
 *     are authored and never rewritten; they are reserved first, so a
 *     derived name steps around them;
 *   - images are NOT numbered: two images from the same file share a name,
 *     which is usually what a book wants.
 * A book that needs a name unique across files scopes the selector by chapter
 * (`#ch-06 [data-name="x"]`) or types `name=`.
 *
 * CONTINUATIONS. A `gp-continued` section (made by `@continue`) is the SAME
 * block, so it keeps its original's `data-name` and carries the
 * `gp-continued` class; `:not(.gp-continued)` picks the first piece. It does
 * NOT repeat the `id` (an id names one element; see markers.js).
 *
 * NO `id`s ARE ADDED. Ids feed `target-counter()` and links; inventing them
 * would change what a document links to.
 *
 * Runs last among the built-in core rules and before any loaded plugin's own
 * rules, so it sees `markdown-it-attrs`' result and a plugin sees the names.
 */
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { slugify } from "../slug";

const BLOCK_OPEN = /^layout_(chapter|spread|page|section|component)_open$/;
const BLOCK_CLOSE = /^layout_(chapter|spread|page|section|component)_close$/;

// Letters NFKD does not decompose (so `slugify` would turn them into `-`).
const FOLDED: Record<string, string> = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", þ: "th", ł: "l", ı: "i",
};

/** The `data-name` slug of `text`: `""` when nothing usable is left. */
export function nameSlug(text: string): string {
  return slugify(text.replace(/[ßæœøđðþłı]/gi, (c) => FOLDED[c.toLowerCase()] ?? c));
}

/**
 * The image name for `src`: its file's basename without extension, slugged.
 * `images/chapter-00/Founder%20House.png?v=2` is `founder-house`. A `data:`
 * URI has no file name, so it has none.
 */
export function nameFromSrc(src: string): string {
  if (/^data:/i.test(src)) return "";
  const path = src.split(/[?#]/, 1)[0] ?? "";
  const base = path.split(/[\\/]/).pop() ?? "";
  let decoded = base;
  try {
    decoded = decodeURIComponent(base);
  } catch {
    // A stray `%` that is not an escape: use the text as written.
  }
  return nameSlug(decoded.replace(/\.[^.]*$/, ""));
}

/**
 * The author's explicit name on a token: `data-name`, or the `name` a
 * `{name=…}` brace leaves behind (not a valid attribute on these elements, so
 * it is moved to `data-name`). `""` when there is none.
 */
export function takeExplicitName(token: Token): string {
  const data = token.attrGet("data-name");
  const plain = token.attrGet("name");
  if (plain !== null && token.attrs) token.attrs = token.attrs.filter(([k]) => k !== "name");
  if (data) return data;
  if (plain) {
    token.attrSet("data-name", plain);
    return plain;
  }
  return "";
}

/** The plain text of an inline token (images contribute their alt text). */
function inlineText(inline: Token | undefined): string {
  if (!inline || inline.type !== "inline") return "";
  const parts: string[] = [];
  for (const child of inline.children ?? []) {
    if (child.type === "text" || child.type === "text_special" || child.type === "code_inline" || child.type === "image") {
      parts.push(child.content);
    } else if (child.type === "softbreak" || child.type === "hardbreak") {
      parts.push(" ");
    }
  }
  return parts.join("");
}

/** Hand out `slug`, `slug-2`, `slug-3`, … skipping every name in `used`. */
function claim(used: Set<string>, slug: string): string {
  let name = slug;
  for (let n = 2; used.has(name); n++) name = `${slug}-${n}`;
  used.add(name);
  return name;
}

interface Block {
  token: Token;
  type: string;
  /** Slug of the first heading directly inside this block, once seen. */
  heading: string;
}

function nameBlocksAndHeadings(tokens: Token[]): void {
  const blocks: Block[] = [];
  const open: Block[] = [];
  const headings: Token[] = [];
  const headingSlugs = new Map<Token, string>();

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const opened = BLOCK_OPEN.exec(tok.type);
    if (opened) {
      const block: Block = { token: tok, type: opened[1]!, heading: "" };
      blocks.push(block);
      open.push(block);
      continue;
    }
    const closed = BLOCK_CLOSE.exec(tok.type);
    if (closed) {
      // Closes are matched by kind, not strictly LIFO: a mis-ordered
      // document (a @page opened before its @chapter) closes by kind rank.
      for (let j = open.length - 1; j >= 0; j--) {
        if (open[j]!.type === closed[1]) {
          open.splice(j, 1);
          break;
        }
      }
      continue;
    }
    if (tok.type === "heading_open") {
      const slug = nameSlug(inlineText(tokens[i + 1]));
      headings.push(tok);
      headingSlugs.set(tok, slug);
      const owner = open[open.length - 1];
      if (owner && !owner.heading) owner.heading = slug;
    }
  }

  // Explicit names are authored: reserved first, never rewritten.
  const usedBlocks = new Set<string>();
  const usedHeadings = new Set<string>();
  const unnamedBlocks = new Set<Block>();
  for (const block of blocks) {
    const explicit = block.token.attrGet("data-name");
    if (explicit) usedBlocks.add(explicit);
    else unnamedBlocks.add(block);
  }
  const unnamedHeadings: Token[] = [];
  for (const heading of headings) {
    const explicit = takeExplicitName(heading);
    if (explicit) usedHeadings.add(explicit);
    else unnamedHeadings.push(heading);
  }

  let previousSection: Block | null = null;
  for (const block of blocks) {
    const { token } = block;
    if (block.type === "section") {
      // A continuation is its section's second piece: same block, same name.
      if ((token.meta as { continued?: boolean } | null)?.continued && previousSection) {
        const inherited = previousSection.token.attrGet("data-name");
        if (inherited) token.attrSet("data-name", inherited);
        previousSection = block;
        continue;
      }
      previousSection = block;
    }
    if (!unnamedBlocks.has(block)) continue;
    const slug = nameSlug(token.attrGet("data-label") ?? "") || block.heading;
    if (slug) token.attrSet("data-name", claim(usedBlocks, slug));
  }

  for (const heading of unnamedHeadings) {
    const slug = headingSlugs.get(heading);
    if (slug) heading.attrSet("data-name", claim(usedHeadings, slug));
  }
}

/** Register the rule. Called by `createMarkdownRenderer` right after the marker plugin. */
export function gpBlockNames(md: MarkdownIt): void {
  md.core.ruler.push("gp_block_names", (state) => nameBlocksAndHeadings(state.tokens));
}
