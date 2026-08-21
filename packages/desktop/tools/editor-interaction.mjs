#!/usr/bin/env node
/**
 * EDITOR INTERACTION checks — does the rich surface respond to a pointer?
 *
 * Every other editor gate is a parse/serialize measurement: they prove a
 * document survives a round trip, and they are blind to whether an author can
 * DO anything to it. That blindness is not theoretical. Rich mode shipped
 * unable to adjust an image at all — no selection affordance, no properties,
 * nothing — and every byte-level gate was green the whole time, because
 * nothing in the suite had ever clicked on anything.
 *
 * So this drives the PACKAGED app with a real pointer and asserts what an
 * author would notice. It is deliberately small: a handful of interactions
 * that must work, each failing with the thing that did not happen, rather
 * than a broad UI suite nobody maintains.
 *
 * ## Running it
 *
 *   npm run interaction -- --book /path/to/book --file 01-chapter.md
 *
 * Options mirror `editor-parity.mjs`:
 *   --book <dir>     project directory (the folder holding manifest.yaml)
 *   --file <name>    chapter to open; defaults to the first .md file
 *   --keep-parent    stage the book's PARENT directory too, for a project
 *                    whose plugins or styles live in a sibling folder
 *   --out <dir>      where the failure screenshot goes (default ./parity-report)
 *
 * On a headless machine, run it under a virtual display:
 *   xvfb-run -a npm run interaction -- --book …
 *
 * Exits non-zero on the first check that fails, with a screenshot of the app
 * at that moment — the state a stack trace cannot describe.
 */
import { _electron as electron } from "playwright-core";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const BOOK = opt("book") ? resolve(opt("book")) : null;
if (!BOOK) {
  console.error("usage: npm run interaction -- --book <project dir> [--file <chapter.md>]");
  process.exit(2);
}
const OUT = resolve(opt("out", "parity-report"));
const DESKTOP = resolve(dirname(new URL(import.meta.url).pathname), "..");
const MAIN = join(DESKTOP, "out", "main", "main.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[interaction] ${m}`);

// A disposable copy, so a run that types into a book cannot touch the
// author's files — the same staging `editor-parity.mjs` does.
const stage = mkdtempSync(join(tmpdir(), "gp-interaction-"));
let book;
if (flag("keep-parent")) {
  cpSync(dirname(BOOK), stage, { recursive: true });
  book = join(stage, basename(BOOK));
} else {
  cpSync(BOOK, stage, { recursive: true });
  book = stage;
}
const FILE =
  opt("file") ??
  readdirSync(book)
    .filter((f) => f.endsWith(".md"))
    .sort()[0];
if (!FILE) {
  console.error(`no .md files in ${BOOK}`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "gp-interaction-home-"));
const userData = join(home, "userData");
mkdirSync(userData, { recursive: true });
writeFileSync(
  join(userData, "gutterpress-settings.json"),
  JSON.stringify({ editor: { mode: "rich" }, preview: { viewMode: "single" } }),
);
writeFileSync(
  join(userData, "gutterpress-prefs.json"),
  JSON.stringify({
    lastProjectDir: book,
    leftPanel: { open: false },
    showLandingAtStartup: false,
    viewMode: "single",
  }),
);

const app = await electron.launch({
  args: [MAIN, `--user-data-dir=${userData}`, "--no-sandbox"],
  cwd: DESKTOP,
  env: { ...process.env, HOME: home, ELECTRON_DISABLE_GPU: "1" },
});

let failures = 0;
let page = null;

/** Assert, and keep going — one run should report every broken interaction. */
async function check(what, fn) {
  try {
    const detail = await fn();
    log(`ok    ${what}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failures++;
    log(`FAIL  ${what} — ${err.message}`);
    await page?.screenshot({ path: join(OUT, `interaction-fail-${failures}.png`) }).catch(() => {});
  }
}

try {
  for (let i = 0; i < 120 && !page; i++) {
    page = app.windows().find((w) => w.url().startsWith("app://"));
    if (!page) await sleep(500);
  }
  if (!page) throw new Error("the app window never appeared");
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1500, height: 1000 });
  for (let i = 0; i < 120; i++) {
    if (
      await page.evaluate(
        () => !!document.querySelector('button[aria-label="Toggle markdown editor"]'),
      )
    ) {
      break;
    }
    await sleep(1000);
  }
  await sleep(4000);

  // The tidy prompt opens over the editing pane and swallows clicks meant for
  // the document, so it is dismissed before and after opening the chapter.
  const dismissTidy = () =>
    page
      .evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((x) => /decide later/i.test(x.textContent || ""))
          ?.click();
      })
      .catch(() => {});

  await page.evaluate(() =>
    document.querySelector('button[aria-label="Toggle markdown editor"]').click(),
  );
  await sleep(3000);
  await dismissTidy();
  await sleep(2000);
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll(".file-item .file-name")].find(
      (x) => x.textContent.trim() === name,
    );
    (el?.closest(".file-item") ?? el)?.click();
  }, FILE);
  await sleep(6000);
  await dismissTidy();
  await sleep(1000);

  const handle = await page.$("iframe.rich-editor");
  const frame = handle ? await handle.contentFrame() : null;
  if (!frame) throw new Error("the rich editor never mounted (is the file rich-editable?)");

  // ── typing ───────────────────────────────────────────────────────────────
  await check("typing into a paragraph reaches the document", async () => {
    const at = await frame.evaluate(() => {
      const p = [...document.querySelectorAll(".gp-editor-page-flow p")].find(
        (x) => (x.textContent || "").trim().length > 20,
      );
      if (!p) return null;
      p.scrollIntoView({ block: "center" });
      const r = p.getBoundingClientRect();
      return { x: r.left + 8, y: r.top + r.height / 2, before: p.textContent };
    });
    if (!at) throw new Error("no paragraph to type into");
    const rect = await page.evaluate(() => {
      const r = document.querySelector("iframe.rich-editor").getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    await page.mouse.click(rect.left + at.x, rect.top + at.y);
    await sleep(400);
    await page.keyboard.type("Zq ");
    await sleep(800);
    const typed = await frame.evaluate(() =>
      [...document.querySelectorAll(".gp-editor-page-flow p")].some((x) =>
        (x.textContent || "").includes("Zq "),
      ),
    );
    if (!typed) throw new Error("the typed text never appeared in the document");
    // Put it back, so the rest of the run measures the author's own book.
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await sleep(400);
    return "text in, text out";
  });

  // ── images ───────────────────────────────────────────────────────────────
  // The interaction that shipped missing: an author could not select an image,
  // let alone change how it sits on the page.
  await check("clicking an image selects it and offers its options", async () => {
    const at = await frame.evaluate(() => {
      const img = [...document.querySelectorAll(".gp-editor-page-flow img")].find(
        (x) => x.getBoundingClientRect().width > 40,
      );
      if (!img) return null;
      img.scrollIntoView({ block: "center" });
      const r = img.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!at) throw new Error("no image in this chapter to click");
    await sleep(600);
    const rect = await page.evaluate(() => {
      const r = document.querySelector("iframe.rich-editor").getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    await page.mouse.click(rect.left + at.x, rect.top + at.y);
    await sleep(1200);
    const selected = await frame.evaluate(
      () => !!document.querySelector(".ProseMirror-selectednode"),
    );
    if (!selected) throw new Error("clicking the image did not select it");
    const chrome = await page.evaluate(() => !!document.querySelector('[aria-label="Image"]'));
    if (!chrome) throw new Error("the image was selected but no options appeared");
    return "selected, options offered";
  });

  await check("the image dialog opens on the real image and applies", async () => {
    await page.evaluate(() => {
      document
        .querySelector('[aria-label="Image"] button')
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await sleep(1200);
    const src = await page.evaluate(() => {
      const input = document.querySelector('.image-properties input[name="src"]');
      return input ? input.value : null;
    });
    if (src == null) throw new Error("the image-properties dialog did not open");
    if (!src.trim()) throw new Error("the dialog opened blank instead of on the selected image");
    await page.evaluate(() => {
      const select = document.querySelector(".image-properties select");
      select.value = "gp-right";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const form = document.querySelector(".image-properties");
      form.requestSubmit();
    });
    await sleep(2500);
    const applied = await frame.evaluate(() =>
      [...document.querySelectorAll(".gp-editor-page-flow img")].some((x) =>
        (x.getAttribute("class") || "").split(/\s+/).includes("gp-right"),
      ),
    );
    if (!applied) throw new Error("the chosen position never reached the image");
    return `on ${src}`;
  });

  // ── plugin regions ───────────────────────────────────────────────────────
  // Not that they are editable (they are not yet — see docs/remaining-work.md),
  // but that they are not showing the author their own markdown as text.
  await check("plugin regions show the plugin's markup, not raw source", async () => {
    const raw = await frame.evaluate(() => {
      // The opaque regions specifically: `pluginAtomView` renders them
      // uneditable, where a layout wrapper or a paired plugin block carries
      // `data-marker` on an EDITABLE container. Matching `[data-marker]`
      // alone counts those too, which is how this check first reported "83
      // regions, none showing source" on a chapter that has no regions at all.
      const atoms = [
        ...document.querySelectorAll('.gp-editor-page-flow [data-marker][contenteditable="false"]'),
      ];
      const suspect = atoms.filter((el) => {
        const text = (el.textContent || "").trim();
        return /^(@\w|\||#{1,6} |\d+\. )/.test(text) && text.includes("\n");
      });
      return {
        total: atoms.length,
        suspect: suspect.length,
        sample: suspect[0]?.textContent?.slice(0, 60) ?? null,
      };
    });
    // A check with nothing to check is not a pass. Say which chapter to point
    // it at rather than reporting green on an empty set.
    if (raw.total === 0) {
      throw new Error(
        `no plugin regions in ${FILE} — point --file at a chapter that has some, or this check proves nothing`,
      );
    }
    if (raw.suspect > 0) {
      throw new Error(
        `${raw.suspect} of ${raw.total} regions render as markdown source (e.g. ${JSON.stringify(raw.sample)})`,
      );
    }
    return `${raw.total} regions, none showing source`;
  });

  // ── the page itself ──────────────────────────────────────────────────────
  await check("pages are painted, not blank white paper", async () => {
    const sheet = await frame.evaluate(() => {
      const el = document.querySelector(".gp-editor-sheet");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.backgroundColor, image: cs.backgroundImage };
    });
    if (!sheet) throw new Error("no page sheet was painted at all");
    const blank =
      sheet.image === "none" &&
      (sheet.color === "rgb(255, 255, 255)" || sheet.color === "rgba(0, 0, 0, 0)");
    // A book that genuinely has white pages is not a failure, so this reports
    // rather than fails — what it catches is the engine layer going missing,
    // which shows up as EVERY book suddenly having white pages.
    return blank ? "white (check the book's own @page/canvas background)" : "painted";
  });
} catch (err) {
  failures++;
  log(`FAIL  setup — ${err.message}`);
  await page?.screenshot({ path: join(OUT, "interaction-fail-setup.png") }).catch(() => {});
} finally {
  await app.close();
}

log(failures === 0 ? "all interaction checks passed" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
