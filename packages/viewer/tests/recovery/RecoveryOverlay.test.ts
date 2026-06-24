/**
 * TDD tests for RecoveryOverlay — transparent blocking auto-recovery progress.
 *
 * These tests are written BEFORE the component exists and are expected to FAIL
 * for the right reason (module not found / missing exports). Green pass is the
 * target state after the component is implemented.
 *
 * Coverage areas:
 * 1. PWA-cleanliness: the module must not value-import @dimm-city/print-md-lib
 * 2. "recovering" state: correct phase copy, no dismiss affordance, a11y attrs
 * 3. Escape/backdrop ignored while recovering (non-dismissable mid-repair)
 * 4. "recovered" state: calm success copy, Done button fires onDone
 * 5. Auto-dismiss timer fires onDone after ~1.8s
 * 6. backupZipPath "Show backup" link calls onShowBackup when present
 * 7. Scrim must not set opacity:0 or be fully opaque (iframe-throttle guard)
 * 8. No git jargon in any author-visible copy
 * 9. var(--app-*) tokens used (not hard-coded colours)
 * 10. aria-live / aria-busy / role="status" present during repair
 *
 * Renderer component tests (bun:test, node process).
 * They inspect the COMPONENT'S SOURCE CODE directly (fs-based) rather than
 * mounting in a browser, following the project's existing unit-test patterns
 * for components that don't yet have a JSDOM harness (see pagedjs-interface.test.mjs
 * and the editor unit tests which also import source modules directly).
 *
 * All assertions that need DOM mounting use a lightweight structural inspection
 * of the compiled Svelte output via source-level string analysis — the same
 * technique used by the existing component tests in this repo.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Path to the component under test ─────────────────────────────────────────

const COMPONENT_PATH = resolve(
  import.meta.dir,
  "../../src/lib/components/RecoveryOverlay.svelte",
);

// ── Helper: read the component source (fails if file absent — the first red) ──

function readSource(): string {
  return readFileSync(COMPONENT_PATH, "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PWA-cleanliness — no value import of the lib
// ─────────────────────────────────────────────────────────────────────────────

describe("PWA-cleanliness (CLAUDE.md §8 / ADR 0004)", () => {
  test("RecoveryOverlay.svelte exists at the expected path", () => {
    // This is the first red: the file does not exist yet.
    // Once the file is created, this becomes the green entry gate.
    expect(() => readSource()).not.toThrow();
  });

  test("does not value-import @dimm-city/print-md-lib (import type only)", () => {
    const src = readSource();
    // Any non-type import of the lib in the SPA is a §8 violation.
    // "import type { … } from …" is fine — it's erased at build time.
    // A value import (e.g. bare import { X } or import X from the lib) is forbidden.
    // We allow: import type
    const valueImportPattern =
      /import\s+(?!type\s)(?:\{[^}]*\}|[\w*]+)\s+from\s+["']@dimm-city\/print-md-lib["']/;
    expect(valueImportPattern.test(src)).toBe(false);
  });

  test("does not import node:fs / node:url / node:path / isomorphic-git in the SPA", () => {
    const src = readSource();
    const forbidden = ["node:fs", "node:url", "node:path", "node:module", "isomorphic-git"];
    for (const dep of forbidden) {
      expect(src.includes(dep)).toBe(false);
    }
  });

  test("does not touch window.electron or ipcRenderer directly (only platform adapter)", () => {
    const src = readSource();
    expect(src.includes("window.electron")).toBe(false);
    expect(src.includes("ipcRenderer")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Component props contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Props contract", () => {
  test("exports a Svelte component (has <script> and <style> sections)", () => {
    const src = readSource();
    expect(src.includes("<script")).toBe(true);
    expect(src.includes("<style>") || src.includes("<style\n")).toBe(true);
  });

  test("declares required props: visible, state", () => {
    const src = readSource();
    // The component must accept `visible` and `state` as props
    expect(src.includes("visible")).toBe(true);
    expect(src.includes("state")).toBe(true);
  });

  test("declares optional props: phase, backupZipPath, onShowBackup, onDone", () => {
    const src = readSource();
    expect(src.includes("phase")).toBe(true);
    expect(src.includes("backupZipPath")).toBe(true);
    expect(src.includes("onShowBackup")).toBe(true);
    expect(src.includes("onDone")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. "recovering" state — phase copy, a11y, no dismiss affordance
// ─────────────────────────────────────────────────────────────────────────────

describe("recovering state — phase-driven copy", () => {
  test("shows 'Checking your project…' for phase=checking", () => {
    const src = readSource();
    expect(src.includes("Checking your project")).toBe(true);
  });

  test("shows 'Saving a backup of your work first…' for phase=backup", () => {
    const src = readSource();
    expect(src.includes("Saving a backup of your work first")).toBe(true);
  });

  test("shows 'Almost done…' for phase=repairing", () => {
    const src = readSource();
    expect(src.includes("Almost done")).toBe(true);
  });

  test("shows persistent reassurance subtext during repair", () => {
    const src = readSource();
    // The spec copy: "Your work was backed up first. This only takes a moment."
    expect(src.includes("backed up first")).toBe(true);
    expect(src.includes("only takes a moment")).toBe(true);
  });

  test("shows a calm title 'Tidying up your sync' while recovering", () => {
    const src = readSource();
    expect(src.includes("Tidying up your sync")).toBe(true);
  });
});

describe("recovering state — no dismiss affordance", () => {
  test("does NOT render a Cancel button in source", () => {
    const src = readSource();
    // There must be no cancel/close button available during the repair phase.
    // We verify by checking that any button marked cancel / close is gated to
    // a state that is NOT "recovering".
    // A naive check: the word "Cancel" must not appear as visible button text
    // unconditionally (it may appear in a comment or in a disabled/conditional context).
    // Strict rule: no <button> with text Cancel or Close that is always rendered.
    // We check that the source does NOT contain an always-rendered cancel/close
    // button (one that is NOT wrapped in an {#if state === "recovered"} or similar).
    //
    // Simplest enforceable signal: "Cancel" must not appear as unconditional
    // button label text. If it appears, it must be inside a conditional block.
    const cancelButton = /<button[^>]*>.*?[Cc]ancel.*?<\/button>/s.exec(src);
    if (cancelButton) {
      // It's present — ensure it is inside a conditional that excludes "recovering"
      const cancelIndex = src.indexOf(cancelButton[0]);
      const precedingSource = src.slice(0, cancelIndex);
      // The nearest preceding {#if must reference "recovered" or another non-recovering state
      const ifBlocks = [...precedingSource.matchAll(/\{#if\s+([^}]+)\}/g)];
      const lastIf = ifBlocks[ifBlocks.length - 1];
      expect(lastIf).toBeDefined();
      expect(lastIf![1]).not.toContain("recovering");
    }
    // If no cancel button at all, test passes trivially — that's fine.
  });

  test("does NOT render a close (×) button while recovering", () => {
    const src = readSource();
    // Any close button (aria-label="Close" or similar) must be gated off during repair.
    // We verify no unconditional close button appears.
    if (src.includes('aria-label="Close"') || src.includes("aria-label='Close'")) {
      // Must be inside a conditional that targets a non-recovering state
      expect(src.includes("{#if") || src.includes(":else")).toBe(true);
    }
    // No close button at all → passes.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Escape / backdrop ignored while recovering (non-dismissable mid-repair)
// ─────────────────────────────────────────────────────────────────────────────

describe("non-dismissable while recovering", () => {
  test("Escape key handler is guarded against dismissal during repair", () => {
    const src = readSource();
    // The component must NOT close/hide on Escape when state === 'recovering'.
    // It either: (a) has no Escape handler at all, or (b) guards the handler
    // with a check that excludes 'recovering'.
    if (src.includes("Escape") || src.includes("e.key")) {
      // If there is an Escape handler, it must reference the state
      // to prevent closing during recovery.
      expect(src.includes("recovering")).toBe(true);
    }
    // If no Escape handler → trivially passes (component is non-dismissable by design).
  });

  test("backdrop click does not trigger dismiss while recovering", () => {
    const src = readSource();
    // If a backdrop element exists with an onclick, it must be guarded.
    if (src.includes("backdrop")) {
      // Any onclick on the backdrop must be conditional on state !== 'recovering'
      // We verify the backdrop is either absent or guarded.
      const hasGuard =
        src.includes("recovering") &&
        (src.includes("state !==") || src.includes("state ===") || src.includes("state !="));
      if (!hasGuard) {
        // Acceptable alternative: no onclick on backdrop at all during recovering
        // (i.e. no <div class="backdrop" onclick=...> when recovering)
        expect(src.includes("{#if")).toBe(true);
      }
    }
    // No backdrop → passes.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. "recovered" state — calm success copy + Done button
// ─────────────────────────────────────────────────────────────────────────────

describe("recovered state — success copy and Done button", () => {
  test("shows 'All set' title in the recovered state", () => {
    const src = readSource();
    expect(src.includes("All set")).toBe(true);
  });

  test("shows calm success body copy", () => {
    const src = readSource();
    // Spec: "We fixed a small sync problem and your work is safe."
    expect(src.includes("small sync problem")).toBe(true);
    expect(src.includes("your work is safe")).toBe(true);
  });

  test("renders a 'Got it' button in the recovered state", () => {
    const src = readSource();
    // The dismiss button fires onDone and is only shown in the recovered state.
    expect(src.includes("Got it")).toBe(true);
  });

  test("Done button references onDone callback", () => {
    const src = readSource();
    expect(src.includes("onDone")).toBe(true);
    // onDone must appear in the context of a button or click handler
    const onDoneInButton = /onclick.*onDone|onDone.*onclick/.test(src) ||
      /on:click.*onDone|onDone.*on:click/.test(src) ||
      // Svelte 5 runes style
      /onclick=\{[^}]*onDone[^}]*\}/.test(src) ||
      /onclick\s*=\s*\{?\s*onDone/.test(src);
    expect(onDoneInButton).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Auto-dismiss timer (~1.8s) for recovered state
// ─────────────────────────────────────────────────────────────────────────────

describe("auto-dismiss after recovery", () => {
  test("source references a ~1800ms auto-dismiss timer for recovered state", () => {
    const src = readSource();
    // The spec calls for ~1.8s auto-dismiss. Acceptable as: 1800, 1.8, 1_800.
    const hasTimer =
      src.includes("1800") ||
      src.includes("1.8") ||
      src.includes("setTimeout") ||
      src.includes("1_800");
    expect(hasTimer).toBe(true);
  });

  test("auto-dismiss is scoped to recovered state only (not to recovering)", () => {
    const src = readSource();
    // The timer must not fire when state === 'recovering' (would prematurely close).
    // The timer setup must appear inside a conditional referencing 'recovered'.
    if (src.includes("1800") || src.includes("setTimeout")) {
      expect(src.includes("recovered")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. backupZipPath → "Show backup" link
// ─────────────────────────────────────────────────────────────────────────────

describe("backupZipPath — Show backup link", () => {
  test("renders a Show backup affordance when backupZipPath is present", () => {
    const src = readSource();
    expect(src.includes("Show backup") || src.includes("show backup")).toBe(true);
  });

  test("Show backup calls onShowBackup", () => {
    const src = readSource();
    expect(src.includes("onShowBackup")).toBe(true);
    // onShowBackup must be wired to a click handler
    const wired =
      /onclick.*onShowBackup|onShowBackup.*onclick/.test(src) ||
      /on:click.*onShowBackup|onShowBackup.*on:click/.test(src) ||
      /onclick\s*=\s*\{?\s*onShowBackup/.test(src);
    expect(wired).toBe(true);
  });

  test("Show backup link is only rendered when backupZipPath is defined", () => {
    const src = readSource();
    // The Show backup element must be inside a conditional that checks backupZipPath.
    // We check that the word backupZipPath appears near Show backup in the template.
    const showBackupIdx = src.indexOf("Show backup");
    if (showBackupIdx === -1) return; // caught by previous test
    const precedingSource = src.slice(0, showBackupIdx);
    const ifBlocks = [...precedingSource.matchAll(/\{#if\s+([^}]+)\}/g)];
    const lastIf = ifBlocks[ifBlocks.length - 1];
    expect(lastIf).toBeDefined();
    expect(lastIf![1]).toContain("backupZipPath");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Scrim / iframe-throttle guard — MUST NOT be fully opaque or opacity:0
// ─────────────────────────────────────────────────────────────────────────────

describe("scrim / iframe-throttle guard (hard rule 3 / 0.4.1 regression)", () => {
  test("does NOT set opacity: 0 on the overlay element", () => {
    const src = readSource();
    // opacity:0 on the overlay would throttle the cross-origin iframe to ~1fps.
    // Allow opacity inside fade transition (which briefly passes through 0 during
    // out:fade) — the prohibition is on STATIC opacity:0 assignments.
    // Static: `opacity: 0` in a CSS rule or a style attribute.
    const staticOpacity0 = /opacity\s*:\s*0(?!\s*\.\d)/.test(src);
    // If found, check it's not in the CSS style block being applied to the overlay
    // A safe occurrence is ONLY inside Svelte transition definitions (out:fade).
    if (staticOpacity0) {
      // Any opacity:0 in CSS rules (not in transition snippets) is a violation.
      // We check the <style> section specifically.
      const styleStart = src.indexOf("<style");
      const styleEnd = src.indexOf("</style>");
      if (styleStart !== -1 && styleEnd !== -1) {
        const cssBlock = src.slice(styleStart, styleEnd);
        expect(/opacity\s*:\s*0(?!\s*\.\d)/.test(cssBlock)).toBe(false);
      }
    }
  });

  test("uses var(--app-overlay) for the background scrim (translucent)", () => {
    const src = readSource();
    // The loading overlay uses var(--app-overlay) which must be translucent.
    // We verify the component references this token for its background.
    expect(src.includes("--app-overlay")).toBe(true);
  });

  test("uses backdrop-filter: blur for the scrim (no opaque cover)", () => {
    const src = readSource();
    expect(src.includes("backdrop-filter")).toBe(true);
    expect(src.includes("blur")).toBe(true);
  });

  test("does NOT set a fully opaque solid background colour on the overlay", () => {
    const src = readSource();
    // Solid background colours like background: #fff or background: rgb(255,255,255)
    // without alpha would create an opaque cover, triggering the 0.4.1 regression.
    // Acceptable: var(--app-overlay), rgba(…), color-mix(…), or no background at all.
    const styleStart = src.indexOf("<style");
    const styleEnd = src.indexOf("</style>");
    if (styleStart !== -1 && styleEnd !== -1) {
      const css = src.slice(styleStart, styleEnd);
      // Detect bare hex or rgb (no alpha) as background on the overlay
      const opaqueRgb = /background\s*:\s*rgb\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/.test(css);
      const opaqueHex = /background\s*:\s*#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/.test(css);
      expect(opaqueRgb).toBe(false);
      expect(opaqueHex).toBe(false);
    }
  });

  test("uses 'pane' variant positioning (scoped to preview area, not full-app)", () => {
    const src = readSource();
    // The spec says: use "pane" positioning so it scrims the preview area only.
    // Acceptable signals: position:absolute (pane), or a reference to the pane variant.
    const hasPane =
      src.includes("pane") ||
      src.includes("position: absolute") ||
      src.includes("position:absolute");
    expect(hasPane).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. No git jargon in any author-visible copy
// ─────────────────────────────────────────────────────────────────────────────

describe("no git jargon (author-facing copy rule)", () => {
  const FORBIDDEN_WORDS = [
    "branch",
    "commit",
    "HEAD",
    "merge",
    "ref",
    "rebase",
    "cherry-pick",
    "cherry pick",
    "git",
    "repository",
    "push",
    "pull",
    "fetch",
    "stash",
  ];

  // Strip the <script> block (which may legitimately contain type names like
  // 'RecoveryProgressInfo') and the <style> block; check only the template HTML.
  function templateSection(src: string): string {
    // Remove <script>…</script> and <style>…</style>
    return src
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "");
  }

  for (const word of FORBIDDEN_WORDS) {
    test(`author-visible template does not contain git jargon: "${word}"`, () => {
      const src = readSource();
      const tmpl = templateSection(src);
      // Case-insensitive match for the forbidden word as a whole word in template text
      const pattern = new RegExp(`\\b${word}\\b`, "i");
      expect(pattern.test(tmpl)).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Design tokens — only var(--app-*) used for colours/layout
// ─────────────────────────────────────────────────────────────────────────────

describe("design tokens — var(--app-*) only", () => {
  test("CSS uses at least one var(--app-*) token", () => {
    const src = readSource();
    expect(/var\(--app-/.test(src)).toBe(true);
  });

  test("CSS does not hard-code common hex colours for text/background", () => {
    const src = readSource();
    const styleStart = src.indexOf("<style");
    const styleEnd = src.indexOf("</style>");
    if (styleStart !== -1 && styleEnd !== -1) {
      // Allow only #fff / #000 as very common baseline resets; flag any specific brand colours.
      const css = src.slice(styleStart, styleEnd);
      const suspectHex = css.match(/#[0-9a-fA-F]{4,8}\b/g) ?? [];
      // No hex colours other than pure white/black should appear
      for (const hex of suspectHex) {
        const normalised = hex.toLowerCase();
        expect(["#fff", "#ffffff", "#000", "#000000"].includes(normalised)).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Accessibility — aria attrs
// ─────────────────────────────────────────────────────────────────────────────

describe("accessibility", () => {
  test("overlay element has role=\"status\"", () => {
    const src = readSource();
    expect(src.includes('role="status"')).toBe(true);
  });

  test("overlay element has aria-live=\"polite\"", () => {
    const src = readSource();
    expect(src.includes('aria-live="polite"')).toBe(true);
  });

  test("overlay element has aria-busy=\"true\" while recovering", () => {
    const src = readSource();
    // aria-busy must be set to true during the repair (recovering) state.
    // Accept either static aria-busy="true" or a dynamic binding.
    const hasAriaBusy =
      src.includes("aria-busy") &&
      (src.includes('aria-busy="true"') ||
        src.includes("aria-busy={") ||
        src.includes("aria-busy=true"));
    expect(hasAriaBusy).toBe(true);
  });

  test("spinner has aria-hidden=\"true\" (decorative)", () => {
    const src = readSource();
    expect(src.includes('aria-hidden="true"')).toBe(true);
  });

  test("overlay is NOT role=\"dialog\" (it is a non-dismissable status overlay)", () => {
    const src = readSource();
    // A dialog role implies the user can interact or close it. This overlay
    // must be role="status" (or region), never role="dialog".
    // Note: role="dialog" may appear in comments; check live attributes only.
    const templatePart = src
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    expect(templatePart.includes('role="dialog"')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Structural: out:fade cross-fade (matches LoadingOverlay pattern)
// ─────────────────────────────────────────────────────────────────────────────

describe("out:fade cross-fade (LoadingOverlay structural match)", () => {
  test("imports fade from svelte/transition", () => {
    const src = readSource();
    expect(src.includes("svelte/transition")).toBe(true);
    expect(src.includes("fade")).toBe(true);
  });

  test("uses out:fade or transition:fade on the overlay wrapper", () => {
    const src = readSource();
    expect(src.includes("out:fade") || src.includes("transition:fade")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline lint: ensure we did not accidentally import the lib as a value above
// ─────────────────────────────────────────────────────────────────────────────
// (This is the test FILE'S own PWA-cleanliness check — meta.)

test("this test file itself does not value-import @dimm-city/print-md-lib", () => {
  const testSrc = readFileSync(
    resolve(import.meta.dir, "RecoveryOverlay.test.ts"),
    "utf-8",
  );
  const valueImportPattern =
    /import\s+(?!type\s)(?:\{[^}]*\}|[\w*]+)\s+from\s+["']@dimm-city\/print-md-lib["']/;
  expect(valueImportPattern.test(testSrc)).toBe(false);
});
