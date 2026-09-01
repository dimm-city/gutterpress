import { test, expect } from "bun:test";
import { friendlyPublishError } from "../../src/lib/errors";

// friendlyPublishError (M41) maps the raw text that reaches PublishSection —
// either a publish-route catch's `e.message` (ProjectConfigPanel) or a
// `PublishRunResult.error` string — to plain-language guidance, mirroring
// friendlyPdfError's approach: recognized technical shapes (a butler/swa
// exit code + log tail, a raw Shopify HTTP/GraphQL failure) get a short
// summary with the original text preserved as `details` for a "Show details"
// disclosure; messages the host/lib already wrote in plain author language
// pass through unchanged with no details to hide.

// ── Already-friendly lib/host messages pass through verbatim ────────────────

test("friendlyPublishError passes an itch.io no-key message through unchanged", () => {
  const msg = "No itch.io API key found. Connect itch.io (or set BUTLER_API_KEY) first.";
  expect(friendlyPublishError(msg)).toEqual({ summary: msg });
});

test("friendlyPublishError passes an itch.io rejected-key message through unchanged", () => {
  const msg =
    "itch.io didn't accept the API key. Create one under itch.io → Settings → API keys and try again.";
  expect(friendlyPublishError(msg)).toEqual({ summary: msg });
});

test("friendlyPublishError passes the Azure SWA CLI install hint through unchanged", () => {
  const msg =
    "Install the Azure SWA CLI first: `npm install -g @azure/static-web-apps-cli` (needs Node.js), or set SWA_CLI_PATH to the swa binary.";
  expect(friendlyPublishError(msg)).toEqual({ summary: msg });
});

test("friendlyPublishError passes a Shopify rejected-token message through unchanged", () => {
  const msg =
    "Shopify rejected the access token. Re-create the custom app token (with write_products scope) and reconnect.";
  expect(friendlyPublishError(msg)).toEqual({ summary: msg });
});

test("friendlyPublishError passes the host's generic internal-failure fallback through unchanged", () => {
  // electron/server-bridge/friendly-errors.ts's handlePublishErrors terse
  // fallback for anything NOT on its own author-language allowlist — the
  // real cause is already redacted host-side, so there's nothing left to
  // hide behind "Show details".
  const msg = "Publishing could not be completed. See the app log for details.";
  expect(friendlyPublishError(msg)).toEqual({ summary: msg });
});

test("friendlyPublishError passes the preflight-blocked summary through unchanged", () => {
  const msg = "Preflight found problems that block publishing.";
  expect(friendlyPublishError(msg)).toEqual({ summary: msg });
});

test("friendlyPublishError passes manifest-key guidance through unchanged", () => {
  const msg = 'Set the itch.io project in the manifest: publish.itch.target: "user/game".';
  expect(friendlyPublishError(msg)).toEqual({ summary: msg });
});

// ── Real technical failure shapes get a friendly summary + details ──────────

test("friendlyPublishError maps a butler push failure to a friendly summary with details", () => {
  const raw = "butler push failed (exit 1).\nerror: invalid API key\nfailing after 3 attempts";
  const result = friendlyPublishError(raw);
  expect(result.summary).toBe(
    "Uploading to itch.io failed. See the details for what butler reported.",
  );
  expect(result.details).toBe(raw);
});

test("friendlyPublishError maps a swa deploy failure to a friendly summary with details", () => {
  const raw = "swa deploy failed (exit 1).\nError: No matching Static Web App environment found";
  const result = friendlyPublishError(raw);
  expect(result.summary).toBe(
    "Deploying to Azure Static Web Apps failed. See the details for what the SWA CLI reported.",
  );
  expect(result.details).toBe(raw);
});

test("friendlyPublishError maps a raw Shopify HTTP failure to a friendly summary with details", () => {
  const raw = "Shopify API request failed (HTTP 500).";
  const result = friendlyPublishError(raw);
  expect(result.summary).toBe(
    "Shopify's server had a problem answering the request. Try again in a moment.",
  );
  expect(result.details).toBe(raw);
});

test("friendlyPublishError maps a raw Shopify GraphQL error to a friendly summary with details", () => {
  const raw = "Shopify API error: Access denied for productCreate field.";
  const result = friendlyPublishError(raw);
  expect(result.summary).toBe("Shopify rejected the publish request.");
  expect(result.details).toBe(raw);
});

test("friendlyPublishError maps a Shopify product userErrors failure to a friendly summary with details", () => {
  const raw = "Shopify couldn't create the product: Title can't be blank.";
  const result = friendlyPublishError(raw);
  expect(result.summary).toBe("Shopify rejected the publish request.");
  expect(result.details).toBe(raw);
});

test("friendlyPublishError maps a network-level failure to a friendly summary with details", () => {
  const result = friendlyPublishError(new Error("Failed to fetch"));
  expect(result.summary).toBe(
    "Couldn't reach the publishing service. Check your internet connection and try again.",
  );
  expect(result.details).toBe("Failed to fetch");
});

// Through SFE-P5c3, friendlyPublishError also unwrapped a `{"message": "…"}`
// JSON envelope SvelteKit's `error(status, message)` produced. SFE-P5c4
// deleted the last publish route and its JSON-serializing handler; the
// round-1 repair removed the now-dead `unwrapPublishErrorEnvelope` step and
// the four tests that pinned it (AP-32 — an obsolete workaround must not
// survive past the phase that deletes its cause). See `src/lib/errors.ts`'s
// `friendlyPublishError` doc comment for the full account.

// ── Misc ──────────────────────────────────────────────────────────────────

test("friendlyPublishError returns a generic fallback for an empty message", () => {
  expect(friendlyPublishError("")).toEqual({
    summary: "Publishing failed for an unknown reason.",
  });
  expect(friendlyPublishError(new Error(""))).toEqual({
    summary: "Publishing failed for an unknown reason.",
  });
});

test("friendlyPublishError accepts a plain string the same as an Error", () => {
  const raw = "swa deploy failed (exit 2).\nsomething went wrong";
  expect(friendlyPublishError(raw)).toEqual(friendlyPublishError(new Error(raw)));
});
