import { mountGutterpressWebview } from "../../../src/webview/index.ts";
import { createFakeExtensionHost } from "./fake-extension-host.ts";

/**
 * SFE-P3c Lane C — the CSP/inertness browser entry
 * (`tests/webview/csp-inertness.btest.ts`, run spec DETAILS #4c).
 *
 * WHY A RECONSTRUCTED CSP, NOT AN IMPORT (see this file's own comment below
 * and this run's report for the same account): `../../../src/provider.ts`'s
 * `renderWebviewHtml` imports `"vscode"` as a VALUE, so it cannot be bundled
 * into this browser-target entry at all — attempting to would fail the
 * build the same way importing any Node-extension-host module into a
 * browser bundle would. This file therefore RECONSTRUCTS the same CSP
 * DIRECTIVE RECIPE `renderWebviewHtml` emits (copied, not derived) and
 * injects it as this page's OWN `<meta http-equiv="Content-Security-Policy">`
 * tag, as the FIRST thing this module does — before `mountGutterpressWebview`
 * (the real production entry point, `../../../src/webview/index.ts`) ever
 * runs.
 *
 * This is ONE of the two options this run's DETAILS #4c offers ("EITHER
 * inject the provider's exact CSP meta into the harness page and assert the
 * sentinel, OR assert inertness through the mount's own inert-text posture
 * AND separately assert renderWebviewHtml's CSP string pins"). Chosen
 * because it gives REAL, LIVE evidence that a same-shaped CSP actually
 * blocks the concrete vectors CSP exists to stop, in a real browser —
 * stronger evidence than a string-pin alone. The COMPLEMENTARY string-pin
 * half already exists, unmodified, as `tests/provider.test.ts`'s
 * `renderWebviewHtml` describe block (default-src 'none', the <script> tag
 * carrying the SAME nonce as the CSP directive, the <base> tag) — see this
 * run's report for exactly which half each suite proves.
 *
 * A `<meta>` CSP tag inserted via script (not server-delivered or parsed
 * from static HTML) still governs everything that happens in the document
 * AFTER it is inserted — this is standard, spec'd Chromium behavior, not an
 * assumption; this file's own script (whose `<script type="module">` tag
 * was itself served with no CSP in effect yet) is unaffected by inserting
 * it, while everything the exposed `window.__gpCsp` driver does later is
 * governed by it.
 */

declare global {
  interface Window {
    __gpCsp: GutterpressCspHarnessDriver;
    __gpReady?: boolean;
    __gpCspNoncedRan?: boolean;
    __gpCspUnnoncedRan?: boolean;
    __gpCspOnerrorRan?: boolean;
  }
}

export interface GutterpressCspHarnessDriver {
  readonly nonce: string;
  readonly containerSelector: string;
  /** Every `securitypolicyviolation` event observed so far, as
   *  `"<violatedDirective>: <blockedURI>"` strings — corroborating
   *  evidence that a blocked sentinel was genuinely BLOCKED BY CSP, not
   *  merely unset for an unrelated reason. */
  violations(): readonly string[];
  /** Positive control: a `<script>` element carrying the SAME nonce as the
   *  CSP directive. Must execute — proves the CSP is actually enforced
   *  (not merely present-but-ignored), so the negative cases below are not
   *  vacuous. */
  runNoncedScript(): void;
  /** Simulates a script payload landing in the document's rendered
   *  markdown/generated HTML: a `<script>` element with NO nonce. Must be
   *  blocked. */
  runUnnoncedScript(): void;
  /** Simulates a common inline-event-handler XSS vector (`onerror="..."`)
   *  that plugin/generated HTML could carry. A nonce covers `<script>`
   *  ELEMENTS only, never inline event-handler attributes — with no
   *  `'unsafe-inline'`/`'unsafe-hashes'` in `script-src`, this is blocked
   *  unconditionally, independent of the nonce. */
  triggerOnerrorPayload(): void;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const nonce = randomNonce();

// The SAME directive recipe as ../../../src/provider.ts's renderWebviewHtml
// (default-src 'none', nonced script-src, unsafe-inline style-src — see
// that function's own CSP comment for the full rationale of each line).
// img-src/font-src/base-uri use 'self' here: this harness page has no
// asWebviewUri-scoped cspSource equivalent, and this suite does not
// exercise those two directives (tests/provider.test.ts's own base-uri
// case already covers that string).
const meta = document.createElement("meta");
meta.httpEquiv = "Content-Security-Policy";
meta.content = [
  "default-src 'none'",
  "base-uri 'self'",
  `script-src 'nonce-${nonce}'`,
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
].join("; ");
document.head.appendChild(meta);

const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
});

const root = document.createElement("div");
root.id = "gp-editor-root";
document.body.appendChild(root);

// The REAL production entry point, mounted through the SAME fake-host
// machinery every other suite in this directory uses — proving the CSP
// coexists with an actual live mount, not just an empty page.
const { transport } = createFakeExtensionHost("hello CSP", { mode: "rich" });
mountGutterpressWebview(root, transport);

window.__gpCsp = {
  nonce,
  containerSelector: "#gp-editor-root",
  violations: () => violations.slice(),
  runNoncedScript(): void {
    const script = document.createElement("script");
    // Set via the IDL property, not setAttribute("nonce", ...): browsers
    // deliberately do not reflect the nonce attribute back to
    // getAttribute() (so an XSS payload cannot read and reuse it), and only
    // the property assignment is reliably honored for a script element
    // created and inserted dynamically, which is exactly this case.
    script.nonce = nonce;
    script.textContent = "window.__gpCspNoncedRan = true;";
    document.body.appendChild(script);
  },
  runUnnoncedScript(): void {
    const script = document.createElement("script");
    script.textContent = "window.__gpCspUnnoncedRan = true;";
    document.body.appendChild(script);
  },
  triggerOnerrorPayload(): void {
    const img = document.createElement("img");
    img.setAttribute("onerror", "window.__gpCspOnerrorRan = true;");
    // Not a decodable image and not same-origin network-fetchable -- fails
    // to load either way, which is all this case needs: an error event to
    // give the inline handler its one chance to run.
    img.src = "data:image/png;base64,not-a-real-image";
    document.body.appendChild(img);
  },
};
window.__gpReady = true;
