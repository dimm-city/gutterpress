import { test, expect } from "bun:test";
import { getSystemDiagnostics } from "./diagnostics";
import { PACKAGE_VERSION } from "./version";

test("getSystemDiagnostics reports the real lib version, not the runtime-walk 'unknown' fallback", async () => {
  const diag = await getSystemDiagnostics();
  expect(diag.libVersion).toBe(PACKAGE_VERSION);
  expect(diag.libVersion).not.toBe("unknown");
});

test("getSystemDiagnostics reports chromium, gs, and qpdf, each with a non-empty canonical install hint", async () => {
  const diag = await getSystemDiagnostics();
  const byBin = Object.fromEntries(diag.tools.map((t) => [t.bin, t]));

  expect(byBin["chrome / chromium / msedge"]).toBeDefined();
  expect(byBin.gs).toBeDefined();
  expect(byBin.qpdf).toBeDefined();

  for (const tool of diag.tools) {
    expect(tool.installHint.length).toBeGreaterThan(0);
  }

  // The chromium hint keeps its extra "Or set CHROMIUM_PATH=..." line that
  // is specific to the diagnostics/doctor presentation.
  expect(byBin["chrome / chromium / msedge"]!.installHint).toContain("CHROMIUM_PATH");
});

test("getSystemDiagnostics reports platform info alongside the tool list", async () => {
  const diag = await getSystemDiagnostics();
  expect(diag.platform.node).toBe(process.versions.node);
  expect(diag.docsUrl.length).toBeGreaterThan(0);
});
