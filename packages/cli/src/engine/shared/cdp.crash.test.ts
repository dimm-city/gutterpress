import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "./cdp.ts";

/**
 * A Chromium that dies mid-build (the out-of-memory killer takes the renderer
 * or the whole browser) must fail the pending call promptly, not hang it.
 * `hang` is the symptom: nothing ever answers, so the race below wins.
 */

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

const outcome = (p: Promise<unknown>) =>
  Promise.race([
    p.then(() => "RESOLVED", (e: Error) => e.message),
    new Promise<string>((r) => setTimeout(() => r("HUNG"), 12_000)),
  ]);

testIf("a renderer crash rejects the page's pending call", async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    const pending = page.evaluate("new Promise(() => {})");
    await new Promise((r) => setTimeout(r, 200));
    void page.send("Page.crash").catch(() => {});
    expect(await outcome(pending)).toMatch(/Chromium.*(crash|closed)/i);
  } finally {
    await browser.close().catch(() => {});
  }
}, 30_000);

testIf("a killed browser rejects the pending call", async () => {
  const marker = `--gp-test-${randomUUID()}`;
  const browser = await launchChromium({ args: [marker] });
  try {
    const page = await browser.newPage();
    const pending = page.evaluate("new Promise(() => {})");
    await new Promise((r) => setTimeout(r, 200));
    const main = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.includes(marker) && !l.includes("--type="))
      .map((l) => Number(l.trim().split(/\s+/)[0]));
    expect(main).toHaveLength(1);
    process.kill(main[0]!, "SIGKILL");
    expect(await outcome(pending)).toMatch(/Chromium closed/i);
  } finally {
    await browser.close().catch(() => {});
  }
}, 30_000);

testIf("a load that never finishes is an error naming what is still loading", async () => {
  // Accepts the connection and never answers, like an unreachable image host.
  const server = createServer(() => {}).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const imgUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/x.png`;
  const dir = mkdtempSync(join(tmpdir(), "gp-load-"));
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    const file = join(dir, "book.html");
    writeFileSync(file, `<img src="${imgUrl}">`);
    expect(await outcome(page.navigate(pathToFileURL(file).href, 1_500))).toContain(imgUrl);
  } finally {
    await browser.close().catch(() => {});
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

testIf("waitForReady reports false when the gp:ready handshake never comes", async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.navigate("data:text/html,<p>hi</p>");
    await page.evaluate("window.__gpReadyPending = true");
    expect(await page.waitForReady(300)).toBe(false);
    await page.evaluate("window.__gpReadyPending = false");
    expect(await page.waitForReady(300)).toBe(true);
  } finally {
    await browser.close().catch(() => {});
  }
}, 30_000);

/** A book whose image never answers, so its load is still in flight when the browser fails. */
async function loadingPage() {
  const server = createServer(() => {}).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const dir = mkdtempSync(join(tmpdir(), "gp-load-"));
  const file = join(dir, "book.html");
  writeFileSync(file, `<img src="http://127.0.0.1:${(server.address() as { port: number }).port}/x.png">`);
  return {
    url: pathToFileURL(file).href,
    done: () => {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const mainBrowserPid = (marker: string) =>
  Number(
    execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.includes(marker) && !l.includes("--type="))[0]!
      .trim()
      .split(/\s+/)[0],
  );

testIf("a renderer crash during a load fails at once, saying Chromium crashed", async () => {
  const { url, done } = await loadingPage();
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    const pending = page.navigate(url, 60_000);
    await new Promise((r) => setTimeout(r, 500));
    void page.send("Page.crash").catch(() => {});
    expect(await outcome(pending)).toMatch(/Chromium.*crash/i);
  } finally {
    await browser.close().catch(() => {});
    done();
  }
}, 30_000);

testIf("a browser killed during a load fails at once, saying Chromium closed", async () => {
  const { url, done } = await loadingPage();
  const marker = `--gp-test-${randomUUID()}`;
  const browser = await launchChromium({ args: [marker] });
  try {
    const page = await browser.newPage();
    const pending = page.navigate(url, 60_000);
    await new Promise((r) => setTimeout(r, 500));
    process.kill(mainBrowserPid(marker), "SIGKILL");
    expect(await outcome(pending)).toMatch(/Chromium closed/i);
  } finally {
    await browser.close().catch(() => {});
    done();
  }
}, 30_000);

testIf("a renderer killed while printing reports the crash, not a print error", async () => {
  const marker = `--gp-test-${randomUUID()}`;
  const dir = mkdtempSync(join(tmpdir(), "gp-print-"));
  const browser = await launchChromium({ args: [marker] });
  try {
    const page = await browser.newPage();
    const body = Array.from(
      { length: 4000 },
      (_, i) => `<p style="filter:blur(0.5px)">Paragraph ${i} ${"lorem ipsum ".repeat(40)}</p>`,
    ).join("");
    writeFileSync(join(dir, "book.html"), `<!doctype html><html><body>${body}</body></html>`);
    await page.navigate(pathToFileURL(join(dir, "book.html")).href);
    const pending = page.printToPDF();
    await new Promise((r) => setTimeout(r, 300));
    const all = execFileSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((a) => a.length > 2);
    const main = String(mainBrowserPid(marker));
    const zygotes = all.filter((a) => a[1] === main).map((a) => a[0]);
    const renderers = all.filter(
      (a) => zygotes.includes(a[1]!) && a.includes("--type=renderer") && !a.includes("--top-chrome-webui"),
    );
    expect(renderers.length).toBeGreaterThan(0);
    for (const r of renderers) process.kill(Number(r[0]), "SIGKILL");
    expect(await outcome(pending)).toMatch(/Chromium.*crash/i);
  } finally {
    await browser.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

testIf("a navigation that fails is an error at once, not a wait for a load that never comes", async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    expect(await outcome(page.navigate("http://127.0.0.1:1/", 60_000))).toMatch(/Could not load.*ERR_/);
  } finally {
    await browser.close().catch(() => {});
  }
}, 30_000);

testIf("a load that is stuck on nothing visible does not blame a remote image", async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    // A page that stays loading with no image or stylesheet to name: a script that never finishes.
    const server = createServer(() => {}).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const dir = mkdtempSync(join(tmpdir(), "gp-load-"));
    const file = join(dir, "book.html");
    writeFileSync(file, `<script src="http://127.0.0.1:${(server.address() as { port: number }).port}/a.js"></script>`);
    const message = await outcome(page.navigate(pathToFileURL(file).href, 1_500));
    server.close();
    rmSync(dir, { recursive: true, force: true });
    expect(message).toContain("had not finished loading");
    expect(message).not.toContain("remote image");
  } finally {
    await browser.close().catch(() => {});
  }
}, 30_000);

testIf("a browser that cannot be talked to at launch leaves no process and no profile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gp-fake-"));
  const bin = join(dir, "fake-chromium");
  const pidFile = join(dir, "pid");
  // Announces a DevTools URL nothing listens on, then idles like a wedged browser.
  writeFileSync(
    bin,
    `#!/bin/sh\necho $$ > "${pidFile}"\necho "DevTools listening on ws://127.0.0.1:1/devtools/browser/x" >&2\nexec sleep 300\n`,
  );
  chmodSync(bin, 0o755);
  const profiles = () => readdirSync(tmpdir()).filter((n) => n.startsWith("gp-cdp-")).sort();
  const before = profiles();
  const saved = process.env.CHROMIUM_PATH;
  process.env.CHROMIUM_PATH = bin;
  try {
    await expect(launchChromium()).rejects.toBeDefined();
    expect(profiles()).toEqual(before);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    if (saved === undefined) delete process.env.CHROMIUM_PATH;
    else process.env.CHROMIUM_PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
