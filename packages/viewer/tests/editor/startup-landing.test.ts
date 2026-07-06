import { test, expect } from "bun:test";
import {
  decideStartupScreen,
  continueStatus,
  shouldReshowLanding,
} from "../../src/lib/routes/startup-landing";

// ---------------------------------------------------------------------------
// decideStartupScreen — the launch policy behind the start screen (welcome
// landing). Mirrors the auto-reopen onMount block in +page.svelte.
// ---------------------------------------------------------------------------

test("no previous project → landing is the welcome screen, no reopen", () => {
  expect(
    decideStartupScreen({ lastProjectDir: null, landingEnabled: true }),
  ).toEqual({ showLanding: true, reopenLastProject: false, revealWindowEarly: true });
});

test("no previous project → landing shows even when the pref is off (it IS the empty state)", () => {
  expect(
    decideStartupScreen({ lastProjectDir: null, landingEnabled: false }),
  ).toEqual({ showLanding: true, reopenLastProject: false, revealWindowEarly: true });
});

test("previous project + landing on → show landing, pre-render behind it, reveal window early", () => {
  expect(
    decideStartupScreen({ lastProjectDir: "/books/novel", landingEnabled: true }),
  ).toEqual({ showLanding: true, reopenLastProject: true, revealWindowEarly: true });
});

test("previous project + landing off → pre-landing behavior (splash covers the render)", () => {
  expect(
    decideStartupScreen({ lastProjectDir: "/books/novel", landingEnabled: false }),
  ).toEqual({ showLanding: false, reopenLastProject: true, revealWindowEarly: false });
});

// ---------------------------------------------------------------------------
// continueStatus — the continue card's live pre-render status line.
// ---------------------------------------------------------------------------

test("no preview URL yet → opening", () => {
  expect(
    continueStatus({ hasPreviewUrl: false, rendering: false, renderProgressPage: 0 }),
  ).toEqual({ kind: "opening", label: "Opening your book…" });
});

test("rendering with no page progress yet → preparing", () => {
  expect(
    continueStatus({ hasPreviewUrl: true, rendering: true, renderProgressPage: 0 }),
  ).toEqual({ kind: "rendering", label: "Preparing your book…" });
});

test("rendering mid-layout → per-page progress", () => {
  expect(
    continueStatus({ hasPreviewUrl: true, rendering: true, renderProgressPage: 42 }),
  ).toEqual({ kind: "rendering", label: "Preparing pages — page 42…" });
});

test("render settled → ready", () => {
  expect(
    continueStatus({ hasPreviewUrl: true, rendering: false, renderProgressPage: 287 }),
  ).toEqual({ kind: "ready", label: "Your book is ready." });
});

// ---------------------------------------------------------------------------
// shouldReshowLanding — the landing as the app's single empty state.
// ---------------------------------------------------------------------------

const idle = {
  ready: true,
  visible: false,
  busy: false,
  hasPreviewUrl: false,
  hasCurrentDir: false,
  hasCurrentUrl: false,
  hasUrlPreviewError: false,
};

test("empty idle workspace → reshow", () => {
  expect(shouldReshowLanding(idle)).toBe(true);
});

test("not ready (startup decision hasn't run) → never show", () => {
  expect(shouldReshowLanding({ ...idle, ready: false })).toBe(false);
});

test("already visible → no-op", () => {
  expect(shouldReshowLanding({ ...idle, visible: true })).toBe(false);
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

test("a URL preview is open and healthy → stay hidden", () => {
  expect(
    shouldReshowLanding({ ...idle, hasCurrentUrl: true, hasPreviewUrl: true }),
  ).toBe(false);
});

test("a URL preview failed → reshow (landing is the error surface)", () => {
  expect(
    shouldReshowLanding({ ...idle, hasCurrentUrl: true, hasUrlPreviewError: true }),
  ).toBe(true);
});
