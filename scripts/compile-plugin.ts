/**
 * Bundler plugin that rewrites runtime `package.json` reads in third-party
 * deps so they survive `bun build --compile`.
 *
 * Some upstream packages (currently vite + stylelint) read their own
 * `package.json` at module-load time using patterns like:
 *
 *   JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)))
 *   createRequire(import.meta.url); require("../package.json")
 *
 * `bun build --compile` can't statically embed these — at runtime
 * `import.meta.url` resolves to the binary path inside `/$bunfs`, the
 * relative `package.json` resolves to a nonexistent location, and the
 * binary crashes on startup before the CLI ever sees argv.
 *
 * To avoid maintaining real `bun patch` files (which would need touch-ups
 * on every dep version bump), this plugin transforms the small set of
 * affected files at bundle time, replacing the runtime read with a
 * statically-inlined JSON literal.
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

// Each entry handles one specific upstream pattern. New entries should be
// surgical so we don't accidentally rewrite unrelated code that happens to
// match.
const REWRITES: Rewrite[] = [
  // vite/dist/node/chunks/logger.js — version constant.
  {
    fileMatch: "/vite/dist/node/chunks/logger.js",
    pattern:
      /JSON\.parse\(readFileSync\(new URL\("\.\.\/\.\.\/package\.json",\s*new URL\("\.\.\/\.\.\/\.\.\/src\/node\/constants\.ts",\s*import\.meta\.url\)\)\)\.toString\(\)\)/g,
    jsonPath: "../../../package.json",
  },
  // stylelint/lib/utils/FileCache.mjs — pulls stylelint's version into the
  // cache key.
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
      const loader = args.path.endsWith(".cjs")
        ? "js"
        : args.path.endsWith(".mjs")
          ? "js"
          : "js";
      return { contents, loader };
    });
  },
};
