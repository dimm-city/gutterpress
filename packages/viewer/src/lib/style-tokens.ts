/**
 * Pure `:root` style-token helpers for the guided Design panel.
 *
 * Extracted verbatim from ProjectConfigPanel.svelte so the parse → mutate logic
 * is unit-testable and the component can commit edits in a single, race-free
 * read-modify-write. Pure strings (plus a browser-only canvas cache for
 * `toHex`) — no node/svelte imports, §8-clean.
 */

import type { StyleToken } from "$lib/platform/contract";

/** Build a typed StyleToken (color / length / text) from a name + raw value. */
export function makeStyleToken(name: string, raw: string): StyleToken {
  const label = name.replace(/^--/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  if (/^#[0-9a-fA-F]{3,8}$|^rgba?\s*\(|^hsla?\s*\(|^oklch\s*\(|^color\s*\(/.test(raw)) {
    return { name, value: raw, kind: "color", label };
  }
  const len = raw.match(/^(-?[\d.]+)\s*(px|rem|em|vh|vw|vmin|vmax|%|pt|cm|mm|in|ex|ch)\b/i);
  if (len) {
    return { name, value: raw, kind: "length", label, number: parseFloat(len[1]), unit: len[2] };
  }
  return { name, value: raw, kind: "text", label };
}

/** Parse every `:root` custom property from a stylesheet, in source order. */
export function parseStyleTokens(cssText: string): StyleToken[] {
  const out: StyleToken[] = [];
  const rootRe = /:root\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rootRe.exec(cssText)) !== null) {
    for (const line of m[1].split("\n")) {
      const pair = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/);
      if (pair) out.push(makeStyleToken(pair[1], pair[2]));
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
