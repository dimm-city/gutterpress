import { expect, test } from "bun:test";
import { buildNativePdf } from "./engine";
import { REQUIRED_MILESTONE, type Browser } from "../engine/shared/cdp.ts";

/**
 * The pooled/external-Chromium path gets its milestone floor enforced inside
 * `connectChromium`. An injected `engineBrowser` (the desktop, driving
 * Electron's own Chromium) never goes through `connectChromium`, so without an
 * explicit check the one hard guarantee the engine makes — "only paginate on a
 * milestone this compiler was actually measured against" — would be silently
 * unenforced on exactly the host that supplies its own browser.
 */
function fakeBrowser(milestone: number, onClose: () => void): Browser {
  return {
    wsUrl: "test://injected",
    version: `Chrome/${milestone}.0.0.0`,
    milestone,
    newPage: async () => {
      throw new Error("should never be reached — the milestone check runs first");
    },
    close: async () => onClose(),
  } as unknown as Browser;
}

test("buildNativePdf rejects a host-supplied browser below REQUIRED_MILESTONE", async () => {
  let closed = false;
  await expect(
    buildNativePdf("/nonexistent.html", "/nonexistent.pdf", {}, async () =>
      fakeBrowser(REQUIRED_MILESTONE - 1, () => {
        closed = true;
      })
    )
  ).rejects.toThrow(new RegExp(`requires Chromium ${REQUIRED_MILESTONE}\\+`));
  // …and it hands the browser back rather than leaking the host's window.
  expect(closed).toBe(true);
});

test("buildNativePdf accepts a host-supplied browser AT REQUIRED_MILESTONE", async () => {
  // Gets past the floor and fails later, in `build()` — proving the check
  // itself did not reject the version Electron actually ships.
  await expect(
    buildNativePdf("/nonexistent.html", "/nonexistent.pdf", {}, async () =>
      fakeBrowser(REQUIRED_MILESTONE, () => {})
    )
  ).rejects.toThrow(/should never be reached|ENOENT|--engine native failed/);
});
