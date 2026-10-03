import { beforeAll, expect, test } from "bun:test";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST } from "../../src/routes/api/report/bundle/+server";

beforeAll(() => {
  // The fake host: no book open, no logs root, a test desktop version.
  registerHostServices(makeHostServices());
});

function event(body: unknown): Parameters<typeof POST>[0] {
  return {
    request: new Request("http://local.test/api/report/bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof POST>[0];
}

test("report bundle with no book: system section from the lib, no book, log stated unavailable", async () => {
  // The fake host has no logs root, so the log reads as unavailable.
  const res = await POST(event({ projectDir: null }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { report: string; issueUrl: string };
  expect(body.report).toContain("Gutterpress desktop 0.0.0-test");
  expect(body.report).toContain("- (no book open)");
  expect(body.report).toContain("(app log unavailable)");
  expect(body.issueUrl).toStartWith("https://github.com/dimm-city/gutterpress/issues/new?");
});

test("report bundle rejects a projectDir outside the open project", async () => {
  // The fs-guard throws SvelteKit's HttpError (403); the framework turns it
  // into the response, so under direct invocation it surfaces as a rejection.
  await expect(POST(event({ projectDir: "/definitely/not/open" }))).rejects.toMatchObject({ status: 403 });
});
