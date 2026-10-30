/**
 * PublishSectionController — the single owner of the Publish section's (#35)
 * provider-card state + logic.
 *
 * Centralises the provider cards, the per-provider settings drafts, the
 * busy/error flags, and the run results. Accounts are managed in one place, the
 * Accounts page: the wizard shows PublishKeyForm (the same form and routes) to
 * add or replace one, and this controller only records which saved account the
 * book uses. It writes non-secret settings through `setConfig`; the host sorts
 * each value into the manifest (shared) or this person's private settings (their
 * account, their own Drive folder, an output folder outside the book). Runs are
 * long (butler/swa uploads) — one provider at a time (`publishBusyId`).
 *
 * Single-owner discipline mirrors `DesignSectionController`
 * (`design-section-controller.svelte.ts`): the component reads the public
 * rune fields and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8): the reactive `projectDir` accessor, the `api.publish.*` /
 * `api.dialog.*` / `api.shell.*` host calls, and the `onSaved` / `onPublished`
 * callbacks (the panel wires these to toasts).
 * `PublishProviderCard` / `PublishRunResult` are type-only imports — ZERO
 * `node:*` / lib value imports.
 */

import type {
  PublishProviderCard,
  PublishRunResult,
  PublishDestination,
  PublishDestinationStatus,
} from "#lib/platform/contract.ts";
import type { PreflightRow } from "#lib/preflight.ts";
import {
  bookValues,
  hasOwnFolder,
  pickValues,
  promptFor,
  statusFromCard,
  type DestinationPrompt,
} from "#lib/routes/destination-prompt.ts";

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
    values: Record<string, string | boolean>,
  ) => Promise<unknown>;
  /** #221 — provider-neutral destination (folder) picker. */
  listDestinations: (projectDir: string, providerId: string) => Promise<PublishDestination[]>;
  createDestination: (
    projectDir: string,
    providerId: string,
    name: string,
  ) => Promise<PublishDestination>;
  /** #452 — where this person publishes among the destinations, and whether they must choose. */
  destinationStatus: (projectDir: string, providerId: string) => Promise<PublishDestinationStatus>;
  run: (
    projectDir: string,
    providerId: string,
    options?: { dryRun?: boolean; artifactPath?: string },
  ) => Promise<PublishRunResult>;
  openExternal: (url: string) => Promise<unknown>;
  /** Fired after Save settings succeeds (the panel wires this to a toast). */
  onSaved?: () => void;
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

  // ── Destinations picker (#221) — provider-neutral (gdrive: folders) ──────
  publishDestinations = $state<Record<string, PublishDestination[]>>({});
  // Keyed per-provider like publishDestinations/newDestinationDrafts
  // beside them: a global string/id would let one provider's busy state or error
  // render under a completely different provider's picker (harmless only
  // while gdrive is the sole destinations-capable provider).
  destinationsBusyId = $state<Record<string, boolean>>({});
  destinationsError = $state<Record<string, string | null>>({});
  // Per-provider draft for the inline "New folder…" name input.
  newDestinationDrafts = $state<Record<string, string>>({});
  /** #452 — where this person publishes, as the host last reported it. */
  publishDestinationStatus = $state<Record<string, PublishDestinationStatus>>({});
  /** #452 — the person asked for a folder just for them while the book's is reachable. */
  ownDestination = $state<Record<string, boolean>>({});
  /** #452 — a pick that would change the book's folder for everyone, awaiting confirmation. */
  pendingDestination = $state<Record<string, PublishDestination | undefined>>({});

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

  /**
   * The EFFECTIVE selected format for a card (#221): an unsaved
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
   * the cards" sequence `selectFormat` and the destination choices need.
   */
  private applyConfig = async (providerId: string, values: Record<string, string>): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
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
   * (#221 — gdrive only), written immediately to `publish.<id>.format` (a
   * choice the whole team shares), so the wizard's other format-dependent UI
   * (the folder picker step, the artifact picker) sees it right away.
   */
  selectFormat = (providerId: string, format: "pdf" | "html"): Promise<void> =>
    this.applyConfig(providerId, { format });

  /** The destinations the team ticked for this book, as the cards report them (`publish.<id>.enabled` in the manifest). */
  get tickedDestinations(): string[] {
    return this.publishCards.filter((c) => c.config.enabled === "true").map((c) => c.id);
  }

  /**
   * Remember which destinations this book publishes to. Where a book is
   * published is the team's decision, so each tick is saved in the manifest
   * (`publish.<id>.enabled`) and a teammate who opens the book finds the same
   * destinations ticked, needing only their own accounts. `chosen` maps a
   * provider id to ticked or not; only the ones that differ from what the
   * cards say are written, so nothing is rewritten when nothing changed.
   * Resolves false (the reason is on `publishError`) when a write fails.
   */
  saveDestinations = async (chosen: Record<string, boolean>): Promise<boolean> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return false;
    const ticked = this.tickedDestinations;
    const changed = Object.entries(chosen).filter(([id, on]) => ticked.includes(id) !== on);
    if (changed.length === 0) return true;
    this.publishBusyId = "destinations";
    this.publishError = null;
    try {
      for (const [id, on] of changed) await this.deps.setConfig(projectDir, id, { enabled: on ? true : "" });
      await this.loadPublish();
      return true;
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      this.publishBusyId = null;
    }
  };

  /**
   * Choose which SAVED account this book publishes with. The choice is this
   * person's own, so the host keeps it in their private settings for the book,
   * never in the manifest a team shares. An empty `account` clears it back to
   * the default account. Also what follows adding or replacing an account in
   * the wizard: the account just saved is the one the book uses. Reused
   * automatically — the account itself lives in the user-scoped store, so
   * nothing is re-entered.
   */
  selectCredential = async (providerId: string, account: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      await this.deps.setConfig(projectDir, providerId, { credential: account });
      await this.loadPublish();
      // Switching the saved account this book uses must refresh the
      // destinations picker, or the PREVIOUS account's folder list keeps
      // showing until the wizard step is re-entered.
      await this.loadDestinationsIfPickerAvailable(providerId);
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  /**
   * Save pending settings drafts — the one draft-flush implementation
   * Save/Publish share, so a fix to draft handling can't diverge between
   * them. On failure the draft is KEPT (the author's typed values must
   * survive the error) and the error propagates.
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

  /** After the account changes, populate the folder picker immediately
   *  (#221) so the wizard doesn't need a manual step-revisit to show it —
   *  provider-neutral: a no-op for any provider without `destinations`. */
  private async loadDestinationsIfPickerAvailable(providerId: string): Promise<void> {
    const card = this.publishCards.find((c) => c.id === providerId);
    if (card?.connected && card.destinations) await this.loadDestinations(providerId);
  }

  // ── Destinations picker (#221, #452) ──────────────────────────────────────
  /** Load the folder list and where this person publishes (called on entering
   *  setup once connected, after the account changes, and after a choice). */
  loadDestinations = async (providerId: string): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.destinationsBusyId[providerId]) return;
    this.destinationsBusyId = { ...this.destinationsBusyId, [providerId]: true };
    this.destinationsError = { ...this.destinationsError, [providerId]: null };
    this.ownDestination = { ...this.ownDestination, [providerId]: false };
    this.pendingDestination = { ...this.pendingDestination, [providerId]: undefined };
    try {
      const [list, status] = await Promise.all([
        this.deps.listDestinations(projectDir, providerId),
        this.deps.destinationStatus(projectDir, providerId),
      ]);
      this.publishDestinations = { ...this.publishDestinations, [providerId]: list };
      this.publishDestinationStatus = { ...this.publishDestinationStatus, [providerId]: status };
    } catch (e) {
      this.destinationsError = {
        ...this.destinationsError,
        [providerId]: e instanceof Error ? e.message : String(e),
      };
    } finally {
      this.destinationsBusyId = { ...this.destinationsBusyId, [providerId]: false };
    }
  };

  /** The host's status, or, until it has answered, what the card's settings
   *  imply (so a pick never replaces an existing book folder unasked). */
  private statusOf(providerId: string): PublishDestinationStatus {
    return statusFromCard(
      this.publishDestinationStatus[providerId],
      this.publishCards.find((c) => c.id === providerId)?.config ?? {},
    );
  }

  /**
   * What the destination step says, and where a pick is saved (#452). The
   * book's folder is the team's: the first pick, and a change while it is
   * reachable, go to the manifest. A person who can't reach it, whose own
   * folder is gone, or who asks for a folder just for them, picks one saved in
   * their private settings only.
   */
  destinationPrompt = (providerId: string): DestinationPrompt =>
    promptFor(this.statusOf(providerId), this.ownDestination[providerId] === true);

  /** Save a destination choice and reload where this person now publishes.
   *  The host files `folderId`/`folder` in the manifest and `myFolderId`/
   *  `myFolder` in this person's private settings (recording the book's folder
   *  it stands in for, and the account). */
  private saveDestination = async (providerId: string, values: Record<string, string>): Promise<void> => {
    await this.applyConfig(providerId, values);
    await this.loadDestinations(providerId);
  };

  /** Pick a destination, saved where {@link destinationPrompt} says. Replacing
   *  the book's folder for everyone waits on {@link confirmBookDestination}. */
  selectDestination = async (providerId: string, destination: PublishDestination): Promise<void> => {
    const values = pickValues(this.statusOf(providerId), this.ownDestination[providerId] === true, destination);
    if (values) return this.saveDestination(providerId, values);
    this.pendingDestination = { ...this.pendingDestination, [providerId]: destination };
  };

  /** "This changes the folder for everyone who publishes this book." — confirmed. */
  confirmBookDestination = async (providerId: string): Promise<void> => {
    const destination = this.pendingDestination[providerId];
    if (!destination) return;
    this.pendingDestination = { ...this.pendingDestination, [providerId]: undefined };
    await this.saveDestination(providerId, bookValues(destination));
  };

  cancelBookDestination = (providerId: string): void => {
    this.pendingDestination = { ...this.pendingDestination, [providerId]: undefined };
  };

  /** "Use a different folder just for me": the next pick is private. */
  chooseOwnDestination = (providerId: string): void => {
    this.ownDestination = { ...this.ownDestination, [providerId]: true };
    this.pendingDestination = { ...this.pendingDestination, [providerId]: undefined };
  };

  /** "Use the book's folder": drop this person's own folder for the book. */
  useBookDestination = async (providerId: string): Promise<void> => {
    const status = this.statusOf(providerId);
    this.ownDestination = { ...this.ownDestination, [providerId]: false };
    if (hasOwnFolder(status)) {
      await this.saveDestination(providerId, { myFolderId: "" });
    }
  };

  setNewDestinationDraft = (providerId: string, value: string): void => {
    this.newDestinationDrafts = { ...this.newDestinationDrafts, [providerId]: value };
  };

  /** Inline "New folder…" — create it, add it to the picker list without a
   *  full reload, then pick it like an existing one. */
  createNewDestination = async (providerId: string): Promise<void> => {
    const name = (this.newDestinationDrafts[providerId] ?? "").trim();
    const projectDir = this.deps.projectDir();
    if (!name || !projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    let destination: PublishDestination;
    try {
      destination = await this.deps.createDestination(projectDir, providerId, name);
    } catch (e) {
      this.publishError = e instanceof Error ? e.message : String(e);
      return;
    } finally {
      this.publishBusyId = null;
    }
    this.publishDestinations = {
      ...this.publishDestinations,
      [providerId]: [...(this.publishDestinations[providerId] ?? []), destination],
    };
    this.newDestinationDrafts = { ...this.newDestinationDrafts, [providerId]: "" };
    await this.selectDestination(providerId, destination);
  };

  /** Run one provider. `artifactPath` is the file/folder the wizard just
   *  built (the lib's manifest-default location is used when absent). */
  runPublish = async (providerId: string, dryRun: boolean, artifactPath = ""): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      // Publishing saves pending settings so the run uses what the author
      // sees; a dry run ("Check readiness") must have NO side effects, so it
      // checks what's on disk.
      if (!dryRun) await this.flushPublishDraft(providerId);
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
