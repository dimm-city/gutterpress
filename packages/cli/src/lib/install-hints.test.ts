import { test, expect } from "bun:test";
import { INSTALL_HINTS, fullInstallHint } from "./install-hints";

test("INSTALL_HINTS covers chromium, gs, and qpdf with per-platform bodies", () => {
  for (const tool of ["chromium", "gs", "qpdf"] as const) {
    const hint = INSTALL_HINTS[tool];
    expect(hint.label.length).toBeGreaterThan(0);
    expect(hint.body).toContain("macOS:");
    expect(hint.body).toContain("Ubuntu:");
    expect(hint.body).toContain("Windows:");
    // Body is the indented per-platform lines only — no "Install X:" header
    // baked in, so callers can compose it into different shapes.
    expect(hint.body.startsWith("Install")).toBe(false);
  }
});

test("fullInstallHint composes 'Install <label>:' header + body", () => {
  const hint = fullInstallHint("gs");
  expect(hint).toBe(`Install Ghostscript:\n${INSTALL_HINTS.gs.body}`);
  expect(hint).toContain("brew install ghostscript");
});

test("build-runner, diagnostics, and chromium all import the canonical install hints instead of hand-copying them", async () => {
  const files = ["./build-runner.ts", "./diagnostics.ts", "./chromium.ts"];
  for (const rel of files) {
    const src = await Bun.file(new URL(rel, import.meta.url)).text();
    expect(src).toContain('from "./install-hints"');
  }
});
