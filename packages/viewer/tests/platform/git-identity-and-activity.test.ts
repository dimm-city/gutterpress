import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("settings schema and dialog expose git author name and email", () => {
  const shared = read("src/lib/platform/shared-types.ts");
  const contract = read("src/lib/platform/contract.ts");
  const dialog = read("src/lib/components/SettingsDialog.svelte");
  expect(shared).toContain("gitIdentity");
  expect(shared).toContain("authorName");
  expect(shared).toContain("authorEmail");
  expect(contract).toContain("gitIdentity");
  expect(dialog).toContain("Git identity");
  expect(dialog).toContain("set-git-author-name");
  expect(dialog).toContain("set-git-author-email");
});

test("snapshot, history enable, and sync routes pass git identity from settings", () => {
  const saveSnapshot = read("src/routes/api/vcs/save-snapshot/+server.ts");
  const enableHistory = read("src/routes/api/vcs/enable-version-history/+server.ts");
  const sync = read("src/routes/api/remote/sync/+server.ts");
  expect(saveSnapshot).toContain("authorName");
  expect(saveSnapshot).toContain("authorEmail");
  expect(enableHistory).toContain("authorName");
  expect(enableHistory).toContain("authorEmail");
  expect(sync).toContain("authorName");
  expect(sync).toContain("authorEmail");
});

test("source provider supports author email and existing git config fallback", () => {
  const src = read("../cli/src/lib/source-provider.ts");
  expect(src).toContain("authorEmail");
  expect(src).toContain("readGitAuthor");
  expect(src).toContain("user.name");
  expect(src).toContain("user.email");
});

test("sync status details open an editor-side activity view, not the modal", () => {
  const page = read("src/routes/+page.svelte");
  const activity = read("src/lib/components/ProjectActivityView.svelte");
  expect(page).toContain('editorView = "activity"');
  expect(page).toContain("ProjectActivityView");
  expect(page).not.toContain("OperationLogDialog bind:open");
  expect(activity).toContain("Operation log");
  expect(activity).toContain("Version history");
  expect(activity).toContain("api.vcs.listSnapshotsPage");
  expect(activity).toContain("api.log.read");
});

test("taskbar icon path resolves packaged and dev app resources", () => {
  const main = read("electron/main.ts");
  expect(main).toContain("process.resourcesPath");
  expect(main).toContain("build-resources/icon.png");
  expect(main).toContain("../../build-resources/icon.png");
  expect(main).toContain("setAppUserModelId");
});
