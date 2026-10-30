#!/usr/bin/env node
/**
 * Book setup › Extensions: the npm update tools, end to end (#479 — restored
 * from 0.11.22 after #442 dropped them).
 *
 * A throwaway book pins one npm extension to an old version. Nothing reaches
 * the real npm: the app runs with `GUTTERPRESS_NPM_REGISTRY` pointed at a
 * registry this script serves on 127.0.0.1 (abbreviated packuments and
 * tarballs it builds itself; every one passes the lib's integrity check except
 * 0.9.0's, on purpose). The native trust prompt is answered in MAIN by a stub
 * of `dialog.showMessageBox` that records each prompt, so every install is
 * seen to pass through the trust gate.
 *
 * Against the BUILT app (out/main/main.js or a packaged exe) it checks that:
 *   1. opening the Extensions tab while npm is unreachable is two quiet lines
 *      ("Couldn't check npm for updates: …", "Couldn't load the version
 *      list."), and the version picker still shows the pin;
 *   2. focusing the picker loads the list again ("Loading versions…"): newest
 *      first, stable only, the pin marked "(current)";
 *   3. Check for updates asks npm again ("Checking npm…" while it runs), and
 *      the row then shows the "1.2.0 available" badge and Update;
 *   4. Include pre-release versions adds 2.0.0-beta.1 to the picker, counts it
 *      as the update, and is saved as the `includeExtensionPrereleases` app
 *      setting; switching it off takes both back;
 *   5. choosing a version asks the trust gate; cancelled, the picker shows the
 *      pin again and the manifest is untouched; accepted, it installs
 *      ("Installing…") and only then re-pins; a version whose install fails
 *      says so and keeps the old pin;
 *   6. Update installs the newer version through the same gate, and Check for
 *      updates then says every package is at its latest version.
 *
 * Screenshots: <dir>/extensions-tab{,-offline,-prerelease,-updated}.png, where
 * <dir> is EXTENSION_UPDATES_SHOTS or the OS temp dir.
 *
 * Usage: node tests/integration/extension-updates.pw.mjs [exe-or-main-js]
 * Exit 0 on pass, 1 on fail.
 */
import { _electron as electron } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { waitForAppWindow } from "./app-window.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));

const log = (m) => console.log(`[extension-updates] ${m}`);
const fail = (m, detail) => {
  throw new Error(detail === undefined ? m : `${m}: ${JSON.stringify(detail)}`);
};
const check = (ok, m, detail) => {
  if (!ok) fail(m, detail);
  log(`ok: ${m}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll `probe` until it returns something truthy; `what` (text, or an async function for the state to report) names it on a timeout. */
async function waitUntil(probe, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const got = await probe();
    if (got) return got;
    await sleep(100);
  }
  fail(`timed out (${ms}ms): ${typeof what === "function" ? await what() : what}`);
}

// ── A fake npm registry ──────────────────────────────────────────────────────
const PKG = "gp-e2e-version-fixture";
const PUBLISHED = ["0.9.0", "1.0.0", "1.1.0", "1.2.0", "2.0.0-beta.1"];
const LATEST = "1.2.0";
/** Its tarball does not match the integrity the registry states. */
const BROKEN = "0.9.0";

/** A minimal ustar archive (what an npm tarball is, before gzip). */
function tar(files) {
  const blocks = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text, "utf8");
    const header = Buffer.alloc(512);
    const put = (offset, length, value) => header.write(value, offset, length, "utf8");
    const octal = (offset, length, value) => put(offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
    put(0, 100, name);
    octal(100, 8, 0o644);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, body.length);
    octal(136, 12, 0);
    header.fill(0x20, 148, 156);
    put(156, 1, "0");
    put(257, 6, "ustar\0");
    put(263, 2, "00");
    const sum = header.reduce((total, byte) => total + byte, 0);
    put(148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
const archives = new Map(
  PUBLISHED.map((version) => [
    version,
    gzipSync(
      tar({
        "package/package.json": JSON.stringify({ name: PKG, version, type: "module", exports: "./index.js" }),
        "package/index.js": "export default function plugin(md) { md.__versionFixture = true; }\n",
      }),
    ),
  ]),
);
const sri = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const registry = { url: "", down: false, delayMs: 0, requests: [] };
const server = createServer(async (req, res) => {
  registry.requests.push(req.url);
  if (registry.delayMs) await sleep(registry.delayMs);
  if (registry.down) {
    res.writeHead(503).end("unavailable");
    return;
  }
  if (req.url === `/${PKG}`) {
    const versions = Object.fromEntries(
      PUBLISHED.map((version) => [
        version,
        {
          name: PKG,
          version,
          dist: {
            tarball: `${registry.url}/${PKG}/-/${PKG}-${version}.tgz`,
            integrity: sri(version === BROKEN ? Buffer.from("not this archive") : archives.get(version)),
          },
        },
      ]),
    );
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: PKG, "dist-tags": { latest: LATEST }, versions }));
    return;
  }
  const tgz = req.url?.match(new RegExp(`^/${PKG}/-/${PKG}-(.+)\\.tgz$`));
  if (tgz && archives.has(tgz[1])) {
    res.writeHead(200, { "content-type": "application/octet-stream" }).end(archives.get(tgz[1]));
    return;
  }
  res.writeHead(404).end("not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
registry.url = `http://127.0.0.1:${server.address().port}`;
log(`fake registry at ${registry.url}`);

// ── A book that pins the package to 1.0.0 ────────────────────────────────────
const target = resolve(process.argv[2] ?? join(desktopDir, "out", "main", "main.js"));
if (!existsSync(target)) fail(`no ${target} — run \`npx vite build && npm run electron:build\` first`);
const isMainJs = target.endsWith(".js");
const shotsDir = resolve(process.env.EXTENSION_UPDATES_SHOTS ?? tmpdir());
mkdirSync(shotsDir, { recursive: true });

const root = mkdtempSync(join(tmpdir(), "gutterpress-extension-updates-"));
const bookDir = join(root, "book");
const homeDir = join(root, "home");
const userDataDir = join(homeDir, "user-data");
mkdirSync(bookDir, { recursive: true });
mkdirSync(userDataDir, { recursive: true });
writeFileSync(join(bookDir, "01-intro.md"), "# Introduction\n\nA book with one extension from npm.\n");
writeFileSync(
  join(bookDir, "manifest.yaml"),
  ['title: "Extension updates fixture"', "source:", "  files:", "    - 01-intro.md", "extensions:", `  - ${PKG}@1.0.0`, ""].join("\n"),
);
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({ lastProjectDir: bookDir, leftPanel: { open: true, activeTab: "toc", width: 300 }, showLandingAtStartup: false }),
);
writeFileSync(join(userDataDir, "app-settings.json"), JSON.stringify({ workspace: { role: "author" } }));
const pinned = () => readFileSync(join(bookDir, "manifest.yaml"), "utf8").match(new RegExp(`${PKG}@([^\\s"']+)`))?.[1];
const vendored = (version) => existsSync(join(bookDir, "extensions", "npm", PKG, version));
const savedPrereleases = () => {
  try {
    return JSON.parse(readFileSync(join(userDataDir, "app-settings.json"), "utf8")).updates?.includeExtensionPrereleases;
  } catch {
    return undefined;
  }
};

let electronApp;
let exitCode = 0;
try {
  log(`launching ${target}`);
  electronApp = await electron.launch({
    executablePath: isMainJs ? require_("electron") : target,
    args: [...(isMainJs ? [target] : []), `--user-data-dir=${userDataDir}`, "--no-sandbox"],
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: join(homeDir, ".config"),
      XDG_CACHE_HOME: join(homeDir, ".cache"),
      XDG_DATA_HOME: join(homeDir, ".local", "share"),
      ELECTRON_DISABLE_GPU: "1",
      GUTTERPRESS_NPM_REGISTRY: registry.url,
    },
    timeout: 90_000,
  });
  // The trust gate is Electron's native message box, which cannot be clicked:
  // answer it here, in MAIN, and keep every prompt it showed.
  await electronApp.evaluate(({ dialog }) => {
    globalThis.__trust = { prompts: [], answer: "install" };
    dialog.showMessageBox = async (...args) => {
      const options = args.find((a) => a && typeof a === "object" && "message" in a) ?? {};
      if (options.title !== "Install npm plugin?") return { response: options.cancelId ?? 0, checkboxChecked: false };
      globalThis.__trust.prompts.push(options.message);
      return { response: globalThis.__trust.answer === "install" ? 1 : 0, checkboxChecked: false };
    };
  });
  const trust = () => electronApp.evaluate(() => globalThis.__trust.prompts);
  const answerTrust = (answer) => electronApp.evaluate((_, a) => { globalThis.__trust.answer = a; }, answer);

  const page = await waitForAppWindow(electronApp);
  page.setDefaultTimeout(10_000);
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())?.setSize(1280, 900);
  });
  await page.locator(".toc-item").first().waitFor({ state: "visible", timeout: 120_000 });
  // Opening the book downloads the pinned copy (from the fake registry), with no prompt.
  await waitUntil(() => vendored("1.0.0"), 60_000, "the open restored the pinned 1.0.0");
  check((await trust()).length === 0, "opening the book restored its pin without a trust prompt");

  /** What the npm row shows: its picker, the badge, Update, the line beside them, and the tab's update lines. */
  const row = () =>
    page.evaluate(() => {
      const panel = document.querySelector("#project-settings-panel");
      const pick = panel?.querySelector(".version-pick");
      const select = pick?.querySelector("select");
      const head = panel?.querySelector(".block-head button");
      return {
        value: select?.value ?? null,
        disabled: select?.disabled ?? null,
        options: select ? [...select.options].map((o) => o.textContent.trim()) : null,
        selected: select?.selectedOptions[0]?.textContent.trim() ?? null,
        badge: pick?.querySelector(".update-badge")?.textContent.trim() ?? null,
        update: [...(pick?.querySelectorAll("button") ?? [])].map((b) => b.textContent.trim()).find((t) => /^Updat/.test(t)) ?? null,
        status: pick?.querySelector(".pick-status")?.textContent.trim() ?? null,
        check: head ? { text: head.textContent.trim(), disabled: head.disabled } : null,
        updateLine: panel?.querySelector(".update-status")?.textContent.trim() ?? null,
        error: panel?.querySelector(".error")?.textContent.trim() ?? null,
        prerelease: panel?.querySelector("#include-prereleases")?.checked ?? null,
      };
    });
  const until = (pred, what, ms = 20_000) =>
    waitUntil(async () => {
      const r = await row();
      return pred(r) ? r : null;
    }, ms, async () => `${what} — last: ${JSON.stringify(await row())}`);
  const shot = async (name) => {
    const file = join(shotsDir, `${name}.png`);
    await page.locator(".app-view").filter({ has: page.locator("#project-settings-panel") }).screenshot({ path: file });
    log(`screenshot: ${file}`);
  };

  // ── 1. the tab opens while npm is unreachable ──────────────────────────────
  registry.down = true;
  await page.locator('[aria-label="Book setup"]').first().click();
  await page.locator("#project-settings-tab-extensions").click();
  let r = await until((x) => x.status === "Couldn't load the version list." && x.updateLine?.startsWith("Couldn't check npm for updates:"), "both npm lookups failed quietly");
  check(r.updateLine.includes("HTTP 503"), "the failed check says why, in one quiet line", r.updateLine);
  check(r.value === "1.0.0" && r.options.join("|") === "1.0.0 (current)", "the picker still shows the pin, marked (current)", r);
  check(r.check?.text === "Check for updates" && !r.check.disabled, "Check for updates is in the list's head", r.check);
  check(r.prerelease === false, "Include pre-release versions is off by default", r);
  check(r.badge === null && r.update === null, "no badge or Update without an answer from npm", r);
  check(!r.error, "nothing blocks the tab", r.error);
  await shot("extensions-tab-offline");

  // ── 2. focusing the picker loads its list again ────────────────────────────
  registry.down = false;
  registry.delayMs = 1200;
  await page.locator("#project-settings-panel .version-pick select").focus();
  await until((x) => x.status === "Loading versions…", "focusing the picker shows Loading versions…");
  r = await until((x) => x.options?.length === 4, "the version list loaded");
  check(r.options.join("|") === "1.2.0|1.1.0|1.0.0 (current)|0.9.0", "newest first, stable only, the pin marked (current)", r.options);
  check(r.value === "1.0.0" && r.status === null, "the picker still selects the pin", r);

  // ── 3. Check for updates asks npm again ────────────────────────────────────
  const asked = registry.requests.length;
  await page.locator("#project-settings-panel .block-head button", { hasText: "Check for updates" }).click();
  r = await until((x) => x.check?.text === "Checking npm…", "the button reads Checking npm… while it runs");
  check(r.check.disabled, "and is disabled meanwhile", r.check);
  r = await until((x) => x.check?.text === "Check for updates" && x.badge !== null, "the check came back");
  check(registry.requests.length > asked, "the button asked the registry again", registry.requests.slice(asked));
  check(r.badge === "1.2.0 available" && r.update === "Update", 'the row shows "1.2.0 available" and Update', r);
  check(r.updateLine === null, "a book with an update has no up-to-date line", r.updateLine);
  registry.delayMs = 0;
  await page.mouse.move(0, 0);
  await shot("extensions-tab");

  // ── 4. Include pre-release versions ────────────────────────────────────────
  await page.locator("#include-prereleases").click();
  r = await until((x) => x.options?.[0] === "2.0.0-beta.1" && x.badge === "2.0.0-beta.1 available", "pre-releases are offered and counted as updates");
  check(r.prerelease === true && r.options.join("|") === "2.0.0-beta.1|1.2.0|1.1.0|1.0.0 (current)|0.9.0", "the picker lists the pre-release first", r.options);
  await waitUntil(() => savedPrereleases() === true, 10_000, "the switch is saved as an app setting");
  check(true, "saved as includeExtensionPrereleases: true in app-settings.json");
  await shot("extensions-tab-prerelease");
  await page.locator("#include-prereleases").click();
  r = await until((x) => x.options?.length === 4 && x.badge === "1.2.0 available", "switching it off takes the pre-release back out");
  await waitUntil(() => savedPrereleases() === false, 10_000, "the switch saved off again");
  check(r.prerelease === false, "off again, and saved", r);

  // ── 5. the version picker installs, behind the trust gate ──────────────────
  await answerTrust("cancel");
  await page.locator("#project-settings-panel .version-pick select").selectOption("1.1.0");
  await waitUntil(async () => (await trust()).length === 1, 10_000, "choosing a version asked the trust gate");
  check((await trust())[0] === `Install ${PKG}@1.1.0?`, "the trust prompt names the exact version", await trust());
  r = await until((x) => x.value === "1.0.0" && x.disabled === false, "a cancelled prompt puts the picker back on the pin");
  check(pinned() === "1.0.0" && !vendored("1.1.0") && !r.error, "and changes nothing", { pin: pinned(), r });

  await answerTrust("install");
  registry.delayMs = 700;
  await page.locator("#project-settings-panel .version-pick select").selectOption("1.1.0");
  r = await until((x) => x.status === "Installing…", "the row reads Installing… while it installs");
  check(r.disabled === true && pinned() === "1.0.0", "the picker is disabled and the pin has not moved yet", { r, pin: pinned() });
  registry.delayMs = 0;
  r = await until((x) => x.selected === "1.1.0 (current)" && x.badge === "1.2.0 available", "the install re-pinned and npm was asked again");
  check(pinned() === "1.1.0" && vendored("1.1.0"), "the manifest pins 1.1.0 once its copy is downloaded", pinned());
  check(r.value === "1.1.0" && !r.error, "the picker shows the new pin", r);

  await page.locator("#project-settings-panel .version-pick select").selectOption(BROKEN);
  r = await until((x) => !!x.error && x.disabled === false, "a failed install says so");
  check(r.error.startsWith(`Couldn't install ${PKG}@${BROKEN}. This book still uses 1.1.0.`), "the error keeps the old pin in plain words", r.error);
  check(r.value === "1.1.0" && pinned() === "1.1.0" && vendored("1.1.0") && !vendored(BROKEN), "the pin and its copy are untouched", { r, pin: pinned() });

  // ── 6. Update, then Check for updates says everything is current ───────────
  await page.locator("#project-settings-panel .version-pick button", { hasText: "Update" }).click();
  r = await until((x) => x.selected === "1.2.0 (current)" && x.badge === null, "Update installed 1.2.0");
  check(pinned() === "1.2.0" && vendored("1.2.0") && !vendored("1.1.0"), "the manifest pins 1.2.0 and the old copy is gone", pinned());
  check(r.update === null && !r.error, "no Update once current", r);
  await page.locator("#project-settings-panel .block-head button", { hasText: "Check for updates" }).click();
  r = await until((x) => x.updateLine === "Every installed package is at its latest version.", "Check for updates confirms the book is current");
  await shot("extensions-tab-updated");

  const prompts = await trust();
  check(
    prompts.join("|") === [`Install ${PKG}@1.1.0?`, `Install ${PKG}@1.1.0?`, `Install ${PKG}@${BROKEN}?`, `Install ${PKG}@1.2.0?`].join("|"),
    "every install from the tab went through the trust gate",
    prompts,
  );
  check(registry.requests.every((u) => u === `/${PKG}` || u.startsWith(`/${PKG}/-/`)), "the registry was only asked for the one package", registry.requests);
  log("PASS");
} catch (error) {
  console.error(`[extension-updates] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await electronApp?.close().catch(() => {});
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
