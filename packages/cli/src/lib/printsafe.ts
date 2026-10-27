// Print-safety CSS checks, run directly on a postcss AST.
//
// These are Gutterpress's own checks — no stylelint. stylelint can't be bundled
// into the `bun build --compile` binary (it loads its ~200 rule modules via a
// computed-path dynamic import), so running these on postcss directly keeps the
// binary, npm package, and Docker image identical and self-contained.
//
//  - no-remote-urls           blocks http(s):// and protocol-relative url()
//  - no-risky-print-effects   warns on properties that can force rasterization
//  - page-containment         warns on rules that trap `.gp-behind`/`.gp-bleed` art
//  - preview-cannot-follow    warns on a forced break or `page:` the live preview's
//                             CSS reader cannot see, so preview and PDF drift apart

import postcss from "postcss";
import { MARGIN_BOX_IGNORED_PROPERTIES } from "../engine/shared/margin-box-support.ts";
import { parseDisableDirective, ruleLevel, type LintLevel } from "./lint-rules.ts";

export const ruleRemoteUrls = "printsafe/no-remote-urls";
export const ruleRiskyProps = "printsafe/no-risky-print-effects";
export const ruleSyntax = "printsafe/syntax-error";
export const rulePageContainment = "printsafe/page-containment";
export const rulePreviewCannotFollow = "printsafe/preview-cannot-follow";
export const rulePageSizeInStylesheet = "printsafe/page-size-in-stylesheet";

export interface PrintSafeWarning {
  rule: string;
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

function extractUrls(value: string): string[] {
  const urls: string[] = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) urls.push(m[2] ?? "");
  return urls;
}

function isRemoteUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("//")
  );
}

const riskyProperties = new Set([
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
  "background-blend-mode",
  // NOT `isolation`: it establishes a stacking context, it does not rasterize.
  // createsStackingContext() below already models it correctly and
  // page-containment reports the real consequence, so listing it here also
  // produced a second, wrong warning for the same declaration.
  "animation",
  "animation-name",
  "transition",
  "will-change",
  // NOT `clip-path`: a basic shape (polygon/inset/circle/ellipse/path) is a
  // vector clip that Chromium prints without rasterizing — only an SVG-mask
  // `url(...)` reference is risky. See isRasterizingClipPath().
]);

/** `clip-path: url(#id)` points at an SVG <clipPath>, which can rasterize;
 * the basic shapes are vector clips and are fine. */
function isRasterizingClipPath(decl: postcss.Declaration): boolean {
  return decl.prop.toLowerCase() === "clip-path" && /\burl\(/i.test(decl.value);
}

const marginBoxAtRuleNames = new Set([
  "top-left-corner", "top-left", "top-center", "top-right", "top-right-corner",
  "bottom-left-corner", "bottom-left", "bottom-center", "bottom-right", "bottom-right-corner",
  "left-top", "left-middle", "left-bottom",
  "right-top", "right-middle", "right-bottom",
]);

// Chromium silently ignores these inside @page margin boxes (renders square,
// unshadowed) though they are valid per CSS Paged Media. Delete this check if/
// when Chromium implements them in margin boxes — see ENGINE recommendation #11
// and docs/known-limitations.md §2, which carries the measured drop list.
const marginBoxIgnoredProperties = MARGIN_BOX_IGNORED_PROPERTIES;

/** Directly inside `@page { … }` itself — not inside one of its margin boxes,
 * where the same declaration behaves differently. */
function isInPageBox(decl: postcss.Declaration): boolean {
  const page = decl.parent;
  return (
    !!page && page.type === "atrule" && (page as postcss.AtRule).name.toLowerCase() === "page"
  );
}

/**
 * Directly inside one of the BOOK's page rules: a plain `@page` or a
 * pseudo-class one (`@page :left`, `:first`…), not a named page (`@page
 * cover`), whose size is its own. The manifest decides the book's page size
 * (`preset:` / `page:`; Setup > Details) and the assembly writes it after
 * every stylesheet, so a `size` here never reaches the printed page.
 */
function isInBookPageRule(decl: postcss.Declaration): boolean {
  if (!isInPageBox(decl)) return false;
  const params = (decl.parent as postcss.AtRule).params.trim();
  return params === "" || /^(:[a-z-]+\s*)+$/i.test(params);
}

/**
 * A gradient in the `@page` box's own background paints NOTHING in print —
 * measured on Chrome 151.0.7922.75 (96dpi raster, mean absolute pixel
 * difference against the same page with the declaration removed): a solid
 * colour there paints the whole sheet (129.0673) while `linear-gradient`,
 * `radial-gradient` and `repeating-linear-gradient` all score 0.0000.
 *
 * Scope is exactly the `@page` box. The same gradient renders on `html`
 * (127.1714) and as a margin box background (11.1627), so the check must not
 * reach either — those are where the fix sends the author.
 */
function isDroppedPageGradient(decl: postcss.Declaration): boolean {
  const prop = decl.prop.toLowerCase();
  if (prop !== "background" && prop !== "background-image") return false;
  if (!/(^|[\s,(])[\w-]*gradient\(/i.test(decl.value)) return false;
  return isInPageBox(decl);
}

/**
 * Chromium emits these as a PostScript-function shading (ShadingType 1 +
 * FunctionType 4), which Ghostscript 10.x cannot convert: a `--format pdfx`
 * build reports "error in pattern" and the gradient prints blank (#386). Plain
 * `linear-gradient()` / `radial-gradient()` are ShadingType 2/3 and fine.
 * Source-only, so it cannot know the book's output format; the build-time
 * check (`findPostScriptShadingPages`) is the exact one. Delete both when
 * Ghostscript paints these shadings.
 */
function isPostScriptShadingGradient(decl: postcss.Declaration): boolean {
  return /(repeating-(linear|radial|conic)|conic)-gradient\(/i.test(decl.value);
}

function isInPageMarginBox(decl: postcss.Declaration): boolean {
  const box = decl.parent;
  if (!box || box.type !== "atrule") return false;
  if (!marginBoxAtRuleNames.has((box as postcss.AtRule).name.toLowerCase())) return false;
  const page = box.parent;
  return !!page && page.type === "atrule" && (page as postcss.AtRule).name.toLowerCase() === "page";
}

/**
 * A margin box is sized by its margin AREA, so `width: fit-content` alone
 * collapses a chip horizontally while it stays stretched to the full band
 * height — a 9pt folio in a 0.75in bottom margin paints as a tall rectangle
 * around the number instead of a pill. `height: fit-content` collapses the
 * other axis; `align-self`/`vertical-align` do nothing here, because there is
 * no inner box to align — the margin box IS the box. Measured: Chromium 148,
 * 7x4in sheet, 0.75in margins.
 */
function isUnpairedFitContentWidth(decl: postcss.Declaration): boolean {
  const prop = decl.prop.toLowerCase();
  if (prop !== "width" && prop !== "inline-size") return false;
  if (!/\bfit-content\b/i.test(decl.value)) return false;
  if (!isInPageMarginBox(decl)) return false;
  const siblings = (decl.parent as postcss.AtRule).nodes ?? [];
  const decls = siblings.filter((n): n is postcss.Declaration => n.type === "decl");
  // any explicit block-axis size counts — fit-content, a length, whatever the
  // author chose is a deliberate answer to "how tall is this chip".
  if (decls.some((d) => ["height", "block-size"].includes(d.prop.toLowerCase())))
    return false;
  // A layered/gradient background means the author is PAINTING the chip
  // themselves rather than relying on the box's own background+border — the
  // box is then deliberately left full-height (so its last layer can keep a
  // patterned margin band continuous) and the visible chip is drawn at a
  // fixed size inside it. That is the correct way to get a chip AND a hard
  // drop shadow, since `box-shadow` is dropped in a margin box and a real
  // `border` would wrap the shadow too. Warning there would be backwards.
  if (decls.some((d) => /gradient\(/i.test(d.value))) return false;
  return true;
}

/**
 * Early source-only check for declarations directly targeting `.page` /
 * `.spread`, the containing blocks core creates for pinned content. This is a
 * cheap authoring hint, not the authority: CSS source cannot know a book's own
 * wrapper names or actual ancestor chain. The build-time `engine.layer.trapped`
 * audit checks every live `.gp-behind` ancestor regardless of its class.
 *
 * Matches `.page`/`.spread` as whole class tokens — `.page-credits` and
 * `.spread-wide` are different classes and must not be flagged — and only in
 * the selector's SUBJECT: `.page pre` styles a `pre`, not the page.
 */
function targetsPageWrapper(selector: string): boolean {
  if (!/\.(page|spread)(?![\w-])/.test(subjectCompound(selector))) return false;
  // A selector that already names gp-bleed/gp-pin has been scoped
  // deliberately — either the exception this rule tells authors to write
  // (`.page:not(:has(.gp-bleed))`) or a rule aimed at those elements. Warning
  // on the documented fix is how a lint rule teaches people to ignore it.
  return !/\bgp-(bleed|pin)\b/.test(selector);
}

/**
 * The last compound of one complex selector, with every `(...)` argument
 * dropped: `.page.doc pre:not(.stage *)` → `pre:not`.
 */
function subjectCompound(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) start = i + 1;
  }
  let subject = selector.slice(start);
  while (/\([^()]*\)/.test(subject)) subject = subject.replace(/\([^()]*\)/g, "");
  return subject;
}

// A property at its initial value — or at a CSS-wide reset keyword — does
// nothing, so neither the rasterization warning, the margin-box "silently
// ignored" warning nor the stacking-context check may fire on it. `filter:
// none` is exactly how a book suppresses an earlier `filter`, and such a book
// must be able to reach zero findings. ONE table for every value-aware check
// in this file. The match is textual: `filter: var(--x)` is still reported
// even when `--x` resolves to `none`, because this is a source-only check
// with no cascade to consult.
const cssWideResetKeywords = new Set(["initial", "unset", "revert", "revert-layer"]);

const inertValues: Record<string, ReadonlySet<string>> = {
  "z-index": new Set(["auto"]),
  opacity: new Set(["1", "100%"]),
  "mix-blend-mode": new Set(["normal"]),
  "background-blend-mode": new Set(["normal"]),
  filter: new Set(["none"]),
  "backdrop-filter": new Set(["none"]),
  transform: new Set(["none"]),
  rotate: new Set(["none"]),
  translate: new Set(["none"]),
  scale: new Set(["none"]),
  perspective: new Set(["none"]),
  "box-shadow": new Set(["none"]),
  outline: new Set(["none"]),
  "outline-style": new Set(["none"]),
  // `none` is not a valid will-change value, so Chromium drops the
  // declaration: nothing happens either way.
  "will-change": new Set(["auto", "none"]),
  "clip-path": new Set(["none"]),
  transition: new Set(["none"]),
  animation: new Set(["none"]),
  "animation-name": new Set(["none"]),
  overflow: new Set(["visible"]),
  "overflow-x": new Set(["visible"]),
  "overflow-y": new Set(["visible"]),
};

function isInertValue(prop: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  return cssWideResetKeywords.has(v) || (inertValues[prop]?.has(v) ?? false);
}

/** Properties that make an element a stacking context, trapping a
 * `.gp-behind` descendant inside it instead of letting it paint under the
 * page's text. Any value in `inertValues` is the property doing nothing;
 * everything else counts, except `isolation` (only `isolate`) and `contain`
 * (only the paint/layout-containing values). */
function createsStackingContext(decl: postcss.Declaration): boolean {
  const p = decl.prop.toLowerCase();
  const v = decl.value.trim().toLowerCase();
  if (isInertValue(p, v)) return false;
  switch (p) {
    case "isolation":
      return v === "isolate";
    case "contain":
      return /\b(paint|layout|strict|content)\b/.test(v);
    case "z-index":
    case "opacity":
    case "mix-blend-mode":
    case "filter":
    case "backdrop-filter":
    case "transform":
    case "perspective":
    case "will-change":
      return true;
    default:
      return false;
  }
}

/** Any `overflow` value other than `visible` makes the box clip its
 * descendants — including out-of-flow ones. */
function clipsDescendants(decl: postcss.Declaration): boolean {
  const p = decl.prop.toLowerCase();
  if (p !== "overflow" && p !== "overflow-x" && p !== "overflow-y") return false;
  const v = decl.value.trim().toLowerCase();
  return v !== "" && !isInertValue(p, v);
}

// ── Declarations the live preview cannot see ────────────────────────────────
//
// The preview does not paginate with the print fragmenter; it reads the
// author's forced breaks and `page:` assignments out of the CSS text itself
// (engine/shared/gcpm-extract.ts) and rebuilds them. That reader is small on
// purpose, so a declaration it cannot read is honoured by the PDF and
// invisible to the preview: the page count drifts, and nothing says why.
// EXACTLY what it misses (see `parseQualifiedRule`, `walk`, `parseDeclarations`
// there and `FORCED_PAGE_LIKE` in viewer/fragment.ts):
//
//   - a `var()`: it compares the value TEXT with page|left|right|recto|verso,
//     and takes `page:` as the page name verbatim;
//   - a rule nested inside another rule (CSS nesting), or an at-rule nested in
//     a rule: it reads qualified rules at the top level and inside
//     @media/@supports/@layer/@scope/@container/@document only;
//   - the first declaration after a nested block in the same rule: its text is
//     glued to the nested block's, so the property name comes out garbled;
//   - the legacy `page-break-before/after`: it reads `break-*` only.
//
// A source-only check, so a `var()` is reported wherever it appears (there is
// no cascade to say what it resolves to), as `inertValues` does for filters.
// Delete this rule when the preview reads computed style instead of text.

const PREVIEW_AT_RULES = new Set(["media", "supports", "layer", "scope", "container", "document"]);
const FORCED_BREAK_VALUE = /^(page|left|right|recto|verso)$/i;
const LEGACY_FORCED_VALUE = /^(always|left|right)$/i;

/** Why the live preview cannot follow `decl`, or null when it can (or it is not a forced break / page assignment). */
function previewBlindSpot(decl: postcss.Declaration): string | null {
  const prop = decl.prop.toLowerCase();
  const value = decl.value.trim();
  const written = `${decl.prop}: ${decl.value}`;
  const isBreak = prop === "break-before" || prop === "break-after";
  const isLegacy = prop === "page-break-before" || prop === "page-break-after";
  if (!isBreak && !isLegacy && prop !== "page") return null;

  // Only declarations the reader would otherwise visit: not inside @page,
  // @keyframes, @font-face and the like, which it skips whole.
  const rules: postcss.Rule[] = [];
  for (let p: postcss.Container | postcss.Document | undefined = decl.parent; p; p = p.parent) {
    if (p.type === "rule") rules.push(p as postcss.Rule);
    else if (p.type === "atrule") {
      const name = (p as postcss.AtRule).name.toLowerCase();
      if (!PREVIEW_AT_RULES.has(name)) return null;
    }
  }
  if (rules.length === 0) return null;

  const consequence =
    "the PDF honours it but the live preview does not show it, so the two page counts drift apart";

  if (isLegacy) {
    if (!LEGACY_FORCED_VALUE.test(value)) return null;
    const modern = prop.replace("page-break-", "break-");
    // The usual pairing (`break-before: page; page-break-before: always;`)
    // is fine: the preview reads the modern line and print ignores the alias.
    const siblings = (decl.parent as postcss.Container).nodes ?? [];
    if (siblings.some((n) => n.type === "decl" && (n as postcss.Declaration).prop.toLowerCase() === modern)) return null;
    const keyword = /^always$/i.test(value) ? "page" : value.toLowerCase();
    return `"${written}" is the legacy spelling, and the live preview reads only ${modern}: ${consequence}. Write "${modern}: ${keyword}".`;
  }

  const viaVar = /\bvar\(/i.test(value);
  if (isBreak && !viaVar && !FORCED_BREAK_VALUE.test(value)) return null;
  if (prop === "page" && !viaVar && (value === "" || /^auto$/i.test(value))) return null;
  const what = prop === "page" ? "page assignment" : "forced break";

  if (viaVar) {
    return `The ${what} "${written}" uses var(): the live preview reads it only as a literal ${
      prop === "page" ? "page name" : "keyword (page, left, right, recto or verso)"
    }, so ${consequence}. Write the literal value.`;
  }

  const parent = decl.parent as postcss.Container;
  if (rules.length >= 2 || parent.type === "atrule") {
    const outer = rules[rules.length - 1]!.selector;
    return `The ${what} "${written}" is inside a nested rule in "${outer}": the live preview reads only top-level rules and rules inside @media, @supports, @layer, @scope, @container and @document, so ${consequence}. Move it to a flat rule of its own.`;
  }
  let prev = decl.prev();
  while (prev && prev.type === "comment") prev = prev.prev();
  if (prev && (prev.type === "rule" || (prev.type === "atrule" && (prev as postcss.AtRule).nodes))) {
    return `The ${what} "${written}" comes right after a nested rule in "${rules[0]!.selector}": the live preview's CSS reader drops the first declaration after a nested block, so ${consequence}. Move the declaration above the nested rule.`;
  }
  return null;
}

function nodeLoc(node: postcss.Node): { line: number; column: number } {
  return {
    line: node.source?.start?.line ?? 1,
    column: node.source?.start?.column ?? 1,
  };
}

export interface CheckCssOptions {
  /** The manifest's `lint.rules`: `off` drops a rule, `warn`/`error` set its severity. */
  rules?: Readonly<Record<string, unknown>>;
}

/**
 * Run print-safety checks against a CSS string. Returns one warning per finding
 * (errors for remote URLs / syntax errors; warnings for risky print effects).
 * A `/* gutterpress-disable-next-line <rule-id> *\/` comment silences that
 * rule on the line directly below it; `options.rules` applies the project's
 * per-rule levels (see lint-rules.ts).
 */
export function checkCss(css: string, from?: string, options: CheckCssOptions = {}): PrintSafeWarning[] {
  return filterFindings(checkCssRaw(css, from), css, options.rules);
}

function filterFindings(
  findings: PrintSafeWarning[],
  css: string,
  rules: CheckCssOptions["rules"],
): PrintSafeWarning[] {
  // line -> rule ids silenced there. Only comments are scanned, so the
  // parse-failure path (no AST) still honours them.
  const silenced = new Map<number, Set<string>>();
  for (const m of css.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    const ids = parseDisableDirective(m[1]!);
    if (!ids) continue;
    const endLine = css.slice(0, m.index + m[0].length).split("\n").length;
    const set = silenced.get(endLine + 1) ?? new Set<string>();
    for (const id of ids) set.add(id);
    silenced.set(endLine + 1, set);
  }
  const out: PrintSafeWarning[] = [];
  for (const f of findings) {
    if (silenced.get(f.line)?.has(f.rule)) continue;
    const level: LintLevel | undefined = ruleLevel(rules, f.rule);
    if (level === "off") continue;
    out.push(level === "warn" ? { ...f, severity: "warning" } : level === "error" ? { ...f, severity: "error" } : f);
  }
  return out;
}

function checkCssRaw(css: string, from?: string): PrintSafeWarning[] {
  let root: postcss.Root;
  try {
    root = postcss.parse(css, from ? { from } : undefined);
  } catch (err) {
    const e = err as { line?: number; column?: number; reason?: string; message?: string };
    return [
      {
        rule: ruleSyntax,
        severity: "error",
        message: `CSS syntax error: ${e.reason ?? e.message ?? "unparseable"}`,
        line: e.line ?? 1,
        column: e.column ?? 1,
      },
    ];
  }

  const warnings: PrintSafeWarning[] = [];

  const reportRemoteUrls = (value: string, node: postcss.Node) => {
    for (const url of extractUrls(value)) {
      if (isRemoteUrl(url)) {
        warnings.push({
          rule: ruleRemoteUrls,
          severity: "error",
          message: `Remote URL is not allowed in print CSS: ${url}`,
          ...nodeLoc(node),
        });
      }
    }
  };
  root.walkDecls((decl) => reportRemoteUrls(decl.value || "", decl));
  root.walkAtRules((at) => reportRemoteUrls(at.params || "", at));

  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    if (prop === "size" && isInBookPageRule(decl)) {
      warnings.push({
        rule: rulePageSizeInStylesheet,
        severity: "warning",
        message: `"size" in a stylesheet's @page rule is ignored: the page size comes from the manifest (preset:, or page: width and height — Setup > Details in the app), which is written after every stylesheet. Remove this declaration; to print at another size, change the manifest.`,
        ...nodeLoc(decl),
      });
      return;
    }
    if (isInertValue(prop, decl.value)) return; // see inertValues
    // The margin-box drop comes first: `filter`, `mix-blend-mode`,
    // `clip-path` and `backdrop-filter` are all in `riskyProperties` too, and
    // there the generic "can force rasterization" text would be wrong —
    // nothing is rasterized in a margin box because nothing paints at all.
    if (marginBoxIgnoredProperties.has(prop) && isInPageMarginBox(decl)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `Property "${decl.prop}" is not supported in Chromium @page margin boxes and is silently ignored — the chrome renders square/unshadowed. Anything that would paint outside the box (box-shadow, outline, filter) or make it a stacking context (transform, opacity, mix-blend-mode) is dropped; text-shadow, border, border-radius, padding and background gradients all work inside the box.`,
        ...nodeLoc(decl),
      });
    } else if (prop === "filter") {
      // `filter:` gets its own message (not the generic risky-props text
      // below): it's the one property measured to have a specific, severe
      // cost — see docs/engine/ENGINE.md §10. It is also the confirmed cause
      // of render-parity's text-extraction blind spot (issue #259): the
      // rasterized subtree has no PDF text objects left for ANY extractor to
      // find, so the render-parity gate cannot see a text-only change inside
      // it either — see docs/render-parity-gate.md's "Known blind spot".
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message:
          "Property is high-risk for print/PDF: 'filter' rasterizes its subtree to a 300 DPI bitmap in the printed PDF (text becomes unselectable, unsearchable, and inaccessible), and it dominates build time (~90% measured; 57.0s -> 6.2s over 60pp when scoped — see ENGINE.md §10). Scope it to the smallest possible selector. It also means the render-parity gate cannot see a text-only change inside it (docs/render-parity-gate.md, \"Known blind spot\").",
        ...nodeLoc(decl),
      });
    } else if (isRasterizingClipPath(decl)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `Property is high-risk for print/PDF (can force rasterization): ${decl.prop} with url(...) references an SVG mask. Use a basic shape (polygon(), inset(), circle(), ellipse(), path()) instead — those print as vector clips.`,
        ...nodeLoc(decl),
      });
    } else if (riskyProperties.has(prop)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `Property is high-risk for print/PDF (can force rasterization): ${decl.prop}`,
        ...nodeLoc(decl),
      });
    } else if (isDroppedPageGradient(decl)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `"${decl.prop}: ${decl.value}" on @page paints nothing in print — Chromium drops a gradient in the @page box's own background, with no error and a valid-looking PDF. A solid colour there paints the whole sheet; the same gradient also works on "html" (it covers the content area, not the sheet) or in a margin box.`,
        ...nodeLoc(decl),
      });
    } else if (isPostScriptShadingGradient(decl)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `"${decl.prop}: ${decl.value}" is at risk in PDF/X exports (--format pdfx): Chromium emits repeating-*-gradient() and conic-gradient() in a form Ghostscript has been seen to paint as nothing or as irregular stripes, so it can print blank or distorted, unless the page also uses transparency and Ghostscript flattens the whole page to an image, which keeps the gradient but loses that page's live text. Plain PDF output is unaffected. Use linear-gradient() or radial-gradient() instead; for 0deg/90deg stripes write "linear-gradient(90deg, #b33 0 6px, #c8c5bf 6px 10px)" with "background-size: 10px 100%", and for anything else a small tiled image.`,
        ...nodeLoc(decl),
      });
    } else if (isUnpairedFitContentWidth(decl)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `"${decl.prop}: fit-content" in a @page margin box collapses only the inline axis — the box stays stretched to the full margin band, so a chip/pill renders as a tall rectangle around its text. Add "height: fit-content" (align-self / vertical-align do nothing here).`,
        ...nodeLoc(decl),
      });
    }
  });

  // Forced breaks and page assignments the live preview's CSS reader cannot see.
  root.walkDecls((decl) => {
    const message = previewBlindSpot(decl);
    if (message) {
      warnings.push({ rule: rulePreviewCannotFollow, severity: "warning", message, ...nodeLoc(decl) });
    }
  });

  // Fast source hint for declarations on core's known page wrappers. The
  // computed-DOM engine.layer.trapped audit is authoritative for real
  // .gp-behind ancestor chains, including book/plugin wrapper classes.
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule") {
      const at = (rule.parent as postcss.AtRule).name.toLowerCase();
      if (at === "page" || marginBoxAtRuleNames.has(at)) return;
    }
    if (!rule.selectors.some(targetsPageWrapper)) return;
    rule.walkDecls((decl) => {
      if (clipsDescendants(decl)) {
        warnings.push({
          rule: rulePageContainment,
          severity: "warning",
          message: `"${decl.prop}: ${decl.value}" on "${rule.selector}" clips out-of-flow descendants: a .gp-bleed plate is cut back to this box's width instead of reaching the sheet edge, and a .gp-behind image is cut the same way. Scope it with :has() (e.g. "${rule.selector}:not(:has(.gp-bleed, .gp-pin))") or drop it. This is an early source-only check; the build-time engine.layer.trapped audit is authoritative for the live ancestor chain.`,
          ...nodeLoc(decl),
        });
      } else if (createsStackingContext(decl)) {
        warnings.push({
          rule: rulePageContainment,
          severity: "warning",
          message: `"${decl.prop}: ${decl.value}" on "${rule.selector}" makes the page box a stacking context, so a .gp-behind image is trapped inside it and paints ABOVE the page's text instead of under it. Core keeps .page/.spread at "position: relative; z-index: auto" for this reason. This is an early source-only check; the build-time engine.layer.trapped audit is authoritative for the live ancestor chain.`,
          ...nodeLoc(decl),
        });
      }
    });
  });

  return warnings;
}
