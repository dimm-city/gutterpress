import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tsParser from "@typescript-eslint/parser";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    plugins: { svelte: sveltePlugin },
    files: ["**/*.svelte", "**/*.svelte.ts"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
      },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='$effect']",
          message:
            "$effect is banned. Use onMount (DOM setup/cleanup), afterNavigate (same-route nav), use: actions with MutationObserver (DOM side effects), event handlers (user-triggered state), untrack() (one-time prop reads), {#key id} in parent (re-init on identity change), $derived+class: binding (reactive CSS classes).",
        },
      ],
    },
  },
];
