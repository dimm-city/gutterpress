import { expect, test } from "bun:test";
import { PublishSectionController } from "../../src/lib/routes/publish-section-controller.svelte";
import type { PublishProviderCard, PublishRunResult } from "../../src/lib/platform/contract";
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
  onConnected: ReturnType<typeof spy>;
  onPublished: ReturnType<typeof spy>;
  projectDir: string | null;
  cards: PublishProviderCard[];
  setConfigCalls: Array<{ dir: string; providerId: string; values: Record<string, string> }>;
  connectCalls: Array<{ dir: string; providerId: string; token: string }>;
  runResult: PublishRunResult;
  failConnect: boolean;
  preflightRows: PreflightRow[];
  preflightCalls: Array<{ dir: string; providerIds: string[] }>;
  failPreflight: boolean;
}

function make(over: Partial<{ noProject: boolean; cards: PublishProviderCard[] }> = {}): Harness {
  const onSaved = spy();
  const onConnected = spy();
  const onPublished = spy();
  const h = {
    onSaved,
    onConnected,
    onPublished,
    projectDir: over.noProject ? null : "/proj",
    cards: over.cards ?? [CARD],
    setConfigCalls: [],
    connectCalls: [],
    runResult: { ok: true, providerId: "itch", issues: [] },
    failConnect: false,
    preflightRows: [],
    preflightCalls: [],
    failPreflight: false,
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
    connect: (dir, providerId, token) => {
      h.connectCalls.push({ dir, providerId, token });
      if (h.failConnect) return Promise.reject(new Error("bad key"));
      h.cards = h.cards.map((c) => (c.id === providerId ? { ...c, connected: true } : c));
      return Promise.resolve({ connected: true, providerId });
    },
    disconnect: (providerId) => {
      h.cards = h.cards.map((c) => (c.id === providerId ? { ...c, connected: false } : c));
      return Promise.resolve({ ok: true });
    },
    run: () => Promise.resolve(h.runResult),
    pickPdfFile: () => Promise.resolve("/picked/book.pdf"),
    openDirectory: () => Promise.resolve("/picked/dist"),
    openExternal: () => Promise.resolve({ ok: true }),
    onSaved: () => onSaved(),
    onConnected: () => onConnected(),
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
  expect(ctrl.publishTokenDrafts).toEqual({});
  expect(ctrl.publishArtifactDrafts).toEqual({});
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

test("setPublishConfigDraft/setPublishTokenDraft update the per-provider draft maps", () => {
  const h = make();
  h.ctrl.setPublishConfigDraft("itch", "project", "my-book");
  expect(h.ctrl.publishConfigDrafts).toEqual({ itch: { project: "my-book" } });
  h.ctrl.setPublishTokenDraft("itch", "secret-key");
  expect(h.ctrl.publishTokenDrafts).toEqual({ itch: "secret-key" });
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

test("connectPublish rejects a blank token without calling the host", async () => {
  const h = make();
  await h.ctrl.connectPublish("itch");
  expect(h.ctrl.publishError).toContain("Paste an API key first.");
  expect(h.connectCalls.length).toBe(0);
});

test("connectPublish flushes settings first, connects, clears the token draft, and fires onConnected", async () => {
  const h = make();
  h.ctrl.setPublishConfigDraft("itch", "project", "my-book");
  h.ctrl.setPublishTokenDraft("itch", "  secret  ");
  await h.ctrl.connectPublish("itch");
  expect(h.setConfigCalls.length).toBe(1);
  expect(h.connectCalls).toEqual([{ dir: "/proj", providerId: "itch", token: "secret" }]);
  expect(h.ctrl.publishTokenDrafts).toEqual({ itch: "" });
  expect(h.onConnected.calls.length).toBe(1);
  expect(h.ctrl.publishCards.find((c) => c.id === "itch")?.connected).toBe(true);
});

test("a failed connect resyncs cards from disk (the resync's own loadPublish clears publishError — pre-existing behavior, preserved verbatim)", async () => {
  const h = make();
  h.failConnect = true;
  h.ctrl.setPublishTokenDraft("itch", "bad-key");
  await h.ctrl.connectPublish("itch");
  // `catch` sets publishError, then immediately calls loadPublish() as a
  // resync — and loadPublish unconditionally resets publishError=null before
  // its own (successful) fetch. The "bad key" message is therefore
  // clobbered by the time this settles. This mirrors the original inline
  // `catch (e) { publishError = ...; await refresh("publish"); }` exactly —
  // characterizing it here rather than silently fixing it in the extraction.
  expect(h.ctrl.publishError).toBeNull();
  expect(h.onConnected.calls.length).toBe(0);
  expect(h.ctrl.publishCards).toEqual([CARD]); // resynced, still disconnected
});

test("disconnectPublish disconnects and reloads", async () => {
  const h = make({ cards: [{ ...CARD, connected: true }] });
  await h.ctrl.disconnectPublish("itch");
  expect(h.ctrl.publishCards.find((c) => c.id === "itch")?.connected).toBe(false);
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

test("runPublish includes the artifact draft path only when set", async () => {
  const h = make();
  let capturedOptions: { dryRun?: boolean; artifactPath?: string } | undefined;
  h.ctrl = new PublishSectionController({
    projectDir: () => h.projectDir,
    listProviders: () => Promise.resolve(h.cards),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.resolve({}),
    connect: () => Promise.resolve({ connected: true, providerId: "itch" }),
    disconnect: () => Promise.resolve({ ok: true }),
    run: (dir, providerId, options) => {
      capturedOptions = options;
      return Promise.resolve(h.runResult);
    },
    pickPdfFile: () => Promise.resolve(null),
    openDirectory: () => Promise.resolve(null),
    openExternal: () => Promise.resolve({ ok: true }),
  });
  await h.ctrl.runPublish("itch", true);
  expect(capturedOptions).toEqual({ dryRun: true });
  h.ctrl.publishArtifactDrafts = { itch: "/book.pdf" };
  await h.ctrl.runPublish("itch", true);
  expect(capturedOptions).toEqual({ dryRun: true, artifactPath: "/book.pdf" });
});

test("pickPublishArtifact uses the PDF picker for a pdf-format card and the directory picker otherwise", async () => {
  const h = make();
  await h.ctrl.pickPublishArtifact(CARD);
  expect(h.ctrl.publishArtifactDrafts).toEqual({ itch: "/picked/book.pdf" });

  const htmlCard: PublishProviderCard = { ...CARD, id: "pages", format: "html" };
  await h.ctrl.pickPublishArtifact(htmlCard);
  expect(h.ctrl.publishArtifactDrafts.pages).toBe("/picked/dist");
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

test("pickPublishArtifact branches on the EFFECTIVE format for a multi-format card, not its static default", async () => {
  const h = make();
  // Still "pdf" by default → the PDF picker.
  await h.ctrl.pickPublishArtifact(GDRIVE_CARD);
  expect(h.ctrl.publishArtifactDrafts.gdrive).toBe("/picked/book.pdf");

  // Selected "html" → the directory picker, even though card.format itself
  // is still the fixed "pdf" default.
  const htmlSelected = { ...GDRIVE_CARD, config: { format: "html" } };
  await h.ctrl.pickPublishArtifact(htmlSelected);
  expect(h.ctrl.publishArtifactDrafts.gdrive).toBe("/picked/dist");
});

// ── Preflight (#105) ──────────────────────────────────────────────────────────

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

// ── Google OAuth connect + destinations picker (#221 C1/C2/C3) ─────────────

const GDRIVE_DEST_CARD: PublishProviderCard = {
  ...CARD,
  id: "gdrive",
  connectKind: "oauth",
  connected: false,
  destinations: { label: "Drive folder", canCreate: true },
} as PublishProviderCard;

/** A deferred promise a test can resolve/reject on its own schedule — used
 *  to simulate `connectGoogleWait()` staying pending across a cancel. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush the microtask queue so an async function's synchronous-until-first-await
 *  chain of internal awaits has had a chance to fully unwind, without waiting on
 *  a real timer (setTimeout would also work, but this keeps the test instant). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

test("connectGoogleOAuth: a stale attempt's late catch/finally must not stomp a newer attempt (#221 C1)", async () => {
  const waits: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const ctrl = new PublishSectionController({
    projectDir: () => "/proj",
    listProviders: () => Promise.resolve([GDRIVE_DEST_CARD]),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.resolve({}),
    connect: () => Promise.reject(new Error("not used")),
    disconnect: () => Promise.resolve({ ok: true }),
    connectGoogleStart: () => Promise.resolve({ authUrl: "https://accounts.google.com/o/oauth2/auth" }),
    connectGoogleWait: () => {
      const d = deferred<void>();
      waits.push(d);
      return d.promise;
    },
    connectGoogleCancel: () => Promise.resolve({ ok: true }),
    listDestinations: () => Promise.resolve([]),
    createDestination: () => Promise.reject(new Error("not used")),
    run: () => Promise.reject(new Error("not used")),
    pickPdfFile: () => Promise.resolve(null),
    openDirectory: () => Promise.resolve(null),
    openExternal: () => Promise.resolve({ ok: true }),
  });

  // Attempt 1: start, then let it reach connectGoogleWait().
  const attempt1 = ctrl.connectGoogleOAuth("gdrive");
  expect(ctrl.publishBusyId).toBe("gdrive"); // set synchronously, before any await
  await flushMicrotasks();
  expect(waits.length).toBe(1);

  // Cancel it — busy/authUrl clear immediately; attempt1's own await on
  // connectGoogleWait() (waits[0]) is still pending.
  await ctrl.cancelGoogleOAuth("gdrive");
  expect(ctrl.publishBusyId).toBeNull();

  // Immediately start attempt 2 (the exact repro: cancel, then click Connect
  // again right away).
  const attempt2 = ctrl.connectGoogleOAuth("gdrive");
  await flushMicrotasks();
  expect(waits.length).toBe(2);
  expect(ctrl.publishBusyId).toBe("gdrive");

  // Now attempt1's promise settles LATE (the cancelled flow finally rejecting).
  waits[0]!.reject(new Error("Google sign-in was canceled."));
  await attempt1;

  // Attempt 2's state must be completely undisturbed by attempt 1's late
  // settlement — this is the exact bug: publishError getting stomped with
  // "canceled", and publishBusyId nulled out from under attempt 2.
  expect(ctrl.publishBusyId).toBe("gdrive");
  expect(ctrl.publishError).toBeNull();

  // Let attempt 2 resolve normally — it owns the final state.
  waits[1]!.resolve();
  await attempt2;
  expect(ctrl.publishBusyId).toBeNull();
  expect(ctrl.publishError).toBeNull();
});

test("selectCredential triggers a destinations reload for the newly selected account (#221 C2)", async () => {
  const listDestinationsCalls: Array<{ dir: string; providerId: string }> = [];
  const ctrl = new PublishSectionController({
    projectDir: () => "/proj",
    listProviders: () => Promise.resolve([{ ...GDRIVE_DEST_CARD, connected: true }]),
    preflight: () => Promise.resolve([]),
    setConfig: () => Promise.resolve({}),
    connect: () => Promise.reject(new Error("not used")),
    disconnect: () => Promise.resolve({ ok: true }),
    connectGoogleStart: () => Promise.reject(new Error("not used")),
    connectGoogleWait: () => Promise.reject(new Error("not used")),
    connectGoogleCancel: () => Promise.resolve({ ok: true }),
    listDestinations: (dir, providerId) => {
      listDestinationsCalls.push({ dir, providerId });
      return Promise.resolve([]);
    },
    createDestination: () => Promise.reject(new Error("not used")),
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
  // The default CARD (itch) has no `destinations` — no-op, matching
  // connectPublish/connectGoogleOAuth's own loadDestinationsIfPickerAvailable.
  h.ctrl = new PublishSectionController({
    projectDir: () => h.projectDir,
    listProviders: () => Promise.resolve(h.cards),
    preflight: () => Promise.resolve([]),
    setConfig: (dir, providerId, values) => {
      h.setConfigCalls.push({ dir, providerId, values });
      return Promise.resolve({});
    },
    connect: () => Promise.reject(new Error("not used")),
    disconnect: () => Promise.resolve({ ok: true }),
    connectGoogleStart: () => Promise.reject(new Error("not used")),
    connectGoogleWait: () => Promise.reject(new Error("not used")),
    connectGoogleCancel: () => Promise.resolve({ ok: true }),
    listDestinations: () => {
      listDestinationsCalls.push(true);
      return Promise.resolve([]);
    },
    createDestination: () => Promise.reject(new Error("not used")),
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
    connect: () => Promise.reject(new Error("not used")),
    disconnect: () => Promise.resolve({ ok: true }),
    connectGoogleStart: () => Promise.reject(new Error("not used")),
    connectGoogleWait: () => Promise.reject(new Error("not used")),
    connectGoogleCancel: () => Promise.resolve({ ok: true }),
    listDestinations: (dir, providerId) => {
      if (providerId === "gdrive-a" && providerAShouldFail) {
        return Promise.reject(new Error("provider A boom"));
      }
      return Promise.resolve([]);
    },
    createDestination: () => Promise.reject(new Error("not used")),
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
    connect: () => Promise.reject(new Error("not used")),
    disconnect: () => Promise.resolve({ ok: true }),
    connectGoogleStart: () => Promise.reject(new Error("not used")),
    connectGoogleWait: () => Promise.reject(new Error("not used")),
    connectGoogleCancel: () => Promise.resolve({ ok: true }),
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
