/**
 * PublishSectionController — the single owner of the Publish view's state
 * (ADR 0012 §6): the target cards, their settings drafts, the book's targets
 * and the ones this person sends, and the one publish run.
 *
 * The run is the lib's `publishBook`, the same one `gutterpress publish`
 * runs: the app starts it (`publish`) and shows what it reports, it does not
 * build, check or send anything itself. Accounts are managed on the Accounts
 * page; the view adds or replaces one with the same form, and this controller
 * only records which saved account the book uses. Settings are written
 * through `setConfig`; the host sorts each value into the manifest (shared)
 * or this person's private settings (their account, their own Drive folder, a
 * folder outside the book, a target they don't send).
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8). Lib shapes are type-only imports — ZERO `node:*` / lib value imports.
 */

import type {
  PublishProviderCard,
  PublishDestination,
  PublishDestinationStatus,
  PublishRunArgs,
  PublishBookResult,
  PublishProgress,
} from "#lib/platform/contract.ts";
import { friendlyHostError, unwrapRouteError } from "#lib/errors.ts";
import {
  bookValues,
  hasOwnFolder,
  pickValues,
  promptFor,
  statusFromCard,
  type DestinationPrompt,
} from "#lib/routes/destination-prompt.ts";

/** A thrown host/route error as one plain line. */
const messageOf = (e: unknown): string =>
  friendlyHostError(unwrapRouteError(e instanceof Error ? e.message : String(e)));

export interface PublishSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  listProviders: (projectDir: string) => Promise<PublishProviderCard[]>;
  /** Add one target to the book or take it out (`publish:` in the manifest). */
  setTarget: (projectDir: string, target: string, inBook: boolean) => Promise<unknown>;
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
  /** The one publish run (main's `PublishRunner`). */
  publish: (args: PublishRunArgs) => Promise<PublishBookResult>;
  cancelPublish: () => Promise<unknown>;
  /** Subscribe to the run's progress; returns an unsubscribe fn. */
  onProgress: (cb: (progress: PublishProgress) => void) => () => void;
  openExternal: (url: string) => Promise<unknown>;
  /** Fired after Save settings succeeds (the panel wires this to a toast). */
  onSaved?: () => void;
  /** Fired with each run's result (the page lists its findings in Problems). */
  onResult?: (result: PublishBookResult) => void;
}

/** What a Publish (or Check only) asks the run for. */
export interface PublishIntent {
  /** Make and check the files; send nothing. */
  checkOnly?: boolean;
  /** Just these targets (default: the ones this person sends); the result is merged into the last one. */
  targets?: string[];
  sendAnyway?: string[];
  allowShrink?: boolean;
}

export class PublishSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  publishCards = $state<PublishProviderCard[]>([]);
  publishError = $state<string | null>(null);
  publishBusyId = $state<string | null>(null);
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

  // ── The run ───────────────────────────────────────────────────────────────
  /** Checks are on unless the person turns them off (ADR 0012 §5). */
  skipChecks = $state(false);
  running = $state(false);
  /** What the run said so far, in order. */
  progress = $state<PublishProgress[]>([]);
  /** The last run's result (merged, when a run was for some targets only). */
  result = $state<PublishBookResult | null>(null);
  /**
   * True once the last result sent or prepared something. After Check only
   * nothing went anywhere, so Publish, not Done, is the next step.
   */
  get published(): boolean {
    return this.result?.targets.some((t) => t.status === "sent" || t.status === "prepared") ?? false;
  }

  private readonly deps: PublishSectionDeps;
  /** The book the state above belongs to. */
  private book: string | null = null;

  constructor(deps: PublishSectionDeps) {
    this.deps = deps;
  }

  /**
   * The open book; when it is another than the state above was for, that
   * state is dropped first, so nothing typed or sent for one book reaches the
   * next.
   */
  private currentBook(): string | null {
    const projectDir = this.deps.projectDir();
    if (projectDir && this.book === null) this.book = projectDir;
    if (projectDir && projectDir !== this.book) {
      this.book = projectDir;
      this.publishCards = [];
      this.publishConfigDrafts = {};
      this.publishDestinations = {};
      this.destinationsError = {};
      this.newDestinationDrafts = {};
      this.publishDestinationStatus = {};
      this.ownDestination = {};
      this.pendingDestination = {};
      this.progress = [];
      this.result = null;
    }
    return projectDir;
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  loadPublish = async (): Promise<void> => {
    const projectDir = this.currentBook();
    if (!projectDir) return;
    this.publishError = null;
    try {
      this.publishCards = await this.deps.listProviders(projectDir);
    } catch (e) {
      this.publishError = messageOf(e);
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
  effectiveFormat = (card: PublishProviderCard): PublishProviderCard["format"] => {
    const allowed = card.formats;
    if (!allowed || allowed.length === 0) return card.format;
    const pick = [this.publishConfigDrafts[card.id]?.format, card.config.format].find(
      (f): f is PublishProviderCard["format"] => !!f && (allowed as string[]).includes(f),
    );
    return pick ?? card.format;
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
      this.publishError = messageOf(e);
    } finally {
      this.publishBusyId = null;
    }
  };

  /**
   * Choose the file a target receives when the target does not fix it,
   * written immediately to `publish.<id>.format` (a choice the whole team
   * shares).
   */
  selectFormat = (providerId: string, format: PublishProviderCard["format"]): Promise<void> =>
    this.applyConfig(providerId, { format });

  /** The book's targets, as the cards report them (`publish:` in the manifest). */
  get bookTargets(): PublishProviderCard[] {
    return this.publishCards.filter((c) => c.inBook);
  }

  /** The targets this person sends: the book's, less the ones they turned off. */
  get sendingTargets(): PublishProviderCard[] {
    return this.publishCards.filter((c) => c.inBook && c.sending);
  }

  /**
   * Add a target to the book, or take one out. The book's targets are the
   * team's, saved in its manifest, so everyone who has the book sees the
   * change. Resolves false (the reason is on `publishError`) when it fails.
   */
  setInBook = async (providerId: string, inBook: boolean): Promise<boolean> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.publishBusyId) return false;
    this.publishBusyId = providerId;
    this.publishError = null;
    try {
      await this.deps.setTarget(projectDir, providerId, inBook);
      await this.loadPublish();
      return true;
    } catch (e) {
      this.publishError = messageOf(e);
      return false;
    } finally {
      this.publishBusyId = null;
    }
  };

  /** Send one of the book's targets or not. This person's own choice, kept on this computer. */
  setSending = (providerId: string, sending: boolean): Promise<void> =>
    this.applyConfig(providerId, { send: sending ? "" : "off" });

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
      this.publishError = messageOf(e);
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
      this.publishError = messageOf(e);
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
        [providerId]: messageOf(e),
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
      this.publishError = messageOf(e);
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

  /** Save every settings draft, so the run uses what the person sees. */
  private async flushAllDrafts(): Promise<void> {
    for (const id of Object.keys(this.publishConfigDrafts)) await this.flushPublishDraft(id);
  }

  /**
   * Publish (or Check only) through the one run. Every target the person
   * sends, unless `intent.targets` names some (Send anyway, Try again): then
   * their results replace theirs in the last result. A failure is part of the
   * result; `publishError` is only for a run that could not start.
   */
  publish = async (intent: PublishIntent = {}): Promise<void> => {
    const projectDir = this.currentBook();
    if (!projectDir || this.running || this.publishBusyId) return;
    const targets = intent.targets ?? this.sendingTargets.map((c) => c.id);
    this.running = true;
    this.publishError = null;
    this.progress = [];
    const off = this.deps.onProgress((p) => {
      this.progress = [...this.progress, p];
    });
    try {
      await this.flushAllDrafts();
      const result = await this.deps.publish({
        projectDir,
        targets,
        ...(intent.checkOnly ? { checkOnly: true } : {}),
        ...(this.skipChecks ? { skipChecks: true } : {}),
        ...(intent.sendAnyway ? { sendAnyway: intent.sendAnyway } : {}),
        ...(intent.allowShrink ? { allowShrink: true } : {}),
      });
      this.result = intent.targets && this.result ? merge(this.result, result) : result;
      this.deps.onResult?.(this.result);
    } catch (e) {
      this.publishError = messageOf(e);
    } finally {
      off();
      this.running = false;
    }
  };

  /** Stop the run (it ends as stopped, with nothing sent after the stop). */
  cancel = (): void => {
    void this.deps.cancelPublish().catch(() => {});
  };

  openPublishUrl = (url: string): void => {
    void this.deps.openExternal(url).catch((e) => {
      this.publishError = messageOf(e);
    });
  };
}

/** A run for some targets laid over the last run's result, each target in its place. */
function merge(last: PublishBookResult, next: PublishBookResult): PublishBookResult {
  const paths = new Set(next.files.map((f) => f.path));
  const targets = [
    ...last.targets.map((t) => next.targets.find((n) => n.id === t.id) ?? t),
    ...next.targets.filter((n) => !last.targets.some((t) => t.id === n.id)),
  ];
  return {
    ...next,
    // Finished when everything went, or, for a check, everything was checked:
    // a target sent anyway after Check only leaves the others still to send.
    ok:
      !next.failure &&
      (targets.every((t) => t.status === "sent" || t.status === "prepared") ||
        targets.every((t) => t.status === "checked" || t.status === "not-connected")),
    files: [...last.files.filter((f) => !paths.has(f.path)), ...next.files],
    targets,
  };
}
