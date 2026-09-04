/**
 * IPC-handler tests for `electron/api/{manifest,style}.ts` (SFE-P5c2 —
 * migrated off `src/routes/api/{manifest/read,manifest/set-fields,
 * style/set-active}/+server.ts`, both deleted). Ports the deleted routes'
 * real positive round-trips (a real manifest.yaml on disk, not a mocked
 * lib) calling the IPC handler functions directly.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { manifestRead, manifestSetFields } from "../../electron/api/manifest";
import { styleSetActive } from "../../electron/api/style";

let projectDir: string;
let savedHostServices: HostServices | null;

beforeEach(async () => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file.
  savedHostServices = getHostServices();

  projectDir = await mkdtemp(path.join(tmpdir(), "gutterpress-config-ipc-"));
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
  // manifest:* and style:setActive confine their `projectDir` to the
  // host-owned `projectRoots()` allow-list (2026-07-29 audit), so these
  // tests model an OPEN project. Out-of-project rejection lives in
  // project-config-ipc.test.ts.
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [projectDir], readOnlyRoots: () => [] as string[] },
    }),
  );
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

test("manifest:read returns project config fields without missing root exports", async () => {
  expect(await manifestRead(projectDir)).toEqual({
    title: "Old Title",
    authors: ["A. Writer"],
    sourceFiles: ["chapter-01.md"],
  });
});

test("manifest:setFields writes details and returns the updated fields", async () => {
  const result = await manifestSetFields(projectDir, {
    title: "New Title",
    authors: ["B. Writer"],
    sourceFiles: ["intro.md", "chapter-01.md"],
  });
  expect(result).toEqual({
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

test("style:setActive rewrites manifest styles", async () => {
  const result = await styleSetActive(projectDir, ["styles/book.css", "themes/zine/theme.css"]);
  expect(result).toEqual(["styles/book.css", "themes/zine/theme.css"]);
  const yaml = await readFile(path.join(projectDir, "manifest.yaml"), "utf8");
  expect(yaml).toContain("styles:");
  expect(yaml).toContain("styles/book.css");
  expect(yaml).toContain("themes/zine/theme.css");
});
