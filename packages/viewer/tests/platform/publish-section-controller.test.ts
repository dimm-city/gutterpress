import { expect, test } from "bun:test";
import { PublishSectionController } from "../../src/lib/routes/publish-section-controller.svelte";
import type { PublishProviderCard, PublishRunResult } from "../../src/lib/platform/contract";

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
  } as Harness;
  h.ctrl = new PublishSectionController({
    projectDir: () => h.projectDir,
    listProviders: () => Promise.resolve(h.cards),
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
