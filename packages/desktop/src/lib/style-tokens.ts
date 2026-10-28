/**
 * Pure `:root` style-token helpers for the guided Design panel.
 *
 * Kept separate from the component so the parse → mutate logic is
 * unit-testable and the component can commit edits in a single, race-free
 * read-modify-write. Pure strings (plus a browser-only canvas cache for
 * `toHex`) — no node/svelte imports, §8-clean.
 *
 * **Token annotations (issue #244).** Theme authors curate what the guided
 * panel shows with a tiny comment grammar scanned out of the `:root` block
 * alongside the declarations themselves — no new file format, no schema, and
 * (since it's ordinary CSS comments) no risk to a plain browser or a build
 * that never heard of Gutterpress. Three directives, each written inside a
 * normal CSS block comment placed right before the declaration it describes:
 *
 * - `@group <name>` — display this token under a "<name>" heading instead of
 *   the heuristic Fonts/Colors/Sizes/Other bucket its `kind` would otherwise
 *   choose. Named groups are listed before the heuristic ones, in the order
 *   their names first appear in the file (`DesignSectionController.customGroups`).
 * - `@label <text>` — human label shown instead of the default: a plain-language
 *   name for the shared vocabulary (`--color-ink` → "Text color"), else one
 *   derived from the token name (`--gap-large` → "Gap large").
 * - `@internal` — omit this token from the panel entirely. The CSS itself is
 *   untouched; this only controls what the guided editor surfaces.
 *
 * Each directive applies to the NEXT declaration only (one-shot, not a
 * sticky section header) and is consumed the moment that declaration is
 * reached — an unannotated declaration a few lines later starts from a clean
 * slate. A block has defaults too (#435): `@group` and `@internal` in a
 * comment placed directly BEFORE the `:root` selector (outside the block)
 * apply to every declaration in the block that carries no directive of its
 * own, so one comment reading "@internal" above `:root` hides a sheet of
 * component defaults and one reading "@group Paper" groups a palette sheet;
 * a declaration's own `@group`, `@label` or `@internal` still wins for that
 * declaration (its own `@group` or `@label` shows it even inside an
 * `@internal` block). Multiple directives can share one comment (`@label X @group Y`) or
 * be spread across consecutive comments; either way they fold onto the same
 * next declaration. A comment that isn't one of the three directives is
 * plain prose and is ignored (it neither contributes nor clears pending
 * annotations), so an author's ordinary explanatory comments are safe to
 * interleave. For example (in the CSS file itself, not this comment): a
 * block comment reading "@group Colors" then one reading "@label Accent
 * color" immediately above `--color-accent: #2b4c7e;` puts that token in a
 * "Colors" heading labeled "Accent color"; both directives could equally be
 * written together in one comment. A block comment reading only "@internal"
 * above `--dc-skill-tab-shape: ...;` drops that token from the panel.
 *
 * A stylesheet with none of these comments parses exactly as it always has —
 * every token's `group` is `undefined` and nothing is dropped, so an
 * unannotated theme's panel is unchanged (no regression for existing themes).
 */

import type { StyleToken } from "#lib/platform/dtos.ts";

// ── Color / font / numeric classification ───────────────────────────────────
//
// The CSS Color Module keyword set (147 named colors plus the two
// color-resolving special keywords). A bare keyword like `white` or
// `rebeccapurple` is a perfectly normal `:root` color value — the browser's
// `<input type="color">` and this module's own `toHex` already understand it
// — the only thing missing was classification, so it fell to a raw text box.
const NAMED_COLORS = new Set([
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "grey", "green",
  "greenyellow", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
  "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue",
  "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
  "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple",
  "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
  "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow",
  "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet",
  "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
  "transparent", "currentcolor",
]);

/** CSS generic font-family keywords — used as the "does this look like a font
 * stack" fallback signal (a comma list ending in one of these). */
const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "math", "emoji", "fangsong",
]);

/** True when a property name is about a font FAMILY (not size/weight/etc). */
function isFontProperty(name: string): boolean {
  const short = name.replace(/^--/, "").toLowerCase();
  return short.includes("font") && !/(size|weight|scale|style|stretch)/.test(short);
}

/** True when a value looks like a CSS font-family stack — a bare generic
 * keyword, or a comma list of quoted/bare family names ending in one. */
function looksLikeFontStack(value: string): boolean {
  if (!value.includes(",")) return GENERIC_FONT_FAMILIES.has(value.toLowerCase());
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const isFamilyLike = (p: string) =>
    /^["'].*["']$/.test(p) || /^[A-Za-z][A-Za-z0-9 _-]*$/.test(p);
  const isGeneric = (p: string) => GENERIC_FONT_FAMILIES.has(p.replace(/^["']|["']$/g, "").toLowerCase());
  return parts.every(isFamilyLike) && parts.some(isGeneric);
}

/** One curated font-stack choice for the Design panel's font dropdown. */
export interface FontStackChoice {
  label: string;
  value: string;
}

/**
 * Print-safe font-family stacks offered as quick picks in the guided Design
 * panel. Deliberately short and system/print-friendly (no web-font-only
 * names) — the accompanying text input is always the real, uncapped editor,
 * so this list is a convenience, not a restriction.
 */
export const PRINT_SAFE_FONT_STACKS: FontStackChoice[] = [
  { label: "Georgia (serif)", value: `"Georgia", "Times New Roman", serif` },
  { label: "Times New Roman (serif)", value: `"Times New Roman", Times, serif` },
  { label: "Palatino (serif)", value: `"Palatino Linotype", "Book Antiqua", Palatino, serif` },
  { label: "Helvetica Neue (sans-serif)", value: `"Helvetica Neue", Arial, sans-serif` },
  { label: "Arial (sans-serif)", value: `Arial, Helvetica, sans-serif` },
  { label: "Segoe UI (sans-serif)", value: `"Segoe UI", Arial, sans-serif` },
  { label: "Courier New (monospace)", value: `"Courier New", Courier, monospace` },
  { label: "Consolas (monospace)", value: `Consolas, Menlo, monospace` },
  { label: "System serif", value: "serif" },
  { label: "System sans-serif", value: "sans-serif" },
  { label: "System monospace", value: "monospace" },
];

/**
 * Plain-language labels for the shared token vocabulary every built-in look
 * defines and the user guide's styling chapter teaches (plus `--color-ink-faint`,
 * the third step of the same ink scale). A name-derived label ("Secondary text color" would be
 * "Color ink muted") reads as designer jargon to a writer; these say what the
 * token DOES. Tokens a look adds beyond this set get `derivedTokenLabel` unless
 * the look labels them itself. Display only: the token NAMES are the CSS
 * authors write and are never renamed (the panel keeps showing them beside the
 * label), and a stylesheet's own `@label` still wins over these.
 */
export const SHARED_TOKEN_LABELS: Record<string, string> = {
  "--font-body": "Body text font",
  "--font-display": "Heading font",
  "--font-mono": "Code font",
  "--color-ink": "Text color",
  "--color-ink-muted": "Secondary text color",
  "--color-ink-faint": "Faint text color",
  "--color-accent": "Accent color",
  "--color-paper": "Page color",
  "--color-rule": "Line color",
  "--fs-body": "Body text size",
  "--fs-h1": "Heading 1 size",
  "--fs-h2": "Heading 2 size",
  "--fs-h3": "Heading 3 size",
  "--leading": "Line spacing",
};

/** Plain words for the abbreviations token names are built from. */
const TOKEN_WORDS: Record<string, string> = {
  h1: "heading 1",
  h2: "heading 2",
  h3: "heading 3",
  h4: "heading 4",
  h5: "heading 5",
  h6: "heading 6",
  xs: "extra small",
  sm: "small",
  md: "medium",
  lg: "large",
  xl: "extra large",
  space: "spacing",
  radius: "corner radius",
  bg: "background",
};

/**
 * The label a token gets when neither the shared vocabulary nor a stylesheet's
 * own `@label` names it: the name's segments as plain words (`--fs-display` →
 * "Display size", `--space-xs` → "Spacing extra small", `--radius-sm` →
 * "Corner radius small"). A look labels anything this cannot make readable
 * with `@label`.
 */
export function derivedTokenLabel(name: string): string {
  const segments = name.replace(/^--/, "").toLowerCase().split("-").filter(Boolean);
  const isSize = segments[0] === "fs";
  const words = (isSize ? segments.slice(1) : segments).map((seg) => TOKEN_WORDS[seg] ?? seg);
  if (isSize) words.push("size");
  const text = words.join(" ");
  return text.replace(/^\w/, (c) => c.toUpperCase());
}

/** The first family of a CSS font stack, unquoted (`"Georgia", serif` → `Georgia`). */
export function firstFontFamily(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "").trim();
}

/** Build a typed StyleToken (color / font / length / number / text) from a
 * name + raw value. */
export function makeStyleToken(name: string, raw: string): StyleToken {
  const label = SHARED_TOKEN_LABELS[name] ?? derivedTokenLabel(name);
  const trimmed = raw.trim();
  if (
    /^#[0-9a-fA-F]{3,8}$|^rgba?\s*\(|^hsla?\s*\(|^oklch\s*\(|^color\s*\(/.test(trimmed) ||
    NAMED_COLORS.has(trimmed.toLowerCase())
  ) {
    return { name, value: raw, kind: "color", label };
  }
  if (isFontProperty(name) || looksLikeFontStack(trimmed)) {
    return { name, value: raw, kind: "font", label };
  }
  // Anchored at both ends: a compound value such as `1pt solid #ccc` is not a
  // length to edit as a bare number, so it falls through to the text control.
  const len = trimmed.match(/^(-?[\d.]+)\s*(px|rem|em|vh|vw|vmin|vmax|%|pt|cm|mm|in|ex|ch)\s*$/i);
  if (len) {
    return { name, value: raw, kind: "length", label, number: parseFloat(len[1]), unit: len[2] };
  }
  const num = trimmed.match(/^-?\d+(\.\d+)?$/);
  if (num) {
    return { name, value: raw, kind: "number", label, number: parseFloat(trimmed) };
  }
  return { name, value: raw, kind: "text", label };
}

/** One `@group`/`@label`/`@internal` annotation, accumulated from the block
 * comment(s) immediately preceding a `:root` declaration (see the file
 * header's "Token annotations" section) and consumed by that declaration. */
interface PendingAnnotation {
  label?: string;
  group?: string;
  internal?: boolean;
}

/** Directives recognized inside a `:root`-block comment. The value is
 * everything after the keyword up to end-of-line or the next `@directive` —
 * excluding `@` from the value is what lets two directives share one comment
 * (`@label X @group Y`) without one bleeding into the other's value. */
const ANNOTATION_DIRECTIVE_RE = /@(group|label|internal)\b[ \t]*([^\n\r@]*)/gi;

/** Fold every directive found in one comment's body onto `pending`, so a run
 * of consecutive annotation comments accumulates before being applied to the
 * declaration that follows them. A comment with no recognized directive
 * (ordinary prose) contributes nothing and leaves `pending` untouched. */
function foldAnnotationComment(pending: PendingAnnotation, commentBody: string): void {
  for (const d of commentBody.matchAll(ANNOTATION_DIRECTIVE_RE)) {
    const key = d[1]!.toLowerCase();
    if (key === "internal") {
      pending.internal = true;
      continue;
    }
    const value = d[2]!.trim();
    if (value) pending[key as "group" | "label"] = value;
  }
}

/**
 * Parse every `:root` custom property from a stylesheet, in source order.
 * Declaration-based (matches up to the next `;`), not one-line-per-declaration
 * — a value that wraps across multiple physical lines (e.g. a font stack)
 * is still read in full instead of being silently dropped because the line it
 * started on had no terminating `;`. Also scans `@group`/`@label`/`@internal`
 * annotation comments (file header) and folds them onto the token they
 * precede; a stylesheet with none of those comments is unaffected.
 */
export function parseStyleTokens(cssText: string): StyleToken[] {
  const out: StyleToken[] = [];
  // Alternates block comments with declarations, in source order, instead of
  // matching declarations alone — so an annotation comment can be folded onto
  // the declaration immediately following it. Branch is told apart by the
  // full match's leading characters (`d[0]`) rather than by checking a
  // capture group for undefined, which TypeScript's regex typings don't
  // track per-alternative.
  const scanRe = /\/\*([\s\S]*?)\*\/|(--[\w-]+)\s*:\s*([^;]+);/g;
  for (const block of rootBlocks(cssText)) {
    // The block's defaults (#435): `@group` / `@internal` in the comments
    // directly before its `:root` selector. `pending` is the one-shot
    // annotation for the next declaration.
    const defaults: PendingAnnotation = {};
    for (const comment of block.leading) foldAnnotationComment(defaults, comment);
    let pending: PendingAnnotation = {};
    for (const d of cssText.slice(block.bodyStart, block.bodyEnd).matchAll(scanRe)) {
      if (d[0].startsWith("/*")) {
        foldAnnotationComment(pending, d[1] ?? "");
        continue;
      }
      // A declaration: consume (and reset) whatever annotation is pending —
      // one-shot, so it never carries over to the declaration after this one.
      const own = pending;
      pending = {};
      const annotated = own.group !== undefined || own.label !== undefined;
      if (own.internal || (defaults.internal && !annotated)) continue;
      const token = makeStyleToken(d[2]!, d[3]!.trim());
      if (own.label !== undefined) token.label = own.label;
      const group = own.group ?? defaults.group;
      if (group !== undefined) token.group = group;
      out.push(token);
    }
  }
  return out;
}

/**
 * One `:root` block: where `:root` starts, its body, the index just past its
 * closing brace, and the bodies of the comments directly before the selector
 * (the block's annotation defaults, #435).
 */
interface RootBlock {
  open: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
  leading: string[];
}

/**
 * Every `:root` block of a stylesheet, found by a scan that skips comments:
 * a `}` (or a `:root {`) inside a comment neither ends nor opens a block
 * (#433), so a block whose leading comment shows `#x { --a: b; }` yields all
 * of its declarations and none of the comment's. A block with no closing
 * brace is not a block.
 */
function rootBlocks(cssText: string): RootBlock[] {
  const blocks: RootBlock[] = [];
  const openRe = /:root\s*\{/y;
  // The comments seen since the last non-blank, non-comment text: the ones
  // directly before a `:root` selector are its block's.
  let leading: string[] = [];
  let i = 0;
  while (i < cssText.length) {
    if (cssText.startsWith("/*", i)) {
      const close = cssText.indexOf("*/", i + 2);
      leading.push(cssText.slice(i + 2, close === -1 ? cssText.length : close));
      i = close === -1 ? cssText.length : close + 2;
      continue;
    }
    if (/\s/.test(cssText[i]!)) {
      i++;
      continue;
    }
    openRe.lastIndex = i;
    const open = openRe.exec(cssText);
    if (!open) {
      leading = [];
      i++;
      continue;
    }
    const bodyStart = i + open[0].length;
    let j = bodyStart;
    while (j < cssText.length && cssText[j] !== "}") {
      if (cssText.startsWith("/*", j)) {
        const close = cssText.indexOf("*/", j + 2);
        j = close === -1 ? cssText.length : close + 2;
      } else {
        j++;
      }
    }
    if (j >= cssText.length) break;
    blocks.push({ open: i, bodyStart, bodyEnd: j, end: j + 1, leading });
    leading = [];
    i = j + 1;
  }
  return blocks;
}

/**
 * The effective `:root` tokens of several stylesheets applied in cascade
 * order (the Design panel's view: every enabled look, then the book's own
 * sheet). A token keeps the place, label and group of its FIRST declaration;
 * its value (and so its kind) is the LAST one's, since a later sheet wins.
 */
export function cascadeStyleTokens(sheets: string[]): StyleToken[] {
  const byName = new Map<string, StyleToken>();
  for (const t of sheets.flatMap(parseStyleTokens)) {
    const first = byName.get(t.name);
    byName.set(t.name, first ? { ...t, label: first.label, group: first.group ?? t.group } : t);
  }
  return [...byName.values()];
}

/**
 * One `:root` block's comments and custom-property declarations, scanned in
 * source order the way `parseStyleTokens` scans them, so a commented-out
 * declaration is skipped whole. A declaration also takes the line break and
 * indent before it, so removing one takes its line with it; the lookbehind
 * and the greedy name match a name whole (`--my--x` is never `--x`).
 */
const ROOT_ITEM_RE = /\/\*[\s\S]*?\*\/|(\n?[ \t]*)(?<![\w-])(--[\w-]+)(\s*:\s*)[^;]+;/g;

/**
 * Set one `:root` custom property's value, or remove it (`value` null). Only
 * declarations inside `:root` blocks count: a scoped rule's or a comment's
 * mention of the name is left alone. Every `:root` declaration of it is
 * replaced (or removed, with its line, and a `:root` block that leaves empty
 * goes too); a property no `:root` block declares is inserted into the first
 * one, or into a `:root` block appended when the stylesheet has none, so an
 * edit is never silently dropped. Returns the new CSS.
 */
export function updateRootToken(cssText: string, name: string, value: string | null): string {
  let declared = false;
  let out = "";
  let last = 0;
  for (const block of rootBlocks(cssText)) {
    const body = cssText.slice(block.bodyStart, block.bodyEnd);
    // The block's closing brace takes the line break after it, so a block
    // that empties goes with its line.
    const end = cssText[block.end] === "\n" ? block.end + 1 : block.end;
    const next = body.replace(ROOT_ITEM_RE, (item, indent?: string, prop?: string, colon?: string) => {
      if (prop !== name) return item;
      declared = true;
      return value === null ? "" : `${indent}${prop}${colon}${value};`;
    });
    out += cssText.slice(last, block.open);
    if (next === body) out += cssText.slice(block.open, end);
    else if (!(value === null && next.trim() === "")) {
      out += `${cssText.slice(block.open, block.bodyStart)}${next}}${cssText.slice(block.end, end)}`;
    }
    last = end;
  }
  out += cssText.slice(last);
  if (declared || value === null) return out;
  if (/:root\s*\{/.test(cssText)) {
    return cssText.replace(/:root\s*\{/, (open) => `${open}\n  ${name}: ${value};`);
  }
  // No :root block yet — append one rather than returning the CSS unchanged.
  const sep = cssText.length > 0 && !cssText.endsWith("\n") ? "\n" : "";
  return `${cssText}${sep}:root {\n  ${name}: ${value};\n}\n`;
}

/** One pending token mutation: a new value, or null to remove the declaration. */
export interface TokenUpdate {
  name: string;
  value: string | null;
}

/**
 * Fold a batch of token mutations onto ONE base CSS string in a single pass, so
 * multiple edits coalesced in the same commit all survive. Applying updates
 * independently to the same base (last-write-wins) would clobber every mutation
 * but the last — this threads each update through the accumulated result.
 */
export function applyTokenUpdates(css: string, updates: TokenUpdate[]): string {
  let out = css;
  for (const u of updates) out = updateRootToken(out, u.name, u.value);
  return out;
}

// Cached 2D canvas context: the browser's own CSS color parser.
let _hexCtx: CanvasRenderingContext2D | null | undefined;

/**
 * A CSS color in the canvas's normal form (`#rrggbb`, or `rgba(…)` when it has
 * alpha), or null when the value is not a color. The canvas ignores a value it
 * cannot parse and keeps its previous color, so the value is tried over two
 * different starting colors: only a real color reads back the same both times.
 */
function canvasColor(value: string): string | null {
  try {
    if (_hexCtx === undefined) _hexCtx = document.createElement("canvas").getContext("2d");
    if (!_hexCtx || !value.trim()) return null;
    _hexCtx.fillStyle = "#000000";
    _hexCtx.fillStyle = value;
    const overBlack = _hexCtx.fillStyle;
    _hexCtx.fillStyle = "#ffffff";
    _hexCtx.fillStyle = value;
    return typeof overBlack === "string" && overBlack === _hexCtx.fillStyle ? overBlack : null;
  } catch {
    return null;
  }
}

/** Normalise a CSS color value to a `#rrggbb` hex string, or null if it is not an opaque color. */
export function toHex(value: string): string | null {
  const color = canvasColor(value);
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

/**
 * A color as the author typed it into a color field, ready to save: `#rrggbb`
 * when it is one (bare hex digits get their `#`), any other CSS color as
 * typed (`rgba(…)`), or null when the text is not a color.
 */
export function typedColor(text: string): string | null {
  const typed = text.trim();
  const candidates = /^[0-9a-f]{3,8}$/i.test(typed) ? [typed, `#${typed}`] : [typed];
  for (const candidate of candidates) {
    if (canvasColor(candidate)) return toHex(candidate) ?? candidate;
  }
  return null;
}
