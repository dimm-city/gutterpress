/**
 * #221 C8 — PublishWizard's PDF/Website radio group. A plain
 * `checked={controller.effectiveFormat(card) === fmt}` binding never re-runs
 * when `selectFormat()` throws (nothing it reads changes), so the clicked
 * radio stayed visually checked even though the save failed and the
 * controller's real format never changed. The fix threads the wizard's
 * in-flight optimistic pick through `displayedFormat`, which is what
 * `chosenFormat` in PublishWizard.svelte now derives from — these pin its
 * contract directly (no Svelte render harness exists in this repo; see
 * publish-wizard.test.ts's source-text convention for the component-wiring
 * half of this fix).
 */
import { expect, test } from "bun:test";
import { displayedFormat } from "../../src/lib/publish-format-choice";

test("displayedFormat shows the in-flight optimistic pick while one is pending", () => {
  expect(displayedFormat("html", "pdf")).toBe("html");
});

test("displayedFormat falls back to the actual (controller) format once no pick is pending", () => {
  expect(displayedFormat(undefined, "pdf")).toBe("pdf");
  expect(displayedFormat(undefined, "html")).toBe("html");
});

test("a failed selectFormat's revert-to-undefined shows the UNCHANGED actual format, not the clicked option (#221 C8)", () => {
  // Simulates PublishWizard's chooseFormat(): click "html" while on "pdf" →
  // selectFormat throws → the wizard's `finally` clears the pending pick back
  // to undefined. The controller's real format never changed.
  const actual: "pdf" | "html" = "pdf";
  let pending: "pdf" | "html" | undefined;

  pending = "html"; // optimistic click
  expect(displayedFormat(pending, actual)).toBe("html");

  pending = undefined; // `finally` clears it — save failed, actual is still "pdf"
  expect(displayedFormat(pending, actual)).toBe("pdf");
});

test("a successful selectFormat's revert-to-undefined agrees with the now-updated actual format", () => {
  // On success the controller's format itself becomes "html" (via
  // setConfig + loadPublish) before `finally` clears the pending pick, so
  // the displayed value stays "html" throughout — no visible flicker back
  // to "pdf".
  let actual: "pdf" | "html" = "pdf";
  let pending: "pdf" | "html" | undefined;

  pending = "html";
  expect(displayedFormat(pending, actual)).toBe("html");

  actual = "html"; // the successful save landed
  pending = undefined; // `finally` clears the optimistic pick
  expect(displayedFormat(pending, actual)).toBe("html");
});
