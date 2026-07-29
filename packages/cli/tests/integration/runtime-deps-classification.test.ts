/**
 * Static guard: every runtime import in packages/cli/src/ MUST be declared in
 * packages/cli/package.json#dependencies (not devDependencies).
 *
 * electron-builder packages production deps only. A missing dep classification
 * means the packaged desktop crashes at runtime with ERR_MODULE_NOT_FOUND when
 * it hits that code path — exactly what happened with stylelint in v0.1.2.
 *
 * This test scans the lib source for static and dynamic imports, filters out
 * relative paths and `node:*` builtins, and asserts every remaining specifier
 * is listed in `dependencies`. devDependencies are deliberately NOT a valid
 * source for runtime imports (they aren't shipped).
 *
 * Type-only imports (import type, dynamic import("...") used only inside
 * `typeof` expressions, etc) are excluded — they're erased at compile time
 * and never resolved at runtime.
 *
 * To opt a runtime import out of this check (e.g., a peer-dep your callers
 * supply), add it to RUNTIME_OPT_OUT below with a comment justifying it.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const LIB_ROOT = resolve(__dirname, "../..");
const SRC = join(LIB_ROOT, "src");
const PKG_JSON = JSON.parse(readFileSync(join(LIB_ROOT, "package.json"), "utf-8"));

// Packages allowed to be imported at runtime even if not listed in
// dependencies. Use only if you have a real reason (peer dep, optional
// runtime probe wrapped in try/catch where the absence is handled).
const RUNTIME_OPT_OUT = new Set<string>([
  // (empty for now)
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      // Skip vendored assets and test files — they're not runtime code.
      if (entry === "assets" || entry === "stylelint") {
        // stylelint config is loaded via dynamic import but the imports
        // INSIDE it (printsafe-plugin) are local relative paths — those
        // are handled by walking src/stylelint/*.ts files
        if (entry === "stylelint") {
          yield* walk(p);
        }
        continue;
      }
      yield* walk(p);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      yield p;
    }
  }
}

/**
 * Returns the bare package specifier from an import path, or null if the
 * import is a relative path, node: builtin, or type-only.
 *
 * Examples:
 *   "node:fs"                → null (builtin)
 *   "./foo"                  → null (relative)
 *   "stylelint"              → "stylelint"
 *   "@scope/pkg/subpath"     → "@scope/pkg"
 *   "lodash/get"             → "lodash"
 */
// Node.js builtin modules — these resolve from the runtime, not node_modules,
// whether prefixed with `node:` or not. The `node:` prefix is best-practice
// but bare names like `import path from "path"` are equally builtin and not
// a package import.
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster",
  "console", "constants", "crypto", "dgram", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector",
  "module", "net", "os", "path", "perf_hooks", "process",
  "punycode", "querystring", "readline", "repl", "stream",
  "string_decoder", "sys", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
  "zlib",
]);

function parseSpecifier(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  if (spec.startsWith("node:")) return null;
  if (spec.startsWith("bun:")) return null;
  if (NODE_BUILTINS.has(spec.split("/")[0]!)) return null;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split("/")[0]!;
}

interface ImportRef {
  file: string;
  line: number;
  specifier: string;
  kind: "static" | "dynamic";
}

function findRuntimeImports(filePath: string): ImportRef[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const refs: ImportRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip type-only imports: `import type {...} from "x"`
    if (/^\s*import\s+type\s+/.test(line)) continue;

    // Static value imports: import X from "spec"   or   import { ... } from "spec"
    const staticMatch = line.match(/^\s*import\s+(?!type\s)[^"']*?from\s+["']([^"']+)["']/);
    if (staticMatch) {
      refs.push({ file: filePath, line: i + 1, specifier: staticMatch[1]!, kind: "static" });
      continue;
    }

    // Bare side-effect import: `import "x"`
    const sideEffectMatch = line.match(/^\s*import\s+["']([^"']+)["']/);
    if (sideEffectMatch) {
      refs.push({ file: filePath, line: i + 1, specifier: sideEffectMatch[1]!, kind: "static" });
      continue;
    }

    // Dynamic import: `await import("spec")` or `import("spec").then(...)`
    // Excludes lines that contain `typeof import(...)` (type-only).
    if (!/typeof\s+import\s*\(/.test(line)) {
      const dynMatches = line.matchAll(/(?<!\.)\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
      for (const m of dynMatches) {
        refs.push({ file: filePath, line: i + 1, specifier: m[1]!, kind: "dynamic" });
      }
    }
  }

  return refs;
}

describe("runtime deps classification", () => {
  it("every runtime import in lib/src must be a dependency (not a devDependency)", () => {
    const declaredDeps = new Set(Object.keys(PKG_JSON.dependencies ?? {}));
    const declaredDevDeps = new Set(Object.keys(PKG_JSON.devDependencies ?? {}));

    const violations: Array<{
      package: string;
      where: string;
      reason: string;
    }> = [];

    for (const file of walk(SRC)) {
      for (const ref of findRuntimeImports(file)) {
        const pkg = parseSpecifier(ref.specifier);
        if (!pkg) continue;
        if (RUNTIME_OPT_OUT.has(pkg)) continue;

        const where = `${relative(LIB_ROOT, ref.file)}:${ref.line} (${ref.kind} import "${ref.specifier}")`;

        if (declaredDeps.has(pkg)) continue;

        if (declaredDevDeps.has(pkg)) {
          violations.push({
            package: pkg,
            where,
            reason: `runtime import of "${pkg}" but it's in devDependencies — electron-builder won't ship it, packaged desktop will crash with ERR_MODULE_NOT_FOUND`,
          });
        } else {
          violations.push({
            package: pkg,
            where,
            reason: `runtime import of "${pkg}" but it's not listed in dependencies OR devDependencies — install will not bring it in`,
          });
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  • ${v.package}\n    at ${v.where}\n    ${v.reason}`)
        .join("\n\n");
      const fix = `\n\nFix: move the offending packages from devDependencies to dependencies in packages/cli/package.json. If a package is genuinely optional/peer, add it to RUNTIME_OPT_OUT in ${relative(LIB_ROOT, __filename)} with a comment explaining why.`;
      throw new Error(
        `\n${violations.length} lib runtime import(s) not declared as dependencies:\n\n${report}${fix}\n`
      );
    }

    expect(violations).toEqual([]);
  });
});
