import { expect, test } from "bun:test";
import { PublishSectionController } from "../../src/lib/routes/publish-section-controller.svelte";
import type {
  PublishDestination,
  PublishDestinationStatus,
  PublishProviderCard,
  PublishRunResult,
} from "../../src/lib/platform/contract";
import type { PreflightRow } from "../../src/lib/preflight";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as design-section-controller.test.ts).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

type Spy = { calls: unknown[][] };
const spy = (): ((...a: unknown[]) => void) & Spy => {
  const fn = ((...a: unknown[]) => {
    fn.calls.push(a);
  }) as ((...a: unknown[]) => void) & Spy;
  fn.calls = [];
  return fn;
};

const CARD: PublishProviderCard = {
  id: "itch",
  label: "itch.io",
  kind: "api",
  format: "pdf",
  description: "d",
  fields: [{ key: "project", label: "Project slug" }],
  credentialRequired: true,
  connected: false,
  config: {},
};

interface Harness {
  ctrl: PublishSectionController;
  onSaved: ReturnType<typeof spy>;
  onPublished: ReturnType<typeof spy>;
  projectDir: string | null;
  cards: PublishProviderCard[];
  setConfigCalls: Array<{ dir: string; providerId: string; values: Record<string, string> }>;
  runResult: PublishRunResult;
  preflightRows: PreflightRow[];
  preflightCalls: Array<{ dir: string; providerIds: string[] }>;
  failPreflight: boolean;
  /** What the host reports for the Drive step (#452), and the folders it lists. */
  status: PublishDestinationStatus;
  statusCalls: number;
  folders: PublishDestination[];
}

function make(over: Partial<{ noProject: boolean; cards: PublishProviderCard[] }> = {}): Harness {
  const onSaved = spy();
  const onPublished = spy();
  const h = {
    onSaved,
    onPublished,
    projectDir: over.noProject ? null : "/proj",
    cards: over.cards ?? [CARD],
    setConfigCalls: [],
    runResult: { ok: true, providerId: "itch", issues: [] },
    preflightRows: [],
    preflightCalls: [],
    failPreflight: false,
    status: { state: "unset" },
    statusCalls: 0,
    folders: [],
  } as Harness;
  h.ctrl = new PublishSectionController({
    projectDir: () => h.projectDir,
    listProviders: () => Promise.resolve(h.cards),
    preflight: (dir, providerIds) => {
      h.preflightCalls.push({ dir, providerIds });
      if (h.failPreflight) return Promise.reject(new Error("preflight boom"));
      return Promise.resolve(h.preflightRows);
    },
    setConfig: (dir, providerId, values) => {
      h.setConfigCalls.push({ dir, providerId, values });
      return Promise.resolve({});
    },
    listDestinations: () => Promise.resolve(h.folders),
    createDestination: (_dir, _providerId, name) => Promise.resolve({ id: `new-${name}`, title: name }),
    destinationStatus: () => {
      h.statusCalls++;
      return Promise.resolve(h.status);
    },
    run: () => Promise.resolve(h.runResult),
    openExternal: () => Promise.resolve({ ok: true }),
    onSaved: () => onSaved(),
    onPublished: (guided) => onPublished(guided),
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.publishCards).toEqual([]);
  expect(ctrl.publishError).toBeNull();
  expect(ctrl.publishBusyId).toBeNull();
  expect(ctrl.publishResults).toEqual({});
  expect(ctrl.publishConfigDrafts).toEqual({});
});

test("loadPublish populates the provider cards", async () => {
  const h = make();
  await h.ctrl.loadPublish();
  expect(h.ctrl.publishCards).toEqual([CARD]);
});

test("loadPublish no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadPublish();
  expect(h.ctrl.publishCards).toEqual([]);
});

test("setPublishConfigDraft updates the per-provider draft map", () => {
  const h = make();
  h.ctrl.setPublishConfigDraft("itch", "project", "my-book");
  expect(h.ctrl.publishConfigDrafts).toEqual({ itch: { project: "my-book" } });
});

test("savePublishConfig flushes the draft, reloads cards, and fires onSaved", async () => {
  const h = make();
  h.ctrl.setPublishConfigDraft("itch", "project", "my-book");
  await h.ctrl.savePublishConfig("itch");
  expect(h.setConfigCalls).toEqual([{ dir: "/proj", providerId: "itch", values: { project: "my-book" } }]);
  expect(h.ctrl.publishConfigDrafts).toEqual({ itch: {} });
  expect(h.onSaved.calls.length).toBe(1);
  expect(h.ctrl.publishBusyId).toBeNull();
});

test("savePublishConfig is a no-op when there is no pending draft (no host call)", async () => {
  const h = make();
  await h.ctrl.savePublishConfig("itch");
  expect(h.setConfigCalls.length).toBe(0);
  expect(h.onSaved.calls.length).toBe(1); // still "saved" — reload + callback run either way
});

test("runPublish (dry run) does not flush drafts, and does not fire onPublished even on success", async () => {
  const h = make();
  h.ctrl.setPublishConfigDraft("itch", "project", "unsaved-value");
  h.runResult = { ok: true, providerId: "itch", issues: [] };
  await h.ctrl.runPublish("itch", true);
  expect(h.setConfigCalls.length).toBe(0); // dry run must have no side effects
  expect(h.ctrl.publishResults.itch).toEqual(h.runResult);
  expect(h.onPublished.calls.length).toBe(0);
});

test("runPublish (real run) flushes drafts first and fires onPublished(false) for a direct-publish outcome", async () => {
  const h = make();
  h.ctrl.setPublishConfigDraft("itch", "project", "my-book");
  h.runResult = { ok: true, providerId: "itch", issues: [], outcome: { kind: "published", detail: "Published." } };
  await h.ctrl.runPublish("itch", false);
  expect(h.setConfigCalls.length).toBe(1);
  expect(h.onPublished.calls).toEqual([[false]]);
});

test("runPublish fires onPublished(true) for a guided outcome", async () => {
  const h = make();
  h.runResult = {
    ok: true,
    providerId: "itch",
    issues: [],
    outcome: { kind: "guided", packageDir: "/pkg", openUrl: "https://x", checklist: [] },
  };
  await h.ctrl.runPublish("itch", false);
  expect(h.onPublished.calls).toEqual([[true]]);
});

test("runPublish does not fire onPublished when the run failed", async () => {
  const h = make();
  h.runResult = { ok: false, providerId: "itch", issues: [], error: "boom" };
  await h.ctrl.runPublish("itch", false);
  expect(h.onPublished.calls.length).toBe(0);
});

test("runPublish forwards the artifact the wizard just built, and omits it when none is given", async () => {
  const h = make();
  let capturedOptions: unknown;
  h.ctrl = new PublishSectionController({
    projectDir: () => h.projectDir,
    listProviders: () => Promise.resolve(h.cards),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.resolve({}),
    listDestinations: () => Promise.resolve([]),
    createDestination: () => Promise.resolve({ id: "d", title: "d" }),
    run: (_dir, _providerId, options) => {
      capturedOptions = options;
      return Promise.resolve(h.runResult);
    },
    openExternal: () => Promise.resolve({ ok: true }),
  });
  await h.ctrl.runPublish("itch", true);
  expect(capturedOptions).toEqual({ dryRun: true });
  await h.ctrl.runPublish("itch", false, "/proj/dist/book.pdf");
  expect(capturedOptions).toEqual({ dryRun: false, artifactPath: "/proj/dist/book.pdf" });
});

// ── Multi-format providers (#221 phase 3, D8 — gdrive) ──────────────────────

const GDRIVE_CARD: PublishProviderCard = {
  id: "gdrive",
  label: "Google Drive",
  kind: "api",
  format: "pdf",
  formats: ["pdf", "html"],
  description: "d",
  fields: [{ key: "folder", label: "Drive folder" }],
  credentialRequired: true,
  connected: true,
  config: {},
};

test("effectiveFormat falls back to card.format for a provider with no formats array", () => {
  const h = make();
  expect(h.ctrl.effectiveFormat(CARD)).toBe("pdf");
});

test("effectiveFormat defaults to card.format when publish.<id>.format is unset", () => {
  const h = make();
  expect(h.ctrl.effectiveFormat(GDRIVE_CARD)).toBe("pdf");
});

test("effectiveFormat uses the saved publish.<id>.format when it's a value the card declares", () => {
  const h = make();
  const card = { ...GDRIVE_CARD, config: { format: "html" } };
  expect(h.ctrl.effectiveFormat(card)).toBe("html");
});

test("effectiveFormat ignores an unrecognized saved format and falls back to the default", () => {
  const h = make();
  const card = { ...GDRIVE_CARD, config: { format: "epub" } };
  expect(h.ctrl.effectiveFormat(card)).toBe("pdf");
});

test("effectiveFormat prefers an unsaved draft over the saved value", () => {
  const h = make();
  h.ctrl.setPublishConfigDraft("gdrive", "format", "html");
  const card = { ...GDRIVE_CARD, config: { format: "pdf" } };
  expect(h.ctrl.effectiveFormat(card)).toBe("html");
});

test("selectFormat writes publish.<id>.format via setConfig and reloads the cards", async () => {
  const h = make({ cards: [GDRIVE_CARD] });
  await h.ctrl.selectFormat("gdrive", "html");
  expect(h.setConfigCalls).toEqual([{ dir: "/proj", providerId: "gdrive", values: { format: "html" } }]);
  expect(h.ctrl.publishBusyId).toBeNull();
});

const PF_ROW = (over: Partial<PreflightRow>): PreflightRow => ({
  id: "source.markdownlint",
  category: "source",
  severity: "warning",
  label: "Markdown style",
  message: "msg",
  code: null,
  fixable: "none",
  ...over,
});

test("runPreflight forwards the selected provider ids and stores the rows + ran flag", async () => {
  const h = make();
  h.preflightRows = [PF_ROW({ severity: "error" })];
  expect(h.ctrl.preflightRan).toBe(false);
  await h.ctrl.runPreflight(["itch", "kdp"]);
  expect(h.preflightCalls).toEqual([{ dir: "/proj", providerIds: ["itch", "kdp"] }]);
  expect(h.ctrl.preflightRows.length).toBe(1);
  expect(h.ctrl.preflightRan).toBe(true);
  expect(h.ctrl.preflightBusy).toBe(false);
  expect(h.ctrl.preflightError).toBeNull();
});

test("runPreflight is a no-op with no project open", async () => {
  const h = make({ noProject: true });
  await h.ctrl.runPreflight(["itch"]);
  expect(h.preflightCalls).toEqual([]);
  expect(h.ctrl.preflightRan).toBe(false);
});

test("runPreflight records the error, clears rows, but still marks ran (so the gate evaluates)", async () => {
  const h = make();
  h.preflightRows = [PF_ROW({})];
  await h.ctrl.runPreflight(["itch"]); // seed some rows first
  expect(h.ctrl.preflightRows.length).toBe(1);
  h.failPreflight = true;
  await h.ctrl.runPreflight(["itch"]);
  expect(h.ctrl.preflightError).toBe("preflight boom");
  expect(h.ctrl.preflightRows).toEqual([]);
  expect(h.ctrl.preflightRan).toBe(true);
  expect(h.ctrl.preflightBusy).toBe(false);
});

// ── Account choice + destinations picker (#221 C2/C3) ───────────────────────

const GDRIVE_DEST_CARD: PublishProviderCard = {
  ...CARD,
  id: "gdrive",
  connectKind: "oauth",
  connected: false,
  destinations: { label: "Drive folder", canCreate: true },
} as PublishProviderCard;

test("selectCredential records the chosen account through setConfig alone, and clears it with an empty one", async () => {
  const h = make({ cards: [{ ...CARD, savedAccounts: [{ account: "Studio", label: "Studio", createdAt: 1 }], selectedAccount: "" }] });
  await h.ctrl.selectCredential("itch", "Studio");
  await h.ctrl.selectCredential("itch", "");
  // The controller never decides where it is kept: the host keeps the account
  // in the person's private settings for the book, not in the manifest.
  expect(h.setConfigCalls).toEqual([
    { dir: "/proj", providerId: "itch", values: { credential: "Studio" } },
    { dir: "/proj", providerId: "itch", values: { credential: "" } },
  ]);
  expect(h.ctrl.publishBusyId).toBeNull();
});

test("picking an output folder sends the path exactly as picked; the host files it as shared or private", async () => {
  const h = make({ cards: [{ ...CARD, id: "local", credentialRequired: false, fields: [{ key: "dir", label: "Folder" }] }] });
  h.ctrl.setPublishConfigDraft("local", "dir", "/proj/exports");
  await h.ctrl.savePublishConfig("local");
  h.ctrl.setPublishConfigDraft("local", "dir", "/Users/ada/Dropbox/Books");
  await h.ctrl.savePublishConfig("local");
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ dir: "/proj/exports" }, { dir: "/Users/ada/Dropbox/Books" }]);
});

test("a chosen Drive folder is written as {folderId, folder} through setConfig (the team's destination, so shared)", async () => {
  const h = make();
  await h.ctrl.selectDestination("gdrive", { id: "F1", title: "My Books" });
  expect(h.setConfigCalls).toEqual([{ dir: "/proj", providerId: "gdrive", values: { folderId: "F1", folder: "My Books" } }]);
});

test("saveDestinations writes only the ticks that changed, as publish.<id>.enabled, then reloads", async () => {
  const shopify = { ...CARD, id: "shopify", config: { enabled: "true" } };
  const gdrive = { ...CARD, id: "gdrive", config: {} };
  const h = make({ cards: [CARD, shopify, gdrive] });
  await h.ctrl.loadPublish();

  // itch newly ticked, shopify unticked, gdrive still unticked (unchanged).
  expect(await h.ctrl.saveDestinations({ itch: true, shopify: false, gdrive: false })).toBe(true);
  expect(h.setConfigCalls).toEqual([
    { dir: "/proj", providerId: "itch", values: { enabled: true } },
    { dir: "/proj", providerId: "shopify", values: { enabled: "" } },
  ]);
  expect(h.ctrl.publishBusyId).toBeNull();
});

test("tickedDestinations lists the destinations the manifest has ticked, so a teammate sees them ticked", async () => {
  const ticked = { ...CARD, id: "shopify", config: { enabled: "true" } };
  const h = make({ cards: [CARD, ticked, { ...CARD, id: "gdrive", config: { enabled: "false" } }] });
  expect(h.ctrl.tickedDestinations).toEqual([]);
  await h.ctrl.loadPublish();
  expect(h.ctrl.tickedDestinations).toEqual(["shopify"]);
});

test("saveDestinations does not touch the manifest when nothing changed", async () => {
  const h = make({ cards: [{ ...CARD, config: { enabled: "true" } }] });
  await h.ctrl.loadPublish();
  expect(await h.ctrl.saveDestinations({ itch: true })).toBe(true);
  expect(h.setConfigCalls.length).toBe(0);
});

test("saveDestinations reports a failed write and keeps the reason", async () => {
  const h = make();
  await h.ctrl.loadPublish();
  const failing = new PublishSectionController({
    projectDir: () => "/proj",
    listProviders: () => Promise.resolve(h.cards),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.reject(new Error("manifest is read-only")),
    listDestinations: () => Promise.resolve([]),
    createDestination: () => Promise.reject(new Error("not used")),
    run: () => Promise.reject(new Error("not used")),
    openExternal: () => Promise.resolve({ ok: true }),
  });
  await failing.loadPublish();
  expect(await failing.saveDestinations({ itch: true })).toBe(false);
  expect(failing.publishError).toBe("manifest is read-only");
  expect(failing.publishBusyId).toBeNull();
});

test("the controller holds no key or account-name drafts: accounts are added in the Accounts page's own form", () => {
  const { ctrl } = make();
  const names = Object.getOwnPropertyNames(ctrl);
  for (const gone of ["publishTokenDrafts", "publishAccountDrafts", "connectPublish", "disconnectPublish", "connectGoogleOAuth"]) {
    expect(names).not.toContain(gone);
  }
});

/** Flush the microtask queue so an async function's chain of internal awaits has
 *  had a chance to fully unwind, without waiting on a real timer. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

test("selectCredential triggers a destinations reload for the newly selected account (#221 C2)", async () => {
  const listDestinationsCalls: Array<{ dir: string; providerId: string }> = [];
  const ctrl = new PublishSectionController({
    projectDir: () => "/proj",
    listProviders: () => Promise.resolve([{ ...GDRIVE_DEST_CARD, connected: true }]),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.resolve({}),
    listDestinations: (dir, providerId) => {
      listDestinationsCalls.push({ dir, providerId });
      return Promise.resolve([]);
    },
    createDestination: () => Promise.reject(new Error("not used")),
    destinationStatus: () => Promise.resolve({ state: "unset" }),
    run: () => Promise.reject(new Error("not used")),
    pickPdfFile: () => Promise.resolve(null),
    openDirectory: () => Promise.resolve(null),
    openExternal: () => Promise.resolve({ ok: true }),
  });

  await ctrl.selectCredential("gdrive", "studio");
  expect(listDestinationsCalls).toEqual([{ dir: "/proj", providerId: "gdrive" }]);
});

test("selectCredential does not reload destinations for a provider without a picker", async () => {
  const listDestinationsCalls: unknown[] = [];
  const h = make();
  // The default CARD (itch) has no `destinations` — no-op, as
  // a reload of the cards alone.
  h.ctrl = new PublishSectionController({
    projectDir: () => h.projectDir,
    listProviders: () => Promise.resolve(h.cards),
    preflight: () => Promise.resolve([]),
    setConfig: (dir, providerId, values) => {
      h.setConfigCalls.push({ dir, providerId, values });
      return Promise.resolve({});
    },
    listDestinations: () => {
      listDestinationsCalls.push(true);
      return Promise.resolve([]);
    },
    createDestination: () => Promise.reject(new Error("not used")),
    destinationStatus: () => Promise.resolve({ state: "unset" }),
    run: () => Promise.reject(new Error("not used")),
    pickPdfFile: () => Promise.resolve(null),
    openDirectory: () => Promise.resolve(null),
    openExternal: () => Promise.resolve({ ok: true }),
  });
  await h.ctrl.selectCredential("itch", "studio");
  expect(listDestinationsCalls.length).toBe(0);
});

test("destinationsError and destinationsBusyId are keyed PER PROVIDER — an error for one never shows under another (#221 C3)", async () => {
  let providerAShouldFail = true;
  const ctrl = new PublishSectionController({
    projectDir: () => "/proj",
    listProviders: () => Promise.resolve([]),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.resolve({}),
    listDestinations: (dir, providerId) => {
      if (providerId === "gdrive-a" && providerAShouldFail) {
        return Promise.reject(new Error("provider A boom"));
      }
      return Promise.resolve([]);
    },
    createDestination: () => Promise.reject(new Error("not used")),
    destinationStatus: () => Promise.resolve({ state: "unset" }),
    run: () => Promise.reject(new Error("not used")),
    pickPdfFile: () => Promise.resolve(null),
    openDirectory: () => Promise.resolve(null),
    openExternal: () => Promise.resolve({ ok: true }),
  });

  await ctrl.loadDestinations("gdrive-a");
  expect(ctrl.destinationsError["gdrive-a"]).toBe("provider A boom");
  // Provider B's slot must stay untouched by provider A's error.
  expect(ctrl.destinationsError["gdrive-b"]).toBeUndefined();

  providerAShouldFail = false;
  await ctrl.loadDestinations("gdrive-b");
  expect(ctrl.destinationsError["gdrive-b"]).toBeNull();
  // Loading B successfully must not clear A's still-outstanding error.
  expect(ctrl.destinationsError["gdrive-a"]).toBe("provider A boom");
});

test("destinationsBusyId's single-flight guard is per-provider, not global", async () => {
  const calls: string[] = [];
  let releaseA: (() => void) | null = null;
  const ctrl = new PublishSectionController({
    projectDir: () => "/proj",
    listProviders: () => Promise.resolve([]),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.resolve({}),
    listDestinations: (dir, providerId) => {
      calls.push(providerId);
      if (providerId === "gdrive-a") {
        return new Promise((resolve) => {
          releaseA = () => resolve([]);
        });
      }
      return Promise.resolve([]);
    },
    createDestination: () => Promise.reject(new Error("not used")),
    destinationStatus: () => Promise.resolve({ state: "unset" }),
    run: () => Promise.reject(new Error("not used")),
    pickPdfFile: () => Promise.resolve(null),
    openDirectory: () => Promise.resolve(null),
    openExternal: () => Promise.resolve({ ok: true }),
  });

  const loadA = ctrl.loadDestinations("gdrive-a");
  await flushMicrotasks();
  expect(ctrl.destinationsBusyId["gdrive-a"]).toBe(true);
  // Provider B must be able to load concurrently — the busy guard must not
  // be a single GLOBAL lock across every provider.
  await ctrl.loadDestinations("gdrive-b");
  expect(calls).toEqual(["gdrive-a", "gdrive-b"]);
  expect(ctrl.destinationsBusyId["gdrive-b"]).toBe(false);
  expect(ctrl.destinationsBusyId["gdrive-a"]).toBe(true); // still in flight

  releaseA!();
  await loadA;
  expect(ctrl.destinationsBusyId["gdrive-a"]).toBe(false);
});

// ── The book's Drive folder, or one of the person's own (#452) ───────────────
//
// The host reports where this person publishes; the controller turns it into
// the step's words and picks one of two save paths: `folderId`/`folder` (the
// book's, which the host writes to the manifest) or `myFolderId`/`myFolder`
// (theirs, which the host keeps in their private settings).

const DRIVE: PublishProviderCard = {
  ...GDRIVE_DEST_CARD,
  connected: true,
  config: { folderId: "F1", folder: "Harbor Books" },
};
const HARBOR = { id: "F1", title: "Harbor Books" };
const BENS = { id: "B1", title: "Ben's Books" };
const SAVED_FOR_YOU = "It is saved for you only; the book keeps its folder for everyone else.";

async function driveStep(status: PublishDestinationStatus, card: PublishProviderCard = DRIVE): Promise<Harness> {
  const h = make({ cards: [card] });
  h.status = status;
  h.folders = [HARBOR, BENS];
  await h.ctrl.loadPublish();
  await h.ctrl.loadDestinations("gdrive");
  return h;
}

test("case 1: the book's reachable folder is shown with no prompt, and a folder just for me is offered", async () => {
  const h = await driveStep({ state: "book", destination: HARBOR });
  expect(h.ctrl.destinationPrompt("gdrive")).toEqual({
    message: "",
    selected: "F1",
    saveTo: "book",
    canUseBook: false,
    canChooseOwn: true,
  });
});

test("case 2: an unreachable book folder is explained, and the pick is saved for this person only", async () => {
  const h = await driveStep({ state: "unreachable", book: { title: "Harbor Books", reachable: false } });
  expect(h.ctrl.destinationPrompt("gdrive")).toEqual({
    message: `This book publishes to the Drive folder 'Harbor Books', which your Google account can't reach. Choose a folder you can reach. ${SAVED_FOR_YOU}`,
    selected: "",
    saveTo: "mine",
    canUseBook: false,
    canChooseOwn: false,
  });

  h.statusCalls = 0;
  await h.ctrl.selectDestination("gdrive", BENS);
  expect(h.setConfigCalls).toEqual([
    { dir: "/proj", providerId: "gdrive", values: { myFolderId: "B1", myFolder: "Ben's Books" } },
  ]);
  expect(h.statusCalls).toBe(1); // where they now publish is checked again
});

test("case 2: a new folder made on the step is theirs too", async () => {
  const h = await driveStep({ state: "unreachable", book: { title: "Harbor Books", reachable: false } });
  h.ctrl.setNewDestinationDraft("gdrive", "Ben's Copy");
  await h.ctrl.createNewDestination("gdrive");
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ myFolderId: "new-Ben's Copy", myFolder: "Ben's Copy" }]);
});

test("case 3: with no folder yet the first pick is the book's, saved with no question", async () => {
  const h = await driveStep({ state: "unset" }, { ...DRIVE, config: {} });
  expect(h.ctrl.destinationPrompt("gdrive").message).toBe("Saved with the book, so everyone publishes here.");
  await h.ctrl.selectDestination("gdrive", HARBOR);
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ folderId: "F1", folder: "Harbor Books" }]);
});

test("case 4: their own folder is named instead of the book's, and Use the book's folder clears it", async () => {
  const h = await driveStep({ state: "mine", destination: BENS, book: { title: "Harbor Books", reachable: true } });
  expect(h.ctrl.destinationPrompt("gdrive")).toEqual({
    message: "You publish to your own folder 'Ben's Books' instead of the book's 'Harbor Books'.",
    selected: "B1",
    saveTo: "mine",
    canUseBook: true,
    canChooseOwn: false,
  });
  await h.ctrl.useBookDestination("gdrive");
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ myFolderId: "" }]);
});

test("case 4: while the book's folder is still out of reach, it says so and offers no way back yet", async () => {
  const h = await driveStep({ state: "mine", destination: BENS, book: { title: "Harbor Books", reachable: false } });
  const prompt = h.ctrl.destinationPrompt("gdrive");
  expect(prompt.message).toBe(
    "You publish to your own folder 'Ben's Books' instead of the book's 'Harbor Books', which your Google account can't reach.",
  );
  expect(prompt.canUseBook).toBe(false);
  await h.ctrl.selectDestination("gdrive", { id: "B2", title: "Elsewhere" }); // changing their own stays private
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ myFolderId: "B2", myFolder: "Elsewhere" }]);
});

test("case 6: their own folder gone asks again as in case 2, offering the book's folder when it is reachable", async () => {
  const h = await driveStep({ state: "unreachable", book: { title: "Harbor Books", reachable: true }, mine: "Ben's Books" });
  expect(h.ctrl.destinationPrompt("gdrive")).toEqual({
    message: `Your own folder 'Ben's Books' for this book can't be reached any more. Choose a folder you can reach. ${SAVED_FOR_YOU}`,
    selected: "",
    saveTo: "mine",
    canUseBook: true,
    canChooseOwn: false,
  });
  await h.ctrl.selectDestination("gdrive", HARBOR);
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ myFolderId: "F1", myFolder: "Harbor Books" }]);
});

test("case 7: changing the book's reachable folder asks first; only a confirmed change is written, to the manifest", async () => {
  const h = await driveStep({ state: "book", destination: HARBOR });
  await h.ctrl.selectDestination("gdrive", BENS);
  expect(h.ctrl.pendingDestination.gdrive).toEqual(BENS);
  expect(h.setConfigCalls).toEqual([]);

  h.ctrl.cancelBookDestination("gdrive");
  expect(h.ctrl.pendingDestination.gdrive).toBeUndefined();
  expect(h.setConfigCalls).toEqual([]);

  await h.ctrl.selectDestination("gdrive", BENS);
  await h.ctrl.confirmBookDestination("gdrive");
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ folderId: "B1", folder: "Ben's Books" }]);
  expect(h.ctrl.pendingDestination.gdrive).toBeUndefined();
});

test("case 7: Use a different folder just for me makes the next pick private", async () => {
  const h = await driveStep({ state: "book", destination: HARBOR });
  h.ctrl.chooseOwnDestination("gdrive");
  expect(h.ctrl.destinationPrompt("gdrive")).toEqual({
    message: `Choose a folder just for you. ${SAVED_FOR_YOU}`,
    selected: "",
    saveTo: "mine",
    canUseBook: true,
    canChooseOwn: false,
  });
  await h.ctrl.selectDestination("gdrive", BENS);
  expect(h.setConfigCalls.map((c) => c.values)).toEqual([{ myFolderId: "B1", myFolder: "Ben's Books" }]);

  // Changing their mind before picking writes nothing.
  h.ctrl.chooseOwnDestination("gdrive");
  await h.ctrl.useBookDestination("gdrive");
  expect(h.setConfigCalls.length).toBe(1);
  expect(h.ctrl.destinationPrompt("gdrive").saveTo).toBe("book");
});

test("case 8: a folder named only by name is each person's own; several of that name are chosen privately, once", async () => {
  const byName = { ...DRIVE, config: { folder: "Harbor Books" } };
  const one = await driveStep({ state: "by-name", name: "Harbor Books", destination: HARBOR, several: false }, byName);
  expect(one.ctrl.destinationPrompt("gdrive")).toMatchObject({
    message: "Each person publishes to a folder named 'Harbor Books' in their own Drive.",
    selected: "F1",
    saveTo: "book",
  });

  const several = await driveStep({ state: "by-name", name: "Harbor Books", destination: HARBOR, several: true }, byName);
  expect(several.ctrl.destinationPrompt("gdrive")).toMatchObject({
    message:
      "Each person publishes to a folder named 'Harbor Books' in their own Drive. Several of yours have that name: choose the one you publish to. It is saved for you only.",
    selected: "",
    saveTo: "mine",
  });
  await several.ctrl.selectDestination("gdrive", { id: "H1", title: "Harbor Books" });
  expect(several.setConfigCalls.map((c) => c.values)).toEqual([{ myFolderId: "H1", myFolder: "Harbor Books" }]);

  // Afterwards the step names the choice without repeating the name twice.
  const chosen = await driveStep({ state: "mine", destination: { id: "H1", title: "Harbor Books" }, book: { title: "Harbor Books", reachable: true } }, byName);
  expect(chosen.ctrl.destinationPrompt("gdrive").message).toBe("You publish to the folder 'Harbor Books' you chose for yourself.");
});

test("case 9: switching the account re-checks where this person publishes", async () => {
  const h = await driveStep({ state: "mine", destination: BENS, book: { title: "Harbor Books", reachable: false } });
  h.statusCalls = 0;
  h.status = { state: "book", destination: HARBOR };
  await h.ctrl.selectCredential("gdrive", "work");
  expect(h.statusCalls).toBe(1);
  expect(h.ctrl.destinationPrompt("gdrive").selected).toBe("F1");
});

test("before the host has answered, a pick never replaces the book's folder unasked", async () => {
  const h = make({ cards: [DRIVE] });
  await h.ctrl.loadPublish();
  await h.ctrl.selectDestination("gdrive", BENS);
  expect(h.setConfigCalls).toEqual([]);
  expect(h.ctrl.pendingDestination.gdrive).toEqual(BENS);
});
