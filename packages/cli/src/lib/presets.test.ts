import { test, expect } from "bun:test";
import { UsageError } from "./cli-args";
import { resolveConfig } from "./manifest";
import {
  BOOK_PRESET,
  DTRPG_PRESET,
  PRESETS,
  resolvePreset,
  warnOnce,
  resetWarnOnce,
} from "./presets";

// ── resolvePreset (UX finding M48) ──────────────────────────────────────────

test("resolvePreset defaults to dtrpg when no preset is set", () => {
  expect(resolvePreset(undefined)).toBe(DTRPG_PRESET);
});

test("resolvePreset returns the named preset for a known value", () => {
  expect(resolvePreset("dtrpg")).toBe(DTRPG_PRESET);
  expect(resolvePreset("book")).toBe(BOOK_PRESET);
});

test("resolvePreset throws a UsageError naming the known presets for an unknown value", () => {
  try {
    resolvePreset("a4");
    throw new Error("expected UsageError");
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    expect((err as UsageError).message).toContain('"a4"');
    expect((err as UsageError).message).toContain("dtrpg");
    expect((err as UsageError).message).toContain("book");
  }
});

test("PRESETS catalog contains exactly dtrpg and book", () => {
  expect(Object.keys(PRESETS).sort()).toEqual(["book", "dtrpg"]);
});

// ── resolveConfig integration: unknown preset errors, never silently falls
// back to dtrpg (the bug this finding fixes) ────────────────────────────────

test("resolveConfig throws for an unknown manifest preset instead of silently using dtrpg", () => {
  expect(() => resolveConfig({}, { preset: "a4" as "dtrpg" })).toThrow(UsageError);
});

test("resolveConfig with no preset set still resolves to dtrpg geometry (unchanged default)", () => {
  const config = resolveConfig({}, {});
  expect(config.page.width).toBe(DTRPG_PRESET.page.width);
  expect(config.page.height).toBe(DTRPG_PRESET.page.height);
  expect(config.ink.maxTac).toBe(240);
});

// ── book preset geometry (UX finding M48) ───────────────────────────────────

test("book preset uses standard 6x9in trade geometry (432x648pt)", () => {
  expect(BOOK_PRESET.page.width).toBe(432);
  expect(BOOK_PRESET.page.height).toBe(648);
});

test("book preset has no vendor TAC cap (400% — the physical ceiling)", () => {
  expect(BOOK_PRESET.ink.maxTac).toBe(400);
});

test("book preset does not force PDF/X-specific checks", () => {
  expect(BOOK_PRESET.validate.checks["pdf.print.pdfx-markers"]).toBe(false);
  expect(BOOK_PRESET.validate.checks["pdf.print.pdfx-metadata"]).toBe(false);
  expect(BOOK_PRESET.validate.pdf.forbidTransparency).toBe(false);
});

test("book preset still enables generic, vendor-agnostic PDF health checks", () => {
  expect(BOOK_PRESET.validate.checks["pdf.structure.qpdf"]).toEqual({
    enabled: true,
    severity: "error",
  });
  expect(BOOK_PRESET.validate.checks["pdf.print.embedded-fonts"]).toEqual({
    enabled: true,
    severity: "error",
  });
});

test("resolveConfig with preset: book resolves the book preset's geometry", () => {
  const config = resolveConfig({}, { preset: "book" as "dtrpg" });
  expect(config.page.width).toBe(432);
  expect(config.page.height).toBe(648);
  expect(config.ink.maxTac).toBe(400);
});

test("book preset differs from dtrpg on the vendor-specific fields (sanity check they're not aliases)", () => {
  expect(BOOK_PRESET).not.toBe(DTRPG_PRESET);
  expect(BOOK_PRESET.page.width).not.toBe(DTRPG_PRESET.page.width);
  expect(BOOK_PRESET.ink.maxTac).not.toBe(DTRPG_PRESET.ink.maxTac);
});

// ── ARCH finding #2 — no more preset-level styles default ──────────────────

test("neither preset declares a `styles` default (resolveActiveStyles owns that fallback chain now)", () => {
  expect((DTRPG_PRESET as Record<string, unknown>).styles).toBeUndefined();
  expect((BOOK_PRESET as Record<string, unknown>).styles).toBeUndefined();
});

// ── ARCH finding #24 — warnOnce / resetWarnOnce replace raw module-level
// mutable booleans, so dedup state is both resettable (a "reset hook") and
// redirectable to a caller-supplied sink instead of `console.warn` ─────────

test("warnOnce fires the sink exactly once per id, even across repeated calls", () => {
  const seen: string[] = [];
  const id = `test-warn-${Math.random()}`;
  warnOnce(id, "first", (m) => seen.push(m));
  warnOnce(id, "second", (m) => seen.push(m));
  warnOnce(id, "third", (m) => seen.push(m));
  expect(seen).toEqual(["first"]);
});

test("different ids each get their own independent warn-once state", () => {
  const seen: string[] = [];
  const idA = `test-warn-a-${Math.random()}`;
  const idB = `test-warn-b-${Math.random()}`;
  warnOnce(idA, "a", (m) => seen.push(m));
  warnOnce(idB, "b", (m) => seen.push(m));
  expect(seen.sort()).toEqual(["a", "b"]);
});

test("resetWarnOnce clears dedup state so a warning can fire again (the reset hook)", () => {
  const seen: string[] = [];
  const id = `test-warn-reset-${Math.random()}`;
  warnOnce(id, "first", (m) => seen.push(m));
  warnOnce(id, "again-before-reset", (m) => seen.push(m));
  expect(seen).toEqual(["first"]);

  resetWarnOnce();
  warnOnce(id, "again-after-reset", (m) => seen.push(m));
  expect(seen).toEqual(["first", "again-after-reset"]);
});

test("resolvePreset's 'no preset set' notice respects resetWarnOnce (no leftover un-resettable module boolean)", () => {
  resetWarnOnce();
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = ((m: unknown) => { lines.push(String(m)); }) as typeof console.warn;
  try {
    resolvePreset(undefined);
    resolvePreset(undefined);
    expect(lines.length).toBe(1);

    resetWarnOnce();
    resolvePreset(undefined);
    expect(lines.length).toBe(2);
  } finally {
    console.warn = orig;
    resetWarnOnce();
  }
});
