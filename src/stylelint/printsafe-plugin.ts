// A tiny Stylelint plugin with print-focused warnings.
// - blocks remote url() (http/https)
// - warns on properties likely to cause rasterization or PDF weirdness in prepress
//
// ESM TypeScript module. Stylelint exposes its public API as a single default
// export (an `Object.assign(postcssPlugin, { utils, createPlugin, ... })`), so
// we destructure the helpers off the default. Named ESM imports for `utils`
// and `createPlugin` are NOT supported by stylelint's index.mjs.
//
// Why ESM and not CJS: when bun bundles ESM stylelint and re-wraps it for CJS
// `require()` consumers under `bun build --compile`, the `utils` namespace
// doesn't survive the round-trip — `stylelint.utils` becomes `undefined` at
// runtime in the standalone binary. Keeping this file ESM avoids that.

import stylelint from "stylelint";

const { utils, createPlugin } = stylelint;

export const ruleRemoteUrls = "printsafe/no-remote-urls";
export const ruleRiskyProps = "printsafe/no-risky-print-effects";
export const rulePagedjsCrashSelectors = "printsafe/no-pagedjs-crash-selectors";

const messages = utils.ruleMessages(ruleRemoteUrls, {
  rejected: (url: string) => `Remote URL is not allowed in print CSS: ${url}`
});

const riskyMessages = utils.ruleMessages(ruleRiskyProps, {
  rejected: (prop: string) => `Property is high-risk for print/PDF (can force rasterization): ${prop}`
});

const pagedjsCrashMessages = utils.ruleMessages(rulePagedjsCrashSelectors, {
  rejected: (selector: string) =>
    `Selector can crash Paged.js preview: avoid combining :first-of-type/:last-of-type/:nth-of-type with adjacent sibling (+) in ${selector}`
});

function extractUrls(value: string): string[] {
  const urls: string[] = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) urls.push(m[2] ?? "");
  return urls;
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
  "clip-path"
]);

function splitSelectorList(selectorList: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < selectorList.length; i += 1) {
    const char = selectorList[i]!;
    const prev = i > 0 ? selectorList[i - 1] : "";

    current += char;

    if (quote) {
      if (char === quote && prev !== "\\") quote = null;
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
  return /:(?:first|last|nth)-of-type\b/i.test(selector) && selector.includes("+");
}

const remoteUrlsRule = function(primaryOption: unknown) {
  return function(root: import("postcss").Root, result: import("stylelint").PostcssResult) {
    if (!primaryOption) return;
    root.walkDecls((decl) => {
      const urls = extractUrls(decl.value || "");
      for (const url of urls) {
        const lower = url.trim().toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//")) {
          utils.report({
            message: messages.rejected(url),
            node: decl,
            result,
            ruleName: ruleRemoteUrls
          });
        }
      }
    });
    root.walkAtRules((at) => {
      const urls = extractUrls(at.params || "");
      for (const url of urls) {
        const lower = url.trim().toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//")) {
          utils.report({
            message: messages.rejected(url),
            node: at,
            result,
            ruleName: ruleRemoteUrls
          });
        }
      }
    });
  };
};

const riskyPropsRule = function(primaryOption: unknown) {
  return function(root: import("postcss").Root, result: import("stylelint").PostcssResult) {
    if (!primaryOption) return;
    root.walkDecls((decl) => {
      if (riskyProperties.has(decl.prop.toLowerCase())) {
        utils.report({
          message: riskyMessages.rejected(decl.prop),
          node: decl,
          result,
          ruleName: ruleRiskyProps
        });
      }
    });
  };
};

const pagedjsCrashSelectorRule = function(primaryOption: unknown) {
  return function(root: import("postcss").Root, result: import("stylelint").PostcssResult) {
    if (!primaryOption) return;
    root.walkRules((rule) => {
      for (const selector of splitSelectorList(rule.selector)) {
        if (!isPagedjsCrashProneSelector(selector)) continue;
        utils.report({
          message: pagedjsCrashMessages.rejected(selector),
          node: rule,
          result,
          ruleName: rulePagedjsCrashSelectors,
        });
      }
    });
  };
};

// Cast: stylelint's `Rule` type expects `ruleName`/`messages` properties on
// the function itself; runtime is happy without them (just like the original
// CJS implementation).
const mainPlugin = createPlugin(ruleRemoteUrls, remoteUrlsRule as unknown as import("stylelint").Rule);
export const riskyRule = createPlugin(ruleRiskyProps, riskyPropsRule as unknown as import("stylelint").Rule);
export const pagedjsCrashSelectorRulePlugin = createPlugin(
  rulePagedjsCrashSelectors,
  pagedjsCrashSelectorRule as unknown as import("stylelint").Rule
);

export const messagesRemoteUrls = messages;
export const messagesRiskyProps = riskyMessages;
export const messagesPagedjsCrashSelectors = pagedjsCrashMessages;

export default mainPlugin;
