import { test, expect } from "bun:test";

import {
  PAGEDJS_VERSION,
  PAGEDJS_POLYFILL_MARKER,
  pagedjsPolyfillTag,
  pagedjsPolyfillTagRegex,
} from "./pagedjs-marker";

// The single owned marker is the ONLY contract between the HTML assembler (which
// emits the polyfill slot) and every build/preview rewriter (which finds, strips,
// or replaces it). These tests pin that contract so it stays version- and
// URL-agnostic — a pagedjs version bump or attribute reorder must never silently
// break the strip/replace passes.

test("pagedjsPolyfillTag emits the stable marker attribute, not a live CDN URL", () => {
  const tag = pagedjsPolyfillTag();
  expect(tag).toContain(PAGEDJS_POLYFILL_MARKER);
  // No network dependency baked into core output.
  expect(tag).not.toMatch(/https?:\/\//);
  expect(tag).not.toMatch(/unpkg/);
  // It is a well-formed, self-closing script element.
  expect(tag).toMatch(/^<script\b[^>]*>\s*<\/script>$/);
});

test("the marker regex matches the emitted tag at ANY pagedjs version", () => {
  // The whole point of the refactor: bump the version in ONE place and the
  // matcher still finds the tag. Prove it across a spread of versions.
  for (const version of ["0.4.3", "0.5.0", "1.2.3", "99.99.99", PAGEDJS_VERSION]) {
    const html = `<head>${pagedjsPolyfillTag(version)}</head>`;
    expect(pagedjsPolyfillTagRegex().test(html)).toBe(true);
  }
});

test("the marker regex tolerates reordered / extra attributes", () => {
  const html = `<head><script defer ${PAGEDJS_POLYFILL_MARKER}="0.4.3" id="pf"></script></head>`;
  expect(pagedjsPolyfillTagRegex().test(html)).toBe(true);
});

test("the marker regex still matches a legacy CDN / vendored polyfill src", () => {
  const cdn =
    '<script src="https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js"></script>';
  const vendored = '<script src="./vendor/paged.polyfill.js"></script>';
  expect(pagedjsPolyfillTagRegex().test(cdn)).toBe(true);
  expect(pagedjsPolyfillTagRegex().test(vendored)).toBe(true);
});

test("the marker regex does NOT match the navigation toolbar scripts", () => {
  // pagedjs-interface.js / pagedjs-bridge.js contain the substring "pagedjs" but
  // are NOT the polyfill and must survive the strip pass.
  const iface = '<script src="preview/scripts/pagedjs-interface.js"></script>';
  const bridge = '<script src="preview/scripts/pagedjs-bridge.js"></script>';
  expect(pagedjsPolyfillTagRegex().test(iface)).toBe(false);
  expect(pagedjsPolyfillTagRegex().test(bridge)).toBe(false);
});

test("each call returns a fresh regex (no shared lastIndex state)", () => {
  const html = `<head>${pagedjsPolyfillTag()}</head>`;
  // A stateful global regex reused across calls would flip .test() results.
  expect(pagedjsPolyfillTagRegex().test(html)).toBe(true);
  expect(pagedjsPolyfillTagRegex().test(html)).toBe(true);
});
