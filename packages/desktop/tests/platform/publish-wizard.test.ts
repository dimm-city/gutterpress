/**
 * Publishing UX overhaul: publishing moved from the crammed last section of
 * Project settings to a front-and-centre toolbar **Publish** button that opens
 * a step-by-step **PublishWizard**. No component-render harness exists here, so
 * (per the repo convention — see ProjectActivityView.test.ts) these assert on
 * the compiled source text: the toolbar entry point exists, the wizard reuses
 * the existing PublishSectionController (zero new backend), and the old
 * in-settings section is gone.
 */
import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Toolbar Publish button (front-and-centre entry point)", () => {
  const page = read("src/routes/+page.svelte");
  const toolbar = read("src/lib/components/AppToolbar.svelte");
  test("a Publish button leads the primary action trio, uses the global button style, and opens the wizard", () => {
    // The button markup lives in the extracted AppToolbar; +page wires the
    // intent (onPublish → publishOpen = true).
    const pubIdx = toolbar.indexOf('name="cloud-upload"');
    expect(pubIdx).toBeGreaterThan(-1);
    expect(page).toContain("publishOpen = true");
    // The Publish button follows the global primary button style (#5) — the
    // same class the neighbouring Export button uses.
    const region = toolbar.slice(Math.max(0, pubIdx - 300), pubIdx);
    expect(region).toContain("app-btn-primary");
    // Publish leads the trio: Publish → Export → Save (Save right-most).
    const exportIdx = toolbar.indexOf('class="export-btn');
    expect(exportIdx).toBeGreaterThan(-1);
    expect(pubIdx).toBeLessThan(exportIdx);
  });
  test("the wizard is mounted (fresh, via {#if}) and wired to the shared controller", () => {
    expect(page).toContain("{#if publishOpen}");
    expect(page).toContain("<PublishWizard");
    expect(page).toContain("controller={publishController}");
    expect(page).toContain("onClose={() => (publishOpen = false)}");
    expect(page).toContain("const publishController = new PublishSectionController(");
    // Reuses the existing publish-capability backend (SFE-P5c3: typed IPC) +
    // the preflight member (#105).
    expect(page).toContain("publish.listProviders");
    expect(page).toContain("publish.run(dir, providerId, options)");
    expect(page).toContain("publish.preflight(dir, providerIds)");
    // Preflight "Go to" delegates to the shared Problems-panel navigation.
    expect(page).toContain("onNavigate={(entry) =>");
    expect(page).toContain("openProblem(entry)");
  });
});

describe("Publishing removed from the crammed Project settings section", () => {
  // ProjectConfigPanel (the retired sidebar embed) became the full-window
  // ProjectSettingsView — publishing must stay out of it either way.
  const panel = read("src/lib/components/ProjectSettingsView.svelte");
  test("ProjectSettingsView does not render or construct the publish section", () => {
    expect(panel).not.toContain("<PublishSection");
    expect(panel).not.toContain("new PublishSectionController(");
    expect(panel).not.toContain("publish.loadPublish()");
  });
});

describe("PublishWizard — guided, multi-target, reuses saved connections", () => {
  const wiz = read("src/lib/components/PublishWizard.svelte");
  test("drives the existing controller, not a new backend", () => {
    expect(wiz).toContain("controller: PublishSectionController");
    expect(wiz).toContain("controller.loadPublish()");
    expect(wiz).toContain("controller.runPublish(card.id, false)");
    expect(wiz).toContain("controller.connectPublish(card.id)");
    expect(wiz).toContain("controller.setPublishConfigDraft(card.id");
  });
  test("generates a dynamic setup step per selected destination (not one long form)", () => {
    expect(wiz).toContain("let stepIndex = $state(0)");
    // choose + one step per selected destination + preflight + publish (#105)
    expect(wiz).toContain("const totalSteps = $derived(selectedCards.length + 3)");
    expect(wiz).toContain('stepKind === "setup"');
    expect(wiz).toContain("selectedCards[stepIndex - 1]");
  });

  test("has a Preflight step between setup and publish that runs on enter + manual re-run (#105)", () => {
    // A distinct preflight step kind, one before the strict-last publish step.
    expect(wiz).toContain('stepKind === "preflight"');
    expect(wiz).toContain('"Preflight"');
    // Entered via the step-change handler (NOT $effect) and re-runnable.
    expect(wiz).toContain("if (target === totalSteps - 2) runPreflightNow()");
    expect(wiz).toContain("controller.runPreflight(selectedCards.map((c) => c.id))");
    expect(wiz).toContain("onclick={runPreflightNow}");
    // Grouped, plain-language rows with a red/amber/green header.
    expect(wiz).toContain("preflightHeaderLevel(controller.preflightRows)");
    expect(wiz).toContain("groupPreflight(controller.preflightRows)");
    // Post-build PDF checks are noted as running at export.
    expect(wiz).toContain("run automatically when you export");
  });

  test("blocking-error gate disables Publish with an explicit override (#105)", () => {
    // Errors block; the gate also engages when preflight hasn't run OR errored.
    expect(wiz).toContain(
      "const publishGated = $derived(preflightMissing || preflightErrored || preflightBlocks)",
    );
    expect(wiz).toContain("disabled={busy || needsConnect || publishGated}");
    // Warnings/info never block — only error count drives preflightBlocks.
    expect(wiz).toContain('controller.preflightRows.filter((r) => r.severity === "error").length');
    // "Publish anyway" requires the shared inline-confirm (two-step).
    expect(wiz).toContain("requestInlineConfirm(overrideConfirm");
    expect(wiz).toContain("Publish anyway");
    // Navigate rules get a "Go to"; none rules just explain themselves.
    expect(wiz).toContain('row.fixable === "navigate"');
    expect(wiz).toContain("onclick={() => goTo(row)}");
  });
  test("a preflight infrastructure failure keeps the gate closed and hides success (#105 hardening)", () => {
    // The errored run must not read as "all clear": it feeds the gate...
    expect(wiz).toContain("const preflightErrored = $derived(controller.preflightError !== null)");
    // ...and suppresses the "No problems found" success branch.
    expect(wiz).toContain(
      "controller.preflightRan && !controller.preflightBusy && !controller.preflightError",
    );
  });
  test("uses the shared dialog form conventions, not config-section classes (#3)", () => {
    expect(wiz).toContain('@import "$lib/styles/dialog-shell.css"');
    expect(wiz).toContain('class="dlg-primary app-btn-primary"');
    expect(wiz).toContain('class="dlg-ghost"');
    expect(wiz).toContain('class="field"');
    expect(wiz).not.toContain("config-section-shared.css");
  });
  test("supports selecting multiple destinations and publishing to all", () => {
    expect(wiz).toContain("let selected = $state<Set<string>>");
    expect(wiz).toContain("async function publishAll()");
  });
  test("reuses saved connections and lets the author change the key per project", () => {
    expect(wiz).toContain("reusing your saved key");
    expect(wiz).toContain("Remove this key");
    // Guided providers need no key.
    expect(wiz).toContain("No account or key needed");
  });
  test("offers a credential picker over saved accounts (named creds) with an add-another option", () => {
    // A <select> of saved accounts drives book-level selection…
    expect(wiz).toContain("card.savedAccounts");
    expect(wiz).toContain("onAccountSelect(card");
    expect(wiz).toContain("controller.selectCredential(card.id");
    // …plus an "add another account" path that names + connects a new one.
    expect(wiz).toContain("Add another account");
    expect(wiz).toContain("controller.setPublishAccountDraft(card.id");
  });
  test("stays $effect-free (CLAUDE.md §8) — load happens onMount", () => {
    expect(wiz).not.toContain("$effect(");
    expect(wiz).toContain("onMount(");
  });
});
