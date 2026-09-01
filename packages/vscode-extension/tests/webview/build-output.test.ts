import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

/**
 * SFE-P3c Lane C — run spec DETAILS #5 ("BUILD INTEGRATION"): "after your
 * entry exists, cd packages/vscode-extension && bun run build must emit the
 * REAL dist/webview.js (no placeholder text in it — assert that in a small
 * unit test reading the build output, or verify and state it)".
 *
 * This test bundles `src/webview/index.ts` itself, the SAME way
 * `../../scripts/build.mjs` does for the webview target (`target:
 * "browser", format: "esm"` — see that script's own header), independent of
 * whether `bun run build` has already been run in this environment (no
 * dependency on `dist/` already existing on disk). It is therefore a
 * self-contained, always-accurate proof rather than one that could pass
 * only because a stale `dist/webview.js` happened to be lying around from
 * an earlier invocation.
 *
 * `scripts/build.mjs`'s own placeholder-vs-real branch
 * (`existsSync(WEBVIEW_ENTRY_PATH)`) is what already stops the placeholder
 * from being emitted once `src/webview/index.ts` exists — this test does
 * not re-prove that branch (Lane A's own file, outside this lane's write
 * boundary); it proves the REAL bundle's own content directly.
 */
describe("src/webview/index.ts bundles to a real (non-placeholder) browser entry", () => {
  test("bundling succeeds and the output contains no placeholder marker", async () => {
    const entryPath = resolve(import.meta.dir, "../../src/webview/index.ts");
    const result = await Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      format: "esm",
    });

    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);

    const code = await result.outputs[0]!.text();

    // scripts/build.mjs's WEBVIEW_PLACEHOLDER_JS's own exact marker
    // strings — must be absent from the REAL bundle.
    expect(code).not.toContain("is not yet built");
    expect(code).not.toContain("SFE-P3c Lane A placeholder");

    // Positive evidence this is the real entry, not an empty/trivial
    // bundle: a string literal only this module's production code
    // contains (the container id the mount looks up and the fallback DOM
    // tags).
    expect(code).toContain("gp-editor-root");
    expect(code).toContain("data-gp-fallback");
  });
});
