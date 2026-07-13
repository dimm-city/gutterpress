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
  test("a Publish button sits by Save PDF and opens the wizard", () => {
    expect(page).toContain("class=\"publish-btn icon-text\"");
    expect(page).toContain('name="cloud-upload"');
    expect(page).toContain("publishOpen = true");
    // Rendered right after the Save PDF / Export HTML block.
    const pubIdx = page.indexOf("publish-btn icon-text");
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
  test("is a three-step wizard (choose → set up → publish)", () => {
    expect(wiz).toContain("let step = $state<Step>(1)");
    expect(wiz).toContain("Where do you want to publish?");
    expect(wiz).toContain("Set up your destinations");
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
