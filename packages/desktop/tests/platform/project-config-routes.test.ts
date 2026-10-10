import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as readManifest } from "../../src/routes/api/manifest/read/+server";
import { POST as setManifestFields } from "../../src/routes/api/manifest/set-fields/+server";
import { POST as readPageSize } from "../../src/routes/api/page-size/read/+server";
import { POST as setPageSize } from "../../src/routes/api/page-size/set/+server";
import { POST as setActiveStyles } from "../../src/routes/api/style/set-active/+server";

let projectDir: string;

function request(body: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "gutterpress-config-route-"));
  await mkdir(path.join(projectDir, "styles"), { recursive: true });
  await writeFile(path.join(projectDir, "styles", "book.css"), "body {}", "utf8");
  await writeFile(
    path.join(projectDir, "manifest.yaml"),
    [
      "title: Old Title",
      "authors:",
      "  - A. Writer",
      "source:",
      "  files:",
      "    - chapter-01.md",
      "styles:",
      "  - styles/book.css",
      "",
    ].join("\n"),
    "utf8",
  );
  // manifest/* and style/set-active confine their `projectDir` to the
  // host-owned `projectRoots()` allow-list, so these tests
  // now have to model an OPEN project. Out-of-project rejection itself lives
  // in route-scoping.test.ts.
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [] as string[] },
    }),
  );
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

test("manifest/read route returns project config fields without missing root exports", async () => {
  const res = await readManifest({ request: request({ projectDir }) } as Parameters<typeof readManifest>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    title: "Old Title",
    authors: ["A. Writer"],
    sourceFiles: ["chapter-01.md"],
  });
});

test("manifest/set-fields route writes details and returns the updated fields", async () => {
  const res = await setManifestFields({
    request: request({
      projectDir,
      updates: {
        title: "New Title",
        authors: ["B. Writer"],
        sourceFiles: ["intro.md", "chapter-01.md"],
      },
    }),
  } as Parameters<typeof setManifestFields>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    title: "New Title",
    authors: ["B. Writer"],
    sourceFiles: ["intro.md", "chapter-01.md"],
  });
  const yaml = await readFile(path.join(projectDir, "manifest.yaml"), "utf8");
  expect(yaml).toContain("title: New Title");
  expect(yaml).toContain("- intro.md");
  // Artifact naming is a convention now (lib/output-paths.ts), not a manifest
  // field — nothing here may write an `output:` block back.
  expect(yaml).not.toContain("output:");
});

test("style/set-active route rewrites manifest styles", async () => {
  const res = await setActiveStyles({
    request: request({ projectDir, paths: ["styles/book.css", "extensions/zine/theme.css"] }),
  } as Parameters<typeof setActiveStyles>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(["styles/book.css", "extensions/zine/theme.css"]);
  const yaml = await readFile(path.join(projectDir, "manifest.yaml"), "utf8");
  expect(yaml).toContain("styles:");
  expect(yaml).toContain("styles/book.css");
  expect(yaml).toContain("extensions/zine/theme.css");
});

// ── page-size (#357) ─────────────────────────────────────────────────────────

test("page-size routes read the size back, then change the manifest and the stylesheet together", async () => {
  await writeFile(path.join(projectDir, "manifest.yaml"), "title: T\npreset: book\nstyles:\n  - styles/book.css\n", "utf8");
  await writeFile(path.join(projectDir, "styles", "book.css"), "/* mine */\n@page { size: 6in 9in; margin: 1in }\n", "utf8");

  const read = await readPageSize({ request: request({ projectDir }) } as Parameters<typeof readPageSize>[0]);
  expect(await read.json()).toEqual({
    preset: "book",
    bounds: { width: 432, height: 648, tolerance: 0.5 },
    css: { width: 432, height: 648, file: "styles/book.css" },
  });

  const res = await setPageSize({
    request: request({ projectDir, choice: { preset: "custom", page: { width: 612, height: 792 } } }),
  } as Parameters<typeof setPageSize>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    preset: "custom",
    bounds: { width: 612, height: 792, tolerance: 0.5 },
    css: { width: 612, height: 792, file: "styles/book.css" },
  });
  expect(await readFile(path.join(projectDir, "styles", "book.css"), "utf8")).toBe(
    "/* mine */\n@page { size: 8.5in 11in; margin: 1in }\n",
  );
  expect(await readFile(path.join(projectDir, "manifest.yaml"), "utf8")).toContain("preset: custom");
});

test("page-size/set rejects a missing choice and an incomplete custom size without writing", async () => {
  await expect(
    setPageSize({ request: request({ projectDir }) } as Parameters<typeof setPageSize>[0]),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    setPageSize({
      request: request({ projectDir, choice: { preset: "custom" } }),
    } as Parameters<typeof setPageSize>[0]),
  ).rejects.toMatchObject({ status: 500 });
  expect(await readFile(path.join(projectDir, "styles", "book.css"), "utf8")).toBe("body {}");
});
