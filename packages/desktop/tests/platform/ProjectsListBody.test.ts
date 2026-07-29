/**
 * Source-level tests for ProjectsListBody.svelte (M20 — error-vs-empty
 * branching for the recents/favorites load).
 *
 * Svelte component templates lack a mount/DOM test harness in this repo's
 * bun:test setup (no JSDOM/Svelte-compile harness is wired up) — these tests
 * follow the established project convention (NewProjectWizard.test.ts,
 * RecoveryConfirmDialog.test.ts, CrashRecoveryDialog.test.ts, …) of asserting
 * the source contains the required wiring, rather than exercising a live
 * component.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/ProjectsListBody.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf-8");
}

describe("ProjectsListBody — M20 error-vs-empty for recents/favorites", () => {
  test("tracks a lastLoadError surface separate from the create/submit `error` state", () => {
    const src = readSource();
    expect(src).toMatch(/let lastLoadError = \$state<string \| null>\(null\)/);
  });

  test("loadLists() clears lastLoadError on a successful recents/favorites load", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadLists("),
      src.indexOf("// Load on mount"),
    );
    const tryBlock = fn.slice(fn.indexOf("try {"), fn.indexOf("} catch"));
    expect(tryBlock).toContain("lastLoadError = null;");
  });

  test("loadLists() sets lastLoadError (not a silent no-op) when the recents/favorites load throws", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadLists("),
      src.indexOf("// Load on mount"),
    );
    const catchBlock = fn.slice(fn.indexOf("} catch {") , fn.indexOf("} finally"));
    expect(catchBlock).toMatch(/lastLoadError\s*=\s*["'].+["'];/);
    // Must not just be the old "// non-fatal" comment with an empty body.
    expect(catchBlock).not.toMatch(/^\s*\}\s*catch\s*\{\s*\/\/ non-fatal\s*\}/);
  });

  test("the empty-state branch checks lastLoadError BEFORE falling back to the 'No recent projects yet' hint", () => {
    const src = readSource();
    const recentsSection = src.slice(
      src.indexOf('<h3 class="list-heading">Recently opened</h3>'),
      src.indexOf("</section>", src.indexOf('<h3 class="list-heading">Recently opened</h3>')),
    );
    const errorBranchIdx = recentsSection.indexOf("{:else if lastLoadError}");
    const emptyHintIdx = recentsSection.indexOf("No recent projects yet");
    expect(errorBranchIdx).toBeGreaterThan(-1);
    expect(emptyHintIdx).toBeGreaterThan(-1);
    // The lastLoadError branch must come first so a genuine failure never
    // falls through to the "no projects yet" copy.
    expect(errorBranchIdx).toBeLessThan(emptyHintIdx);
  });

  test("the error branch renders a working Retry that re-runs loadLists()", () => {
    const src = readSource();
    const recentsSection = src.slice(
      src.indexOf('<h3 class="list-heading">Recently opened</h3>'),
      src.indexOf("</section>", src.indexOf('<h3 class="list-heading">Recently opened</h3>')),
    );
    const errorBranch = recentsSection.slice(
      recentsSection.indexOf("{:else if lastLoadError}"),
      recentsSection.indexOf("{:else if !loading}"),
    );
    expect(errorBranch).toContain("{lastLoadError}");
    expect(errorBranch).toMatch(/onclick=\{[^}]*loadLists\(\)[^}]*\}/);
    expect(errorBranch).toContain(">Retry<");
    // role="alert" so a failed load is announced to AT, not silently dropped.
    expect(errorBranch).toMatch(/role="alert"/);
  });

  test("a genuinely empty list (no error) still keeps the original copy", () => {
    const src = readSource();
    expect(src).toContain(
      '<p class="empty-section-hint">No recent projects yet. Open a folder to get started.</p>',
    );
  });
});

describe("ProjectsListBody — M20 error-vs-empty for the discover scan (surface 3)", () => {
  test("tracks a discoverError surface separate from lastLoadError", () => {
    const src = readSource();
    expect(src).toMatch(/let discoverError = \$state<string \| null>\(null\)/);
  });

  test("loadDiscovered() clears discoverError on a successful scan", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadDiscovered("),
      src.indexOf("async function loadDiscovered(") + 400,
    );
    const tryBlock = fn.slice(fn.indexOf("try {"), fn.indexOf("} catch"));
    expect(tryBlock).toContain("discoverError = null;");
  });

  test("loadDiscovered() sets discoverError (not a silent no-op) when the scan throws", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadDiscovered("),
      src.indexOf("async function loadDiscovered(") + 800,
    );
    const catchBlock = fn.slice(fn.indexOf("} catch {"), fn.indexOf("}\n  }"));
    expect(catchBlock).toMatch(/discoverError\s*=\s*["'].+["'];/);
    // Must not just be the old `.catch(() => {})` silent swallow.
    expect(src).not.toMatch(/discoverProjectsCached\(\)[\s\S]{0,120}\.catch\(\(\) => \{\}\)/);
  });

  test("loadLists() invokes the discover scan via loadDiscovered(), not an inline swallowed .catch", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadLists("),
      src.indexOf("async function loadDiscovered("),
    );
    expect(fn).toContain("void loadDiscovered();");
  });

  test("the Discovered section renders even when there are zero discovered results, as long as discoverError is set", () => {
    const src = readSource();
    const sectionIdx = src.indexOf('{#if filteredDiscovered.length > 0 || discoverError}');
    expect(sectionIdx).toBeGreaterThan(-1);
  });

  test("the discover-error branch renders role=alert + the failure text + a working Retry that re-invokes loadDiscovered()", () => {
    const src = readSource();
    const sectionStart = src.indexOf('{#if filteredDiscovered.length > 0 || discoverError}');
    const sectionEnd = src.indexOf("{/if}", src.indexOf("</section>", sectionStart));
    const section = src.slice(sectionStart, sectionEnd);
    const errorBranch = section.slice(section.indexOf("{:else if discoverError}"));
    expect(errorBranch).toContain("{discoverError}");
    expect(errorBranch).toMatch(/onclick=\{[^}]*loadDiscovered\(\)[^}]*\}/);
    expect(errorBranch).toContain(">Retry<");
    expect(errorBranch).toMatch(/role="alert"/);
  });

  test("a genuinely empty discover scan (no error) renders no Discovered section at all", () => {
    const src = readSource();
    // The section-gating condition requires either results or an error — a
    // plain empty scan with discoverError === null must render nothing, same
    // as before M20 (no regression to an always-visible empty Discovered box).
    const sectionIdx = src.indexOf('{#if filteredDiscovered.length > 0 || discoverError}');
    const section = src.slice(sectionIdx, src.indexOf("{/if}", src.indexOf("</section>", sectionIdx)));
    expect(section).not.toMatch(/No (discovered )?projects (found|on disk)/i);
  });
});
