import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(__dirname, "../..", path), "utf8");
}

test("manual macOS update action reaches both available-update buttons", () => {
  const controller = source("src/lib/update/update-controller.svelte.ts");
  const page = source("src/routes/+page.svelte");
  const landing = source("src/lib/components/WelcomeLanding.svelte");

  expect(controller).toContain("this.availableAction = status.availableAction");
  expect(controller).toContain("this.availableAction = event.action");
  expect(page).toContain('updateController.availableAction === "open-release"');
  expect(page).toContain("Download from GitHub");
  expect(landing).toContain('updateAvailableAction === "open-release"');
  expect(landing).toContain("Download from GitHub");
});

test("macOS update UI remains PWA-clean", () => {
  for (const path of [
    "src/lib/update/update-controller.svelte.ts",
    "src/routes/+page.svelte",
    "src/lib/components/WelcomeLanding.svelte",
    "src/lib/components/HelpContent.svelte",
  ]) {
    const contents = source(path);
    expect(contents).not.toMatch(/from ["']node:/);
    expect(contents).not.toMatch(/from ["']electron["']/);
    expect(contents).not.toMatch(/window\.electron|ipcRenderer/);
  }
});
