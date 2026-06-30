import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST as readManifest } from "../../src/routes/api/manifest/read/+server";
import { POST as setManifestFields } from "../../src/routes/api/manifest/set-fields/+server";
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
  projectDir = await mkdtemp(path.join(tmpdir(), "pmd-config-route-"));
  await mkdir(path.join(projectDir, "styles"), { recursive: true });
  await writeFile(path.join(projectDir, "styles", "book.css"), "body {}", "utf8");
  await writeFile(
    path.join(projectDir, "manifest.yaml"),
    [
      "title: Old Title",
      "authors:",
      "  - A. Writer",
      "output:",
      "  filename: old.pdf",
      "source:",
      "  files:",
      "    - chapter-01.md",
      "styles:",
      "  - styles/book.css",
      "",
    ].join("\n"),
    "utf8",
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
    outputFilename: "old.pdf",
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
        outputFilename: "new.pdf",
        sourceFiles: ["intro.md", "chapter-01.md"],
      },
    }),
  } as Parameters<typeof setManifestFields>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    title: "New Title",
    authors: ["B. Writer"],
    outputFilename: "new.pdf",
    sourceFiles: ["intro.md", "chapter-01.md"],
  });
  const yaml = await readFile(path.join(projectDir, "manifest.yaml"), "utf8");
  expect(yaml).toContain("title: New Title");
  expect(yaml).toContain("filename: new.pdf");
});

test("style/set-active route rewrites manifest styles", async () => {
  const res = await setActiveStyles({
    request: request({ projectDir, paths: ["styles/book.css", "themes/zine/theme.css"] }),
  } as Parameters<typeof setActiveStyles>[0]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(["styles/book.css", "themes/zine/theme.css"]);
  const yaml = await readFile(path.join(projectDir, "manifest.yaml"), "utf8");
  expect(yaml).toContain("styles:");
  expect(yaml).toContain("styles/book.css");
  expect(yaml).toContain("themes/zine/theme.css");
});
