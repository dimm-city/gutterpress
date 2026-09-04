import { afterEach, expect, test } from "bun:test";
import { buildEditorProjection } from "../../src/lib/editor-host/editor-projection-capability";
import { DesktopHostRequiredError } from "../../src/lib/platform/bridge";

// SFE-P5b: `buildEditorProjection` (SFE-P3e) is a pure 1:1 forward to the
// bridge, kept as its own small capability module (see that file's header
// for why) rather than folded into `+page.svelte`. This proves the
// delegation and the shared fail-loudly behavior.

afterEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
});

test("buildEditorProjection delegates 1:1 to the bridge", async () => {
  const calls: unknown[] = [];
  const outcome = { ok: true, projection: { schemaVersion: 1, sourceVersion: 1, blocks: [], generated: [], diagnostics: [] }, pluginCss: "", pluginErrors: [] };
  // @ts-expect-error test global
  globalThis.window = {
    electron: {
      buildEditorProjection: async (args: unknown) => {
        calls.push(args);
        return outcome;
      },
    },
  };
  const args = { projectDir: "/book", content: "# Hi", sourceVersion: 1 };
  await expect(buildEditorProjection(args)).resolves.toEqual(outcome as never);
  expect(calls).toEqual([args]);
});

test("buildEditorProjection fails loudly off-Electron", () => {
  // @ts-expect-error test global
  globalThis.window = {};
  // bridge() throws SYNCHRONOUSLY (matching the deleted getPlatform()'s own
  // synchronous fail-loudly behavior) — buildEditorProjection is not itself
  // `async`, so the throw happens before a promise is ever returned.
  expect(() => buildEditorProjection({ projectDir: "/book", content: "", sourceVersion: 0 })).toThrow(
    DesktopHostRequiredError,
  );
});
