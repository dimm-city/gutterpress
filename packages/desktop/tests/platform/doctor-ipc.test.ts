/**
 * IPC-handler tests for `electron/api/doctor.ts` (SFE-P5c4 — migrated off
 * `src/routes/api/doctor/+server.ts`, deleted). Ports the deleted
 * `doctor-route.test.ts` verbatim, calling `doctorGetDiagnostics()`
 * directly instead of the SvelteKit route's `GET` handler.
 *
 * L10: the doctor handler must exclude the bundled-Chromium diagnostic
 * entry from the "external tools" list by matching a stable machine id
 * (`ToolStatus.id === "chromium"`), not the human-readable display string
 * ("chrome / chromium / msedge") — rewording that label must not silently
 * make Help -> System tools tell desktop users to install Chrome.
 */
import { afterEach, expect, test } from "bun:test";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { doctorGetDiagnostics } from "../../electron/api/doctor";

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

test("doctor handler reports exactly one Chromium-flavored tool entry (the bundled Electron one), keyed off ToolStatus.id", async () => {
  const body = await doctorGetDiagnostics();

  const chromiumFlavored = body.tools.filter(
    (t) => t.bin === "electron" || t.bin === "chrome / chromium / msedge",
  );
  // The lib's own "chrome / chromium / msedge" diagnostic entry must have
  // been filtered out by id, leaving only the desktop's injected Electron
  // entry.
  expect(chromiumFlavored).toHaveLength(1);
  expect(chromiumFlavored[0]!.bin).toBe("electron");

  // The other lib-reported tools (gs, qpdf) must still be present untouched.
  const bins = body.tools.map((t) => t.bin);
  expect(bins).toContain("gs");
  expect(bins).toContain("qpdf");
});

test("doctor handler response includes versions, docs, and the existing config directory", async () => {
  // electronVersion/chromeVersion come from `process.versions.{electron,chrome}`,
  // which are only populated inside a real Electron process — undefined
  // under plain `bun test`. That's environment-dependent, not something
  // this handler controls, so it isn't asserted here.
  const body = await doctorGetDiagnostics();
  expect(body).toHaveProperty("desktopVersion");
  expect(body.desktopVersion).toBe("unknown"); // getDoctorHooks() isn't registered in tests
  expect(body).toHaveProperty("libVersion");
  expect(body).toHaveProperty("configDir");
  expect(body.configDir).toContain("gutterpress");
  expect(body).toHaveProperty("docsUrl");
});
