/**
 * `gcpm-extract` (§9) — the ONLY piece of Gutterpress that reads CSS, and it never
 * rewrites the author's files.
 *
 * Scope is deliberately narrow: `@page` blocks (incl. margin at-rules and the
 * `bleed`/`marks` descriptors CSSOM drops) plus the four GCPM constructs
 * Chromium doesn't implement — `string-set`, `string()`, `target-counter()` /
 * `target-text()`, and `leader()`. It is NOT a general CSS parser; if general
 * parsing ever feels necessary, the design has drifted (§1).
 */

export interface Declarations {
  [prop: string]: string;
}

export interface PageRule {
  /** named page, e.g. `@page chapter:first` -> "chapter" */
  name?: string;
  /** pseudo-pages in source order, e.g. ["first"] or ["left"] */
  pseudos: string[];
  decls: Declarations;
  /** "@top-center" -> { content: '...' } */
  marginBoxes: Record<string, Declarations>;
  raw: string;
}

export interface StringSetDecl {
  selector: string;
  /** string name, e.g. "chapter-title" */
  name: string;
  /** raw value expression, e.g. "content()" or '"§ " content(text)' */
  value: string;
}

export interface PageAssignment {
  selector: string;
  page: string;
}

export interface BreakDecl {
  selector: string;
  prop: "break-before" | "break-after" | "break-inside";
  value: string;
}

/**
 * An `overflow` declaration that makes its subject a scroll container.
 *
 * Collected because a scroll container is MONOLITHIC in a multicol box but
 * splittable in Chromium's print engine — so anything that paginates with
 * multicol has to know which of the author's selectors are affected in order
 * to agree with the PDF. `viewer/fragment.ts` solves the same problem from the
 * DOM side; a multicol paginator that cannot mutate the DOM (the editor) needs
 * it from the stylesheet instead.
 *
 * `visible` and `clip` are not recorded: neither makes a scroll container.
 */
export interface ScrollContainerDecl {
  selector: string;
  prop: "overflow" | "overflow-x" | "overflow-y";
  /** The raw value, e.g. `hidden` or `hidden auto`. */
  value: string;
}

export interface XrefDecl {
  /** selector the generated content hangs off, e.g. "a.xref::after" */
  selector: string;
  /** raw content value */
  content: string;
  fn: "target-counter" | "target-text" | "leader" | "string";
}

export interface CounterResetDecl {
  /** selector the reset hangs off, e.g. ".page-chapter-start" */
  selector: string;
  /** the value `counter-reset: page N` sets */
  start: number;
}

export interface Length {
  value: number;
  unit: string;
}

export interface PageGeometry {
  /** trim size in pt */
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  bleed: number;
  marks: string[];
}

export interface GcpmModel {
  pageRules: PageRule[];
  stringSets: StringSetDecl[];
  pageAssignments: PageAssignment[];
  breaks: BreakDecl[];
  /** `overflow` declarations that create a scroll container — see the type. */
  scrollContainers: ScrollContainerDecl[];
  xrefs: XrefDecl[];
  /** `counter-reset: page N` declarations — native print ignores this restart (ENGINE.md §8) */
  counterResets: CounterResetDecl[];
  /** page names referenced by either `@page name` or a `page:` assignment */
  pageNames: string[];
  warnings: string[];
}

export const MARGIN_BOX_NAMES = [
  "top-left-corner",
  "top-left",
  "top-center",
  "top-right",
  "top-right-corner",
  "bottom-left-corner",
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "bottom-right-corner",
  "left-top",
  "left-middle",
  "left-bottom",
  "right-top",
  "right-middle",
  "right-bottom",
] as const;

const NESTED_AT_RULES = /^@(media|supports|layer|scope|container|document)\b/i;

// ---------------------------------------------------------------------------
// scanner
// ---------------------------------------------------------------------------

interface Block {
  prelude: string;
  body: string;
}

/** Split a stylesheet body into top-level rules, comment/string aware. */
function scanRules(css: string): Array<Block | { statement: string }> {
  const out: Array<Block | { statement: string }> = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let bodyStart = -1;

  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(css, i);
      continue;
    }
    if (c === "{") {
      if (depth === 0) bodyStart = i;
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push({
          // comments live in the prelude slice (the scanner skips over them
          // without removing them) — strip so `@page` still matches at ^
          prelude: stripComments(css.slice(start, bodyStart)).trim(),
          body: css.slice(bodyStart + 1, i),
        });
        start = i + 1;
      }
      i++;
      continue;
    }
    if (c === ";" && depth === 0) {
      const stmt = stripComments(css.slice(start, i)).trim();
      if (stmt) out.push({ statement: stmt });
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  return out;
}

function stripComments(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const end = skipString(s, i);
      out += s.slice(i, end);
      i = end;
      continue;
    }
    out += s[i++];
  }
  return out;
}

function skipString(css: string, i: number): number {
  const quote = css[i];
  i++;
  while (i < css.length) {
    if (css[i] === "\\") i += 2;
    else if (css[i] === quote) return i + 1;
    else i++;
  }
  return i;
}

/** Parse a declaration list (no nested blocks) into a map; last wins. */
export function parseDeclarations(body: string): Declarations {
  const decls: Declarations = {};
  let i = 0;
  let start = 0;
  let depth = 0;
  const push = (chunk: string) => {
    // `chunk` is a raw slice between `;` boundaries — the scanner above skips
    // OVER comments while looking for the next `;`/`{`/`}` but never moves
    // `start`, so a comment sitting between two declarations (extremely
    // common: `--x: 1in; /* note */\n--y: 2in;`) is still embedded verbatim
    // in the next chunk. Left unstripped, it became part of the "property
    // name" (`/* note */\n--y`), silently dropping `--y` from the map —
    // caught when a real book's `--page-margin` vanished this way.
    const s = stripComments(chunk).trim();
    if (!s) return;
    const colon = indexOfTopLevel(s, ":");
    if (colon <= 0) return;
    const rawProp = s.slice(0, colon).trim();
    // custom-property names are case-sensitive (CSS Custom Properties §2);
    // everything else in this file is a known lowercase-ASCII descriptor.
    const prop = rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase();
    const value = s.slice(colon + 1).trim().replace(/\s*!important$/i, "");
    if (prop) decls[prop] = value;
  };
  while (i < body.length) {
    const c = body[i];
    if (c === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? body.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(body, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  push(body.slice(start));
  return decls;
}

function indexOfTopLevel(s: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

/**
 * The raw bodies of `@media print` blocks. The viewer re-injects these as
 * screen styles: the preview must render the print stylesheet, and the browser
 * won't apply print-media rules on screen (verified: `break-before` computes to
 * `auto` until print emulation is on, which a plain document can't switch on).
 */
export function mediaPrintBodies(css: string): string[] {
  const out: string[] = [];
  for (const rule of scanRules(css)) {
    if ("statement" in rule) continue;
    if (/^@media\b/i.test(rule.prelude)) {
      // crude media-query match is fine here: `print` present and `not print`
      // absent — anything fancier and the author is off the paved path
      const q = rule.prelude.replace(/^@media/i, "").trim();
      if (/\bprint\b/i.test(q) && !/\bnot\s+print\b/i.test(q)) out.push(rule.body);
    }
  }
  return out;
}

export function extract(css: string): GcpmModel {
  const model: GcpmModel = {
    pageRules: [],
    stringSets: [],
    pageAssignments: [],
    breaks: [],
    scrollContainers: [],
    xrefs: [],
    counterResets: [],
    pageNames: [],
    warnings: [],
  };
  walk(css, model);
  resolveGeometryVars(model, collectRootCustomProperties(css));
  const names = new Set<string>();
  for (const r of model.pageRules) if (r.name) names.add(r.name);
  for (const a of model.pageAssignments) names.add(a.page);
  model.pageNames = [...names];
  return model;
}

// ---------------------------------------------------------------------------
// var() resolution (§−1a) — geometry declarations only
// ---------------------------------------------------------------------------
//
// This engine reads `size`/`margin`/`margin-*`/`bleed`/`marks` off `@page`
// itself (Chromium's CSSOM drops the descriptors it doesn't implement, and
// even `size`/`margin` need to be known BEFORE print so the viewport and the
// shrink-to-fit guard can be set up). Everything else in an `@page` rule
// (e.g. `background`) is left untouched and resolved by Chromium as normal —
// var() there was never our business and must keep working unmodified.
//
// A `var()` in one of OUR declarations must never resolve to a wrong value
// silently (§−1a): `size: var(--trim)` silently becoming Letter, or
// `margin: var(--m)` silently becoming 0, both defeat protections this
// engine exists to provide. So: resolve what can be resolved from `:root`
// custom properties in the same stylesheet (honoring `var(--x, fallback)`),
// and hard-error on anything left over.

/** The subset of `@page` descriptors this engine's own parsing depends on. */
const GEOMETRY_PROPS = [
  "size",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "bleed",
  "marks",
] as const;

/** `:root { --x: ... }` custom properties, gathered from the whole stylesheet
 *  (incl. inside `@media`/`@supports`/etc.) — last declaration wins, same as
 *  the cascade a browser would apply to an unconditional `:root` rule. */
function collectRootCustomProperties(css: string): Map<string, string> {
  const props = new Map<string, string>();
  const walkForRoot = (body: string) => {
    for (const rule of scanRules(body)) {
      if ("statement" in rule) continue;
      const { prelude, body: ruleBody } = rule;
      if (NESTED_AT_RULES.test(prelude)) {
        walkForRoot(ruleBody);
        continue;
      }
      if (!prelude.startsWith("@")) {
        const selectors = splitTopLevel(prelude, ",");
        if (selectors.some((s) => s.trim() === ":root")) {
          const decls = parseDeclarations(ruleBody);
          for (const [k, v] of Object.entries(decls)) {
            if (k.startsWith("--")) props.set(k, v);
          }
        }
      }
    }
  };
  walkForRoot(css);
  return props;
}

/** Index of the `)` matching the `(` at `s[open]`, string- and nesting-aware. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i);
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Resolve every `var(--x)` / `var(--x, fallback)` in `value` against
 * `customProps`. Returns the resolved text, or an `unresolved` message the
 * caller turns into a hard error. A fallback containing a nested `var()` is
 * deliberately rejected rather than resolved (documented scope narrowing —
 * §−1a step 1).
 */
function resolveVarsInValue(
  value: string,
  customProps: Map<string, string>,
  stack: Set<string> = new Set(),
): { text: string; unresolved?: string } {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const isVarStart =
      /^var\(/i.test(value.slice(i, i + 4)) && (i === 0 || !/[\w-]/.test(value[i - 1]!));
    if (!isVarStart) {
      out += value[i];
      i++;
      continue;
    }
    const open = i + 3;
    const close = matchParen(value, open);
    if (close === -1) {
      // unterminated var( — leave as-is, nothing more we can do
      out += value.slice(i);
      break;
    }
    const inner = value.slice(open + 1, close);
    const commaIdx = indexOfTopLevel(inner, ",");
    const name = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
    const fallback = commaIdx === -1 ? undefined : inner.slice(commaIdx + 1).trim();
    if (!/^--[\w-]+$/.test(name)) {
      return { text: out, unresolved: `var(${inner}) is not a valid custom property reference` };
    }
    if (stack.has(name)) {
      return { text: out, unresolved: `var(${name}) is circular` };
    }
    const rootValue = customProps.get(name);
    if (rootValue !== undefined) {
      const nested = resolveVarsInValue(rootValue, customProps, new Set(stack).add(name));
      if (nested.unresolved) return { text: out, unresolved: nested.unresolved };
      out += nested.text;
    } else if (fallback !== undefined) {
      if (/\bvar\(/i.test(fallback)) {
        return {
          text: out,
          unresolved: `var(${name}, ${fallback}) — a fallback containing another var() is not resolved`,
        };
      }
      out += fallback;
    } else {
      return {
        text: out,
        unresolved: `${name} is not defined at :root and var() has no fallback`,
      };
    }
    i = close + 1;
  }
  return { text: out };
}

/**
 * Resolve `var()` in the geometry-affecting declarations of every `@page`
 * rule in place. Anything left unresolved is a hard error (§−1a) — never a
 * silent fallback to a default trim size or a zeroed-out margin.
 */
function resolveGeometryVars(model: GcpmModel, customProps: Map<string, string>): void {
  for (const rule of model.pageRules) {
    for (const prop of GEOMETRY_PROPS) {
      const value = rule.decls[prop];
      if (!value || !/\bvar\(/i.test(value)) continue;
      const { text, unresolved } = resolveVarsInValue(value, customProps);
      if (unresolved) {
        throw new Error(
          `${rule.raw} { ${prop}: ${value} } — cannot resolve ${unresolved}. ` +
            `Define the custom property at :root, add a literal var(--x, fallback) fallback, or use a literal value.`,
        );
      }
      // Resolving the var() is only half the job: the RESOLVED text still has
      // to be something this engine can parse. `size: var(--trim)` with
      // `--trim: ;` or `--trim: banana` resolves fine and then falls through
      // `parseSize` to Letter — the exact silent-wrong-trim this step exists
      // to kill. Same for margins: an unparsable token becomes 0pt, which
      // widens the shrink-to-fit guard's content box and silently disables
      // it. So: anything var()-derived that our own parser can't read is a
      // hard error too. (Literal values are left on the existing lenient
      // path — narrowing those is a separate, wider-blast-radius change.)
      const unparsable = unparsableGeometry(prop, text);
      if (unparsable) {
        throw new Error(
          `${rule.raw} { ${prop}: ${value} } — resolves to \`${text.trim()}\`, ${unparsable}. ` +
            `Use a value this engine can read (a length like 0.75in/12pt/10mm, or a named page size for \`size\`).`,
        );
      }
      rule.decls[prop] = text;
    }
  }
}

/** Why a var()-resolved geometry value is unreadable, or `undefined` if it is fine. */
function unparsableGeometry(prop: string, text: string): string | undefined {
  const t = text.trim();
  if (prop === "size") {
    if (!t) return "which is empty";
    return parseSize(t) ? undefined : "which is not a page size";
  }
  if (prop === "margin" || prop.startsWith("margin-")) {
    if (!t) return "which is empty";
    const parts = t.split(/\s+/);
    if (prop !== "margin" && parts.length !== 1) return "which is not a single length";
    if (parts.length > 4) return "which is not a valid margin";
    const bad = parts.filter((p) => toPt(p) === undefined);
    if (bad.length) return `which this engine cannot read as a length (\`${bad[0]}\`)`;
    return undefined;
  }
  if (prop === "bleed") {
    if (!t) return "which is empty";
    if (/^(auto|none)$/i.test(t)) return undefined;
    return toPt(t) === undefined ? "which this engine cannot read as a length" : undefined;
  }
  return undefined;
}

function walk(css: string, model: GcpmModel) {
  for (const rule of scanRules(css)) {
    if ("statement" in rule) continue; // @import / @charset — not our business
    const { prelude, body } = rule;
    if (NESTED_AT_RULES.test(prelude)) {
      walk(body, model);
      continue;
    }
    if (/^@page\b/i.test(prelude)) {
      model.pageRules.push(parsePageRule(prelude, body));
      continue;
    }
    if (prelude.startsWith("@")) continue; // @font-face, @counter-style, @keyframes…
    parseQualifiedRule(prelude, body, model);
  }
}

function parsePageRule(prelude: string, body: string): PageRule {
  const sel = prelude.replace(/^@page\s*/i, "").trim();
  const nameMatch = /^([A-Za-z_][\w-]*)/.exec(sel);
  const pseudos = [...sel.matchAll(/:([A-Za-z-]+)(\([^)]*\))?/g)].map(
    (m) => m[1] + (m[2] ?? ""),
  );
  const rule: PageRule = {
    name: nameMatch?.[1],
    pseudos,
    decls: {},
    marginBoxes: {},
    raw: `@page ${sel}`.trim(),
  };
  // margin at-rules are nested blocks; strip them out, then parse the rest
  let rest = "";
  let i = 0;
  while (i < body.length) {
    const at = findNextAtRule(body, i);
    if (at === -1) {
      rest += body.slice(i);
      break;
    }
    rest += body.slice(i, at);
    const open = body.indexOf("{", at);
    if (open === -1) {
      rest += body.slice(at);
      break;
    }
    const name = body.slice(at + 1, open).trim().toLowerCase();
    let depth = 1;
    let j = open + 1;
    while (j < body.length && depth > 0) {
      const c = body[j];
      if (c === "/" && body[j + 1] === "*") {
        const end = body.indexOf("*/", j + 2);
        j = end === -1 ? body.length : end + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        j = skipString(body, j);
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    rule.marginBoxes[`@${name}`] = parseDeclarations(body.slice(open + 1, j - 1));
    i = j;
  }
  rule.decls = parseDeclarations(rest);
  return rule;
}

/** Find the next nested margin at-rule without treating comment prose such as
 *  `` `@bottom-left` `` as syntax. Comments also commonly contain apostrophes
 *  ("the chip's face"); a raw `indexOf("@")` plus string-aware brace scan
 *  mistakes that apostrophe for a CSS string and can swallow the next margin
 *  box into the current one. */
function findNextAtRule(body: string, start: number): number {
  let i = start;
  while (i < body.length) {
    const c = body[i];
    if (c === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? body.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(body, i);
      continue;
    }
    if (c === "@") return i;
    i++;
  }
  return -1;
}

/** `overflow` values that make a box a scroll container. */
const SCROLLING = /^(hidden|auto|scroll)$/i;

function parseQualifiedRule(selector: string, body: string, model: GcpmModel) {
  const decls = parseDeclarations(body);
  for (const [prop, value] of Object.entries(decls)) {
    if (prop === "string-set") {
      for (const entry of splitTopLevel(value, ",")) {
        const m = /^\s*([A-Za-z_][\w-]*)\s+(.+)$/.exec(entry);
        if (m && m[1] !== undefined && m[2] !== undefined)
          model.stringSets.push({ selector, name: m[1], value: m[2].trim() });
      }
    } else if (prop === "page") {
      if (value && value !== "auto")
        model.pageAssignments.push({ selector, page: value.trim() });
    } else if (prop === "break-before" || prop === "break-after" || prop === "break-inside") {
      model.breaks.push({ selector, prop, value });
    } else if (prop === "overflow" || prop === "overflow-x" || prop === "overflow-y") {
      // Only the values that actually create a scroll container. `overflow`
      // takes one or two values (x then y), so a shorthand qualifies if
      // EITHER axis does.
      if (value.trim().split(/\s+/).some((v) => SCROLLING.test(v)))
        model.scrollContainers.push({ selector, prop, value: value.trim() });
    } else if (prop === "counter-reset") {
      // `counter-reset` resets a list of counters ("page 1", "chapter 1 page
      // 1", …); only the `page` pair is our business.
      const m = /\bpage\s+(-?\d+)/.exec(value);
      if (m) model.counterResets.push({ selector, start: Number(m[1]) });
    } else if (prop === "content") {
      for (const fn of ["target-counter", "target-text", "leader", "string"] as const) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(value)) {
          model.xrefs.push({ selector, content: value, fn });
        }
      }
    }
  }
}

export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

const UNITS_PER_PT: Record<string, number> = {
  pt: 1,
  px: 0.75,
  in: 72,
  pc: 12,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  q: 72 / 101.6,
};

export function toPt(value: string): number | undefined {
  const m = /^(-?[\d.]+)([a-z%]*)$/i.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] || "px").toLowerCase();
  const factor = UNITS_PER_PT[unit];
  return factor === undefined ? undefined : n * factor;
}

/** Named page sizes (CSS Paged Media §5.1), portrait, in pt. */
export const PAGE_SIZES: Record<string, [number, number]> = {
  a5: [419.53, 595.28],
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  b5: [498.9, 708.66],
  b4: [708.66, 1000.63],
  "jis-b5": [515.91, 728.5],
  "jis-b4": [728.5, 1031.81],
  letter: [612, 792],
  legal: [612, 1008],
  ledger: [1224, 792],
};

export function parseSize(value: string): { width: number; height: number } | undefined {
  const parts = value.trim().split(/\s+/);
  let landscape = false;
  const lens: number[] = [];
  let named: [number, number] | undefined;
  for (const p of parts) {
    const key = p.toLowerCase();
    if (key === "landscape") landscape = true;
    else if (key === "portrait") continue;
    else if (PAGE_SIZES[key]) named = PAGE_SIZES[key];
    else {
      const pt = toPt(p);
      if (pt !== undefined) lens.push(pt);
    }
  }
  let w: number, h: number;
  if (named) [w, h] = named;
  else if (lens.length === 1) [w, h] = [lens[0]!, lens[0]!];
  else if (lens.length >= 2) [w, h] = [lens[0]!, lens[1]!];
  else return undefined;
  if (landscape && h > w) [w, h] = [h, w];
  return { width: w, height: h };
}

export function parseMargin(value: string): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const parts = value.trim().split(/\s+/).map((p) => toPt(p) ?? 0);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? a;
  const c = parts[2] ?? a;
  const d = parts[3] ?? b;
  return { top: a, right: b, bottom: c, left: d };
}

/**
 * Resolve the cascade of `@page` rules that apply to a given page context.
 * Later rules win; specificity follows the spec's simplified order
 * (unnamed < named, no-pseudo < pseudo).
 */
export function resolvePage(
  model: GcpmModel,
  ctx: { name?: string; pseudos?: string[] } = {},
): { decls: Declarations; marginBoxes: Record<string, Declarations>; geometry: PageGeometry } {
  const wanted = new Set(ctx.pseudos ?? []);
  const applicable = model.pageRules
    .filter((r) => (r.name ? r.name === ctx.name : true))
    .filter((r) => r.pseudos.every((p) => wanted.has(p)))
    .sort((a, b) => specificity(a) - specificity(b));

  const decls: Declarations = {};
  const marginBoxes: Record<string, Declarations> = {};
  // Margins are accumulated IN CASCADE ORDER, shorthand and longhands
  // interleaved exactly as written. Resolving the merged map afterwards
  // ("apply `margin`, then apply any `margin-*`") makes a longhand from a
  // WEAKER rule beat a shorthand from a stronger one: `@page :right {
  // margin-left: .75in }` would override `@page cover { margin: 0 }` and inset
  // a full-bleed cover by three quarters of an inch. (Observed in the
  // Gutterpress user-guide theme; see compare/COMPARISON.md.)
  const margin = { top: 72, right: 72, bottom: 72, left: 72 };
  for (const rule of applicable) {
    for (const [prop, value] of Object.entries(rule.decls)) {
      if (prop === "margin") Object.assign(margin, parseMargin(value));
      else if (prop === "margin-top" || prop === "margin-right" ||
               prop === "margin-bottom" || prop === "margin-left") {
        const side = prop.slice(7) as "top" | "right" | "bottom" | "left";
        margin[side] = toPt(value) ?? margin[side];
      }
    }
    Object.assign(decls, rule.decls);
    for (const [box, d] of Object.entries(rule.marginBoxes)) {
      marginBoxes[box] = { ...(marginBoxes[box] ?? {}), ...d };
    }
  }
  const size = parseSize(decls.size ?? "letter") ?? { width: 612, height: 792 };
  return {
    decls,
    marginBoxes,
    geometry: {
      width: size.width,
      height: size.height,
      margin,
      bleed: decls.bleed ? (toPt(decls.bleed) ?? 0) : 0,
      marks: (decls.marks ?? "none")
        .split(/\s+/)
        .filter((m) => m && m !== "none"),
    },
  };
}

function specificity(r: PageRule): number {
  return (r.name ? 2 : 0) + r.pseudos.length;
}
