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

import type {
  PublishProviderCard,
  PublishRunResult,
  PublishDestination,
  GoogleConnectStartResult,
  GoogleConnectResult,
} from "$lib/platform/contract";
import type { PreflightRow } from "$lib/preflight";

export interface PublishSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  listProviders: (projectDir: string) => Promise<PublishProviderCard[]>;
  /**
   * Publish preflight (#105) — run the pre-build SOURCE + ASSET checks (no PDF
   * build), scoped to the selected destinations.
   */
  preflight: (projectDir: string, providerIds: string[]) => Promise<PreflightRow[]>;
  setConfig: (
    projectDir: string,
    providerId: string,
    values: Record<string, string>,
  ) => Promise<unknown>;
  connect: (
    projectDir: string,
    providerId: string,
    token: string,
    account?: string,
  ) => Promise<{ connected: boolean; providerId: string }>;
  disconnect: (providerId: string, account?: string) => Promise<unknown>;
  /**
   * #221 D10 — the Google Drive OAuth connect trio (mirrors the platform
   * adapter's `connectGoogleStart`/`Wait`/`Cancel`, driven directly rather
   * than through `api.publish.*` — see PublishWizard's oauth branch).
   */
  connectGoogleStart: (account?: string) => Promise<GoogleConnectStartResult>;
  connectGoogleWait: () => Promise<GoogleConnectResult>;
  connectGoogleCancel: () => Promise<{ ok: boolean }>;
  /** #221 D9 — provider-neutral destination (folder) picker. */
  listDestinations: (projectDir: string, providerId: string) => Promise<PublishDestination[]>;
  createDestination: (
    projectDir: string,
    providerId: string,
    name: string,
  ) => Promise<PublishDestination>;
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
  // Account-label draft when ADDING a new named credential (the picker's
  // "Add another account" flow). Empty stores/uses the default credential.
  publishAccountDrafts = $state<Record<string, string>>({});
  // Explicit artifact path per provider — desktop PDF exports go wherever the
  // author chose in the save dialog, so the manifest-default rarely exists.
  publishArtifactDrafts = $state<Record<string, string>>({});

  // ── OAuth connect (#221 D10, gdrive) ─────────────────────────────────────
  // The auth URL the browser was (or should be) sent to, per provider — set
  // while a connect is in flight so the UI can offer "open the sign-in page
  // again"; cleared on success, failure, or cancel. `publishBusyId === id`
  // doubles as "an oauth connect is in flight" (the SAME single-provider-busy
  // lock every other publish intent already uses).
  googleAuthUrls = $state<Record<string, string>>({});

  // ── Destinations picker (#221 D9) — provider-neutral (gdrive: folders) ───
  publishDestinations = $state<Record<string, PublishDestination[]>>({});
  destinationsBusyId = $state<string | null>(null);
  destinationsError = $state<string | null>(null);
  // Per-provider draft for the inline "New folder…" name input.
  newDestinationDrafts = $state<Record<string, string>>({});

  // ── Preflight (#105) — the wizard's readiness step reads these ──────────────
  preflightRows = $state<PreflightRow[]>([]);
  /** True once a preflight run has completed (the gate needs "ran vs not-run"). */
  preflightRan = $state(false);
  preflightBusy = $state(false);
  preflightError = $state<string | null>(null);

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

  setPublishAccountDraft = (providerId: string, value: string): void => {
    this.publishAccountDrafts = { ...this.publishAccountDrafts, [providerId]: value };
  };

  /**
   * Choose which SAVED credential this book uses for a provider (book-level
   * selection, written to the manifest's `publish.<id>.credential`). An empty
   * `account` clears it back to the default credential. Reused automatically —
   * the account itself lives in the user-scoped store, so nothing is re-entered.
   */
  selectCredential = async (providerId: string, account: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      await this.deps.setConfig(projectDir, providerId, { credential: account });
      await this.loadPublish();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
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
    const account = (this.publishAccountDrafts[providerId] ?? "").trim();
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      // Unsaved settings (e.g. the Shopify store domain) are needed to verify
      // the key — save them first.
      await this.flushPublishDraft(providerId);
      await this.deps.connect(projectDir, providerId, token, account || undefined);
      this.publishTokenDrafts = { ...this.publishTokenDrafts, [providerId]: "" };
      this.publishAccountDrafts = { ...this.publishAccountDrafts, [providerId]: "" };
      // A NAMED account just added → make this book use it (book-level
      // selection). The default (unnamed) credential needs no manifest write.
      if (account) {
        await this.deps.setConfig(projectDir, providerId, { credential: account });
      }
      await this.loadPublish();
      await this.loadDestinationsIfPickerAvailable(providerId);
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

  /** After a successful connect, populate the folder picker immediately
   *  (#221 D9) so the wizard doesn't need a manual step-revisit to show it —
   *  provider-neutral: a no-op for any provider without `destinations`. */
  private async loadDestinationsIfPickerAvailable(providerId: string): Promise<void> {
    const card = this.publishCards.find((c) => c.id === providerId);
    if (card?.connected && card.destinations) await this.loadDestinations(providerId);
  }

  disconnectPublish = async (providerId: string, account?: string): Promise<void> => {
    if (this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      await this.deps.disconnect(providerId, account);
      await this.loadPublish();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  /**
   * #221 D10 — connect an oauth provider (gdrive) via the browser consent
   * flow instead of a pasted key. Reuses the SAME account draft the
   * paste-a-key "Add another account" flow uses (`publishAccountDrafts`), so
   * one input serves both connect kinds. `publishBusyId` is set for the
   * WHOLE attempt (Start through Wait) so the wizard shows one continuous
   * busy state, matching `connectPublish`'s existing lock semantics.
   */
  connectGoogleOAuth = async (providerId: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    const account = (this.publishAccountDrafts[providerId] ?? "").trim();
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      // Unsaved settings (e.g. a chosen folder) are needed before the first
      // publish, but connecting itself has none to flush yet — kept for
      // symmetry with connectPublish in case a future oauth provider adds one.
      await this.flushPublishDraft(providerId);
      const { authUrl } = await this.deps.connectGoogleStart(account || undefined);
      this.googleAuthUrls = { ...this.googleAuthUrls, [providerId]: authUrl };
      await this.deps.connectGoogleWait();
      this.publishAccountDrafts = { ...this.publishAccountDrafts, [providerId]: "" };
      // A NAMED account just connected → make this book use it (book-level
      // selection), same as the paste-a-key flow.
      if (account) {
        await this.deps.setConfig(projectDir, providerId, { credential: account });
      }
      await this.loadPublish();
      await this.loadDestinationsIfPickerAvailable(providerId);
      this.deps.onConnected?.();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.googleAuthUrls = { ...this.googleAuthUrls, [providerId]: "" };
      this.publishBusyId = null;
    }
  };

  /** Cancel an in-flight oauth connect (the dialog's Cancel button). */
  cancelGoogleOAuth = async (providerId: string): Promise<void> => {
    try {
      await this.deps.connectGoogleCancel();
    } finally {
      this.googleAuthUrls = { ...this.googleAuthUrls, [providerId]: "" };
      if (this.publishBusyId === providerId) this.publishBusyId = null;
    }
  };

  /** "Open the sign-in page again" — the browser didn't auto-open, or the
   *  author closed the tab. */
  reopenGoogleAuthUrl = (providerId: string): void => {
    const url = this.googleAuthUrls[providerId];
    if (!url) return;
    void this.deps.openExternal(url).catch((e) => {
      this.publishError = e instanceof Error ? e.message : String(e);
    });
  };

  // ── Destinations picker (#221 D9) ────────────────────────────────────────
  /** Load the folder list for a provider's picker (called on entering setup
   *  once connected, and after a successful connect). */
  loadDestinations = async (providerId: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.destinationsBusyId) return;
    this.destinationsBusyId = providerId;
    this.destinationsError = null;
    try {
      this.publishDestinations = {
        ...this.publishDestinations,
        [providerId]: await this.deps.listDestinations(projectDir, providerId),
      };
    } catch (e) {
      this.destinationsError = e instanceof Error ? e.message : String(e);
    } finally {
      this.destinationsBusyId = null;
    }
  };

  /** Pick an existing destination — writes `{folderId, folder}` via the same
   *  non-secret settings path the free-text `folder` config field uses. */
  selectDestination = async (providerId: string, destination: PublishDestination): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      await this.deps.setConfig(projectDir, providerId, {
        folderId: destination.id,
        folder: destination.title,
      });
      await this.loadPublish();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  setNewDestinationDraft = (providerId: string, value: string): void => {
    this.newDestinationDrafts = { ...this.newDestinationDrafts, [providerId]: value };
  };

  /** Inline "New folder…" — create it, then select it (same as picking an
   *  existing one), and add it to the picker list without a full reload. */
  createNewDestination = async (providerId: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    const name = (this.newDestinationDrafts[providerId] ?? "").trim();
    if (!projectDir || this.publishBusyId || !name) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      const destination = await this.deps.createDestination(projectDir, providerId, name);
      this.publishDestinations = {
        ...this.publishDestinations,
        [providerId]: [...(this.publishDestinations[providerId] ?? []), destination],
      };
      this.newDestinationDrafts = { ...this.newDestinationDrafts, [providerId]: "" };
      await this.deps.setConfig(projectDir, providerId, {
        folderId: destination.id,
        folder: destination.title,
      });
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

  /**
   * Run the pre-build publish preflight (#105) for the selected destinations.
   * Called on ENTERING the wizard's Preflight step and on manual Re-run — each
   * call is a fresh run (checks the current on-disk content). Errors surface on
   * `preflightError` and leave `preflightRan` true so the gate still evaluates.
   */
  runPreflight = async (providerIds: string[]): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.preflightBusy) return;
    this.preflightBusy = true;
    this.preflightError = null;
    try {
      this.preflightRows = await this.deps.preflight(projectDir, providerIds);
      this.preflightRan = true;
    } catch (e) {
      this.preflightError = e instanceof Error ? e.message : String(e);
      // A failed run must not read as "checked, all clear" — keep any prior
      // rows cleared so the gate treats it as unresolved.
      this.preflightRows = [];
      this.preflightRan = true;
    } finally {
      this.preflightBusy = false;
    }
  };

  openPublishUrl = (url: string): void => {
    void this.deps.openExternal(url).catch((e) => {
      this.publishError = e instanceof Error ? e.message : String(e);
    });
  };
}
