import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const viewerRoot = path.resolve(import.meta.dir, "../..");
const main = readFileSync(path.join(viewerRoot, "electron/main.ts"), "utf8");
const preload = readFileSync(path.join(viewerRoot, "electron/preload.ts"), "utf8");
const page = readFileSync(path.join(viewerRoot, "src/routes/+page.svelte"), "utf8");
const builder = readFileSync(path.join(viewerRoot, "electron-builder.yml"), "utf8");

test("builder registers only the .md Markdown association", () => {
  expect(builder).toMatch(/fileAssociations:\s*\n\s*- ext: md\b/);
  expect(builder).toContain("mimeType: text/markdown");
});

test("main handles macOS open-file plus initial and second-instance argv before ready", () => {
  const start = main.indexOf("// ── OS `.md` launches");
  const lifecycle = main.slice(start, main.indexOf("app.whenReady().then", start));
  expect(lifecycle).toContain('app.on("open-file"');
  expect(lifecycle).toContain("event.preventDefault()");
  expect(lifecycle).toContain("markdownFilePathsFromArgv(process.argv, process.cwd())");
  expect(lifecycle).toMatch(/app\.on\("second-instance", \(_event, commandLine, workingDirectory\)/);
  expect(lifecycle).toContain("markdownFilePathsFromArgv(commandLine, workingDirectory || process.cwd())");
});

test("preload installs the push listener before declaring the UI ready", () => {
  const method = preload.slice(
    preload.indexOf("onOpenMarkdownFile:"),
    preload.indexOf("// tpl:*", preload.indexOf("onOpenMarkdownFile:")),
  );
  expect(method.indexOf('forwardPush("app:openMarkdownFile"')).toBeGreaterThan(-1);
  expect(method.indexOf('ipcRenderer.invoke("app:openMarkdownFileReady")')).toBeGreaterThan(
    method.indexOf('forwardPush("app:openMarkdownFile"'),
  );
});

test("renderer reuses the project-open and editor-selection flows and gates normal startup on ready", () => {
  const handler = page.slice(
    page.indexOf("function handleMarkdownFileLaunch"),
    page.indexOf("// ----------------------------------------------------------------", page.indexOf("function handleMarkdownFileLaunch")),
  );
  expect(handler).toContain("await openProjectPath(");
  expect(handler).toContain("await selectEditorFile(event.filePath)");
  expect(handler).toContain("if (!initialFileLaunchSeen) void startup.run()");
  expect(handler).toContain("toast?.error(event.message)");
});
