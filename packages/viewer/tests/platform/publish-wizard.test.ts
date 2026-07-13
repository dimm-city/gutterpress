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
  test("a Publish button sits by Save PDF, uses the global button style, and opens the wizard", () => {
    const pubIdx = page.indexOf('name="cloud-upload"');
    expect(pubIdx).toBeGreaterThan(-1);
    expect(page).toContain("publishOpen = true");
    // The Publish button follows the global primary button style (#5) — the
    // same class the neighbouring Save PDF button uses.
    const region = page.slice(Math.max(0, pubIdx - 300), pubIdx);
    expect(region).toContain("app-btn-primary");
    // Rendered right after the Save PDF / Export HTML block.
    const savePdfIdx = page.indexOf("exportController.savePdf()");
    expect(savePdfIdx).toBeGreaterThan(-1);
    expect(pubIdx).toBeGreaterThan(savePdfIdx);
  });
  test("the wizard is mounted (fresh, via {#if}) and wired to the shared controller", () => {
    expect(page).toContain("{#if publishOpen}");
    expect(page).toContain("<PublishWizard controller={publishController} onClose={() => (publishOpen = false)} />");
    expect(page).toContain("const publishController = new PublishSectionController(");
    // Reuses the existing api.publish.* backend — no new routes.
    expect(page).toContain("api.publish.listProviders");
    expect(page).toContain("api.publish.run(dir, providerId, options)");
  });
});

describe("Publishing removed from the crammed Project settings section", () => {
  const panel = read("src/lib/components/ProjectConfigPanel.svelte");
  test("ProjectConfigPanel no longer renders or constructs the publish section", () => {
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
    // choose + one step per selected destination + publish
    expect(wiz).toContain("const totalSteps = $derived(selectedCards.length + 2)");
    expect(wiz).toContain('stepKind === "setup"');
    expect(wiz).toContain("selectedCards[stepIndex - 1]");
  });
  test("uses the shared dialog form conventions, not config-section classes (#3)", () => {
    expect(wiz).toContain('@import "$lib/styles/dialog-shell.css"');
    expect(wiz).toContain('class="dlg-primary"');
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
    expect(wiz).toContain("Use a different key");
    // Guided providers need no key.
    expect(wiz).toContain("No account or key needed");
  });
  test("stays $effect-free (CLAUDE.md §8) — load happens onMount", () => {
    expect(wiz).not.toContain("$effect(");
    expect(wiz).toContain("onMount(");
  });
});
