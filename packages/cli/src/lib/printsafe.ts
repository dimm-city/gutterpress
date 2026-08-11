// Print-safety CSS checks, run directly on a postcss AST.
//
// These are Gutterpress's own checks — no stylelint. stylelint can't be bundled
// into the `bun build --compile` binary (it loads its ~200 rule modules via a
// computed-path dynamic import), so running these on postcss directly keeps the
// binary, npm package, and Docker image identical and self-contained.
//
//  - no-remote-urls           blocks http(s):// and protocol-relative url()
//  - no-risky-print-effects   warns on properties that can force rasterization
//
// `no-pagedjs-crash-selectors` was removed along with Paged.js
// (native-only-migration-plan.md Phase 6): authors regain sibling
// combinators (`+`/`~`) combined with `:is()`/`:where()`/`:not()`/
// `:nth-of-type` in their CSS — Chromium's native print has no such crash.

import postcss from "postcss";

export const ruleRemoteUrls = "printsafe/no-remote-urls";
export const ruleRiskyProps = "printsafe/no-risky-print-effects";
export const ruleSyntax = "printsafe/syntax-error";

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
  "isolation",
  "animation",
  "animation-name",
  "transition",
  "will-change",
  "clip-path",
]);

const marginBoxAtRuleNames = new Set([
  "top-left-corner", "top-left", "top-center", "top-right", "top-right-corner",
  "bottom-left-corner", "bottom-left", "bottom-center", "bottom-right", "bottom-right-corner",
  "left-top", "left-middle", "left-bottom",
  "right-top", "right-middle", "right-bottom",
]);

// Chromium silently ignores these inside @page margin boxes (renders square,
// unshadowed) though they are valid per CSS Paged Media. Delete this check if/
// when Chromium implements them in margin boxes — see ENGINE recommendation #11.
const marginBoxIgnoredProperties = new Set([
  "transform", "rotate", "translate", "scale", "box-shadow",
]);

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
 * other axis; `align-self`/`vertical-align` (the Paged.js-era reflex, where
 * the chrome sat on an already-text-sized inner `.pagedjs_margin-content`)
 * do nothing here. Measured: Chromium 148, 7x4in sheet, 0.75in margins.
 */
function isUnpairedFitContentWidth(decl: postcss.Declaration): boolean {
  const prop = decl.prop.toLowerCase();
  if (prop !== "width" && prop !== "inline-size") return false;
  if (!/\bfit-content\b/i.test(decl.value)) return false;
  if (!isInPageMarginBox(decl)) return false;
  // any explicit block-axis size counts — fit-content, a length, whatever the
  // author chose is a deliberate answer to "how tall is this chip".
  return !(decl.parent as postcss.AtRule).nodes?.some(
    (n) =>
      n.type === "decl" &&
      ["height", "block-size"].includes((n as postcss.Declaration).prop.toLowerCase()),
  );
}

function nodeLoc(node: postcss.Node): { line: number; column: number } {
  return {
    line: node.source?.start?.line ?? 1,
    column: node.source?.start?.column ?? 1,
  };
}

/**
 * Run print-safety checks against a CSS string. Returns one warning per finding
 * (errors for remote URLs / crash-prone selectors / syntax errors; warnings for
 * risky print effects).
 */
export function checkCss(css: string, from?: string): PrintSafeWarning[] {
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
    if (prop === "filter") {
      // `filter:` gets its own message (not the generic risky-props text
      // below): it's the one property measured to have a specific, severe
      // cost — see MIGRATION.md Step 1 "Scope filter:" and ENGINE.md §10.
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message:
          "Property is high-risk for print/PDF: 'filter' rasterizes its subtree to a 300 DPI bitmap in the printed PDF (text becomes unselectable, unsearchable, and inaccessible), and it dominates build time (~90% measured; 57.0s -> 6.2s over 60pp when scoped — see ENGINE.md §10). Scope it to the smallest possible selector.",
        ...nodeLoc(decl),
      });
    } else if (riskyProperties.has(prop)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `Property is high-risk for print/PDF (can force rasterization): ${decl.prop}`,
        ...nodeLoc(decl),
      });
    } else if (marginBoxIgnoredProperties.has(prop) && isInPageMarginBox(decl)) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `Property "${decl.prop}" is not supported in Chromium @page margin boxes and is silently ignored — the chrome renders square/unshadowed.`,
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

  return warnings;
}
