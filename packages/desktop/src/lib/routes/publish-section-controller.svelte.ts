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
  // C3 — keyed per-provider like publishDestinations/newDestinationDrafts
  // beside them: a global string/id let one provider's busy state or error
  // render under a completely different provider's picker (harmless only
  // while gdrive is the sole destinations-capable provider).
  destinationsBusyId = $state<Record<string, boolean>>({});
  destinationsError = $state<Record<string, string | null>>({});
  // Per-provider draft for the inline "New folder…" name input.
  newDestinationDrafts = $state<Record<string, string>>({});

  // ── Preflight (#105) — the wizard's readiness step reads these ──────────────
  preflightRows = $state<PreflightRow[]>([]);
  /** True once a preflight run has completed (the gate needs "ran vs not-run"). */
  preflightRan = $state(false);
  preflightBusy = $state(false);
  preflightError = $state<string | null>(null);

  private readonly deps: PublishSectionDeps;
  /**
   * Generation counter for `connectGoogleOAuth` (C1 hardening). Cancelling an
   * in-flight attempt clears `publishBusyId` right away, but that attempt's own
   * await on `connectGoogleWait()` is still pending — its `catch`/`finally`
   * settle LATE. Without this guard, a cancel immediately followed by a fresh
   * connect lets the OLD attempt's late settlement stomp the NEW one (wrong
   * `publishError`, `publishBusyId` nulled out from under the new attempt).
   * Each `connectGoogleOAuth` call captures the post-increment value; only the
   * MOST RECENT attempt's side effects are allowed to land.
   */
  private googleConnectGeneration = 0;

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
   * The EFFECTIVE selected format for a card (#221 phase 3, D8): an unsaved
   * draft wins, then the saved `publish.<id>.format`, then the card's fixed
   * default — mirrors the lib's `resolvePublishFormat` (run-publish.ts) so
   * the wizard can never show/act on a choice the lib itself wouldn't honor.
   * Returns `card.format` unchanged for every provider without `formats`.
   */
  effectiveFormat = (card: PublishProviderCard): "pdf" | "html" => {
    const allowed = card.formats;
    if (!allowed || allowed.length === 0) return card.format;
    const draft = this.publishConfigDrafts[card.id]?.format;
    if (draft && (allowed as string[]).includes(draft)) return draft as "pdf" | "html";
    const saved = card.config.format;
    if (saved && (allowed as string[]).includes(saved)) return saved as "pdf" | "html";
    return card.format;
  };

  /**
   * The shared "busy-lock this provider → write non-secret config → reload
   * the cards" sequence `selectFormat`/`selectDestination`/
   * `createNewDestination` all need. `valuesOrBuilder` is either the config
   * values directly, or an async builder (for a caller — `createNewDestination`
   * — that has real work to do, e.g. an API call, BEFORE it knows what to
   * write, and that work must happen INSIDE the same busy-lock window as the
   * write itself; the builder receives the already-null-checked `projectDir`
   * so it doesn't need to re-resolve or re-guard it).
   */
  private applyConfig = async (
    providerId: string,
    valuesOrBuilder:
      | Record<string, string>
      | ((projectDir: string) => Promise<Record<string, string>>),
  ): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      const values =
        typeof valuesOrBuilder === "function" ? await valuesOrBuilder(projectDir) : valuesOrBuilder;
      await this.deps.setConfig(projectDir, providerId, values);
      await this.loadPublish();
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  /**
   * Choose which format this book publishes to a multi-format provider
   * (#221 phase 3, D8 — gdrive only), written immediately to
   * `publish.<id>.format` the same way `selectCredential` writes the
   * credential choice, so the wizard's other format-dependent UI (the
   * folder picker step, the artifact picker) sees it right away.
   */
  selectFormat = (providerId: string, format: "pdf" | "html"): Promise<void> =>
    this.applyConfig(providerId, { format });

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
      // C2 — switching the saved account this book uses must refresh the
      // destinations picker the same way connectPublish/connectGoogleOAuth do,
      // or the PREVIOUS account's folder list keeps showing until the wizard
      // step is re-entered.
      await this.loadDestinationsIfPickerAvailable(providerId);
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
    // C1 hardening: this attempt owns `generation` for its whole lifetime.
    // Cancel clears `publishBusyId` right away while this same await chain is
    // still pending — if a NEW connect starts before this one settles, every
    // side effect below (including the catch/finally) must become a no-op
    // rather than stomp the newer attempt's state.
    const generation = ++this.googleConnectGeneration;
    const isCurrent = () => generation === this.googleConnectGeneration;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      // Unsaved settings (e.g. a chosen folder) are needed before the first
      // publish, but connecting itself has none to flush yet — kept for
      // symmetry with connectPublish in case a future oauth provider adds one.
      await this.flushPublishDraft(providerId);
      const { authUrl } = await this.deps.connectGoogleStart(account || undefined);
      if (!isCurrent()) return;
      this.googleAuthUrls = { ...this.googleAuthUrls, [providerId]: authUrl };
      await this.deps.connectGoogleWait();
      if (!isCurrent()) return;
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
      if (!isCurrent()) return; // a newer attempt has since taken over — stay quiet
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      if (isCurrent()) {
        this.googleAuthUrls = { ...this.googleAuthUrls, [providerId]: "" };
        this.publishBusyId = null;
      }
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
    if (!projectDir || this.destinationsBusyId[providerId]) return;
    this.destinationsBusyId = { ...this.destinationsBusyId, [providerId]: true };
    this.destinationsError = { ...this.destinationsError, [providerId]: null };
    try {
      this.publishDestinations = {
        ...this.publishDestinations,
        [providerId]: await this.deps.listDestinations(projectDir, providerId),
      };
    } catch (e) {
      this.destinationsError = {
        ...this.destinationsError,
        [providerId]: e instanceof Error ? e.message : String(e),
      };
    } finally {
      this.destinationsBusyId = { ...this.destinationsBusyId, [providerId]: false };
    }
  };

  /** Pick an existing destination — writes `{folderId, folder}` via the same
   *  non-secret settings path the free-text `folder` config field uses. */
  selectDestination = (providerId: string, destination: PublishDestination): Promise<void> =>
    this.applyConfig(providerId, { folderId: destination.id, folder: destination.title });

  setNewDestinationDraft = (providerId: string, value: string): void => {
    this.newDestinationDrafts = { ...this.newDestinationDrafts, [providerId]: value };
  };

  /** Inline "New folder…" — create it, then select it (same as picking an
   *  existing one), and add it to the picker list without a full reload. The
   *  create call and the local state updates happen inside applyConfig's
   *  builder callback, so they share its busy-lock window (the UI shows
   *  "busy" for the whole create-then-select operation, not just the final
   *  config write) exactly like the un-refactored version did. */
  createNewDestination = (providerId: string): Promise<void> => {
    const name = (this.newDestinationDrafts[providerId] ?? "").trim();
    if (!name) return Promise.resolve();
    return this.applyConfig(providerId, async (projectDir) => {
      const destination = await this.deps.createDestination(projectDir, providerId, name);
      this.publishDestinations = {
        ...this.publishDestinations,
        [providerId]: [...(this.publishDestinations[providerId] ?? []), destination],
      };
      this.newDestinationDrafts = { ...this.newDestinationDrafts, [providerId]: "" };
      return { folderId: destination.id, folder: destination.title };
    });
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
      // #221 phase 3, D8: a gdrive card set to "html" must offer the
      // directory picker, matching what azure-swa (fixed html) already does
      // — branch on the EFFECTIVE selected format, not the card's static
      // default, which stays "pdf" for gdrive regardless of the author's
      // choice.
      const picked =
        this.effectiveFormat(card) === "pdf"
          ? await this.deps.pickPdfFile()
          : await this.deps.openDirectory();
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
