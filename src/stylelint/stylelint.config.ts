import type { Config } from "stylelint";
import mainPlugin, { riskyRule, ruleRemoteUrls, ruleRiskyProps } from "./printsafe-plugin";

const config: Config = {
  extends: ["stylelint-config-standard"],
  plugins: [mainPlugin, riskyRule],
  ignoreFiles: ["**/*.min.css"],
  rules: {
    // Keep the baseline sane
    "no-descending-specificity": null,

    // Print safety rules
    [ruleRemoteUrls]: [true],
    [ruleRiskyProps]: [true],

    // Allow Paged Media + margin boxes
    "at-rule-no-unknown": [true, {
      ignoreAtRules: [
        "page",
        "page:",  // @page: with pseudo-selectors
        "top-left", "top-center", "top-right",
        "bottom-left", "bottom-center", "bottom-right",
        "left-top", "left-middle", "left-bottom",
        "right-top", "right-middle", "right-bottom"
      ]
    }],

    // Allow Paged.js / Prince-style running headers
    "property-no-unknown": [true, {
      ignoreProperties: ["string-set"]
    }],

    // Allow CSS Paged Media functions (string() for running headers, content() for string-set)
    "function-no-unknown": [true, {
      ignoreFunctions: ["string", "content"]
    }],

    // Allow explicit longhand properties (top/right/bottom/left instead of inset) for clarity
    "declaration-block-no-redundant-longhand-properties": null,

    // Allow redundant shorthand values (e.g., "0 0 0.2in 0") for explicit intent
    "shorthand-property-no-redundant-values": null,

    // Disable value validation - it doesn't understand Paged Media values like content(text)
    "declaration-property-value-no-unknown": null,

    // Allow multiple declarations on single line (common in compact print CSS)
    "declaration-block-single-line-max-declarations": null,

    // Allow flexible whitespace between rules
    "rule-empty-line-before": null,

    // Allow flexible whitespace before at-rules
    "at-rule-empty-line-before": null,

    // Allow long hex colors (#000000 vs #000)
    "color-hex-length": null,

    // Allow legacy page-break-* properties (widely supported for print)
    "property-no-deprecated": null,

    // Disable stylistic formatting rules (defer to author's style)
    "selector-attribute-quotes": null,
    "declaration-empty-line-before": null,
    "comment-empty-line-before": null,
    "comment-whitespace-inside": null,
    "value-keyword-case": null,
    "length-zero-no-unit": null,
    "custom-property-empty-line-before": null,

    // Allow third-party/minified CSS patterns
    "custom-property-pattern": null,
    "color-function-alias-notation": null,
    "color-function-notation": null,
    "alpha-value-notation": null,

    // Allow various CSS patterns used in complex projects
    "number-max-precision": null,
    "no-duplicate-selectors": null,
    "property-no-vendor-prefix": null,
    "selector-class-pattern": null,
    "declaration-block-no-duplicate-properties": null,
    "declaration-block-no-duplicate-custom-properties": null,
    "selector-pseudo-element-colon-notation": null,
    "declaration-block-no-shorthand-property-overrides": null,
    "at-rule-descriptor-no-unknown": null,
    "font-family-name-quotes": null,
    "hue-degree-notation": null,
    "selector-not-notation": null,
    "declaration-property-value-keyword-no-deprecated": null,
  }
};

export default config;
