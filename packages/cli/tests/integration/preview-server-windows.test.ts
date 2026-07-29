/**
 * End-to-end smoke for startPreviewServer.
 *
 * Boots the preview server against a real on-disk fixture (using the
 * platform's native path separators — backslashes on Windows), then
 * fetches the served book.html and asserts the response is a sane page.
 *
 * The desktop's /api/preview route is a thin wrapper around this call, so
 * a passing test here proves the directory-load path the user hits in
 * the Electron desktop.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startPreviewServer, type PreviewServerHandle } from "../../src/server.ts";

const FIXTURE_DIR = resolve(__dirname, "../../../cli/tests/integration/fixtures/smoke");

let active: PreviewServerHandle | null = null;

afterEach(async () => {
  if (active) {
    await active.stop().catch(() => {});
    active = null;
  }
});

async function copyFixtureToTemp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gutterpress-itest-"));
  // cp recursively to a fresh tempdir — simulates the user opening an
  // arbitrary project directory anywhere on the filesystem.
  await cp(FIXTURE_DIR, root, { recursive: true });
  return root;
}

describe("startPreviewServer end-to-end (matches desktop's /api/preview path)", () => {
  it("loads a directory referenced by its native absolute path and serves book.html", async () => {
    const projectDir = await copyFixtureToTemp();

    active = await startPreviewServer({
      input: projectDir,
      port: 0,
      host: "127.0.0.1",
      noWatch: true,
      openBrowser: false,
      verbose: false,
      debug: false,
      installSignalHandlers: false,
    });

    expect(active.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(active.port).toBeGreaterThan(0);

    // The desktop's iframe loads `book.html` directly. If this returns
    // anything other than 200 with a non-trivial HTML body, the Electron
    // desktop's preview iframe shows a broken page.
    const res = await fetch(`${active.url}/book.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("<html");
    expect(html).toContain("Smoke Test");
  });

  it("inlines a stylesheet shared from a sibling directory via a relative ../ path", async () => {
    // A project layout with a shared design system alongside it (the DC design
    // guide shape). The cross-platform concern this test exists for is intact:
    // the `../`-relative path must resolve on Windows (backslash separators)
    // as well as POSIX. What changed is the MECHANISM — the shared stylesheet
    // is no longer mirrored into a temp root under its basename; it is READ and
    // inlined into book.html, so there is no copy, no flattening, and no second
    // place for it to go missing.
    const root = await mkdtemp(join(tmpdir(), "gutterpress-itest-shared-"));
    const sharedDir = join(root, "_shared", "css");
    const projectDir = join(root, "book");
    await mkdir(sharedDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(sharedDir, "print.css"), "body { color: black; }\n");
    await writeFile(
      join(projectDir, "manifest.yaml"),
      [
        "title: Shared Assets Test",
        "styles:",
        "  - ../_shared/css/print.css",
        "",
      ].join("\n")
    );
    await writeFile(
      join(projectDir, "chapter-01.md"),
      "# Shared Assets Test\n\nBody text for layout.\n"
    );

    active = await startPreviewServer({
      input: projectDir,
      port: 0,
      host: "127.0.0.1",
      noWatch: true,
      openBrowser: false,
      verbose: false,
      debug: false,
      installSignalHandlers: false,
    });

    const res = await fetch(`${active.url}/book.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Shared Assets Test");

    // The shared stylesheet's RULES are in the document itself — proof the
    // `../`-relative path resolved — and nothing is <link>ed.
    expect(html).toContain("color: black");
    expect(html).not.toContain('<link rel="stylesheet"');
  });
});
