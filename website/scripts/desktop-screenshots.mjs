#!/usr/bin/env node
/**
 * desktop-screenshots.mjs — retake the screenshots in docs/desktop-guide/images/
 * from the real desktop app, so the how-to guides show the app as it is.
 *
 *   npm run screenshots            # from website/ (needs the app built, see below)
 *   xvfb-run -a node scripts/desktop-screenshots.mjs   # headless Linux / CI
 *
 * It launches the built Electron app (packages/desktop/out/ + build/) with an
 * isolated profile, opens a throwaway copy of the user guide set up to show
 * every screen at its best (a few book snippets, some version history, one
 * missing image for the Problems panel), clicks through the screens the guides
 * describe, and writes each one cropped and resized as a JPEG. Cropping and
 * resizing use Electron's own nativeImage, so nothing else is needed.
 *
 * Build the app first (from packages/desktop):
 *   bun run --cwd ../cli build:library && npx vite build && npx electron-vite build
 * and make sure Electron's binary is downloaded (node install.js in
 * node_modules/electron). The Pages workflow does both before it runs this.
 *
 * A screen that fails is reported and its committed image is left alone; the
 * script exits 1 if any did, so a broken selector is noticed.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const desktop = join(repo, "packages/desktop");
const outDir = join(repo, "docs/desktop-guide/images");
const { _electron } = createRequire(join(desktop, "package.json"))("playwright-core");

const electronBin = join(desktop, "node_modules/electron/dist/electron");
for (const [path, hint] of [
  [join(desktop, "out/main/main.js"), "build the app (see the header of this script)"],
  [join(desktop, "build/client"), "build the app (see the header of this script)"],
  [electronBin, "download Electron: node install.js in packages/desktop/node_modules/electron"],
]) {
  if (!existsSync(path)) throw new Error(`desktop-screenshots: missing ${path} — ${hint}`);
}

// ── the demo book ───────────────────────────────────────────────────────

const work = mkdtempSync(join(tmpdir(), "gp-shots-"));
const book = join(work, "Gutterpress User Guide");
const home = join(work, "home");
cpSync(join(repo, "examples/gutterpress-user-guide"), book, { recursive: true });
mkdirSync(join(book, "snippets"));
const snippets = {
  "pull-quote.md": "@section .pull-quote\n\n> {{quote}}\n\n— {{speaker}}\n\n@end-section\n",
  "chapter-opener.md": "@chapter {{number}}\n\n# {{title}}\n\n{{opening paragraph}}\n",
  "two-columns.md": "@columns 2\n\nWrite the first column here. It flows into the second column on its own.\n\n@end-columns\n",
  "tip.md": "> [!TIP]\n> {{tip}}\n",
};
for (const [name, body] of Object.entries(snippets)) writeFileSync(join(book, "snippets", name), body);

// Version history, so "Where your work is kept" and Previous versions have
// something to show. The fixture is test data, so plain git is fine here.
const git = (...args) => {
  const r = spawnSync("git", args, {
    cwd: book,
    env: { ...process.env, GIT_AUTHOR_NAME: "Ada Writer", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada Writer", GIT_COMMITTER_EMAIL: "ada@example.com" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};
git("init", "-q");
git("add", "-A");
git("commit", "-qm", "Start the user guide");
writeFileSync(join(book, "08-publishing.md"), "\n", { flag: "a" });
git("commit", "-qam", "Edit Publishing");
// One missing image, so the Problems panel has a problem to show.
const ch1 = join(book, "01-getting-started.md");
writeFileSync(ch1, readFileSync(ch1, "utf8").replace("## Installation", "![A map of the book](images/map.png)\n\n## Installation"));
git("commit", "-qam", "Add a map");

// ── the app ─────────────────────────────────────────────────────────────

const W = 1440, H = 900;
const app = await _electron.launch({
  executablePath: electronBin,
  args: ["--no-sandbox", "--disable-gpu", "out/main/main.js"],
  cwd: desktop,
  env: { ...process.env, HOME: home },
  timeout: 60_000,
});
const page = await app.firstWindow();
page.setDefaultTimeout(8000);
await (await app.browserWindow(page)).evaluate((win, [w, h]) => win.setSize(w, h), [W, H]);
await page.waitForTimeout(4000);

const failures = [];
/** Screenshot the window, crop and resize it in Electron, and write a JPEG. */
async function shot(name, { crop, width } = {}) {
  await page.waitForTimeout(1200);
  const png = (await page.screenshot()).toString("base64");
  const jpeg = await app.evaluate(({ nativeImage }, [b64, c, w]) => {
    let img = nativeImage.createFromBuffer(Buffer.from(b64, "base64"));
    if (c) img = img.crop({ x: c[0], y: c[1], width: c[2], height: c[3] });
    if (w && img.getSize().width > w) img = img.resize({ width: w, quality: "best" });
    return img.toJPEG(82).toString("base64");
  }, [png, crop, width]);
  writeFileSync(join(outDir, `${name}.jpg`), Buffer.from(jpeg, "base64"));
  console.log(`  ✓ ${name}.jpg`);
}
/** One screen: run the steps, then shoot. A failure is reported, not fatal. */
async function screen(name, steps, opts) {
  try {
    await steps();
    await shot(name, opts);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}: ${error.message.split("\n")[0]}`);
  }
}
const click = (sel) => page.click(sel);
const press = (key) => page.keyboard.press(key);
const wait = (ms) => page.waitForTimeout(ms);

const CENTRE = [360, 60, 720, 560];        // a start-screen column
const DIALOG = [450, 170, 540, 560];        // the new-book wizard
const SETTINGS = [240, 0, 960, 900];        // a full-window settings page
const TALL = [360, 40, 720, 720];           // Publish / Where your work is kept

console.log("desktop-screenshots: start screen and new book");
await screen("start-screen", async () => {}, { crop: CENTRE, width: 760 });
await screen("settings", () => click(".landing button:has-text('Settings')"), { crop: [370, 50, 700, 620], width: 700 });
await press("Escape");
await wait(800);
await screen("new-book-name", async () => {
  await click("button:has-text('Create a new book')");
  // The wizard needs a title before Next does anything.
  await page.fill("input[placeholder='My First Book']", "Harbor Lights");
  await page.fill("input[placeholder='Your name']", "Ada Writer");
}, { crop: DIALOG });
await screen("new-book-template", () => click("button:text-is('Next')"), { crop: DIALOG });
await screen("new-book-print", () => click("button:text-is('Next')"), { crop: DIALOG });
await press("Escape");
await wait(800);

console.log("desktop-screenshots: the workspace");
await page.fill("input[placeholder^='Search your books']", book);
await press("Enter");
await wait(10_000); // the preview paginates the whole book
await screen("workspace-edit", async () => {
  await click("button:has-text('Getting Started')");
  await wait(2500);
}, { width: 1200 });
await screen("workspace-read", async () => {
  await click("button:has-text('Read')");
  await wait(2000);
  for (let i = 0; i < 3; i++) await press("PageDown");
  await wait(1500);
}, { width: 1200 });
await click("button:has-text('Edit')");
await wait(2000);
await screen("left-panel-files", () => click("button:has-text('Files')"), { crop: [0, 0, 640, 500] });
await click("button:has-text('TOC')");
await screen("problems-panel", async () => {
  await click("[aria-label^='Problems']");
  await wait(1500);
}, { width: 1200 });
await press("Escape");
await screen("snippet-picker", async () => {
  await press("Control+Shift+S");
  await wait(1200);
}, { width: 1200 });
await screen("snippet-fill", async () => {
  await page.fill("input[placeholder^='Search snippets']", "quote");
  await press("Enter");
  await wait(1000);
}, { width: 1200 });
await press("Escape");
await press("Escape");
await wait(600);

console.log("desktop-screenshots: Book setup");
await screen("book-settings-details", async () => {
  await click("[aria-label='Book setup']");
  await wait(1500);
}, { crop: SETTINGS, width: 960 });
// Further down the Book tab: the page size and the margins.
await screen("book-settings-page", async () => {
  await page.locator("#details-margin-outside").scrollIntoViewIfNeeded();
  await wait(600);
}, { crop: SETTINGS, width: 960 });
// The demo book lists no extensions, so choose a look and tick an extra: Look
// then shows the look's six settings beside the sample page, and Advanced
// lists both.
await screen("book-settings-design", async () => {
  await click("[role=tab]:has-text('Look')");
  await click("input[name='book-look'][value='clean-book']");
  await wait(2500); // a choice is written once it stops changing
  await page.locator("label:has-text('Highlight') input[type=checkbox]").check();
  await wait(1500);
  await page.locator(".app-view :text('Choose a look')").first().scrollIntoViewIfNeeded();
}, { crop: SETTINGS, width: 960 });
await screen("book-settings-extensions", () => click("[role=tab]:has-text('Advanced')"), { crop: SETTINGS, width: 960 });
// Take both out again, so the preview in the shots below is unchanged. A
// removed row takes the focus with it, so close with the X, not Esc.
await click("[aria-label='Remove Highlight']");
await click("[aria-label='Remove Clean book']");
await wait(1500);
await click("[aria-label='Close this screen']");
await wait(800);

console.log("desktop-screenshots: publishing and versions");
await screen("publish-format", async () => {
  await click("button:has-text('Publish')");
  await wait(1500);
}, { crop: [360, 40, 720, 640], width: 760 });
await screen("publish-choose", () => click("button:text-is('Next')"), { crop: TALL, width: 760 });
await press("Escape");
await wait(800);
await screen("where-your-work-is-kept", () => click("button:has-text('Edits saved')"), { crop: TALL, width: 760 });
await screen("previous-versions", async () => {
  await click("button:has-text('See previous versions')");
  await wait(2000);
}, { width: 1200 });

await app.close();
rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.error(`desktop-screenshots: ${failures.length} screen(s) failed, their images left as they were: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`desktop-screenshots: done → ${outDir}`);
