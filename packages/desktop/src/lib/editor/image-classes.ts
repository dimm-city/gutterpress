/**
 * image-classes — the single source of truth for the author-facing image
 * class vocabulary the desktop UI reads and writes (inline-editing plan
 * §4.4's "one attrs-suffix rule" widened to the whole class list).
 *
 * The vocabulary itself is core's: `GUTTERPRESS_CSS` in
 * `packages/cli/src/lib/markdown/gutterpress-css.ts` ships the rules;
 * this module only mirrors the names for UI options and attrs editing.
 * `image-classes.test.ts` holds a drift gate asserting every class listed
 * here appears as a selector in `GUTTERPRESS_CSS` — and that no legacy alias
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

import { attrsToBraces, authoredBlockAttrs, type ExtraAttrs } from "./markdown-doc/attrs";

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
  { class: "gp-pin", short: "pin", label: "Pin to page" },
] as const;

export const IMAGE_SIZE_OPTIONS: readonly ImageClassOption[] = [
  { class: "gp-small", short: "small", label: "Small (25%)" },
  { class: "gp-medium", short: "medium", label: "Medium (50%)" },
  { class: "gp-large", short: "large", label: "Large (75%)" },
] as const;

export const IMAGE_SPACING_OPTIONS: readonly ImageClassOption[] = [
  { class: "gp-tight", short: "tight", label: "Tight (0.5em)" },
  { class: "gp-loose", short: "loose", label: "Loose (2em)" },
] as const;

export const IMAGE_LAYER_OPTIONS: readonly ImageClassOption[] = [
  { class: "gp-behind", short: "behind", label: "Behind page content" },
  { class: "gp-base", short: "base", label: "Base" },
  { class: "gp-raised", short: "raised", label: "Raised" },
  { class: "gp-front", short: "front", label: "Front" },
] as const;

export interface ImagePinAlignmentOption {
  value: string;
  label: string;
  classes: readonly string[];
}

/** Complete, valid edge combinations for a `.gp-pin` image. */
export const IMAGE_PIN_ALIGNMENT_OPTIONS: readonly ImagePinAlignmentOption[] = [
  { value: "center", label: "Centered", classes: [] },
  { value: "top", label: "Top", classes: ["gp-top"] },
  { value: "bottom", label: "Bottom", classes: ["gp-bottom"] },
  { value: "left", label: "Left", classes: ["gp-left"] },
  { value: "right", label: "Right", classes: ["gp-right"] },
  { value: "top-left", label: "Top left", classes: ["gp-top", "gp-left"] },
  { value: "top-right", label: "Top right", classes: ["gp-top", "gp-right"] },
  { value: "bottom-left", label: "Bottom left", classes: ["gp-bottom", "gp-left"] },
  { value: "bottom-right", label: "Bottom right", classes: ["gp-bottom", "gp-right"] },
] as const;

export type ImagePositionClass = (typeof IMAGE_POSITION_OPTIONS)[number]["class"];
export type ImageSizeClass = (typeof IMAGE_SIZE_OPTIONS)[number]["class"];

/** Complete value edited by the one image-properties dialog. */
export interface ImagePropertiesValue {
  src: string;
  alt: string;
  width: string;
  position: string;
  pinAlignment: string;
  size: string;
  spacing: string;
  shape: boolean;
  flush: boolean;
  layer: string;
}

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
  const raw = input.trim().toLowerCase();
  const t = raw.startsWith(".") ? raw.slice(1) : raw;
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
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  const flush = () => {
    if (token) tokens.push(token);
    token = "";
  };
  for (let i = 0; i < attrsRaw.length; i++) {
    const char = attrsRaw[i]!;
    if (quote) {
      token += char;
      if (char === "\\" && i + 1 < attrsRaw.length) token += attrsRaw[++i];
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
      token += char;
    } else if (char === "{" || char === "}" || char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f") {
      flush();
    } else {
      token += char;
    }
  }
  flush();
  return tokens;
}

/** `[]` → `""`, otherwise `{a b c}` — the shape `applyImage` inserts. */
export function serializeImageAttrs(tokens: readonly string[]): string {
  return tokens.length > 0 ? `{${tokens.join(" ")}}` : "";
}

function isWidthToken(token: string): boolean {
  return token.startsWith("width=");
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

/** Strip the outer quotes a `key="value"` token carries, if any. */
export function unquoteAttrValue(value: string): string {
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    return value.slice(1, -1);
  }
  return value;
}

/** Current width value, `""` when absent. */
export function getWidth(tokens: readonly string[]): string {
  const token = tokens.find(isWidthToken);
  return token ? unquoteAttrValue(token.slice("width=".length)) : "";
}

/**
 * Pin mode is a COMPOSED position: `.gp-pin` plus up to two edge words.
 * `.gp-top`/`.gp-bottom` are pin-only; `.gp-left`/`.gp-right` are dual —
 * flow floats on their own, pin edges once `.gp-pin` is present. So which
 * tokens make up "the position" depends on whether the image is pinned,
 * and treating position as a single token silently corrupts pinned images
 * (clearing `{.gp-pin .gp-bottom .gp-right}` used to drop only `.gp-pin`,
 * leaving `.gp-right` as a live right float instead of an inline image).
 */
export const IMAGE_PIN_CLASS = "gp-pin";
const PIN_EDGE_CLASSES: readonly string[] = ["gp-top", "gp-bottom", "gp-left", "gp-right"];

function isPinned(tokens: readonly string[]): boolean {
  return tokens.includes(`.${IMAGE_PIN_CLASS}`);
}

/**
 * Predicate for "this token participates in the image's ACTIVE position".
 * When pinned that is `.gp-pin` + any edge word (+ any contradictory flow
 * position someone hand-wrote); otherwise just the flow position class.
 * Inert `.gp-top`/`.gp-bottom` on a NON-pinned image are deliberately not
 * included — they do nothing, and this module edits one facet rather than
 * tidying tokens the user did not ask about.
 */
function participatesInPosition(tokens: readonly string[]): (token: string) => boolean {
  const pinned = isPinned(tokens);
  return (token: string): boolean => {
    const name = classTokenName(token);
    if (name == null) return false;
    if (optionFor(IMAGE_POSITION_OPTIONS, name) != null) return true;
    return pinned && PIN_EDGE_CLASSES.includes(name);
  };
}

/**
 * The position class AS WRITTEN (canonical or legacy alias) — the UI maps
 * it for display but the document keeps the author's spelling until the
 * user actively changes this facet. `.gp-pin` anywhere wins regardless of
 * token order: `{.gp-right .gp-pin}` is a pinned image whose `.gp-right`
 * is an edge modifier, not a right float.
 */
export function getPositionClass(tokens: readonly string[]): string | undefined {
  if (isPinned(tokens)) return IMAGE_PIN_CLASS;
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

export function getSpacingClass(tokens: readonly string[]): string | undefined {
  for (const token of tokens) {
    const name = classTokenName(token);
    if (name && optionFor(IMAGE_SPACING_OPTIONS, name)) return name;
  }
  return undefined;
}

export function getLayerClass(tokens: readonly string[]): string | undefined {
  for (const token of tokens) {
    const name = classTokenName(token);
    if (name && optionFor(IMAGE_LAYER_OPTIONS, name)) return name;
  }
  return undefined;
}

/** Current visual pin alignment, accounting for core CSS's bottom/right wins. */
export function getPinAlignment(tokens: readonly string[]): string | undefined {
  if (!isPinned(tokens)) return undefined;
  const vertical = tokens.includes(".gp-bottom")
    ? "bottom"
    : tokens.includes(".gp-top") ? "top" : "";
  const horizontal = tokens.includes(".gp-right")
    ? "right"
    : tokens.includes(".gp-left") ? "left" : "";
  return [vertical, horizontal].filter(Boolean).join("-") || "center";
}

/**
 * Replace all tokens matching `matches` with one value at the first match's
 * position. This makes a property edit authoritative even when hand-written
 * source contains duplicate/conflicting facet tokens.
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
  const next = tokens.filter((token) => !matches(token));
  if (replacement != null) next.splice(at, 0, replacement);
  return next;
}

export function setWidth(tokens: readonly string[], width: string | null): string[] {
  return setFacetToken(tokens, isWidthToken, width == null ? null : `width="${width}"`);
}

/**
 * Replace the image's whole composed position: every participating token is
 * removed and the new class takes the first one's slot (appended when the
 * image had no position), so clearing a pinned image really does make it
 * inline and switching away from pin cannot leave a live edge word behind.
 *
 * `cls` must be canonical (`gp-*`) or a known alias; null clears the facet.
 * Re-selecting pin on an already-pinned image is a no-op rather than a
 * reset — the context menu seeds its prompt with the current position, so
 * confirming it unchanged must not silently drop the author's edge words.
 */
export function setPositionClass(tokens: readonly string[], cls: string | null): string[] {
  if (cls === IMAGE_PIN_CLASS && isPinned(tokens)) return [...tokens];
  const participates = participatesInPosition(tokens);
  const at = tokens.findIndex(participates);
  const kept = tokens.filter((token) => !participates(token));
  if (cls == null) return kept;
  const next = [...kept];
  next.splice(at === -1 ? kept.length : at, 0, `.${cls}`);
  return next;
}

export function setSizeClass(tokens: readonly string[], cls: string | null): string[] {
  return setFacetToken(
    tokens,
    isFacetToken(IMAGE_SIZE_OPTIONS),
    cls == null ? null : `.${cls}`,
  );
}

export function setSpacingClass(tokens: readonly string[], cls: string | null): string[] {
  return setFacetToken(
    tokens,
    isFacetToken(IMAGE_SPACING_OPTIONS),
    cls == null ? null : `.${cls}`,
  );
}

export function setLayerClass(tokens: readonly string[], cls: string | null): string[] {
  return setFacetToken(
    tokens,
    isFacetToken(IMAGE_LAYER_OPTIONS),
    cls == null ? null : `.${cls}`,
  );
}

/** Replace only a pinned image's edge modifiers; every other token survives. */
export function setPinAlignment(tokens: readonly string[], value: string): string[] {
  const option = IMAGE_PIN_ALIGNMENT_OPTIONS.find((candidate) => candidate.value === value);
  if (!option || !isPinned(tokens)) return [...tokens];
  const kept = tokens.filter((token) => {
    const name = classTokenName(token);
    return name == null || !PIN_EDGE_CLASSES.includes(name);
  });
  const pinAt = kept.indexOf(`.${IMAGE_PIN_CLASS}`);
  kept.splice(pinAt + 1, 0, ...option.classes.map((cls) => `.${cls}`));
  return kept;
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

/**
 * The flush facet is a boolean too: `.gp-flush` lets a PINNED image sit on
 * the paper instead of on the text block, by having core drop that page's
 * margin on the edges the pin uses (core's `flushPageCss`, a `:has()`-driven
 * named page — the desktop only toggles the class).
 *
 * It is one class rather than part of the pin-alignment token set, because it
 * is orthogonal to WHICH edge: every alignment except "center" composes with
 * it, and a centered pin touches no edge so the class is simply inert. That
 * also keeps it reachable from this dialog at all — the whole reason it
 * exists as an image class is that the editor sets image classes and cannot
 * write the `@page` rules an author would otherwise need.
 */
export const IMAGE_FLUSH_CLASS = "gp-flush";

export function hasFlushClass(tokens: readonly string[]): boolean {
  return tokens.includes(`.${IMAGE_FLUSH_CLASS}`);
}

export function setFlushClass(tokens: readonly string[], on: boolean): string[] {
  return setFacetToken(
    tokens,
    (token) => token === `.${IMAGE_FLUSH_CLASS}`,
    on ? `.${IMAGE_FLUSH_CLASS}` : null,
  );
}

// ---------------------------------------------------------------------------
// the whole dialog, read and applied
// ---------------------------------------------------------------------------

/**
 * The dialog's value for an image, from its source pieces.
 *
 * Both surfaces that offer image properties — the preview's context menu
 * (which addresses the markdown token) and the rich editor (which addresses
 * a ProseMirror node) — need the identical mapping between the author's
 * attribute tokens and the eight fields the dialog shows. Reading it here
 * rather than at each call site is what keeps them from drifting into two
 * slightly different ideas of what `.gp-pin` with no edge means.
 */
export function readImageProperties(
  src: string,
  alt: string,
  tokens: readonly string[],
): ImagePropertiesValue {
  const position = getPositionClass(tokens);
  return {
    src,
    alt,
    width: getWidth(tokens),
    position: position ? (normalizeClassInput(IMAGE_POSITION_OPTIONS, position) ?? "") : "",
    pinAlignment: getPinAlignment(tokens) ?? "center",
    size: getSizeClass(tokens) ?? "",
    spacing: getSpacingClass(tokens) ?? "",
    shape: hasShapeClass(tokens),
    flush: hasFlushClass(tokens),
    layer: getLayerClass(tokens) ?? "",
  };
}

/**
 * The dialog's value applied back to attribute tokens, or the message to show
 * the author when it cannot be.
 *
 * Facet by facet, and only where the value CHANGED — a facet the author did
 * not touch keeps its token exactly as written, including a spelling this
 * vocabulary would canonicalize (`.float-right` stays `.float-right`). Every
 * rejection is a sentence rather than a silent no-op, because the alternative
 * measured worse: a dialog that accepts a width AND a preset size and quietly
 * honours one of them.
 */
export function applyImageProperties(
  tokens: readonly string[],
  initial: ImagePropertiesValue,
  next: ImagePropertiesValue,
): { tokens: readonly string[] } | { error: string } {
  if (!next.src.trim()) return { error: "Choose an image path or URL." };
  const inList = (options: readonly { class: string }[], value: string) =>
    !value || options.some((option) => option.class === value);
  if (
    !inList(IMAGE_POSITION_OPTIONS, next.position) ||
    !IMAGE_PIN_ALIGNMENT_OPTIONS.some((option) => option.value === next.pinAlignment) ||
    !inList(IMAGE_SIZE_OPTIONS, next.size) ||
    !inList(IMAGE_SPACING_OPTIONS, next.spacing) ||
    !inList(IMAGE_LAYER_OPTIONS, next.layer)
  ) {
    return { error: "Choose image options from the lists." };
  }
  if (next.width.trim() && next.size) {
    return { error: "Choose either a custom width or a preset size, not both." };
  }
  const width = next.width.trim();
  let out = tokens;
  if (width !== initial.width) out = setWidth(out, width || null);
  if (next.position !== initial.position) out = setPositionClass(out, next.position || null);
  // Pin alignment is meaningless off a pin, and re-applying it when the image
  // has just BECOME pinned is what puts the edge words back in order.
  if (
    next.position === IMAGE_PIN_CLASS &&
    (initial.position !== IMAGE_PIN_CLASS || next.pinAlignment !== initial.pinAlignment)
  ) {
    out = setPinAlignment(out, next.pinAlignment);
  }
  if (next.size !== initial.size) out = setSizeClass(out, next.size || null);
  if (next.spacing !== initial.spacing) out = setSpacingClass(out, next.spacing || null);
  if (next.shape !== initial.shape) out = setShapeClass(out, next.shape);
  if (next.flush !== initial.flush) out = setFlushClass(out, next.flush);
  if (next.layer !== initial.layer) out = setLayerClass(out, next.layer || null);
  return { tokens: out };
}

/**
 * An image node's authored attributes as tokens, and back.
 *
 * Two representations, for two jobs, both already written and tested: the
 * document model keeps an attribute MAP (`markdown-doc/attrs.ts`, which is
 * what serializes), while this vocabulary edits an ordered TOKEN LIST so an
 * attribute it does not recognize survives an edit byte-for-byte. Converting
 * through `attrsToBraces`/`authoredBlockAttrs` — the same pair the serializer
 * and the parser use — is what stops a third spelling of "what a `{…}` suffix
 * means" from appearing anywhere.
 */
export function imageAttrsToTokens(attrs: ExtraAttrs | null): string[] {
  const braces = attrsToBraces(attrs);
  return braces ? tokenizeImageAttrs(braces.slice(1, -1)) : [];
}

export function tokensToImageAttrs(tokens: readonly string[]): ExtraAttrs | null {
  const braces = serializeImageAttrs([...tokens]);
  // `authoredBlockAttrs` reads a trailing brace block off a SOURCE LINE, so
  // it is given one; the leading `x` is never read back.
  return braces ? authoredBlockAttrs(`x ${braces}`) : null;
}
