import { expect, spyOn, test } from "bun:test";

import * as chromium from "../chromium.ts";
import { explainBuildFailure, explainSendFailure, isCanceled } from "./explain.ts";

test("a book too wide for the page names what is too wide and what building anyway costs", () => {
  const e = Object.assign(new Error("raw engine prose"), {
    code: "TOO_WIDE",
    offenders: ["div.a", "div.b", "div.c", "div.d", "div.e"],
    scale: 0.6666,
  });
  const f = explainBuildFailure(e);
  expect(f.code).toBe("TOO_WIDE");
  expect(f.message).toContain("div.a, div.b, div.c and 2 more");
  expect(f.message).toContain("about 0.67×");
  expect(f.detail).toBe("raw engine prose");
});

test("a box pulled off the left edge has no scale, so none is quoted", () => {
  const e = Object.assign(new Error("raw"), { code: "TOO_WIDE", offenders: ["div.pull"], scale: null });
  const f = explainBuildFailure(e);
  expect(f.message).toContain("div.pull");
  expect(f.message).not.toMatch(/\d\.\d\d×/);
});

test("a missing Chromium is a missing program, not a failed build", async () => {
  const spy = spyOn(chromium, "resolveChromiumExecutable").mockResolvedValue(undefined);
  try {
    const e = await chromium.requireChromiumExecutable().then(() => null, (err: unknown) => err);
    const f = explainBuildFailure(e);
    expect(f.code).toBe("TOOL_MISSING");
    expect(f.detail).toContain("Chromium");
  } finally {
    spy.mockRestore();
  }
});

test("a program that cannot be started is named", () => {
  const e = Object.assign(new Error("spawn gs ENOENT"), { code: "ENOENT", syscall: "spawn gs", path: "gs" });
  const f = explainBuildFailure(e, "PDF/X");
  expect(f.code).toBe("TOOL_MISSING");
  expect(f.message).toBe('Making the PDF/X needs "gs", which is not installed on this computer.');
});

test("a missing file is not mistaken for a missing program", () => {
  const e = Object.assign(new Error("ENOENT: no such file, open 'x.md'"), { code: "ENOENT", syscall: "open" });
  expect(explainBuildFailure(e).code).toBe("BUILD_FAILED");
});

test("a write the system refused is a permission problem", () => {
  const e = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  expect(explainBuildFailure(e).code).toBe("PERMISSION");
});

test("a full disk keeps the first line as the message and the whole text as detail", () => {
  const e = Object.assign(new Error("Disk filled up.\nraw gs output"), { code: "DISK_FULL" });
  const f = explainBuildFailure(e);
  expect(f).toEqual({ code: "DISK_FULL", message: "Disk filled up.", detail: "Disk filled up.\nraw gs output" });
});

test("a stopped run is a cancel with nothing to show", () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  expect(explainBuildFailure(abort)).toEqual({ code: "CANCELED", message: "" });
  expect(isCanceled(Object.assign(new Error("x"), { code: "EXPORT_CANCELED" }))).toBe(true);
  expect(isCanceled(new Error("x"))).toBe(false);
});

test("anything else keeps its first line", () => {
  expect(explainBuildFailure(new Error("boom\nstack"))).toEqual({
    code: "BUILD_FAILED",
    message: "Making the PDF failed: boom",
    detail: "boom\nstack",
  });
});

test.each([
  ["butler push failed (exit 1): nope", "SEND_FAILED", "Uploading to itch.io failed"],
  ["swa deploy failed (exit 2)", "SEND_FAILED", "Azure Static Web Apps"],
  ["Shopify API request failed (HTTP 502)", "SEND_FAILED", "server had a problem"],
  ["Shopify couldn't create the product", "SEND_FAILED", "turned the upload down"],
  ["token refresh: invalid_grant", "ACCOUNT_EXPIRED", "Your Drive sign-in expired"],
  ["storageQuotaExceeded", "STORAGE_FULL", "Google Drive is full"],
  ["fetch failed", "OFFLINE", "Couldn't reach Drive"],
  ["The folder was deleted.", "SEND_FAILED", "The folder was deleted."],
])("sending: %s", (raw, code, words) => {
  const f = explainSendFailure(new Error(raw), "Drive");
  expect(f.code).toBe(code as never);
  expect(f.message).toContain(words);
});

test("a one-line error is not repeated as its own detail", () => {
  expect(explainBuildFailure(new Error("No markdown files found"))).toEqual({
    code: "BUILD_FAILED",
    message: "Making the PDF failed: No markdown files found",
  });
});
