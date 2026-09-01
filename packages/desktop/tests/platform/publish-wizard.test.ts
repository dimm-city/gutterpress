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
    // Reuses the existing api.publish.* backend + the new preflight route (#105).
    expect(page).toContain("api.publish.listProviders");
    expect(page).toContain("api.publish.run(dir, providerId, options)");
    expect(page).toContain("api.publish.preflight(dir, providerIds)");
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
    expect(wiz).toContain("if (entersPreflightForward(direction, target, totalSteps)) runPreflightNow()");
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

  // ── OAuth connect branch (#221 D10) ──────────────────────────────────────
  test("branches the connect UI on connectKind === oauth instead of a paste-a-key form", () => {
    expect(wiz).toContain('card.connectKind === "oauth"');
    expect(wiz).toContain("controller.connectGoogleOAuth(card.id)");
    expect(wiz).toContain("controller.cancelGoogleOAuth(card.id)");
    expect(wiz).toContain("controller.reopenGoogleAuthUrl(card.id)");
    // Busy copy + fallback link, per the task brief's exact wording.
    expect(wiz).toContain("Waiting for your browser");
    expect(wiz).toContain("choose your Google account and click Allow");
    expect(wiz).toContain("Open the sign-in page again");
    expect(wiz).toContain("Connect Google Drive");
  });
  test("the saved-accounts picker and add-another-account flow are unbranched (work the same for oauth)", () => {
    // onAccountSelect/selectCredential/setPublishAccountDraft sit OUTSIDE the
    // connectKind branch — they must not be duplicated per branch.
    const oauthBranchIdx = wiz.indexOf('card.connectKind === "oauth"');
    const accountSelectIdx = wiz.indexOf("onAccountSelect(card");
    expect(accountSelectIdx).toBeGreaterThan(-1);
    expect(accountSelectIdx).toBeLessThan(oauthBranchIdx);
  });
  test("on success, reuses the existing Connected row styling and shows the account email", () => {
    expect(wiz).toContain("card.savedAccounts.find((a) => a.account === card.selectedAccount)");
    expect(wiz).toContain('class="conn-ok"');
    expect(wiz).toContain("Connected — reusing your saved key");
  });

  // ── Folder (destinations) picker (#221 D9) ───────────────────────────────
  test("renders a provider-neutral folder picker when card.destinations is present", () => {
    expect(wiz).toContain("card.destinations");
    expect(wiz).toContain("controller.publishDestinations[card.id]");
    expect(wiz).toContain("controller.selectDestination(card.id");
    expect(wiz).toContain("controller.loadDestinations(card.id)");
  });
  test("offers an inline New folder… create flow", () => {
    expect(wiz).toContain("NEW_FOLDER");
    expect(wiz).toContain("controller.createNewDestination(card.id)");
    expect(wiz).toContain("controller.setNewDestinationDraft(card.id");
  });
  test("the free-text folder config field stays as the no-picker fallback", () => {
    // card.fields (the data-driven configFields loop, which renders gdrive's
    // free-text "folder" field) is untouched by the picker addition.
    expect(wiz).toContain("card.fields as field (field.key)");
    expect(wiz).toContain("controller.setPublishConfigDraft(card.id, field.key");
  });
  test("loading a setup step for a connected provider with destinations refreshes the picker (no $effect)", () => {
    expect(wiz).toContain('function enterStep(target: number, direction: "forward" | "back")');
    expect(wiz).toContain("card?.connected && card.destinations");
    expect(wiz).toContain("void controller.loadDestinations(card.id)");
  });

  // ── Backward navigation into Preflight must not rerun it (#221 C4) ───────
  test("next() enters Preflight forward; back() enters it backward — only forward reruns", () => {
    expect(wiz).toContain('enterStep(Math.min(stepIndex + 1, totalSteps - 1), "forward")');
    expect(wiz).toContain('enterStep(Math.max(stepIndex - 1, 0), "back")');
    expect(wiz).toContain("entersPreflightForward,");
  });

  // ── Format choice (#221 phase 3, D8 — gdrive PDF/Website) ────────────────
  test("renders a PDF/Website choice only for a provider that declares more than one format", () => {
    expect(wiz).toContain("card.formats && card.formats.length > 1");
    expect(wiz).toContain("controller.effectiveFormat(card)");
    expect(wiz).toContain("chooseFormat(card, fmt)");
  });
  test("the format choice mentions Drive is file delivery, not a live website", () => {
    const idx = wiz.indexOf("card.formats && card.formats.length > 1");
    const region = wiz.slice(idx, idx + 1600);
    expect(region).toContain("Azure Static Web Apps");
  });

  // ── Radio `checked` state must re-derive from the controller after a
  //    failed selectFormat(), not stay stuck on the clicked option (#221 C8) ─
  test("the format radio's checked state is driven by an in-flight optimistic pick that ALWAYS clears once selectFormat settles", () => {
    expect(wiz).toContain('import { displayedFormat } from "$lib/publish-format-choice"');
    expect(wiz).toContain(
      "{@const chosenFormat = displayedFormat(pendingFormat[card.id], controller.effectiveFormat(card))}",
    );
    expect(wiz).toContain("checked={chosenFormat === fmt}");
    // chooseFormat sets the optimistic pick, then clears it in `finally` —
    // i.e. on BOTH success and failure, never leaving a stale override.
    const idx = wiz.indexOf("async function chooseFormat(");
    expect(idx).toBeGreaterThan(-1);
    const region = wiz.slice(idx, idx + 500);
    expect(region).toContain("pendingFormat = { ...pendingFormat, [card.id]: fmt }");
    expect(region).toContain("await controller.selectFormat(card.id, fmt)");
    expect(region).toContain("} finally {");
    expect(region).toContain("delete rest[card.id]");
  });
});
