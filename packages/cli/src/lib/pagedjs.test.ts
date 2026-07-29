import { test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { patchHtmlForPagedjs, BREAK_INSIDE_HANDLER } from "./pagedjs.ts";
import { pagedjsPolyfillTag, PAGEDJS_POLYFILL_MARKER } from "./pagedjs-marker.ts";

// Regression coverage for ARCH finding #22: patchHtmlForPagedjs must decide
// "is the polyfill slot already present?" using ONLY the stable marker/filename
// regex from pagedjs-marker.ts — never a bare `pagedjs` substring test — and
// must ALWAYS end up with the polyfill script actually injected. The historical
// bug: a document whose body TEXT merely mentions "pagedjs" (e.g. the user
// guide) tripped a bare substring test, so the code believed the polyfill was
// already present, found no marker slot to replace, and injected only the
// break-handler script with no `<script src="...paged.polyfill...">` at all —
// meaning Paged.js itself never loads, `__PAGED_RENDERED__` never fires, and
// the build pipeline stalls for the full poll timeout (finding #19).

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function stageHtml(html: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "gutterpress-pagedjs-test-"));
  const htmlPath = join(dir, "book.html");
  await writeFile(htmlPath, html, "utf8");
  return htmlPath;
}

test("a document with no polyfill slot gets the polyfill script injected", async () => {
  const htmlPath = await stageHtml(
    "<!DOCTYPE html><html><head><title>Book</title></head><body><p>Hello</p></body></html>"
  );
  await patchHtmlForPagedjs(htmlPath, "./vendor/paged.polyfill.js");
  const out = await readFile(htmlPath, "utf8");

  expect(out).toContain('<script src="./vendor/paged.polyfill.js"></script>');
  expect(out).toContain("PagedConfig");
});

test("body text merely mentioning 'pagedjs' does NOT suppress polyfill injection (finding #22)", async () => {
  // No marker, no paged.polyfill filename anywhere — just the bare substring
  // "pagedjs" inside ordinary prose, exactly like the project's own user guide.
  const htmlPath = await stageHtml(
    "<!DOCTYPE html><html><head><title>Book</title></head><body>" +
      "<p>This chapter explains how Paged.js (pagedjs) renders print layouts.</p>" +
      "</body></html>"
  );
  await patchHtmlForPagedjs(htmlPath, "./vendor/paged.polyfill.js");
  const out = await readFile(htmlPath, "utf8");

  // The real polyfill <script src> MUST be present — the bug produced a
  // document with the break handler but no polyfill src at all.
  expect(out).toContain('<script src="./vendor/paged.polyfill.js"></script>');
  expect(out).toContain("PagedConfig");
});

test("navigation toolbar scripts (pagedjs-interface.js / pagedjs-bridge.js) do not count as an existing polyfill", async () => {
  const htmlPath = await stageHtml(
    "<!DOCTYPE html><html><head>" +
      '<script src="preview/scripts/pagedjs-interface.js"></script>' +
      '<script src="preview/scripts/pagedjs-bridge.js"></script>' +
      "</head><body><p>Hi</p></body></html>"
  );
  await patchHtmlForPagedjs(htmlPath, "./vendor/paged.polyfill.js");
  const out = await readFile(htmlPath, "utf8");

  expect(out).toContain('<script src="./vendor/paged.polyfill.js"></script>');
  // Navigation scripts survive untouched.
  expect(out).toContain("pagedjs-interface.js");
  expect(out).toContain("pagedjs-bridge.js");
});

test("an existing stable marker slot is replaced with the handler + local vendor copy", async () => {
  const htmlPath = await stageHtml(
    `<!DOCTYPE html><html><head>${pagedjsPolyfillTag()}</head><body><p>Hi</p></body></html>`
  );
  await patchHtmlForPagedjs(htmlPath, "./vendor/paged.polyfill.js");
  const out = await readFile(htmlPath, "utf8");

  expect(out).not.toContain(PAGEDJS_POLYFILL_MARKER);
  expect(out).toContain('<script src="./vendor/paged.polyfill.js"></script>');
  expect(out).toContain("PagedConfig");
});

test("an existing legacy paged.polyfill src slot is replaced with the handler + local vendor copy", async () => {
  const htmlPath = await stageHtml(
    "<!DOCTYPE html><html><head>" +
      '<script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script>' +
      "</head><body><p>Hi</p></body></html>"
  );
  await patchHtmlForPagedjs(htmlPath, "./vendor/paged.polyfill.js");
  const out = await readFile(htmlPath, "utf8");

  expect(out).not.toContain("unpkg.com");
  expect(out).toContain('<script src="./vendor/paged.polyfill.js"></script>');
  expect(out).toContain("PagedConfig");
});

test("BREAK_INSIDE_HANDLER never appears without the polyfill script alongside it", async () => {
  // Broad guard: whatever branch is taken, the two must travel together. This
  // is the precise shape of the finding #22 defect — handler injected alone.
  const inputs = [
    "<html><head></head><body>mentions pagedjs in prose</body></html>",
    `<html><head>${pagedjsPolyfillTag()}</head><body></body></html>`,
    "<html><head></head><body></body></html>",
  ];
  for (const html of inputs) {
    const htmlPath = await stageHtml(html);
    await patchHtmlForPagedjs(htmlPath, "./vendor/paged.polyfill.js");
    const out = await readFile(htmlPath, "utf8");
    const hasHandler = out.includes(BREAK_INSIDE_HANDLER.slice(0, 40));
    const hasVendorScript = out.includes(
      '<script src="./vendor/paged.polyfill.js"></script>'
    );
    expect(hasHandler).toBe(true);
    expect(hasVendorScript).toBe(true);
    await rm(dir, { recursive: true, force: true });
  }
});
