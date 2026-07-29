/**
 * ARCH #61 — the settings store used to keep a hand-rolled `subscribers`
 * array (notified from inside `set()`/`_loadSettings()`) ALONGSIDE its
 * `$state` reactivity: two notification channels for one state object, where
 * a setter that forgot the manual notify loop would silently break every
 * imperative `subscribe()` consumer.
 *
 * That channel is retired. Consumers now read `useSettings().current...`
 * inside a component `$effect`. Because `set()` replaces the whole `current`
 * object on every call (not just the touched section), an `$effect` reading
 * one nested field would re-fire on every UNRELATED settings change too —
 * this is what the old `+page.svelte` `lastBg` closure guarded against for
 * the previewBg → iframe-style sync. `settingsChangeGuard()` is the extracted,
 * directly-testable replacement for that guard (no Svelte component/effect
 * harness exists in this repo — see `history-seam-retirement.test.ts` — so
 * the guard logic must be a plain function to be pinned with a real test
 * rather than a source-text assertion).
 */
import { expect, test } from "bun:test";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as buffer-state.test.ts / the *-controller.
// svelte.ts suite: the production compiler replaces $state; this store only
// needs a plain value box for behavior tests, not deep reactivity). Unlike
// those class-field controllers, `settings.svelte.ts` calls `$state()` at
// MODULE TOP LEVEL, which runs at import time — static `import` declarations
// are hoisted above the rest of the file regardless of textual position, so
// a same-file shim placed "before" a static import would still lose the
// race. A top-level-await dynamic `import()` is a real statement (not
// hoisted); it runs strictly after the shim line above it.
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

const { useSettings, settingsChangeGuard, onSettingsChange } = await import(
  "../../src/lib/settings.svelte"
);

// ── settingsChangeGuard (pure) ────────────────────────────────────────────

test("settingsChangeGuard: fires on the first call", () => {
  const seen: string[] = [];
  const guard = settingsChangeGuard<string>((v) => seen.push(v));

  guard("a");

  expect(seen).toEqual(["a"]);
});

test("settingsChangeGuard: calling with the same value twice does not re-trigger the sink", () => {
  const seen: string[] = [];
  const guard = settingsChangeGuard<string>((v) => seen.push(v));

  guard("#5a5a5a");
  guard("#5a5a5a");
  guard("#5a5a5a");

  expect(seen).toEqual(["#5a5a5a"]);
});

test("settingsChangeGuard: a real change re-triggers the sink", () => {
  const seen: string[] = [];
  const guard = settingsChangeGuard<string>((v) => seen.push(v));

  guard("#5a5a5a");
  guard("#ffffff");
  guard("#ffffff"); // duplicate again, still suppressed
  guard("#000000");

  expect(seen).toEqual(["#5a5a5a", "#ffffff", "#000000"]);
});

test("settingsChangeGuard: a falsy `ready()` suppresses the sink without consuming the value", () => {
  const seen: string[] = [];
  let ready = false;
  const guard = settingsChangeGuard<string>((v) => seen.push(v), () => ready);

  guard("#5a5a5a"); // ready() is false — sink must not fire
  expect(seen).toEqual([]);

  ready = true;
  guard("#5a5a5a"); // same value as the suppressed attempt — must still fire
  // now that the guarded resource (e.g. the preview client) is ready, this is
  // the first value it has actually seen applied.
  expect(seen).toEqual(["#5a5a5a"]);

  guard("#5a5a5a"); // duplicate while ready — suppressed
  expect(seen).toEqual(["#5a5a5a"]);
});

// ── Wired against the real settings store (the exact +page.svelte usage) ──

test("useSettings().set() with an unchanged previewBg does not re-trigger the sink, a real change does", () => {
  const applied: string[] = [];
  const bgGuard = settingsChangeGuard<string>((bg) => applied.push(bg));

  const settings = useSettings();
  const readBg = () => bgGuard(settings.current.appearance.previewBg);

  // Baseline read.
  readBg();
  expect(applied).toEqual([settings.current.appearance.previewBg]);

  // Setting the SAME previewBg value again must not re-trigger the sink.
  const currentBg = settings.current.appearance.previewBg;
  settings.set({ appearance: { previewBg: currentBg } });
  readBg();
  expect(applied).toEqual([currentBg]);

  // An unrelated section change must not re-trigger the sink either (this is
  // the exact case the old unconditional subscribe() notify loop got wrong).
  settings.set({ editor: { fontSize: settings.current.editor.fontSize + 1 } });
  readBg();
  expect(applied).toEqual([currentBg]);

  // A real previewBg change DOES re-trigger the sink.
  settings.set({ appearance: { previewBg: "#123456" } });
  readBg();
  expect(applied).toEqual([currentBg, "#123456"]);
});

// ── Manual subscribe channel removed ──────────────────────────────────────

test("useSettings() no longer exposes a subscribe() method (ARCH #61 — the manual channel is retired)", () => {
  const settings = useSettings() as unknown as Record<string, unknown>;
  expect(settings.subscribe).toBeUndefined();
});

// ── onSettingsChange (the single imperative side-effect channel) ──────────
// The repo bans $effect in the SPA (eslint no-restricted-syntax; CLAUDE.md),
// so imperative sinks register here. Every state replacement flows through
// the store's replaceState() choke point, which owns the notify — the
// forgot-to-notify hazard ARCH #61 flagged cannot recur in a new setter.

test("onSettingsChange: fires on set() with the fully-merged current settings", () => {
  const settings = useSettings();
  const seen: number[] = [];
  const off = onSettingsChange((s) => seen.push(s.editor.fontSize));
  const next = settings.current.editor.fontSize + 2;
  settings.set({ editor: { fontSize: next } });
  expect(seen).toEqual([next]);
  off();
});

test("onSettingsChange: unsubscribe stops further notifications", () => {
  const settings = useSettings();
  const seen: unknown[] = [];
  const off = onSettingsChange((s) => seen.push(s.editor.fontSize));
  settings.set({ editor: { fontSize: settings.current.editor.fontSize + 1 } });
  expect(seen.length).toBe(1);
  off();
  settings.set({ editor: { fontSize: settings.current.editor.fontSize + 1 } });
  expect(seen.length).toBe(1);
});

test("onSettingsChange: pairs with settingsChangeGuard to skip unrelated changes", () => {
  const settings = useSettings();
  const applied: string[] = [];
  const sink = settingsChangeGuard<string>((bg) => applied.push(bg));
  const off = onSettingsChange((s) => sink(s.appearance.previewBg));
  const bg = settings.current.appearance.previewBg;
  settings.set({ editor: { fontSize: settings.current.editor.fontSize + 1 } });
  expect(applied).toEqual([bg]); // first notify seeds the guard
  settings.set({ editor: { fontSize: settings.current.editor.fontSize + 1 } });
  expect(applied).toEqual([bg]); // unrelated change: guard suppresses
  settings.set({ appearance: { previewBg: "#0a0b0c" } });
  expect(applied).toEqual([bg, "#0a0b0c"]);
  off();
});
