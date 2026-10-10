import { test, expect } from "bun:test";
import type { ActivityStage } from "../../src/lib/loading/activity-stage";
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

const stage = (over: Partial<ActivityStage>): ActivityStage => ({
  id: "layout",
  label: "Laying out pages…",
  detail: null,
  progress: null,
  ...over,
});

test("no preview URL yet → opening", () => {
  expect(continueStatus({ hasPreviewUrl: false, stage: null })).toEqual({
    kind: "opening",
    label: "Opening your book…",
    detail: null,
  });
  // The open's own stage ("Opening “Book”…") does not replace the card's wording:
  // the card already names the book.
  expect(
    continueStatus({ hasPreviewUrl: false, stage: stage({ id: "opening", label: "Opening Book…" }) }),
  ).toEqual({ kind: "opening", label: "Opening your book…", detail: null });
});

test("the extension download is named on the card before the preview exists", () => {
  expect(
    continueStatus({
      hasPreviewUrl: false,
      stage: stage({
        id: "downloading",
        label: "Downloading extensions (1 of 2)…",
        detail: "gp-x 1.0.0",
      }),
    }),
  ).toEqual({ kind: "opening", label: "Downloading extensions (1 of 2)…", detail: "gp-x 1.0.0" });
});

test("laying out with no page progress yet → the stage's label, no detail", () => {
  expect(continueStatus({ hasPreviewUrl: true, stage: stage({}) })).toEqual({
    kind: "rendering",
    label: "Laying out pages…",
    detail: null,
  });
});

test("laying out mid-way → the page count goes in detail, label stays constant", () => {
  expect(
    continueStatus({ hasPreviewUrl: true, stage: stage({ detail: "42 pages so far" }) }),
  ).toEqual({ kind: "rendering", label: "Laying out pages…", detail: "42 pages so far" });
});

test("no stage left → ready", () => {
  expect(continueStatus({ hasPreviewUrl: true, stage: null })).toEqual({
    kind: "ready",
    label: "Your book is ready.",
    detail: null,
  });
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
