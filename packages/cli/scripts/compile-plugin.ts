/**
 * Bundler plugin that rewrites runtime module/asset reads in third-party deps
 * so they survive `bun build --compile`.
 *
 * Two failure modes show up under `--compile`:
 *
 *  1. A package reads its own `package.json` (or another file) at module-load
 *     via `readFileSync(new URL("…", import.meta.url))`. At runtime
 *     `import.meta.url` points inside the `/$bunfs` virtual fs and the relative
 *     read resolves to nothing → crash.
 *
 *  2. A package uses `createRequire(import.meta.url)` + `require("…json")` to
 *     pull in data files. `--compile` can't statically see those reads, so the
 *     JSON is never embedded and the binary throws
 *     `Cannot find module '../data/patch.json' from '/$bunfs/root/cli.js'`.
 *
 * Rather than maintaining `bun patch` files (which need re-patching on every
 * dep bump), this plugin transforms the affected source at bundle time. For (1)
 * it inlines the JSON as a literal; for (2) it rewrites the dynamic `require`
 * into a static `import`, which Bun's bundler *does* resolve and embed.
 *
 * Each transform is surgical: matched by exact file path suffix inside
 * node_modules and guarded by the exact source it expects.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import type { BunPlugin } from "bun";

type Transform = {
  /** Path suffix (inside node_modules) identifying the dep file. */
  fileMatch: string;
  /** Returns rewritten source, or undefined to leave the file untouched. */
  apply: (source: string, absPath: string) => string | undefined;
};

/** Inline a JSON file (relative to `absPath`) as a canonical literal. */
function inlineJson(absPath: string, jsonRelPath: string): string {
  const jsonAbsPath = path.resolve(path.dirname(absPath), jsonRelPath);
  return JSON.stringify(JSON.parse(readFileSync(jsonAbsPath, "utf8")));
}

const TRANSFORMS: Transform[] = [
  // stylelint/lib/utils/FileCache.mjs — reads stylelint's package.json for the
  // cache key. Inline the version literal so the runtime read disappears.
  {
    fileMatch: "/stylelint/lib/utils/FileCache.mjs",
    apply(source, absPath) {
      const pattern =
        /JSON\.parse\(readFileSync\(new URL\(['"]\.\.\/\.\.\/package\.json['"],\s*import\.meta\.url\),\s*['"]utf8['"]\)\)/g;
      if (!pattern.test(source)) return undefined;
      pattern.lastIndex = 0;
      return source.replace(pattern, inlineJson(absPath, "../../package.json"));
    },
  },

  // css-tree (a stylelint transitive dep) loads JSON via
  // createRequire(import.meta.url) in three files. Rewrite each dynamic require
  // into a static import so Bun embeds the JSON in the binary.
  {
    fileMatch: "/css-tree/lib/version.js",
    apply(source) {
      if (!source.includes("createRequire")) return undefined;
      return "import pkg from '../package.json';\nexport const version = pkg.version;\n";
    },
  },
  {
    fileMatch: "/css-tree/lib/data-patch.js",
    apply(source) {
      if (!source.includes("createRequire")) return undefined;
      return "import patch from '../data/patch.json';\nexport default patch;\n";
    },
  },
  {
    fileMatch: "/css-tree/lib/data.js",
    apply(source) {
      if (!source.includes("createRequire")) return undefined;
      return source
        .replace("import { createRequire } from 'module';\n", "")
        .replace("const require = createRequire(import.meta.url);\n", "")
        .replace(
          "const mdnAtrules = require('mdn-data/css/at-rules.json');",
          "import mdnAtrules from 'mdn-data/css/at-rules.json';"
        )
        .replace(
          "const mdnProperties = require('mdn-data/css/properties.json');",
          "import mdnProperties from 'mdn-data/css/properties.json';"
        )
        .replace(
          "const mdnSyntaxes = require('mdn-data/css/syntaxes.json');",
          "import mdnSyntaxes from 'mdn-data/css/syntaxes.json';"
        );
    },
  },
];

export const inlinePackageJsonReads: BunPlugin = {
  name: "compile-fixups",
  setup(build) {
    build.onLoad({ filter: /node_modules.+\.(m?js|cjs)$/ }, (args) => {
      const normalized = args.path.replace(/\\/g, "/");
      const transform = TRANSFORMS.find((t) => normalized.endsWith(t.fileMatch));
      if (!transform) return undefined;

      const source = readFileSync(args.path, "utf8");
      const contents = transform.apply(source, args.path);
      if (contents === undefined) return undefined;
      return { contents, loader: "js" };
    });
  },
};
