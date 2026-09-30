/**
 * Source-level tests for ProjectConnectionsSection.svelte (#310 — the
 * Connections tab of a plain-folder project was two facts and one sentence on
 * an otherwise blank page, with no next step).
 *
 * The contract: a plain folder gets a plain-language "Turn on version history"
 * action wired to the existing `api.vcs.enableVersionHistory` route — no new
 * backend — and every git-backed project (with or without an online
 * repository) keeps showing exactly what it showed before.
 *
 * Svelte templates have no mount/DOM harness in this repo's bun:test setup, so
 * — like features-section.test.ts, ux-writer-friendly.test.ts — these assert
 * on the source text. The behavior itself is exercised in the real app.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");

const src = read("src/lib/components/ProjectConnectionsSection.svelte");
const script = src.slice(src.indexOf("<script"), src.indexOf("</script>"));
const markup = src.slice(src.indexOf("</script>"), src.indexOf("<style>"));

/** The function body of `turnOnVersionHistory`, up to the next top-level declaration. */
const action = script.slice(
  script.indexOf("async function turnOnVersionHistory"),
  script.indexOf("const isPlainFolder"),
);

describe("ProjectConnectionsSection — plain folder gets a next step (#310)", () => {
  test("a plain folder is recognised from the diagnosis's classification", () => {
    expect(script).toContain('const isPlainFolder = $derived(diag?.classification.type === "local-folder");');
  });

  test("it offers one 'Turn on version history' button, only for a plain folder", () => {
    expect(markup.split("Turn on version history").length - 1).toBe(1);
    const block = markup.slice(markup.indexOf("{#if isPlainFolder}"));
    expect(block.indexOf("Turn on version history")).toBeGreaterThan(-1);
    // The button sits inside that guard, before the account-settings button.
    expect(block.indexOf("Turn on version history")).toBeLessThan(block.indexOf("{#if needsAccounts"));
    expect(markup).toContain("onclick={turnOnVersionHistory}");
  });

  test("the button drives the EXISTING version-history route — no new backend", () => {
    expect(action).toContain("await api.vcs.enableVersionHistory(projectDir);");
    expect(fs.existsSync(path.join(root, "src/routes/api/vcs/enable-version-history/+server.ts"))).toBe(true);
  });

  test("it can't be double-fired: guarded on entry and disabled while working", () => {
    expect(action).toContain("if (!projectDir || enabling) return;");
    expect(markup).toContain("disabled={enabling}");
    expect(action).toMatch(/finally \{\s*enabling = false;/);
  });

  test("on success the parent is told and the tab re-reads its own diagnosis", () => {
    const enabled = action.indexOf("await api.vcs.enableVersionHistory(projectDir);");
    const told = action.indexOf("onVersionHistoryEnabled?.(projectDir);");
    const reloaded = action.indexOf("await load();");
    expect(enabled).toBeGreaterThan(-1);
    expect(told).toBeGreaterThan(enabled);
    expect(reloaded).toBeGreaterThan(told);
    // A confirmation, since the button disappears once it has worked.
    expect(action).toContain("justEnabled = true;");
    expect(markup).toContain("{#if justEnabled}");
  });

  test("a failure is one plain sentence in an alert, never the route's raw JSON envelope", () => {
    expect(action).toMatch(/catch \{[\s\S]*enableError =\s*"Couldn't turn on version history\./);
    expect(action).not.toContain("e.message");
    expect(markup).toMatch(/role="alert">\{enableError\}/);
  });

  test("the new copy stays in the writer's vocabulary (no snapshot/commit/repo/branch/git)", () => {
    const strings = [
      script.match(/Version history is off\.[^"]*/)?.[0],
      markup.match(/Version history is on — [^<]*/)?.[0],
      action.match(/"Couldn't turn on version history\.[^"]*"/)?.[0],
      "Turn on version history",
      "Turning on…",
    ];
    for (const s of strings) {
      expect(s).toBeTruthy();
      expect(s!).not.toMatch(/snapshot|commit|\brepo|branch|\bgit\b/i);
    }
  });
});

describe("ProjectConnectionsSection — git-backed projects are unchanged (#310)", () => {
  test("the no-remote guidance for a git folder keeps its original sentence", () => {
    const caseAt = script.indexOf('case "local-only":');
    expect(script.slice(caseAt, caseAt + 700)).toContain(
      '"This book lives only on this computer. Everything works without a Git server."',
    );
    // ...and only a plain folder gets the version-history sentence instead.
    expect(script.slice(caseAt, caseAt + 200)).toContain("isPlainFolder");
  });

  test("the remote guidance, account button and explicit Test remote access are all still there", () => {
    for (const piece of [
      'case "connect-github-to-sync":',
      'case "https-connect-server":',
      'case "ready-to-sync":',
      'case "ssh-use-own-tools":',
      "Open account settings…",
      "onclick={runRemoteTest}",
      "Test remote access",
      "Server connection",
      "Online repository",
    ]) {
      expect(src).toContain(piece);
    }
    // The remote probe stays behind the online-repository check, off the plain-folder path.
    expect(markup).toContain("{#if diag.remoteUrl}");
  });

  test("the folder row still names each state (plain / connected / local history)", () => {
    expect(script).toContain('return "Plain folder";');
    expect(script).toContain('"Connected folder (has an online repository)"');
    expect(script).toContain('"Local version history"');
  });
});

describe("Connections → parent wiring (#310)", () => {
  test("ProjectSettingsView passes the callback straight through to the section", () => {
    const view = read("src/lib/components/ProjectSettingsView.svelte");
    expect(view).toContain("onVersionHistoryEnabled?: (projectDir: string) => void;");
    expect(view).toContain("<ProjectConnectionsSection {projectDir} {onOpenAccounts} {onVersionHistoryEnabled} />");
  });

  test("the page re-classifies the project so the status bar's cached capabilities catch up", () => {
    const page = read("src/routes/+page.svelte");
    const mount = page.slice(page.indexOf("<ProjectSettingsView"), page.indexOf("<ProjectSettingsView") + 900);
    expect(mount).toContain("onVersionHistoryEnabled={(dir) => void projectSession.classify(dir)}");
  });

  test("the route no longer claims nothing in the app calls it", () => {
    const route = read("src/routes/api/vcs/enable-version-history/+server.ts");
    expect(route).not.toContain("no SPA action calls");
    expect(route).toContain("ProjectConnectionsSection");
  });
});
