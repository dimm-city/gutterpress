import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "../browser-harness/index.ts";

/**
 * `{...}` attribute trailers land where markdown-it-attrs puts them on the
 * page: straight after a link, emphasis, strong, code span or image, on that
 * element (a TOC's `[Alpha](#alpha){.toc}` styles `a.toc`); after plain text
 * or a space, on the block. The braces are hidden either way.
 */
const entryPath = resolve(import.meta.dir, "support/entry.ts");

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await waitForHarnessReady(harness.page);
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

const SOURCE = [
  "# Contents {#c .x}",
  "[Alpha](#alpha){.toc}",
  "See [Beta](#beta){.toc} and *em*{.x} more.",
  "- [Gamma](#g){.toc}",
  "plain text {.p}",
  "[A](#a) {.q}",
  "literal {not attrs} here",
].join("\n\n") + "\n";

describe("attribute trailers in the editor", () => {
  test("bind to the element they follow, or to the block, as on the page", async () => {
    const { containerSelector } = await harness.page.evaluate((t) => window.__gpGutterpress.mount(t), SOURCE);
    await harness.page.waitForTimeout(200);
    const html = await harness.page.evaluate(
      (sel) =>
        [...document.querySelectorAll(`${sel} .md-document > *`)].map((el) => ({
          cls: [...el.classList].filter((c) => !c.startsWith("md-") && !c.startsWith("gp-")).join(" "),
          id: el.id,
          inner: [...el.querySelectorAll("a, em")].map((x) => `${x.tagName.toLowerCase()}.${x.className}`),
          text: el.textContent?.trim(),
        })),
      containerSelector,
    );
    expect(html).toEqual([
      { cls: "x", id: "c", inner: [], text: "Contents" },
      { cls: "", id: "", inner: ["a.toc"], text: "Alpha" },
      { cls: "", id: "", inner: ["a.toc", "em.x"], text: "See Beta and em more." },
      { cls: "", id: "", inner: ["a.toc"], text: "Gamma" },
      { cls: "p", id: "", inner: [], text: "plain text" },
      { cls: "q", id: "", inner: ["a."], text: "A" },
      { cls: "", id: "", inner: [], text: "literal {not attrs} here" },
    ]);
  });
});
