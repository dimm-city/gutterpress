/**
 * PublishSectionController — the single owner of the Publish section's (#35)
 * provider-card state + logic that used to live inline in
 * `ProjectConfigPanel.svelte`.
 *
 * Centralises the provider cards, the per-provider settings/token/artifact
 * drafts, the busy/error flags, and the run results. Credentials go straight
 * to the host credential store via `connect` and only redacted status comes
 * back; the manifest holds non-secret settings. Runs are long
 * (butler/swa uploads) — one provider at a time (`publishBusyId`).
 *
 * Single-owner discipline mirrors `DesignSectionController`
 * (`design-section-controller.svelte.ts`): the component reads the public
 * rune fields and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the reactive `projectDir` accessor, the `api.publish.*` /
 * `api.dialog.*` / `api.shell.*` host calls, and the `onSaved` / `onConnected`
 * / `onPublished` callbacks (the panel wires these to toasts).
 * `PublishProviderCard` / `PublishRunResult` are type-only imports — ZERO
 * `node:*` / lib value imports.
 */

import type { PublishProviderCard, PublishRunResult } from "$lib/platform/contract";

export interface PublishSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  listProviders: (projectDir: string) => Promise<PublishProviderCard[]>;
  setConfig: (
    projectDir: string,
    providerId: string,
    values: Record<string, string>,
  ) => Promise<unknown>;
  connect: (
    projectDir: string,
    providerId: string,
    token: string,
  ) => Promise<{ connected: boolean; providerId: string }>;
  disconnect: (providerId: string) => Promise<unknown>;
  run: (
    projectDir: string,
    providerId: string,
    options?: { dryRun?: boolean; artifactPath?: string },
  ) => Promise<PublishRunResult>;
  /** Native open dialog for a PDF artifact. Null when cancelled. */
  pickPdfFile: () => Promise<string | null>;
  /** Native directory picker for a website-folder artifact. Null when cancelled. */
  openDirectory: () => Promise<string | null>;
  openExternal: (url: string) => Promise<unknown>;
  /** Fired after Save settings succeeds (the panel wires this to a toast). */
  onSaved?: () => void;
  /** Fired after Connect succeeds. */
  onConnected?: () => void;
  /** Fired after a non-dry-run Publish succeeds; `guided` selects the copy. */
  onPublished?: (guided: boolean) => void;
}

export class PublishSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  publishCards = $state<PublishProviderCard[]>([]);
  publishError = $state<string | null>(null);
  publishBusyId = $state<string | null>(null);
  publishResults = $state<Record<string, PublishRunResult>>({});
  publishConfigDrafts = $state<Record<string, Record<string, string>>>({});
  publishTokenDrafts = $state<Record<string, string>>({});
  // Explicit artifact path per provider — viewer PDF exports go wherever the
  // author chose in the save dialog, so the manifest-default rarely exists.
  publishArtifactDrafts = $state<Record<string, string>>({});

  private readonly deps: PublishSectionDeps;

  constructor(deps: PublishSectionDeps) {
    this.deps = deps;
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  loadPublish = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.publishError = null;
    try {
      this.publishCards = await this.deps.listProviders(projectDir);
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    }
  };

  // ── Draft setters ─────────────────────────────────────────────────────────
  setPublishConfigDraft = (providerId: string, key: string, value: string): void => {
    this.publishConfigDrafts = {
      ...this.publishConfigDrafts,
      [providerId]: { ...this.publishConfigDrafts[providerId], [key]: value },
    };
  };

  setPublishTokenDraft = (providerId: string, value: string): void => {
    this.publishTokenDrafts = { ...this.publishTokenDrafts, [providerId]: value };
  };

  /**
   * Write pending settings drafts to the manifest — the one draft-flush
   * implementation Save/Connect/Publish all share, so a fix to draft handling
   * can't diverge between them. On failure the draft is KEPT (the author's
   * typed values must survive the error) and the error propagates.
   */
  private async flushPublishDraft(providerId: string): Promise<void> {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    const draft = this.publishConfigDrafts[providerId];
    if (!draft || Object.keys(draft).length === 0) return;
    await this.deps.setConfig(projectDir, providerId, draft);
    this.publishConfigDrafts = { ...this.publishConfigDrafts, [providerId]: {} };
  }

  // ── Intents ───────────────────────────────────────────────────────────────
  savePublishConfig = async (providerId: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      await this.flushPublishDraft(providerId);
      await this.loadPublish();
      this.deps.onSaved?.();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  connectPublish = async (providerId: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    const token = (this.publishTokenDrafts[providerId] ?? "").trim();
    if (!token) {
      this.publishError = "Paste an API key first.";
      return;
    }
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      // Unsaved settings (e.g. the Shopify store domain) are needed to verify
      // the key — save them first.
      await this.flushPublishDraft(providerId);
      await this.deps.connect(projectDir, providerId, token);
      this.publishTokenDrafts = { ...this.publishTokenDrafts, [providerId]: "" };
      await this.loadPublish();
      this.deps.onConnected?.();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
      // Settings may have been written before the failure — resync the cards
      // so the panel shows what's actually on disk.
      await this.loadPublish();
    } finally {
      this.publishBusyId = null;
    }
  };

  disconnectPublish = async (providerId: string): Promise<void> => {
    if (this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      await this.deps.disconnect(providerId);
      await this.loadPublish();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  runPublish = async (providerId: string, dryRun: boolean): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      // Publishing saves pending settings so the run uses what the author
      // sees; a dry run ("Check readiness") must have NO side effects, so it
      // checks what's on disk.
      if (!dryRun) await this.flushPublishDraft(providerId);
      const artifactPath = (this.publishArtifactDrafts[providerId] ?? "").trim();
      const result = await this.deps.run(projectDir, providerId, {
        dryRun,
        ...(artifactPath ? { artifactPath } : {}),
      });
      this.publishResults = { ...this.publishResults, [providerId]: result };
      if (result.ok && !dryRun) {
        this.deps.onPublished?.(result.outcome?.kind === "guided");
      }
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  pickPublishArtifact = async (card: PublishProviderCard): Promise<void> => {
    try {
      const picked =
        card.format === "pdf" ? await this.deps.pickPdfFile() : await this.deps.openDirectory();
      if (picked) {
        this.publishArtifactDrafts = { ...this.publishArtifactDrafts, [card.id]: picked };
      }
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    }
  };

  openPublishUrl = (url: string): void => {
    void this.deps.openExternal(url).catch((e) => {
      this.publishError = e instanceof Error ? e.message : String(e);
    });
  };
}
