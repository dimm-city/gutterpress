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
 * REPAIR ROUND 1 (finding "build.mjs's webview placeholder is dead
 * machinery, a false header, and a silent-fail path"): `scripts/build.mjs`'s
 * placeholder-vs-real branch (`existsSync(WEBVIEW_ENTRY_PATH)`) has been
 * deleted — the entry is unconditionally bundled now, and a missing entry
 * is a build FAILURE, not a silently-emitted "not yet built" notice. The
 * two `not.toContain` assertions this test used to run against the
 * placeholder's own exact marker strings are therefore now vacuous (those
 * strings exist nowhere in this package any more) and have been replaced
 * below with `result.success` plus the same positive-evidence assertions —
 * proof the REAL bundle's own content is present, not proof an unreachable
 * fallback string is absent.
 */
describe("src/webview/index.ts bundles to a real browser entry", () => {
  test("bundling succeeds and the output contains the real entry's own content", async () => {
    const entryPath = resolve(import.meta.dir, "../../src/webview/index.ts");
    const result = await Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      format: "esm",
    });

    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);

    const code = await result.outputs[0]!.text();

    // Positive evidence this is the real entry, not an empty/trivial
    // bundle: string literals only this module's production code
    // contains (the container id the mount looks up, the fallback DOM
    // tags, and the exported production entry point's own name).
    expect(code).toContain("gp-editor-root");
    expect(code).toContain("data-gp-fallback");
    expect(code).toContain("mountGutterpressWebview");
  });
});
