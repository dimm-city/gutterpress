/**
 * image-classes — the single source of truth for the author-facing image
 * class vocabulary the desktop UI reads and writes (inline-editing plan
 * §4.4's "one attrs-suffix rule" widened to the whole class list).
 *
 * The vocabulary itself is core's: `PAGED_CSS` in
 * `packages/cli/src/lib/markdown/markdown-it-paged.js` ships the rules;
 * this module only mirrors the names for UI options and attrs editing.
 * `image-classes.test.ts` holds a drift gate asserting every class listed
 * here appears as a selector in `PAGED_CSS` — and that no legacy alias
 * does — so the two cannot diverge silently. The vocabulary is `gp-*`
 * ONLY: the five pre-vocabulary names (`center`, `float-left`,
 * `float-right`, `full-width`, `full-bleed`) were REMOVED from core CSS.
 * The `aliases` lists below keep them recognized on READ purely as a
 * migration path — an old book's `{.float-right}` still identifies the
 * position facet, so "Set position…" rewrites it to the live `gp-*` name
 * in place instead of appending a second class beside a dead one.
 *
 * The tokenizer/facet-setter pairs below exist for one reason: the old
 * `parsePosition`-regex + rebuild-from-scratch write path silently DROPPED
 * every token it didn't recognize (`.gp-small`, `.my-note`, `#fig`,
 * `key=val`) whenever the user edited width or position. All editing is
 * therefore token-preserving: parse the `{…}` suffix into verbatim tokens,
 * replace only the facet being changed (in place, order kept), serialize
 * the rest untouched.
 *
 * PWA-clean and Svelte-free (ADR 0004): pure data + pure string functions,
 * directly `bun test`-able — same posture as `context-menu-actions.ts`.
 */

export interface ImageClassOption {
  /** Canonical documented class, e.g. "gp-right". */
  class: string;
  /** Short name accepted from text prompts, e.g. "right". */
  short: string;
  /**
   * REMOVED legacy name(s) recognized on read as a migration path (they no
   * longer exist in core CSS); rewritten to `class` when the user edits
   * this facet, never resurrected otherwise.
   */
  aliases?: readonly string[];
  /** UI label, e.g. "Float right". */
  label: string;
}

export const IMAGE_POSITION_OPTIONS: readonly ImageClassOption[] = [
  { class: "gp-center", short: "center", aliases: ["center"], label: "Center" },
  { class: "gp-left", short: "left", aliases: ["float-left"], label: "Float left" },
  { class: "gp-right", short: "right", aliases: ["float-right"], label: "Float right" },
  { class: "gp-full", short: "full", aliases: ["full-width"], label: "Full width" },
  { class: "gp-bleed", short: "bleed", aliases: ["full-bleed"], label: "Full bleed (own page, edge-to-edge)" },
  { class: "gp-pin", short: "pin", label: "Pin to page (centered)" },
] as const;

export const IMAGE_SIZE_OPTIONS: readonly ImageClassOption[] = [
  { class: "gp-small", short: "small", label: "Small (25%)" },
  { class: "gp-medium", short: "medium", label: "Medium (50%)" },
  { class: "gp-large", short: "large", label: "Large (75%)" },
] as const;

export type ImagePositionClass = (typeof IMAGE_POSITION_OPTIONS)[number]["class"];
export type ImageSizeClass = (typeof IMAGE_SIZE_OPTIONS)[number]["class"];

/** class-or-alias → its option, for one facet's option table. */
function optionFor(
  options: readonly ImageClassOption[],
  cls: string,
): ImageClassOption | undefined {
  return options.find((o) => o.class === cls || o.aliases?.includes(cls));
}

/**
 * Normalize prompt input to a canonical class for one facet: accepts the
 * short name ("right"), the canonical class ("gp-right"), or a legacy alias
 * ("float-right"), case-insensitively with a stray leading dot tolerated.
 * Returns undefined for anything else — callers treat that as "not a valid
 * choice", never as "drop the facet".
 */
export function normalizeClassInput(
  options: readonly ImageClassOption[],
  input: string,
): string | undefined {
  const t = input.trim().toLowerCase().replace(/^\./, "");
  if (!t) return undefined;
  return options.find(
    (o) => o.class === t || o.short === t || o.aliases?.includes(t),
  )?.class;
}

/**
 * Tokenize a markdown-it-attrs `{…}` suffix into verbatim tokens, preserving
 * quoted values (`width="30 px"` stays one token). `""` → `[]`. The
 * tokenizer is intentionally forgiving — it never validates, because every
 * token it doesn't understand must survive round-trips byte-for-byte.
 */
export function tokenizeImageAttrs(attrsRaw: string): string[] {
  const body = attrsRaw.trim().replace(/^\{/, "").replace(/\}$/, "");
  return body.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

/** `[]` → `""`, otherwise `{a b c}` — the shape `applyImage` inserts. */
export function serializeImageAttrs(tokens: readonly string[]): string {
  return tokens.length > 0 ? `{${tokens.join(" ")}}` : "";
}

function isWidthToken(token: string): boolean {
  return /^width=/.test(token);
}

function classTokenName(token: string): string | undefined {
  return token.startsWith(".") ? token.slice(1) : undefined;
}

function isFacetToken(options: readonly ImageClassOption[]) {
  return (token: string): boolean => {
    const name = classTokenName(token);
    return name != null && optionFor(options, name) != null;
  };
}

/** Current width value, `""` when absent. */
export function getWidth(tokens: readonly string[]): string {
  const token = tokens.find(isWidthToken);
  return token?.match(/^width="?([^"]*)"?$/)?.[1] ?? "";
}

/**
 * The position class AS WRITTEN (canonical or legacy alias) — the UI maps
 * it for display but the document keeps the author's spelling until the
 * user actively changes this facet.
 */
export function getPositionClass(tokens: readonly string[]): string | undefined {
  for (const token of tokens) {
    const name = classTokenName(token);
    if (name && optionFor(IMAGE_POSITION_OPTIONS, name)) return name;
  }
  return undefined;
}

export function getSizeClass(tokens: readonly string[]): string | undefined {
  for (const token of tokens) {
    const name = classTokenName(token);
    if (name && optionFor(IMAGE_SIZE_OPTIONS, name)) return name;
  }
  return undefined;
}

/**
 * Replace the first token matching `matches` in place (list position kept),
 * remove it on null, append on absent — every other token passes through
 * verbatim, in order. Extra matching tokens (e.g. a hand-written second
 * position class) are left alone: this edits one facet, it does not tidy.
 */
function setFacetToken(
  tokens: readonly string[],
  matches: (token: string) => boolean,
  replacement: string | null,
): string[] {
  const at = tokens.findIndex(matches);
  if (at === -1) {
    return replacement == null ? [...tokens] : [...tokens, replacement];
  }
  const next = [...tokens];
  if (replacement == null) next.splice(at, 1);
  else next[at] = replacement;
  return next;
}

export function setWidth(tokens: readonly string[], width: string | null): string[] {
  return setFacetToken(tokens, isWidthToken, width == null ? null : `width="${width}"`);
}

/** `cls` must be canonical (`gp-*`) or a known alias; null clears the facet. */
export function setPositionClass(tokens: readonly string[], cls: string | null): string[] {
  return setFacetToken(
    tokens,
    isFacetToken(IMAGE_POSITION_OPTIONS),
    cls == null ? null : `.${cls}`,
  );
}

export function setSizeClass(tokens: readonly string[], cls: string | null): string[] {
  return setFacetToken(
    tokens,
    isFacetToken(IMAGE_SIZE_OPTIONS),
    cls == null ? null : `.${cls}`,
  );
}

/**
 * The shape-wrap facet is a boolean: `.gp-shape` wraps text to a floated
 * image's alpha silhouette (core mirrors the src into --gp-shape at render
 * time; the desktop only toggles the class). Inert without a float
 * position, so the UI can offer it unconditionally.
 */
export const IMAGE_SHAPE_CLASS = "gp-shape";

export function hasShapeClass(tokens: readonly string[]): boolean {
  return tokens.includes(`.${IMAGE_SHAPE_CLASS}`);
}

export function setShapeClass(tokens: readonly string[], on: boolean): string[] {
  return setFacetToken(
    tokens,
    (token) => token === `.${IMAGE_SHAPE_CLASS}`,
    on ? `.${IMAGE_SHAPE_CLASS}` : null,
  );
}
