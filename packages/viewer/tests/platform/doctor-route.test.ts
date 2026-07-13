import { expect, test } from "bun:test";
import { GET } from "../../src/routes/api/doctor/+server";

// L10: the doctor route must exclude the bundled-Chromium diagnostic entry
// from the "external tools" list by matching a stable machine id
// (ToolStatus.id === "chromium"), not the human-readable display string
// ("chrome / chromium / msedge") — rewording that label must not silently
// make Help -> System tools tell desktop users to install Chrome.

function event(): Parameters<typeof GET>[0] {
  return {
    request: new Request("http://local.test/api/doctor"),
  } as Parameters<typeof GET>[0];
}

test("doctor route reports exactly one Chromium-flavored tool entry (the bundled Electron one), keyed off ToolStatus.id", async () => {
  const res = await GET(event());
  expect(res.status).toBe(200);
  const body = await res.json();

  const chromiumFlavored = (body.tools as Array<{ id?: string; bin: string }>).filter(
    (t) => t.bin === 'electron' || t.bin === 'chrome / chromium / msedge',
  );
  // The lib's own "chrome / chromium / msedge" diagnostic entry must have been
  // filtered out by id, leaving only the viewer's injected Electron entry.
  expect(chromiumFlavored).toHaveLength(1);
  expect(chromiumFlavored[0]!.bin).toBe('electron');

  // The other lib-reported tools (gs, qpdf) must still be present untouched.
  const bins = (body.tools as Array<{ bin: string }>).map((t) => t.bin);
  expect(bins).toContain('gs');
  expect(bins).toContain('qpdf');
});

test("doctor route response includes viewerVersion/libVersion/docsUrl fields", async () => {
  // electronVersion/chromeVersion come from `process.versions.{electron,chrome}`,
  // which are only populated inside a real Electron process — undefined (and thus
  // absent after JSON serialization) under plain `bun test`. That's environment-
  // dependent, not something this route controls, so it isn't asserted here.
  const res = await GET(event());
  const body = await res.json();
  expect(body).toHaveProperty('viewerVersion');
  expect(body.viewerVersion).toBe('unknown'); // getDoctorHooks() isn't registered in tests
  expect(body).toHaveProperty('libVersion');
  expect(body).toHaveProperty('docsUrl');
});
