/**
 * `:root` style-token helpers for the guided Design panel: how a token is
 * classified (color / font / length / number / text) and labelled, the
 * curated font stacks, and the browser's own readings of a value — the color
 * normal form (`toHex`, `typedColor`) and the sample page's computed values
 * (`sampleComputedValues`).
 *
 * Which custom properties a book has, and the `@group` / `@label` /
 * `@internal` comments that curate them (issue #244), are read host-side with
 * postcss (the lib's `root-tokens.ts`, served by the `style/book-css` route),
 * and edits are written there too (`style/edit-tokens`): postcss never reaches
 * the SPA (architecture rules §8). No node/svelte imports here.
 */

import type { StyleToken } from "#lib/platform/dtos.ts";
import { sampleSrcdoc } from "#lib/components/config/config-helpers.ts";

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

/**
 * Each named custom property's value on the sample page's root element, as
 * the browser computes it with `css` (`getComputedStyle`), so the cascade —
 * layers, order, specificity — is the browser's, not ours. The page is the
 * Look tab's sample (`sampleSrcdoc`), rendered in a frame off-screen and
 * removed again. A property the CSS does not set reads as "".
 */
export function sampleComputedValues(css: string, names: string[]): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:400px;height:375px;border:0;visibility:hidden;";
    frame.addEventListener(
      "load",
      () => {
        const out: Record<string, string> = {};
        try {
          const root = frame.contentDocument?.documentElement;
          const style = root && frame.contentWindow?.getComputedStyle(root);
          if (style) for (const name of names) out[name] = style.getPropertyValue(name).trim();
        } finally {
          frame.remove();
          resolve(out);
        }
      },
      { once: true },
    );
    frame.srcdoc = sampleSrcdoc(css);
    document.body.append(frame);
  });
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

/** `var(--name)`: a reference to another setting, nothing more (no fallback, no second value). */
const VAR_REFERENCE_RE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;

/** Is `value` one `var(--name)` reference — what a color field may save besides a color? */
export function isVarReference(value: string): boolean {
  return VAR_REFERENCE_RE.test(value.trim());
}

/**
 * What a color field saves (#482): a color as `typedColor` reads it, or a
 * reference to another setting, `var(--name)` — what a color field took in
 * 0.11.22. A reference is saved spaced the plain way; one to the setting
 * itself (`self`) would make it a loop, so it is not saved. Anything else is
 * null, so nothing but a color or one reference ever reaches the stylesheet.
 */
export function typedColorValue(text: string, self?: string): string | null {
  const color = typedColor(text);
  if (color) return color;
  const ref = text.trim().match(VAR_REFERENCE_RE)?.[1];
  return ref && ref !== self ? `var(${ref})` : null;
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
