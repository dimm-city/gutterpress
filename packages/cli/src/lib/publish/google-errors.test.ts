import { test, expect } from "bun:test";
import { FriendlyHttpError } from "../fetch-timeout";
import { googleApiFailure, parseGoogleApiError, readGoogleApiError } from "./google-errors";

const ACCESS_NOT_CONFIGURED = {
  error: {
    code: 403,
    message:
      "Google Drive API has not been used in project 1234 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=1234 then retry.",
    errors: [{ domain: "usageLimits", reason: "accessNotConfigured", message: "Access Not Configured." }],
    status: "PERMISSION_DENIED",
  },
};

// ── parseGoogleApiError ─────────────────────────────────────────────────────

test("parseGoogleApiError keeps Google's reason and message from the standard envelope", () => {
  expect(parseGoogleApiError(403, ACCESS_NOT_CONFIGURED)).toEqual({
    status: 403,
    reason: "accessNotConfigured",
    message: ACCESS_NOT_CONFIGURED.error.message,
  });
});

test("parseGoogleApiError falls back to error.status when there is no errors[] reason", () => {
  expect(parseGoogleApiError(403, { error: { code: 403, message: "nope", status: "PERMISSION_DENIED" } })).toEqual({
    status: 403,
    reason: "PERMISSION_DENIED",
    message: "nope",
  });
});

test("parseGoogleApiError tolerates any body shape and yields the bare status", () => {
  expect(parseGoogleApiError(500, undefined)).toEqual({ status: 500 });
  expect(parseGoogleApiError(500, "not json")).toEqual({ status: 500 });
  expect(parseGoogleApiError(500, { error: "string-shaped" })).toEqual({ status: 500 });
  expect(parseGoogleApiError(500, { error: { message: "   " } })).toEqual({ status: 500 });
});

test("parseGoogleApiError redacts a credential-shaped query value if a message ever echoed one", () => {
  const body = { error: { message: "Bad request to https://x.googleapis.com/f?access_token=SECRET&key=ALSO-SECRET" } };
  const info = parseGoogleApiError(400, body);
  expect(info.message).not.toContain("SECRET");
  expect(info.message).toBe("Bad request to https://x.googleapis.com/f?access_token=(redacted)&key=(redacted)");
});

// ── readGoogleApiError ──────────────────────────────────────────────────────

test("readGoogleApiError decodes a JSON body and shrugs off a non-JSON one", async () => {
  const json = new Response(JSON.stringify(ACCESS_NOT_CONFIGURED), { status: 403 });
  expect((await readGoogleApiError(json)).reason).toBe("accessNotConfigured");
  const text = new Response("forbidden", { status: 403 });
  expect(await readGoogleApiError(text)).toEqual({ status: 403 });
});

// ── googleApiFailure ────────────────────────────────────────────────────────

test("accessNotConfigured (the disabled-Drive-API case) names the fix and keeps Google's enable-it link", () => {
  const err = googleApiFailure("Couldn't list Google Drive folders", parseGoogleApiError(403, ACCESS_NOT_CONFIGURED));
  expect(err).toBeInstanceOf(FriendlyHttpError);
  expect(err.message).toStartWith("Couldn't list Google Drive folders (HTTP 403, accessNotConfigured). ");
  expect(err.message).toMatch(/Drive API isn't enabled for the app's Google Cloud project/);
  expect(err.message).toContain("drive.googleapis.com/overview?project=1234");
});

test("the permission and rate-limit reason families each get a what-to-do sentence", () => {
  const perm = googleApiFailure("Couldn't create the Google Drive folder \"x\"", {
    status: 403,
    reason: "insufficientPermissions",
  });
  expect(perm.message).toMatch(/disconnect and connect Google Drive again/);
  const unauthorized = googleApiFailure("Couldn't read your Google Drive account info", { status: 401 });
  expect(unauthorized.message).toMatch(/connect Google Drive again/);
  for (const reason of ["userRateLimitExceeded", "rateLimitExceeded", "dailyLimitExceeded"]) {
    expect(googleApiFailure("Google Drive upload failed", { status: 403, reason }).message).toMatch(/rate-limiting/);
  }
  const full = googleApiFailure("Google Drive upload failed", { status: 403, reason: "storageQuotaExceeded" });
  expect(full.message).toMatch(/Your Google Drive is full/);
});

test("an unknown reason still carries the status, the reason, and Google's own message", () => {
  const err = googleApiFailure("Google Drive upload failed", {
    status: 400,
    reason: "badRequest",
    message: "The file's parent is not a folder.",
  });
  expect(err.message).toBe(
    'Google Drive upload failed (HTTP 400, badRequest). Google said: "The file\'s parent is not a folder."',
  );
});

test("every message names Google as prose — even when the caller's phrase forgot to", () => {
  // friendly-errors.ts's `\bgoogle\b` publish allowlist is what lets a lib
  // message reach the author verbatim; this is the invariant it relies on.
  const cases = [
    googleApiFailure("Couldn't create the folder", { status: 403 }),
    googleApiFailure("Couldn't create the folder", { status: 500, message: "backend error" }),
    googleApiFailure("Couldn't list Google Drive folders", { status: 403 }),
  ];
  for (const err of cases) expect(err.message).toMatch(/\bGoogle\b/);
  expect(cases[0]!.message).toBe("Google Drive: Couldn't create the folder (HTTP 403).");
});
