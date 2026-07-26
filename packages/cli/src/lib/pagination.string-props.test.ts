import { test, expect } from "bun:test";
import { closeUnterminatedCssString } from "./pagination.ts";

/**
 * Unit tests for the quote-normalisation rule applied to Paged.js's
 * `--pagedjs-string-*` inline custom properties immediately before the
 * paginated DOM is serialized to static HTML.
 *
 * Paged.js writes those values with an opening quote and NO closing quote
 * (`"1`). Live that is fine — `setProperty` parses each value in isolation and
 * the CSS tokenizer auto-closes at end-of-value — but serialization joins all
 * four properties into ONE `style` attribute with `;`, so on reparse the first
 * unterminated string swallows the declarations after it and the footer that
 * consumes `content: "C." var(--pagedjs-string-first-…)` renders nothing.
 *
 * The values arrive already CSS-escaped by Paged.js's `cleanPseudoContent`
 * (quotes → `\"` / `\'`, newlines → `\00000A`), so the rule only has to decide
 * whether the string token terminates — honouring backslash escapes — and
 * append a closing quote when it does not.
 */

test("closes a simple unterminated string", () => {
  expect(closeUnterminatedCssString('"1')).toBe('"1"');
  expect(closeUnterminatedCssString('"Chapter 12')).toBe('"Chapter 12"');
});

test("closes an empty unterminated string", () => {
  // Paged.js emits a bare `"` for a page with no matching string-set source.
  expect(closeUnterminatedCssString('"')).toBe('""');
});

test("is idempotent — an already-closed string is returned unchanged", () => {
  expect(closeUnterminatedCssString('"1"')).toBe('"1"');
  expect(closeUnterminatedCssString(closeUnterminatedCssString('"1'))).toBe(
    '"1"'
  );
  expect(closeUnterminatedCssString('""')).toBe('""');
});

test("treats an escaped quote as content, not as the terminator", () => {
  // A title containing a double quote: cleanPseudoContent gives `\"`.
  expect(closeUnterminatedCssString('"The \\"Q\\" Chapter')).toBe(
    '"The \\"Q\\" Chapter"'
  );
  // …and the same value run twice must not gain a second quote.
  expect(
    closeUnterminatedCssString(closeUnterminatedCssString('"The \\"Q\\" Chapter'))
  ).toBe('"The \\"Q\\" Chapter"');
  expect(closeUnterminatedCssString("\"apos\\'trophe")).toBe(
    "\"apos\\'trophe\""
  );
});

test("handles backslashes inside the value", () => {
  // A title containing a backslash. Paged.js does not escape it (an upstream
  // limitation), so `\s` reaches us as a one-character escape — the rule must
  // skip past the escaped character rather than mistaking it for a terminator.
  expect(closeUnterminatedCssString('"Back\\slash')).toBe('"Back\\slash"');
  // An escaped backslash followed by a quote: the quote IS the terminator.
  expect(closeUnterminatedCssString('"Back\\\\"')).toBe('"Back\\\\"');
  // An escaped backslash with no terminator still needs one.
  expect(closeUnterminatedCssString('"Back\\\\')).toBe('"Back\\\\"');
});

test("drops a dangling escape rather than escaping the quote it appends", () => {
  // A trailing lone backslash cannot escape anything (CSS discards it at
  // end-of-input); keeping it would escape our closing quote and leave the
  // string open.
  expect(closeUnterminatedCssString('"trail\\')).toBe('"trail"');
});

test("preserves the escaped-newline form Paged.js emits", () => {
  expect(closeUnterminatedCssString('"multi\\00000Aline')).toBe(
    '"multi\\00000Aline"'
  );
});

test("leaves values that are not a quoted string alone", () => {
  // Every other `--pagedjs-*` custom property holds a length/count/color.
  expect(closeUnterminatedCssString("12px")).toBe("12px");
  expect(closeUnterminatedCssString("")).toBe("");
  expect(closeUnterminatedCssString("counter(page)")).toBe("counter(page)");
});
