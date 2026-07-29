import { test, expect } from "bun:test";
import {
  decideStartupScreen,
  continueStatus,
  shouldReshowLanding,
} from "../../src/lib/routes/startup-landing";

// ---------------------------------------------------------------------------
// decideStartupScreen — the launch policy behind the start screen (welcome
// landing). Mirrors the auto-reopen onMount block in +page.svelte. showLanding
// doubles as "reveal the window immediately" at the call site; whether the
// previous project reopens is simply "is there a lastProjectDir".
// ---------------------------------------------------------------------------

test("no previous project → landing is the welcome screen", () => {
  expect(
    decideStartupScreen({ lastProjectDir: null, landingEnabled: true }),
  ).toEqual({ showLanding: true });
});

test("no previous project → landing shows even when the pref is off (it IS the empty state)", () => {
  expect(
    decideStartupScreen({ lastProjectDir: null, landingEnabled: false }),
  ).toEqual({ showLanding: true });
});

test("previous project + landing on → show landing over the pre-render", () => {
  expect(
    decideStartupScreen({ lastProjectDir: "/books/novel", landingEnabled: true }),
  ).toEqual({ showLanding: true });
});

test("previous project + landing off → pre-landing behavior (splash covers the render)", () => {
  expect(
    decideStartupScreen({ lastProjectDir: "/books/novel", landingEnabled: false }),
  ).toEqual({ showLanding: false });
});

// ---------------------------------------------------------------------------
// continueStatus — the continue card's live pre-render status. `label` is
// coarse (stable per kind — safe for aria-live); `detail` carries the
// per-page tick and is rendered aria-hidden.
// ---------------------------------------------------------------------------

test("no preview URL yet → opening", () => {
  expect(
    continueStatus({ hasPreviewUrl: false, rendering: false, renderProgressPage: 0 }),
  ).toEqual({ kind: "opening", label: "Opening your book…", detail: null });
});

test("rendering with no page progress yet → preparing, no detail", () => {
  expect(
    continueStatus({ hasPreviewUrl: true, rendering: true, renderProgressPage: 0 }),
  ).toEqual({ kind: "rendering", label: "Preparing your book…", detail: null });
});

test("rendering mid-layout → per-page progress goes in detail, label stays coarse", () => {
  expect(
    continueStatus({ hasPreviewUrl: true, rendering: true, renderProgressPage: 42 }),
  ).toEqual({ kind: "rendering", label: "Preparing your book…", detail: "page 42…" });
});

test("render settled → ready", () => {
  expect(
    continueStatus({ hasPreviewUrl: true, rendering: false, renderProgressPage: 287 }),
  ).toEqual({ kind: "ready", label: "Your book is ready.", detail: null });
});

// ---------------------------------------------------------------------------
// shouldReshowLanding — the landing as the app's single empty state. The host
// wraps this in a $derived, so it is a pure predicate over workspace state.
// ---------------------------------------------------------------------------

const idle = {
  busy: false,
  hasPreviewUrl: false,
  hasCurrentDir: false,
  hasCurrentUrl: false,
  hasUrlPreviewError: false,
};

test("empty idle workspace → show", () => {
  expect(shouldReshowLanding(idle)).toBe(true);
});

test("an open is in flight (busy) → stay hidden", () => {
  expect(shouldReshowLanding({ ...idle, busy: true })).toBe(false);
});

test("a preview is up → stay hidden", () => {
  expect(shouldReshowLanding({ ...idle, hasPreviewUrl: true })).toBe(false);
});

test("a folder is open → stay hidden", () => {
  expect(shouldReshowLanding({ ...idle, hasCurrentDir: true })).toBe(false);
});

test("a URL preview still loading (currentUrl set, no iframe yet) → stay hidden", () => {
  // Exercises the URL-specific branch on its own: during openUrl's microtask
  // gap the URL is "open" with previewUrl momentarily null and no error —
  // the landing must not flash over it. (A previous version of this suite
  // also set hasPreviewUrl, which short-circuited before the URL branch and
  // let a deletion of that branch pass the tests.)
  expect(shouldReshowLanding({ ...idle, hasCurrentUrl: true })).toBe(false);
});

test("a URL preview failed → show (landing is the error surface)", () => {
  expect(
    shouldReshowLanding({ ...idle, hasCurrentUrl: true, hasUrlPreviewError: true }),
  ).toBe(true);
});
