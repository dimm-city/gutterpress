import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
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
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    const file = join(mkdtempSync(join(tmpdir(), "gp-load-")), "book.html");
    writeFileSync(file, `<img src="${imgUrl}">`);
    expect(await outcome(page.navigate(pathToFileURL(file).href, 1_500))).toContain(imgUrl);
  } finally {
    await browser.close().catch(() => {});
    server.close();
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
