import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

/**
 * Render a Svelte 5 component to HTML, in a plain `bun test`.
 *
 * The repo's existing convention for component files is to assert on their
 * SOURCE TEXT — `markdown-editor-doc-swap.test.ts` says so outright: "no
 * component-render test harness in this repo". That convention is weaker than
 * it needs to be. A source-text check passes on markup that never renders, and
 * it cannot see which branch a conditional actually produced.
 *
 * Svelte 5 ships a server renderer, so this compiles the component (and any
 * `.svelte` it imports, recursively) and runs it, giving real markup to assert
 * on: roles, aria attributes, list output, which branch rendered.
 *
 * Three honest limits, which is why this supplements browser checks rather
 * than replacing them:
 *  - No interaction. SSR attaches no event handlers, so a click or keydown
 *    cannot be simulated here.
 *  - No layout. Anything positional is inert; geometry belongs in a pure-
 *    function test or a real browser.
 *  - **No `use:` actions.** They run on mount, so anything an action applies
 *    is absent from this markup — `dialogBehavior`'s `role="dialog"` /
 *    `aria-modal` among them. Assert those at source level instead of
 *    concluding from an SSR render that they are missing.
 *
 * COMPILE WARNINGS ARE FAILURES. Svelte's own a11y analysis runs at compile
 * time and caught a missing `tabindex` on a `role="toolbar"` element that
 * eslint did not — surfacing those is half the value of rendering at all.
 */

/**
 * Inside the package, not the OS temp dir: compiled output imports
 * `svelte/internal/server`, which Node resolves by walking up from the file's
 * own location. From `/tmp` there is no `node_modules` to find.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(HERE, "..", "..", "node_modules", ".cache", "gp-ssr");
const ROOT = resolve(HERE, "..", "..");

/** Compile one `.svelte` file (and its `.svelte` imports) to a runnable module. */
function compileToCache(absPath: string, seen = new Map<string, string>()): string {
  const cached = seen.get(absPath);
  if (cached) return cached;

  const source = readFileSync(absPath, "utf8");
  const name = absPath.split("/").pop()!.replace(".svelte", "");
  const compiled = compile(source, { generate: "server", name, filename: absPath });
  if (compiled.warnings.length > 0) {
    throw new Error(
      `${absPath.slice(ROOT.length + 1)} has ${compiled.warnings.length} compile warning(s):\n` +
        compiled.warnings.map((w) => `  ${w.code}: ${w.message}`).join("\n"),
    );
  }

  // Keyed on the file's PATH, not just its basename and length. Two different
  // `.svelte` files sharing a basename and byte length would have resolved to
  // the same cache path, and since the compiled module is loaded with
  // `import()` — which caches by resolved path — the second component would
  // silently render as the first. A test that passes while exercising the
  // wrong component is worse than no test, which is the whole reason this
  // harness treats compile warnings as failures too.
  const key = absPath.slice(ROOT.length + 1).replace(/[^a-zA-Z0-9]+/g, "_");
  const out = join(CACHE, `${key}-${source.length}.js`);
  mkdirSync(CACHE, { recursive: true });
  // Reserve the path before recursing so an import cycle terminates.
  seen.set(absPath, out);

  const code = compiled.js.code.replace(
    /(["'])((?:\$lib|\.{1,2})\/[^"']*)\1/g,
    (whole, quote: string, spec: string) => {
      const target = spec.startsWith("$lib/")
        ? join(ROOT, "src", "lib", spec.slice("$lib/".length))
        : resolve(dirname(absPath), spec);
      // A child COMPONENT has to be compiled too, or it imports as a string
      // and renders as "Icon is not a function". But `foo.svelte.ts` is a
      // runes MODULE whose specifier drops the `.ts`, so the extension alone
      // cannot tell them apart — ask the filesystem which one exists.
      if (target.endsWith(".svelte") && existsSync(target)) {
        return `${quote}${compileToCache(target, seen)}${quote}`;
      }
      return `${quote}${target}${quote}`;
    },
  );

  writeFileSync(out, code, "utf8");
  return out;
}

export async function renderComponent(
  /** Path relative to `packages/desktop/src`, e.g. `lib/components/X.svelte`. */
  relPath: string,
  props: Record<string, unknown> = {},
): Promise<string> {
  const modulePath = compileToCache(join(ROOT, "src", relPath));
  // The component's real prop type is unknown here by construction — this
  // harness renders arbitrary components — so the cast is at the boundary,
  // where each test supplies props the component actually declares.
  const mod = (await import(modulePath)) as { default: Parameters<typeof render>[0] };
  return render(mod.default, { props } as Parameters<typeof render>[1]).body;
}

/**
 * Rendered text with runs of whitespace collapsed.
 *
 * SSR preserves the template's own newlines and indentation, so a sentence
 * that reads as one line in the source arrives with line breaks inside it.
 * Assert prose against this, not the raw markup.
 */
export function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
