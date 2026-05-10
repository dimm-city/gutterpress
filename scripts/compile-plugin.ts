/**
 * Bundler plugin that rewrites runtime `package.json` reads in third-party
 * deps so they survive `bun build --compile`.
 *
 * Some upstream packages read their own `package.json` at module-load time:
 *
 *   JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)))
 *
 * `bun build --compile` can't statically embed these — at runtime
 * `import.meta.url` resolves to the binary path inside `/$bunfs`, the
 * relative `package.json` resolves to a nonexistent location, and the
 * binary crashes. Rather than maintaining real `bun patch` files (which
 * would need touch-ups on every dep version bump), this plugin transforms
 * the affected files at bundle time, replacing the runtime read with a
 * statically-inlined JSON literal.
 *
 * Each rewrite is surgical: matched by exact file path inside `node_modules`
 * and guarded by an exact source pattern.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import type { BunPlugin } from "bun";

type Rewrite = {
  /** Substring match used to identify the dep file inside node_modules. */
  fileMatch: string;
  /** Regex that captures the runtime read expression. */
  pattern: RegExp;
  /** Path (relative to the dep root) of the JSON file to inline. */
  jsonPath: string;
};

const REWRITES: Rewrite[] = [
  // stylelint/lib/utils/FileCache.mjs — pulls stylelint's version into the
  // cache key. Lazy-loaded at the lint command path (see ADR 0001 rule 2),
  // but still bundled, so the rewrite is required.
  {
    fileMatch: "/stylelint/lib/utils/FileCache.mjs",
    pattern:
      /JSON\.parse\(readFileSync\(new URL\(['"]\.\.\/\.\.\/package\.json['"],\s*import\.meta\.url\),\s*['"]utf8['"]\)\)/g,
    jsonPath: "../../package.json",
  },
];

function loadPackageJson(sourcePath: string, jsonRelPath: string): string {
  const jsonAbsPath = path.resolve(path.dirname(sourcePath), jsonRelPath);
  const raw = readFileSync(jsonAbsPath, "utf8");
  // Round-trip through JSON.parse so the inlined literal is canonical
  // (drops comments, normalizes whitespace) and survives JS minification.
  return JSON.stringify(JSON.parse(raw));
}

export const inlinePackageJsonReads: BunPlugin = {
  name: "inline-pkg-json-reads",
  setup(build) {
    build.onLoad({ filter: /node_modules.+\.(m?js|cjs)$/ }, (args) => {
      const normalized = args.path.replace(/\\/g, "/");
      const rewrite = REWRITES.find((r) => normalized.endsWith(r.fileMatch));
      if (!rewrite) return null;

      const source = readFileSync(args.path, "utf8");
      if (!rewrite.pattern.test(source)) return null;
      // RegExp with /g flag carries lastIndex state; reset before re-using.
      rewrite.pattern.lastIndex = 0;

      const inlined = loadPackageJson(args.path, rewrite.jsonPath);
      const contents = source.replace(rewrite.pattern, inlined);
      return { contents, loader: "js" };
    });
  },
};
