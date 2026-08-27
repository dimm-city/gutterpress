// Manifest regression test (SFE-P1a review dimension: "a manifest
// regression test per the spec's review dimension"). Parses package.json
// directly — no vscode host, no mocking — so a future edit that silently
// widens this custom editor's reach (e.g. flipping `priority` to
// "default", broadening the selector, or renaming the viewType) fails a
// fast, host-free test instead of depending on a human re-reading the JSON.
//
// D9: "Register an optional custom text editor ... Do not make it the
// default for all Markdown." `priority: "option"` is the actual mechanism
// that keeps this true (see src/extension.ts's header) — this test pins it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

interface CustomEditorContribution {
  viewType: string;
  displayName?: string;
  selector?: Array<{ filenamePattern?: string }>;
  priority?: string;
}

interface ExtensionManifest {
  name: string;
  publisher?: string;
  private?: boolean;
  engines?: { vscode?: string };
  activationEvents?: string[];
  main?: string;
  contributes?: { customEditors?: CustomEditorContribution[] };
}

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as ExtensionManifest;

describe("package.json — VS Code extension manifest (D1/D9)", () => {
  test("is named and published as the D1-designated extension package, and private (not published this run)", () => {
    expect(pkg.name).toBe("@dimm-city/gutterpress-vscode");
    expect(pkg.publisher).toBe("dimm-city");
    expect(pkg.private).toBe(true);
  });

  test("pins an engines.vscode range", () => {
    expect(pkg.engines?.vscode).toBeTruthy();
    expect(pkg.engines?.vscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
  });

  test("declares an activation event for the custom editor", () => {
    expect(pkg.activationEvents).toContain("onCustomEditor:gutterpress.markdownEditor");
  });

  test("registers exactly one custom editor: gutterpress.markdownEditor", () => {
    const editors = pkg.contributes?.customEditors ?? [];
    expect(editors).toHaveLength(1);
    expect(editors[0]?.viewType).toBe("gutterpress.markdownEditor");
  });

  test("D9: priority is 'option' — never the default handler for all Markdown", () => {
    const editor = pkg.contributes?.customEditors?.[0];
    expect(editor?.priority).toBe("option");
    expect(editor?.priority).not.toBe("default");
  });

  test("selector matches *.md files", () => {
    const editor = pkg.contributes?.customEditors?.[0];
    expect(editor?.selector).toEqual([{ filenamePattern: "*.md" }]);
  });
});
