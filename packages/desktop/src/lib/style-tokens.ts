/**
 * Pure `:root` style-token helpers for the guided Design panel.
 *
 * Extracted verbatim from ProjectConfigPanel.svelte so the parse → mutate logic
 * is unit-testable and the component can commit edits in a single, race-free
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
 * - `@label <text>` — human label shown instead of the name-derived default
 *   (`--color-accent` → "Color accent").
 * - `@internal` — omit this token from the panel entirely. The CSS itself is
 *   untouched; this only controls what the guided editor surfaces.
 *
 * Each directive applies to the NEXT declaration only (one-shot, not a
 * sticky section header) and is consumed the moment that declaration is
 * reached — an unannotated declaration a few lines later starts from a clean
 * slate. Multiple directives can share one comment (`@label X @group Y`) or
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

import type { StyleToken } from "$lib/platform/dtos";

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

/** Build a typed StyleToken (color / font / length / number / text) from a
 * name + raw value. */
export function makeStyleToken(name: string, raw: string): StyleToken {
  const label = name.replace(/^--/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
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
  const len = trimmed.match(/^(-?[\d.]+)\s*(px|rem|em|vh|vw|vmin|vmax|%|pt|cm|mm|in|ex|ch)\b/i);
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
  const rootRe = /:root\s*\{([^}]*)\}/g;
  // Alternates block comments with declarations, in source order, instead of
  // matching declarations alone — so an annotation comment can be folded onto
  // the declaration immediately following it. Branch is told apart by the
  // full match's leading characters (`d[0]`) rather than by checking a
  // capture group for undefined, which TypeScript's regex typings don't
  // track per-alternative.
  const scanRe = /\/\*([\s\S]*?)\*\/|(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = rootRe.exec(cssText)) !== null) {
    let pending: PendingAnnotation = {};
    for (const d of m[1].matchAll(scanRe)) {
      if (d[0].startsWith("/*")) {
        foldAnnotationComment(pending, d[1] ?? "");
        continue;
      }
      // A declaration: consume (and reset) whatever annotation is pending —
      // one-shot, so it never carries over to the declaration after this one.
      const annotation = pending;
      pending = {};
      if (annotation.internal) continue;
      const token = makeStyleToken(d[2]!, d[3]!.trim());
      if (annotation.label) token.label = annotation.label;
      if (annotation.group) token.group = annotation.group;
      out.push(token);
    }
  }
  return out;
}

/**
 * Set a single `:root` custom property's value. If the property already exists,
 * every declaration of it is replaced; otherwise it is inserted into the first
 * `:root` block. If the stylesheet has no `:root` block at all, one is appended
 * so the token is never silently dropped. Returns the new CSS.
 */
export function updateRootToken(cssText: string, name: string, value: string): string {
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  const existing = new RegExp(`(${escaped}\\s*:)[^;]*(;)`, "g");
  if (existing.test(cssText)) {
    return cssText.replace(new RegExp(`(${escaped}\\s*:)[^;]*(;)`, "g"), `$1 ${value}$2`);
  }
  if (/:root\s*\{/.test(cssText)) {
    return cssText.replace(/(:root\s*\{)/, `$1\n  ${name}: ${value};`);
  }
  // No :root block yet — append one rather than returning the CSS unchanged.
  const sep = cssText.length > 0 && !cssText.endsWith("\n") ? "\n" : "";
  return `${cssText}${sep}:root {\n  ${name}: ${value};\n}\n`;
}

/** One pending token mutation. */
export interface TokenUpdate {
  name: string;
  value: string;
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

// Cached 2D canvas context used to normalise any CSS color to `#rrggbb`.
let _hexCtx: CanvasRenderingContext2D | null | undefined;

/** Normalise a CSS color value to a `#rrggbb` hex string, or null if unparseable. */
export function toHex(value: string): string | null {
  try {
    if (_hexCtx === undefined) _hexCtx = document.createElement("canvas").getContext("2d");
    if (!_hexCtx) return null;
    _hexCtx.fillStyle = "#000000";
    _hexCtx.fillStyle = value;
    const out = _hexCtx.fillStyle;
    return typeof out === "string" && /^#[0-9a-f]{6}$/i.test(out) ? out : null;
  } catch {
    return null;
  }
}
