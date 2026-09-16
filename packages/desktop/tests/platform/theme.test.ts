import { expect, test } from "bun:test";

/**
 * theme.svelte.ts's OS-appearance push subscription (#48) lost its only test
 * when `adapter.test.ts` was deleted (SFE-P5b review round 1, CONFIRMED
 * finding): `onNativeThemeUpdated` was collapsed from
 * `ElectronAdapter.onNativeThemeUpdated` into an inline `bridge()` call
 * inside `initTheme()` (capability-map.md §3), and the old adapter test's
 * "delegates onNativeThemeUpdated 1:1 to the bridge" case was dropped
 * instead of following the collapse. This is that test's replacement,
 * against the real inline call site — it also pins the actual dark-mode
 * flip the old test never exercised (that one only asserted `typeof unsub
 * === "function"`), so the fix is more evidence, not less.
 *
 * Bun imports the rune-bearing `.svelte.ts` module without Svelte's compiler
 * in these unit tests (same shim as settings-change-guard.test.ts /
 * buffer-state.test.ts: the production compiler replaces `$state`; this
 * controller only needs a plain value box for behavior tests, not deep
 * reactivity). `theme.svelte.ts` calls `$state()` at MODULE TOP LEVEL (it
 * also transitively imports `settings.svelte.ts`, which does the same), so
 * the shim must be installed, and the module imported, via a top-level-await
 * dynamic `import()` — a real statement, unlike a static `import`
 * declaration (which is hoisted above the shim regardless of textual
 * position).
 */
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

const { initTheme } = await import("../../src/lib/theme.svelte");

function stubDom(): { dataset: Record<string, string> } {
  const dataset: Record<string, string> = {};
  // @ts-expect-error test global — minimal stand-in for `document`; only
  // `documentElement.dataset` is read by `theme.svelte.ts`'s `apply()`.
  globalThis.document = { documentElement: { dataset } };
  return { dataset };
}

test("initTheme subscribes to the bridge's onNativeThemeUpdated and flips the resolved theme when it fires", () => {
  const { dataset } = stubDom();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let capturedCb: ((state: { shouldUseDarkColors: boolean }) => void) | undefined;
  const unsubscribeSentinel = () => {};

  // @ts-expect-error test global
  globalThis.window = {
    electron: {
      onNativeThemeUpdated: (cb: (state: { shouldUseDarkColors: boolean }) => void) => {
        calls.push({ method: "onNativeThemeUpdated", args: [cb] });
        capturedCb = cb;
        return unsubscribeSentinel;
      },
    },
  };

  initTheme();

  // Subscribed through the bridge exactly once, at init.
  expect(calls.map((c) => c.method)).toEqual(["onNativeThemeUpdated"]);
  expect(capturedCb).toBeDefined();

  // Default settings mode is "system" (DEFAULT_SETTINGS.appearance.theme),
  // so the OS push directly decides the resolved theme.
  capturedCb?.({ shouldUseDarkColors: false });
  expect(dataset.theme).toBe("light");

  capturedCb?.({ shouldUseDarkColors: true });
  expect(dataset.theme).toBe("dark");
});
