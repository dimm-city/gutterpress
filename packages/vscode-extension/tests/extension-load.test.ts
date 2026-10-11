import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Repair round 1 — closes the gate blind spot the review named: "`bun run
 * build` is in the gate but nothing ever LOADS the artifact." Every prior
 * check (typecheck, `bun test`, `bun run build` succeeding) is silent about
 * whether the file the real VS Code extension host actually loads
 * (`dist/extension.js`, via `require()`, per package.json's
 * `"main"`/`"type": "commonjs"`) is loadable at all.
 *
 * This test reproduces the REAL host's load exactly: runs the package's OWN
 * `bun run build` (`scripts/build.mjs` — a SEPARATE CHILD PROCESS, not an
 * in-process `Bun.build()` call; see the "WHY A CHILD PROCESS" note below)
 * to produce the real `dist/extension.js`, copies it into a fresh temp
 * directory alongside a `{"type":"commonjs"}` package.json (the real
 * packaged shape — a VS Code extension's package.json lives one directory
 * above dist/extension.js, and Node's module-type resolution walks up to
 * find it, so co-locating it directly beside extension.js in a fresh temp
 * directory is a tighter, minimal reproduction of the same resolution
 * outcome) and stub `node_modules/vscode` + `node_modules/gutterpress`
 * packages on the require() resolution path (mirroring how a real installed
 * extension has "vscode" host-injected and "gutterpress" present as an
 * ordinary npm dependency), then spawns a REAL `node` process — not Bun's
 * own require, which is not the runtime the real extension host uses — to
 * `require()` the built file and assert `activate`/`deactivate` are
 * functions.
 *
 * WHY A CHILD PROCESS, NOT AN IN-PROCESS `Bun.build()` CALL: an earlier
 * version of this test called `Bun.build()` directly (mirroring
 * `tests/webview/build-output.test.ts`'s own pattern for the webview
 * bundle). Verified locally: running the full `bun test` suite (this file
 * plus `build-output.test.ts`, both invoking `Bun.build()` against
 * overlapping dependency graphs that both resolve
 * `packages/editor/src/core/index.ts`) made `build-output.test.ts` fail
 * DETERMINISTICALLY — every run, never in isolation — with
 * `error: EISDIR reading file: ".../packages/editor/src/core/index.ts"`
 * against a plain, real, non-directory file. This reproduces under Bun
 * 1.3.11's own test-file concurrency when two `Bun.build()` calls in
 * different test files race on a shared source file; it is not a defect in
 * either bundle's own config. Shelling out to the real `bun run build`
 * script as an independent child process avoids the shared in-process
 * bundler state entirely and, as a bonus, exercises the REAL build script
 * end to end rather than a duplicated `Bun.build()` config that could drift
 * from it.
 *
 * Before the fix (packages/cli inlined into dist/extension.js because
 * "gutterpress" was not external in scripts/build.mjs), this reproduced the
 * confirmed defect exactly: `packages/cli/src/lib/pdf-inspect.ts`'s eager
 * top-level `import { getDocumentProxy } from "unpdf"` pulls in a module
 * whose body contains `import.meta.resolve` — a parse-time `SyntaxError`
 * under CommonJS, unconditional and independent of whether any exported
 * function is ever called. This test fails on that code and passes once
 * "gutterpress" is externalized.
 */
describe("dist/extension.js is loadable by a real Node require(), exactly as the VS Code extension host loads it", () => {
  test("a real `node -e \"require(...)\"` against a stub vscode/gutterpress and a commonjs package.json resolves activate/deactivate as functions", () => {
    const packageRoot = resolve(import.meta.dir, "..");

    // The real build script, as a genuine child process — see this file's
    // own "WHY A CHILD PROCESS" note above.
    execFileSync("bun", ["run", "build"], { cwd: packageRoot, stdio: "pipe" });
    const code = readFileSync(join(packageRoot, "dist", "extension.js"), "utf8");
    expect(code.length).toBeGreaterThan(0); // AP-21 liveness: the build actually produced something

    const dir = mkdtempSync(join(tmpdir(), "gp-vscode-extension-load-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "commonjs" }));
      writeFileSync(join(dir, "extension.js"), code);

      // Stub "vscode" — the real host injects this; here it just needs to
      // be requireable so the module body's `require("vscode")` succeeds.
      mkdirSync(join(dir, "node_modules", "vscode"), { recursive: true });
      writeFileSync(
        join(dir, "node_modules", "vscode", "package.json"),
        JSON.stringify({ name: "vscode", main: "index.js" }),
      );
      writeFileSync(join(dir, "node_modules", "vscode", "index.js"), "module.exports = {};");

      // Stub "gutterpress" — a real, ordinary npm dependency in the
      // packaged extension's own node_modules (package.json's real
      // "dependencies" entry); a trivial stub is sufficient here since this
      // test only proves the FILE LOADS, not that any gutterpress behavior
      // works. Declares an "exports" map covering every subpath this
      // package's own source actually imports as a VALUE (`grep -rn 'from
      // "gutterpress' src/` — the bare specifier plus "./plugins" and
      // "./render"; every other reference is `import type`, erased at build
      // time) — the real gutterpress package.json also uses an exports map
      // for these subpaths (D11), so a stub without one would fail to
      // resolve them the same way a real but out-of-date gutterpress
      // install could, which is not what this test exists to catch.
      mkdirSync(join(dir, "node_modules", "gutterpress"), { recursive: true });
      writeFileSync(
        join(dir, "node_modules", "gutterpress", "package.json"),
        JSON.stringify({
          name: "gutterpress",
          main: "./index.js",
          exports: { ".": "./index.js", "./plugins": "./plugins.js", "./render": "./render.js" },
        }),
      );
      writeFileSync(join(dir, "node_modules", "gutterpress", "index.js"), "module.exports = {};");
      writeFileSync(join(dir, "node_modules", "gutterpress", "plugins.js"), "module.exports = {};");
      writeFileSync(join(dir, "node_modules", "gutterpress", "render.js"), "module.exports = {};");

      const probePath = join(dir, "probe.js");
      writeFileSync(
        probePath,
        [
          "const mod = require('./extension.js');",
          "if (typeof mod.activate !== 'function') {",
          "  console.error('activate is ' + typeof mod.activate);",
          "  process.exit(1);",
          "}",
          "if (typeof mod.deactivate !== 'function') {",
          "  console.error('deactivate is ' + typeof mod.deactivate);",
          "  process.exit(1);",
          "}",
          "console.log('OK');",
        ].join("\n"),
      );

      const output = execFileSync("node", ["probe.js"], { cwd: dir, encoding: "utf8" });
      expect(output.trim()).toBe("OK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
