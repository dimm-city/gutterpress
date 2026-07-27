import { afterEach, expect, spyOn, test } from "bun:test";
import { getSystemDiagnostics } from "./diagnostics";
import { PACKAGE_VERSION } from "./version";
import { defaultConfigDir } from "./remote-auth/token-store";
import * as ghostscriptMod from "./ghostscript";

afterEach(() => {
  (ghostscriptMod.resolveGhostscript as unknown as { mockRestore?: () => void }).mockRestore?.();
});

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
  expect(byBin.gs!.installHint).toContain("GHOSTSCRIPT_PATH");
});

test("getSystemDiagnostics reports platform info alongside the tool list", async () => {
  const diag = await getSystemDiagnostics();
  expect(diag.platform.node).toBe(process.versions.node);
  expect(diag.configDir).toBe(defaultConfigDir());
  expect(diag.docsUrl.length).toBeGreaterThan(0);
});

test("getSystemDiagnostics reports Ghostscript through the shared resolver", async () => {
  const resolved = "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe";
  spyOn(ghostscriptMod, "resolveGhostscript").mockResolvedValue(resolved);

  const diag = await getSystemDiagnostics();
  const ghostscript = diag.tools.find((tool) => tool.id === "gs");

  expect(ghostscript?.found).toBe(true);
  expect(ghostscript?.path).toBe(resolved);
});
