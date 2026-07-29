// Print-safety CSS checks, run directly on a postcss AST.
//
// These are Gutterpress's own checks — no stylelint. stylelint can't be bundled
// into the `bun build --compile` binary (it loads its ~200 rule modules via a
// computed-path dynamic import), so running these on postcss directly keeps the
// binary, npm package, and Docker image identical and self-contained.
//
//  - no-remote-urls           blocks http(s):// and protocol-relative url()
//  - no-risky-print-effects   warns on properties that can force rasterization
//  - no-pagedjs-crash-selectors  flags selectors Paged.js silently skips

import postcss from "postcss";

export const ruleRemoteUrls = "printsafe/no-remote-urls";
export const ruleRiskyProps = "printsafe/no-risky-print-effects";
export const rulePagedjsCrashSelectors = "printsafe/no-pagedjs-crash-selectors";
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

function splitSelectorList(selectorList: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < selectorList.length; i += 1) {
    const char = selectorList[i]!;

    current += char;

    if (quote) {
      // A quote closes the string only if it is not escaped. It is escaped when
      // an ODD number of backslashes immediately precede it; an even count means
      // those backslashes escape each other and the quote stands on its own.
      if (char === quote) {
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && selectorList[j] === "\\"; j -= 1) backslashes += 1;
        if (backslashes % 2 === 0) quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "[") {
      depth += 1;
      continue;
    }

    if ((char === ")" || char === "]") && depth > 0) {
      depth -= 1;
      continue;
    }

    if (char === "," && depth === 0) {
      selectors.push(current.slice(0, -1).trim());
      current = "";
    }
  }

  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function isPagedjsCrashProneSelector(selector: string): boolean {
  const hasSiblingCombinator = selector.includes("+") || selector.includes("~");
  // :is()/:where()/:not() combined with sibling combinators crash
  // DocumentFragment.querySelectorAll in Paged.js's CSS pipeline. As of Gutterpress's
  // vendored Paged.js the crash is caught and the selector skipped with a
  // console.warn — but the CSS still has no effect on break/nth processing.
  const hasFunctionalPseudoWithSibling =
    hasSiblingCombinator && /:(?:is|where|not)\s*\(/i.test(selector);
  // :first-of-type/:last-of-type/:nth-of-type with an adjacent sibling was the
  // original crash pattern — keep detecting it.
  const hasNthOfTypeWithSibling =
    hasSiblingCombinator && /:(?:first|last|nth)-of-type\b/i.test(selector);
  return hasFunctionalPseudoWithSibling || hasNthOfTypeWithSibling;
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
    if (riskyProperties.has(decl.prop.toLowerCase())) {
      warnings.push({
        rule: ruleRiskyProps,
        severity: "warning",
        message: `Property is high-risk for print/PDF (can force rasterization): ${decl.prop}`,
        ...nodeLoc(decl),
      });
    }
  });

  root.walkRules((rule) => {
    for (const selector of splitSelectorList(rule.selector)) {
      if (isPagedjsCrashProneSelector(selector)) {
        warnings.push({
          rule: rulePagedjsCrashSelectors,
          severity: "error",
          message: `Selector will be skipped by Paged.js (DocumentFragment.querySelectorAll rejects this pattern — break/nth rules won't apply): ${selector}`,
          ...nodeLoc(rule),
        });
      }
    }
  });

  return warnings;
}
