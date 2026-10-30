#!/usr/bin/env node
/**
 * Book setup's Look and Extensions tabs, end to end: the npm update tools
 * (#479) and the rest of what 0.11.22 had there (#482) — both restored after
 * the Book setup redesign (#442) and its follow-ups dropped them.
 *
 * A throwaway book pins one npm extension to an old version, lists a look from
 * a folder (switched off; its package names an author) and a plugin folder
 * that is not there yet. Nothing reaches the real npm: the app runs with
 * `GUTTERPRESS_NPM_REGISTRY` pointed at a registry this script serves on
 * 127.0.0.1 (abbreviated packuments, tarballs it builds itself — every one
 * passes the lib's integrity check except 0.9.0's, on purpose — and a search
 * endpoint). The native trust prompt is answered in MAIN by a stub of
 * `dialog.showMessageBox` that records each prompt, so every install is seen
 * to pass through the trust gate; `shell.openExternal` is stubbed the same way.
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
 * and then (#482) that:
 *   7. the Book tab says what each print check does, as the new-book wizard does;
 *   8. the Look tab names a look's author on its card; a color setting takes
 *      `var(--color-ink)` (and refuses anything that would end the
 *      declaration); "Make an editable copy" copies the built-in look in use
 *      into extensions/zine/ and lists the copy in its place; pointing at a
 *      card shows the enlarged two-page sample in a window wider than 1620 px,
 *      and not in a narrower one;
 *   9. the Extensions tab adds a second built-in look in one click (stacked,
 *      and the Look tab then says the book combines two); a listed built-in
 *      extra's row says what to type; a search result shows name@version, its
 *      npm page link and "Showing N of M"; a package with no default plugin is
 *      installed by its named export; a row shows the lib's notice ("Not found:
 *      …"), and Re-check, in the list's head, reads the list again once the
 *      folder is there and says every extension loads.
 *
 * Screenshots: <dir>/extensions-tab{,-offline,-prerelease,-updated,-restored}.png,
 * <dir>/extensions-search.png, <dir>/book-tab-targets.png and
 * <dir>/look-tab{-builtin,-copy,-hover}.png, where <dir> is EXTENSION_UPDATES_SHOTS or
 * the OS temp dir.
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
/** A plugin with no default export: it loads only by its named export, `full` (like markdown-it-emoji). */
const NAMED = "gp-e2e-named-export";
const namedArchive = gzipSync(
  tar({
    "package/package.json": JSON.stringify({ name: NAMED, version: "1.0.0", type: "module", exports: "./index.js" }),
    "package/index.js": "export function full(md) { md.__namedExport = true; }\n",
  }),
);
/** What the search endpoint has, per keyword the lib asks for, and the totals npm would report. */
const SEARCH = {
  gutterpress: {
    total: 3,
    objects: [{ package: { name: PKG, version: LATEST, description: "Version picker fixture", keywords: ["gutterpress"], links: { npm: `https://www.npmjs.com/package/${PKG}` } }, searchScore: 2 }],
  },
  "markdown-it-plugin": {
    total: 5,
    objects: [{ package: { name: NAMED, version: "1.0.0", description: "A plugin with only a named export", keywords: ["markdown-it-plugin"], links: { npm: `https://www.npmjs.com/package/${NAMED}` } }, searchScore: 1 }],
  },
};
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
  if (req.url === `/${NAMED}`) {
    const version = { name: NAMED, version: "1.0.0", dist: { tarball: `${registry.url}/${NAMED}/-/${NAMED}-1.0.0.tgz`, integrity: sri(namedArchive) } };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: NAMED, "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } }));
    return;
  }
  if (req.url === `/${NAMED}/-/${NAMED}-1.0.0.tgz`) {
    res.writeHead(200, { "content-type": "application/octet-stream" }).end(namedArchive);
    return;
  }
  if (req.url?.startsWith("/-/v1/search?")) {
    const keyword = new URL(req.url, registry.url).searchParams.get("text")?.match(/keywords:(\S+)/)?.[1];
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(SEARCH[keyword] ?? { total: 0, objects: [] }));
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
// A look from a folder, switched off, whose package names its author.
mkdirSync(join(bookDir, "looks", "house"), { recursive: true });
writeFileSync(join(bookDir, "looks", "house", "package.json"), JSON.stringify({ name: "house-style", author: "Ada Lovelace", gutterpress: { styles: ["theme.css"] } }));
writeFileSync(join(bookDir, "looks", "house", "theme.css"), ":root { --color-accent: #0b6e4f; }\n");
writeFileSync(
  join(bookDir, "manifest.yaml"),
  [
    'title: "Extension updates fixture"',
    "source:",
    "  files:",
    "    - 01-intro.md",
    "extensions:",
    `  - ${PKG}@1.0.0`,
    "  - use: ./looks/house",
    "    enabled: false",
    // Not there yet: its row says so until it is, and Re-check finds it.
    "  - ./plugins/later",
    "",
  ].join("\n"),
);
const manifest = () => readFileSync(join(bookDir, "manifest.yaml"), "utf8");
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
  await electronApp.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => {
      globalThis.__opened.push(url);
    };
  });
  const opened = () => electronApp.evaluate(() => globalThis.__opened);
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

  // ══ #482: the rest of what 0.11.22's Look and Extensions tabs did ═════════
  const texts = (selector) =>
    page.evaluate((sel) => [...document.querySelectorAll(`#project-settings-panel ${sel}`)].map((el) => el.textContent.replace(/\s+/g, " ").trim()), selector);
  const resize = (width, height) =>
    electronApp.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => !x.isDestroyed())?.setSize(w, h), [width, height]);
  const shotWindow = async (name) => {
    const file = join(shotsDir, `${name}.png`);
    await page.screenshot({ path: file });
    log(`screenshot: ${file}`);
  };

  // ── 7. Book: what each print check does ────────────────────────────────────
  await page.locator("#project-settings-tab-book").click();
  const targetRows = await waitUntil(
    () =>
      page.evaluate(() => {
        const set = [...document.querySelectorAll("#project-settings-panel fieldset")].find((f) => f.querySelector("legend")?.textContent.includes("Check the PDF against"));
        const rows = set ? [...set.querySelectorAll("label.choice")].map((l) => [l.querySelector(".choice-label")?.textContent.trim(), l.querySelector(".choice-desc")?.textContent.trim() ?? null]) : [];
        return rows.length ? rows : null;
      }),
    10_000,
    "the Book tab's print checks",
  );
  check(
    JSON.stringify(targetRows) ===
      JSON.stringify([
        ["DriveThruRPG (print)", "Checks the finished PDF against DriveThruRPG's print rules."],
        ["itch.io (digital)", "Checks the finished PDF is well-formed with embedded fonts."],
      ]),
    "each print check says what it does, in the new-book wizard's words",
    targetRows,
  );
  await shot("book-tab-targets");

  // ── 8. Look: author, a color as a reference, an editable copy, the sample ──
  await page.locator("#project-settings-tab-look").click();
  const cards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#project-settings-panel .card")].map((c) => ({
        name: c.querySelector(".card-name")?.textContent.trim(),
        notes: [...c.querySelectorAll(".card-note")].map((n) => n.textContent.trim()),
        checked: !!c.querySelector("input")?.checked,
      })),
    );
  let gallery = await waitUntil(async () => ((await cards()).length === 5 ? cards() : null), 10_000, "the look gallery");
  check(gallery.find((c) => c.name === "House style")?.notes.join("|") === "From a folder|By Ada Lovelace", "a look's card names its author", gallery);
  check(gallery.filter((c) => c.notes.length === 0).map((c) => c.name).join("|") === "Clean book|Zine|Technical doc|Academic", "beside the built-in looks", gallery);

  await page.locator("#project-settings-panel .card", { hasText: "Zine" }).click();
  await waitUntil(() => /^ {2}- zine$/m.test(manifest()), 10_000, "choosing Zine lists it");

  const accent = page.locator("#look---color-accent");
  await accent.fill("var(--color-ink); } body { display: none");
  await accent.press("Enter");
  const refused = (await page.locator("#project-settings-panel .color-error").textContent({ timeout: 5_000 })).trim();
  check(refused === "Enter a color like #2b6cb0, or var(--color-ink)", "a color that would end its declaration is refused, saying what to type", refused);
  await accent.fill("var(--color-ink)");
  await accent.press("Enter");
  const bookCss = join(bookDir, "styles", "book.css");
  await waitUntil(() => existsSync(bookCss) && readFileSync(bookCss, "utf8").includes("--color-accent: var(--color-ink);"), 10_000, "the reference is saved");
  check(!readFileSync(bookCss, "utf8").includes("display"), "a color setting takes var(--color-ink), and nothing else reached the stylesheet", readFileSync(bookCss, "utf8"));
  check((await page.locator("#project-settings-panel .color-error").count()) === 0, "the field takes the reference without complaint");

  await shot("look-tab-builtin");
  await page.locator("#project-settings-panel button", { hasText: "Make an editable copy" }).click();
  const copyDir = join(bookDir, "extensions", "zine");
  await waitUntil(() => existsSync(join(copyDir, "theme.css")) && /^ {2}- \.\/extensions\/zine$/m.test(manifest()), 10_000, "the copy landed and is listed");
  check(!/^ {2}- zine$/m.test(manifest()), "Make an editable copy lists the copy in the built-in's place, once", manifest());
  check(JSON.parse(readFileSync(join(copyDir, "package.json"), "utf8")).gutterpress?.styles?.[0] === "theme.css", "the copy has a package.json of its own, declaring its stylesheet");
  gallery = await waitUntil(async () => ((await cards()).find((c) => c.name === "Zine")?.notes[0] === "From a folder" ? cards() : null), 10_000, "the copy's card");
  check(gallery.findIndex((c) => c.name === "Zine") === 1 && gallery[1].checked, "the copy is the look in use, in the built-in's card", gallery);
  check((await page.locator("#project-settings-panel button", { hasText: "Make an editable copy" }).count()) === 0, "a copy is the book's own: nothing more to copy");
  await shot("look-tab-copy");

  const sampleShown = () =>
    page.evaluate(() => {
      const el = document.querySelector(".hover-preview");
      return !!el && getComputedStyle(el).display !== "none" && !!el.querySelector("iframe")?.srcdoc.includes('class="pm-sample-page"');
    });
  const samplePresent = () => page.evaluate(() => !!document.querySelector(".hover-preview"));
  await page.locator("#project-settings-panel .card", { hasText: "Academic" }).hover();
  await waitUntil(samplePresent, 5_000, "pointing at a card prepares the sample");
  check(!(await sampleShown()), "a 1280 px window shows no enlarged sample: it would cover the cards");
  await page.mouse.move(0, 0);
  await resize(1800, 1000);
  await waitUntil(() => page.evaluate(() => window.innerWidth > 1620), 5_000, "the window is wider than 1620 px");
  await page.locator("#project-settings-panel .card", { hasText: "Academic" }).hover();
  await waitUntil(sampleShown, 5_000, "pointing at a card in a wide window shows the two-page sample");
  check(true, "a window wider than 1620 px shows the enlarged two-page sample beside the column");
  await shotWindow("look-tab-hover");
  await page.mouse.move(0, 0);
  await waitUntil(async () => !(await samplePresent()), 5_000, "leaving the card hides the sample");
  await resize(1280, 900);

  // ── 9. Extensions: a second look, what to type, search, a named export, Re-check
  await page.locator("#project-settings-tab-extensions").click();
  const looksToAdd = await waitUntil(async () => ((await texts(".looks .add-name")).length ? texts(".looks .add-name") : null), 10_000, "the built-in looks to add");
  check(looksToAdd.join("|") === "Clean book|Technical doc|Academic", "Add an extension offers the built-in looks the book does not list (Zine is its copy)", looksToAdd);
  await page.locator('[aria-label="Add the Academic look"]').click();
  await waitUntil(() => /- \.\/extensions\/zine\n {2}- academic\n/.test(manifest()), 10_000, "Academic is listed after the book's look");
  await waitUntil(async () => !(await texts(".looks .add-name")).includes("Academic"), 10_000, "and leaves the Add area");
  check(true, "a second built-in look is one click, stacked last so it wins ties");
  await page.locator("#project-settings-tab-look").click();
  const combined = (await page.locator("#project-settings-panel .notice-box p").first().textContent()).trim();
  check(combined === "This book combines 2 looks: Zine, Academic. Change them in Extensions.", "the Look tab says the book combines the two", combined);
  await page.locator("#project-settings-tab-extensions").click();

  await page.locator('[aria-label="Add Highlight"]').click();
  const highlight = await waitUntil(
    async () =>
      (
        await page.evaluate(() =>
          [...document.querySelectorAll("#project-settings-panel .item-list li")].map((li) => ({
            label: li.querySelector(".item-label")?.textContent.trim(),
            code: [...li.querySelectorAll(".what-to-type code")].map((c) => c.textContent),
          })),
        )
      ).find((x) => x.label === "Highlight"),
    10_000,
    "Highlight is a row of the list",
  );
  check(highlight.code.join("|") === "==double equals==", "a listed built-in extra's row says what to type", highlight);

  await page.locator("#search-npm").fill("named");
  await page.locator("#search-npm").press("Enter");
  const found = await waitUntil(
    async () => {
      const x = await page.evaluate(() => ({
        status: document.querySelector("#project-settings-panel .search-status")?.textContent.trim() ?? null,
        names: [...document.querySelectorAll("#project-settings-panel .results .result-name")].map((n) => n.textContent.trim()),
      }));
      return x.names.length ? x : null;
    },
    10_000,
    "the search results",
  );
  check(found.names.join("|") === `${NAMED}@1.0.0` && found.status === "Showing 1 of 8.", 'a search result reads name@version, under "Showing N of M"', found);
  await page.locator("#project-settings-panel .results .result-link").first().click();
  await waitUntil(async () => (await opened()).length > 0, 5_000, "the npm page link opens");
  check((await opened()).join("|") === `https://www.npmjs.com/package/${NAMED}`, "its npm page link opens the package's page", await opened());
  await shot("extensions-search");

  const exactRow = page.locator("#project-settings-panel .add-row", { has: page.locator("#add-npm") });
  await page.locator("#add-npm").fill(NAMED);
  await exactRow.locator("button").click();
  const noDefault = (await page.locator("#project-settings-panel .error").first().textContent({ timeout: 20_000 })).trim();
  check(!manifest().includes(NAMED), "without its export, a package with no default plugin is not added", noDefault);
  await page.locator("#add-npm-export").fill("full");
  await exactRow.locator("button").click();
  await waitUntil(() => new RegExp(`use: ${NAMED}@1\\.0\\.0\\n {4}export: full`).test(manifest()), 20_000, async () => `the named export is installed — ${manifest()}`);
  check((await page.locator("#project-settings-panel .error").count()) === 0, "with its named export (full) it installs and loads", manifest());

  const laterRow = () =>
    page.evaluate(() => {
      const li = [...document.querySelectorAll("#project-settings-panel .item-list li")].find((x) => x.querySelector(".item-label")?.getAttribute("title") === "./plugins/later");
      return li
        ? {
            warnings: [...li.querySelectorAll(".ext-note.warning")].map((w) => w.textContent.trim()),
            problem: li.querySelector(".ext-note.problem span")?.textContent.trim() ?? null,
          }
        : null;
    });
  const later = await laterRow();
  check(
    later?.warnings.length === 1 && later.warnings[0].startsWith("Not found: ") && later.warnings[0].endsWith(join("plugins", "later")) && later.problem === "Couldn't load.",
    "a row shows the lib's notice about it",
    later,
  );
  check((await page.locator("#project-settings-panel .recheck-status").count()) === 0, "and nothing says every extension loads");
  mkdirSync(join(bookDir, "plugins", "later"), { recursive: true });
  writeFileSync(join(bookDir, "plugins", "later", "package.json"), JSON.stringify({ name: "later", type: "module", main: "index.js" }));
  writeFileSync(join(bookDir, "plugins", "later", "index.js"), "export default function later(md) { md.__later = true; }\n");
  await page.locator("#project-settings-panel .block-head button", { hasText: "Re-check" }).click();
  await waitUntil(async () => {
    const x = await laterRow();
    return x && x.warnings.length === 0 && x.problem === null;
  }, 15_000, async () => `Re-check found the folder — ${JSON.stringify(await laterRow())}`);
  const allLoad = (await page.locator("#project-settings-panel .recheck-status").textContent({ timeout: 10_000 })).trim();
  check(allLoad === "Every extension loads.", "Re-check, in the list's head, reads the list again and says every extension loads", allLoad);
  await shot("extensions-tab-restored");

  const laterPrompts = (await trust()).slice(4);
  check(laterPrompts.join("|") === [`Install ${NAMED}?`, `Install ${NAMED}?`].join("|"), "both named-export installs went through the trust gate", laterPrompts);
  check(
    registry.requests.every((u) => u === `/${PKG}` || u.startsWith(`/${PKG}/-/`) || u === `/${NAMED}` || u.startsWith(`/${NAMED}/-/`) || u.startsWith("/-/v1/search?")),
    "the registry was only asked for the fixture packages and the search",
    registry.requests,
  );
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
