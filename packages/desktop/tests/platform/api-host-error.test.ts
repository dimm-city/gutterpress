import { expect, test } from "bun:test";
import { hostErrorMessage } from "../../src/lib/api";

// `$lib/api`'s post/get throw the response text for a non-OK reply. When that
// text is the app:// proxy's HTML error page (the loopback request itself
// failed), a component must get a sentence, not a page of markup — the
// GitHub "Open book" dialog displayed the raw <!doctype html> in 0.11.10-alpha.3.

test("an HTML error page becomes one sentence carrying the page's detail", () => {
  const page = `<!doctype html><html><body><main><h1>Gutterpress ran into a problem</h1>
<p>A request to the app's internal server failed.</p><p><code>TypeError: fetch failed &#39;x&#39; &amp; &quot;y&quot;</code></p></main></body></html>`;
  expect(hostErrorMessage("text/html; charset=utf-8", page)).toBe(
    `The app's internal server didn't answer. (TypeError: fetch failed 'x' & "y")`,
  );
});

test("an HTML page without a detail still reads as a sentence", () => {
  expect(hostErrorMessage("text/html", "<html><body><p>nope</p></body></html>")).toBe(
    "The app's internal server didn't answer.",
  );
});

test("a route's own JSON error body passes through untouched", () => {
  expect(hostErrorMessage("application/json", '{"message":"path is outside the open book"}')).toBe(
    '{"message":"path is outside the open book"}',
  );
  expect(hostErrorMessage(null, "plain")).toBe("plain");
});
