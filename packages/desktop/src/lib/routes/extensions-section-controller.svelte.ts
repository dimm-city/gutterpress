/**
 * ExtensionsSectionController (#243, #265) — the single owner of the
 * manifest's `extensions:` list in Book setup: ONE list (`entries`, in
 * cascade order) and ONE verb set (add, remove, toggle, move). Two tabs read
 * it:
 *   - **Look** shows it the way an author thinks of it: one look, chosen from
 *     a gallery (`galleryLooks`, `chooseLook`), an editable copy of a built-in
 *     one (`copyLook`), and an enlarged two-page sample of the card under the
 *     pointer (`showHoverPreview`, wide windows only);
 *   - **Extensions** shows the list itself, with every verb, Re-check
 *     (`recheck`), the npm update tools (check, update, a version picker per
 *     npm row, the pre-release preference), and the ways to add one: a
 *     built-in extra or look the book does not list yet (`unlistedExtras`,
 *     `unlistedLooks`, `addExtra` — a second look stacks on the first), or one
 *     from elsewhere.
 *
 * A look is an extension that carries styles and no markdown (`isLook`); an
 * extra carries markdown; a component library carries both. The list order
 * is the CSS cascade (later wins ties) and the markdown registration order,
 * and the project's own stylesheets always load last. Moving a row rewrites
 * the whole order (`config-helpers.ts`'s `orderAfterMove`). Choosing a look
 * is the same verbs in one step: the new look takes the old one's place, and
 * the old one goes (a built-in is removed; an npm or folder look is only
 * switched off, so nothing downloaded or authored is lost).
 *
 * Adding is one verb with several ways to NAME the extension, which differ
 * only in what the host does with the name:
 *   - a bundled name (a look or an extra, written as-is; nothing is copied) or
 *     an npm specifier (`addNpm` by exact name — with the named export to use
 *     when the package has no default one, `npmExport` — or `addSearched`
 *     from a search result: downloaded, verified, vendored, pinned, behind
 *     the native trust gate, so a null result means "the author cancelled");
 *   - `copyLook` — a built-in look COPIED into `extensions/<id>/` as the
 *     author's own files and listed by path in the built-in's place (the
 *     lib's `addBuiltInStyleSet`, what `ext add <look> --look` calls);
 *   - `addLocal` — a folder or plugin file from the native picker,
 *     referenced in place, never copied;
 *   - `importFile` / `importUrl` — a `.zip`, `.css`, or URL package the host
 *     validates and lands in `extensions/<id>/` (#106).
 *
 * Search: `runSearch` asks npm, on submit and never at project load, for
 * packages tagged `gutterpress` or `markdown-it-plugin` (the lib's
 * `searchNpmExtensions`, what `gutterpress ext search` prints). A failure is
 * `search.message`, one quiet line, never `error`; `searchResults` marks the
 * packages the book already lists, so each reads "Added" instead of Add.
 * `search.total` is what npm said it has, for "Showing N of M".
 *
 * Updates: `checkUpdates` asks npm for each pinned entry's latest (when the
 * tab opens, and again on Check for updates), and `update` re-pins one;
 * `install` (a row whose downloaded copy is missing or broken) is the same
 * `add` for exactly the pinned version.
 *
 * Versions: every npm row has a picker over that package's published versions
 * (`loadVersions`, on demand, cached for the session; `versionChoices` filters
 * pre-releases by the app-level "Include pre-release versions" preference,
 * `setIncludePrerelease`, and always keeps the pin). `switchVersion` is the
 * same `add` of `name@<version>`. The host pins only after downloading,
 * verifying and load-testing, so a failed install or switch leaves the old pin
 * and copy untouched.
 *
 * Removal never touches the author's files (a path entry's folder stays; an
 * npm entry's vendored copy — Gutterpress's own — is deleted), so it is a
 * single click, not a two-step confirm.
 *
 * Same single-owner discipline as every other `*SectionController`: the
 * component reads the public rune fields and calls the intent methods; host
 * coupling is injected so this stays testable with fakes and PWA-clean (§8)
 * — type-only DTO imports plus the pure helpers from `config-helpers`,
 * ZERO `node:*` / lib value imports.
 * Computed values are plain getters, not `$derived` (mirrors
 * `design-section-controller.svelte.ts`), so bun's unit tests need only the
 * `$state` shim.
 */

import type {
  ProjectExtensionEntry,
  ExtensionValidationResult,
  BundledExtensionInfo,
  ExtensionImportResult,
  ExtensionSearchResult,
  ExtensionUpdateCheck,
  ExtensionUpdatesResult,
  ExtensionVersionsResult,
  NpmExtensionMatch,
} from "#lib/platform/dtos.ts";
import {
  addedBuiltInIds,
  hoverPreviewSrcdoc,
  isLook,
  orderAfterMove,
  pickerVersions,
  sampleSrcdoc,
  searchMatchesQuery,
} from "#lib/components/config/config-helpers.ts";

export interface ExtensionsSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** Every configured extension, in manifest (= cascade) order. */
  list: (projectDir: string) => Promise<ProjectExtensionEntry[]>;
  /** The bundled extensions (markdown extras and looks), static. */
  bundled: () => Promise<BundledExtensionInfo[]>;
  /** Search npm for extensions. A fetch/parse failure comes back as `{ ok: false }` data, never a rejection. */
  search: (query: string) => Promise<ExtensionSearchResult>;
  /** Each pinned npm entry against npm's latest (or newest of any kind). Same data-not-rejection contract as `search`. */
  outdated: (projectDir: string, includePrerelease: boolean) => Promise<ExtensionUpdatesResult>;
  /** Every published version of one npm package, newest first, pre-releases included. Same data-not-rejection contract as `search`. */
  versions: (name: string) => Promise<ExtensionVersionsResult>;
  /** The "Include pre-release versions" app preference (`settings.updates.includeExtensionPrereleases`) — read and write. */
  includePrerelease: () => boolean;
  setIncludePrerelease: (on: boolean) => void;
  validate: (projectDir: string) => Promise<ExtensionValidationResult[]>;
  /** Add by specifier. Null when the author cancelled the native npm trust gate. */
  add: (
    projectDir: string,
    specifier: string,
    exportName?: string,
  ) => Promise<ProjectExtensionEntry | null>;
  /** Native folder/file picker; referenced in place. Null when cancelled. */
  addLocal: (projectDir: string) => Promise<ProjectExtensionEntry | null>;
  /** Copy a built-in look into `extensions/<id>/` and list the copy, in the built-in's place when listed. */
  addBuiltIn: (projectDir: string, id: string) => Promise<ProjectExtensionEntry>;
  remove: (projectDir: string, use: string) => Promise<unknown>;
  setEnabled: (projectDir: string, use: string, enabled: boolean) => Promise<unknown>;
  /** Rewrite the whole list order; must name every `use` exactly once. */
  reorder: (projectDir: string, order: string[]) => Promise<unknown>;
  /** An extension's stylesheets as CSS text (a bundled look's — listed or not — or a folder's declared sheets), for the sample thumbnail. */
  readCss: (projectDir: string, use: string) => Promise<string>;
  /** `.zip`/`.css` via the native file picker (#106). Null when cancelled. */
  importFromFile: (projectDir: string) => Promise<ExtensionImportResult | null>;
  importFromUrl: (projectDir: string, url: string) => Promise<ExtensionImportResult>;
  /**
   * Fired after any successful change to a styles-carrying entry (added,
   * removed, toggled, moved, a look chosen): the design settings depend on
   * the cascade, so the panel wires this to reload them.
   */
  afterLookChange?: () => Promise<void>;
}

/** One card of the Look tab's gallery: a built-in look, or a look the book lists from npm or a folder. */
export interface LookCard {
  /** The `use` it is listed under (or would be, once chosen). */
  use: string;
  label: string;
  description: string;
  /** "From npm" / "From a folder"; null for a built-in look. */
  from: string | null;
  /** Who made it (its package.json `author`), when it says. */
  author?: string;
}

/** Does this add/import result carry a look? (`null` = cancelled, nothing changed.) */
const carriesStyles = (entry: ProjectExtensionEntry | null): boolean => !!entry?.carries.styles;

export class ExtensionsSectionController {
  // ── Public rune state (read by the view; mutated only via methods) ──────────
  /** The manifest's `extensions:` list in cascade order — the ONE model. */
  entries = $state<ProjectExtensionEntry[]>([]);
  bundled = $state<BundledExtensionInfo[]>([]);
  /**
   * Update check — each pinned npm entry against npm's latest. Run when the
   * Extensions tab is first shown (never at project load) and on *Check for
   * updates*; a failure is one quiet `message`, never a modal.
   */
  updates = $state<{
    status: "idle" | "loading" | "ready" | "error";
    checks: ExtensionUpdateCheck[];
    message: string | null;
  }>({ status: "idle", checks: [], message: null });
  /**
   * Published versions per npm package NAME (the version picker's source),
   * loaded on demand — when an npm row is shown, or its picker is focused
   * after a failure — and kept for the session. Pre-releases are in the cached
   * list; `versionChoices` filters them by the preference, so flipping it
   * needs no second fetch. A failed load is retried the next time a picker
   * opens.
   */
  versions = $state<
    Record<string, { status: "loading" | "ready" | "error"; versions: string[]; message: string | null }>
  >({});
  /**
   * npm search — run ON DEMAND when the author submits the box, never at
   * project load; a failure is one quiet `message`, never a modal, and never
   * blocks the rest of the tab.
   */
  search = $state<{
    status: "idle" | "loading" | "ready" | "error";
    /** The query the current `matches` are for. */
    query: string;
    matches: NpmExtensionMatch[];
    /** What npm said it has, for "Showing N of M". */
    total: number;
    message: string | null;
  }>({ status: "idle", query: "", matches: [], total: 0, message: null });
  /** The search box's draft text (bound by the view). */
  searchQuery = $state("");
  /** Last load-test result per `use`. */
  validation = $state<Record<string, ExtensionValidationResult>>({});
  validating = $state(false);
  /** Re-check was pressed: the list says when every extension loads. */
  rechecked = $state(false);
  error = $state<string | null>(null);
  /** A non-fatal notice from the last add (installer warnings). */
  notice = $state<string | null>(null);
  /** What an action is in flight for — an entry's `use`, a bundled name, the
   *  npm draft, or `__local__`/`__file__`/`__url__` — else null. */
  busy = $state<string | null>(null);
  /** The Book setup header's Saving… / Saved, for this list's writes. */
  saveStatus = $state<"idle" | "saving" | "saved">("idle");
  /** Non-fatal warnings from the last `.zip`/`.css`/URL import (#106). */
  importWarnings = $state<string[]>([]);
  /** Drafts bound directly from the templates. */
  url = $state("");
  npmName = $state("");
  /** The named export to use for a package with no default plugin (markdown-it-emoji's `full`). */
  npmExport = $state("");
  /** Sample-thumbnail srcdoc per `use` (`"__fallback__"` when unavailable). */
  thumbs = $state<Record<string, string>>({});
  /** The enlarged two-page sample of the look card under the pointer, or null. */
  hoverPreview = $state<string | null>(null);

  /** The gallery's card order, fixed by `freezeGalleryOrder` when the Look tab opens. */
  private galleryOrder: string[] = [];
  /** Each look's stylesheet as `loadThumb` read it, for the hover sample (no second host call). */
  private readonly rawCss: Record<string, string> = {};
  /** The card the pointer is on, so a late read never paints a card it has left. */
  private hoverUse: string | null = null;
  private readonly deps: ExtensionsSectionDeps;

  constructor(deps: ExtensionsSectionDeps) {
    this.deps = deps;
  }

  // ── Derivations (getters so bun unit tests need only the $state shim) ─────
  /** The enabled looks, in cascade order: one in practice; more is an Extensions setup. */
  get enabledLooks(): ProjectExtensionEntry[] {
    return this.entries.filter((e) => e.enabled && isLook(e));
  }

  /**
   * The Look tab's cards: every built-in look, then every look the book lists
   * from npm or a folder, on or off, with the look in use first. A built-in
   * the book still has as an older version's `./extensions/<id>` copy shows
   * once, as that copy. The order is the one `freezeGalleryOrder` fixed (a
   * card that was not there then goes last), so choosing never moves a card.
   */
  get galleryLooks(): LookCard[] {
    const rank = (card: LookCard): number => {
      const at = this.galleryOrder.indexOf(card.use);
      return at < 0 ? Infinity : at;
    };
    return this.lookCards().sort((a, b) => rank(a) - rank(b));
  }

  /** Fix the gallery order as it is now (the Look tab calls this as it opens). */
  freezeGalleryOrder = (): void => {
    this.galleryOrder = this.lookCards().map((card) => card.use);
  };

  private lookCards(): LookCard[] {
    const copies = addedBuiltInIds(this.entries);
    const inUse = new Set(this.enabledLooks.map((e) => e.use));
    const cards: LookCard[] = [
      ...this.bundled
        .filter((b) => b.look && !copies.has(b.use))
        .map((b) => ({ use: b.use, label: b.label, description: b.description, from: null })),
      ...this.entries
        .filter((e) => isLook(e) && e.kind !== "bundled")
        .map((e) => ({
          use: e.use,
          label: e.label,
          description: e.description ?? "",
          from: e.kind === "npm" ? "From npm" : "From a folder",
          ...(e.author ? { author: e.author } : {}),
        })),
    ];
    return [...cards.filter((c) => inUse.has(c.use)), ...cards.filter((c) => !inUse.has(c.use))];
  }

  /** The built-in extras (bundled, not looks) the book does not list: what the Add area offers. A listed one is a row of the list. */
  get unlistedExtras(): BundledExtensionInfo[] {
    return this.bundled.filter((b) => !b.look && !this.entries.some((e) => e.use === b.use));
  }

  /**
   * The built-in looks the book does not list, by name or as an editable copy:
   * the Add area's one-click way to stack a second look on the first (the Look
   * tab's gallery chooses ONE look). A listed one is a row of the list.
   */
  get unlistedLooks(): BundledExtensionInfo[] {
    const copies = addedBuiltInIds(this.entries);
    return this.bundled.filter((b) => b.look && !copies.has(b.use) && !this.entries.some((e) => e.use === b.use));
  }

  /**
   * The search results, each marked when the book already lists the package.
   * An npm entry's `use` is `name@version`, so it is matched by package NAME;
   * any other entry by the whole `use`.
   */
  get searchResults(): Array<NpmExtensionMatch & { added: boolean }> {
    return this.search.matches.map((m) => ({
      ...m,
      added: this.entries.some((e) => (e.kind === "npm" ? e.name === m.name : e.use === m.name)),
    }));
  }

  /** The newer version npm has for an entry, or null (not npm, not checked, or current). */
  updateFor = (entry: ProjectExtensionEntry): string | null => {
    if (entry.kind !== "npm") return null;
    const check = this.updates.checks.find((c) => c.name === entry.name && c.outdated);
    return check && check.current === entry.version ? check.latest : null;
  };

  /** Pre-release versions are offered and counted as "newer" (an app preference, not per book). */
  get includePrerelease(): boolean {
    return this.deps.includePrerelease();
  }

  /** What a row's version picker lists: stable unless the preference is on, always including the pin. Empty for non-npm entries. */
  versionChoices = (entry: ProjectExtensionEntry): string[] =>
    entry.kind === "npm"
      ? pickerVersions(this.versions[entry.name]?.versions ?? [], entry.version, this.includePrerelease)
      : [];

  // ── Load ────────────────────────────────────────────────────────────────────
  loadExtensions = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.error = null;
    try {
      const [entries, bundled] = await Promise.all([this.deps.list(projectDir), this.deps.bundled()]);
      this.entries = entries;
      this.bundled = bundled;
      // Gallery thumbnails lazy-load in the background (non-fatal if they
      // fail): every listed look and every built-in one.
      const wanted = new Set([
        ...entries.filter(isLook).map((e) => e.use),
        ...bundled.filter((b) => b.look).map((b) => b.use),
      ]);
      void Promise.all([...wanted].map((use) => this.loadThumb(use)));
      await this.validateExtensions();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  };

  /**
   * Re-check (the list's head, any time) and a failing row's Check again: read
   * the list again — a folder put back or fixed since is described afresh —
   * and load-test every entry. Afterwards the list says when every one loads.
   */
  recheck = async (): Promise<void> => {
    await this.loadExtensions();
    this.rechecked = true;
  };

  /** Load-test every entry. */
  validateExtensions = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.validating = true;
    try {
      const results = await this.deps.validate(projectDir);
      this.validation = Object.fromEntries(results.map((r) => [r.use, r]));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.validating = false;
    }
  };

  /**
   * Search npm. An empty query lists the most relevant packages; a typed one
   * keeps the results that mention it (`searchMatchesQuery`). Refuses to
   * pile up a second in-flight search; a failure lands in `search.message`,
   * not `this.error` — it must never block or blank the rest of the tab.
   */
  runSearch = async (): Promise<void> => {
    if (this.search.status === "loading") return;
    const query = this.searchQuery.trim();
    this.search = { status: "loading", query, matches: this.search.matches, total: this.search.total, message: null };
    try {
      const result = await this.deps.search(query);
      this.search = result.ok
        ? {
            status: "ready",
            query,
            matches: result.matches.filter((m) => searchMatchesQuery(m, query)),
            total: result.total,
            message: null,
          }
        : { status: "error", query, matches: [], total: 0, message: result.message };
    } catch (e) {
      this.search = { status: "error", query, matches: [], total: 0, message: e instanceof Error ? e.message : String(e) };
    }
  };

  /**
   * Ask npm for each pinned entry's latest (pre-releases too when the
   * preference is on). Refuses to pile up a second in-flight check; a failure
   * lands in `updates.message`, not `this.error`.
   */
  checkUpdates = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.updates.status === "loading") return;
    this.updates = { status: "loading", checks: this.updates.checks, message: null };
    try {
      const result = await this.deps.outdated(projectDir, this.includePrerelease);
      this.updates = result.ok
        ? { status: "ready", checks: result.checks, message: null }
        : { status: "error", checks: [], message: result.message };
    } catch (e) {
      this.updates = { status: "error", checks: [], message: e instanceof Error ? e.message : String(e) };
    }
  };

  /** Flip "Include pre-release versions" and ask npm again — "newer" now means something else. */
  setIncludePrerelease = (on: boolean): void => {
    this.deps.setIncludePrerelease(on);
    void this.checkUpdates();
  };

  /**
   * Load one package's published versions for its picker. A no-op while a load
   * is in flight or once it succeeded (the session cache); after a failure the
   * next call tries again. A failure lands in `versions[name].message`, not
   * `this.error` — it must never block the tab.
   */
  loadVersions = async (name: string): Promise<void> => {
    const current = this.versions[name]?.status;
    if (current === "loading" || current === "ready") return;
    this.versions = { ...this.versions, [name]: { status: "loading", versions: [], message: null } };
    let next: { status: "ready" | "error"; versions: string[]; message: string | null };
    try {
      const result = await this.deps.versions(name);
      next = result.ok
        ? { status: "ready", versions: result.versions, message: null }
        : { status: "error", versions: [], message: result.message };
    } catch (e) {
      next = { status: "error", versions: [], message: e instanceof Error ? e.message : String(e) };
    }
    this.versions = { ...this.versions, [name]: next };
  };

  /** Re-pin one npm entry to the version `checkUpdates` found: `add(name@latest)`, behind the same trust gate as any install. */
  update = async (entry: ProjectExtensionEntry): Promise<void> => {
    const latest = this.updateFor(entry);
    if (!latest) return;
    const added = await this.installSpec(entry, `${entry.name}@${latest}`);
    if (!added) return;
    this.updates = { ...this.updates, checks: this.updates.checks.filter((c) => c.name !== entry.name) };
  };

  /**
   * "Install" on a row whose downloaded copy is missing or broken: the SAME
   * install path as `ext add`, for exactly the version the book pins (a book
   * with no pin gets npm's latest, which the install then pins).
   */
  install = async (entry: ProjectExtensionEntry): Promise<void> => {
    if (entry.kind !== "npm") return;
    if (await this.installSpec(entry, entry.version ? `${entry.name}@${entry.version}` : entry.name)) {
      void this.checkUpdates();
    }
  };

  /**
   * The picker: install `name@<version>` and, only once the host has
   * downloaded, verified and load-tested it, pin it. A failed install leaves
   * the old pin and its downloaded copy exactly as they were (the host rolls
   * back), and the error says so. Choosing the version already pinned is a no-op.
   */
  switchVersion = async (entry: ProjectExtensionEntry, version: string): Promise<void> => {
    if (entry.kind !== "npm" || !version || version === entry.version) return;
    const kept = entry.version ? `This book still uses ${entry.version}. ` : "";
    if (await this.installSpec(entry, `${entry.name}@${version}`, kept)) void this.checkUpdates();
  };

  /** The one npm install: `add(spec)` keeping the entry's `export`, behind the native trust gate. Null result: cancelled or failed. */
  private async installSpec(
    entry: ProjectExtensionEntry,
    spec: string,
    /** Said after "Couldn't install …" when it fails, e.g. what the book still uses. */
    failureNote = "",
  ): Promise<ProjectExtensionEntry | null> {
    const added = await this.mutate(
      entry.use,
      (dir) => this.deps.add(dir, spec, entry.export),
      carriesStyles,
      `Couldn't install ${spec}. ${failureNote}`,
    );
    if (!added) return null;
    if (added.warnings?.length) this.notice = added.warnings.join(" ");
    return added;
  }

  private async loadThumb(use: string): Promise<void> {
    if (this.thumbs[use]) return;
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    try {
      const css = await this.deps.readCss(projectDir, use);
      this.rawCss[use] = css;
      this.thumbs = { ...this.thumbs, [use]: sampleSrcdoc(css) };
    } catch {
      this.thumbs = { ...this.thumbs, [use]: "__fallback__" };
    }
  }

  // ── The enlarged sample (0.11.22's hover preview, restored in #482) ────────
  //
  // Pointing at (or tabbing to) a look card shows the same look over a FIXED
  // two-page sample spread, larger (`hoverPreviewSrcdoc`). It never renders the
  // author's document, so it cannot re-paginate anything. The Look tab shows
  // it only in a window wide enough to hold it beside the column (CSS); the
  // CSS is the one `loadThumb` read, read again only when that failed.
  showHoverPreview = async (use: string): Promise<void> => {
    this.hoverUse = use;
    let css = this.rawCss[use];
    if (css === undefined) {
      const projectDir = this.deps.projectDir();
      if (!projectDir) return;
      try {
        css = await this.deps.readCss(projectDir, use);
        this.rawCss[use] = css;
      } catch {
        if (this.hoverUse === use) this.hoverPreview = null;
        return;
      }
    }
    // The pointer may have moved on while the CSS was read.
    if (this.hoverUse === use) this.hoverPreview = hoverPreviewSrcdoc(css);
  };

  hideHoverPreview = (): void => {
    this.hoverUse = null;
    this.hoverPreview = null;
  };

  // ── The one mutation shape ──────────────────────────────────────────────────
  /**
   * Every verb below: refuse while busy, clear the messages, mark busy, run,
   * reload the list on success (and the design settings when the change
   * touched a look), surface a failure, clear busy. A `null` result is the
   * "cancelled, nothing changed" convention of the add/import verbs — no
   * reload. Returns the action's result, or undefined when refused or failed.
   */
  private async mutate<T>(
    busyKey: string,
    action: (projectDir: string) => Promise<T>,
    touchesLook: (result: T) => boolean,
    /** Prepended to a failure's message, so the author learns what failed. */
    failurePrefix = "",
  ): Promise<T | undefined> {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.busy) return undefined;
    this.busy = busyKey;
    this.error = null;
    this.notice = null;
    this.saveStatus = "saving";
    try {
      const result = await action(projectDir);
      if (result === null) {
        this.saveStatus = "idle";
        return result;
      }
      await this.loadExtensions();
      if (touchesLook(result)) await this.deps.afterLookChange?.();
      this.saveStatus = "saved";
      return result;
    } catch (e) {
      this.error = failurePrefix + (e instanceof Error ? e.message : String(e));
      this.saveStatus = "idle";
      return undefined;
    } finally {
      this.busy = null;
    }
  }

  // ── Verbs (arrow fields: passed as callbacks from the templates) ────────────
  toggle = async (entry: ProjectExtensionEntry): Promise<void> => {
    await this.mutate(
      entry.use,
      (dir) => this.deps.setEnabled(dir, entry.use, !entry.enabled),
      () => entry.carries.styles,
    );
  };

  remove = async (entry: ProjectExtensionEntry): Promise<void> => {
    await this.mutate(entry.use, (dir) => this.deps.remove(dir, entry.use), () => entry.carries.styles);
  };

  /** Move `entry` one slot up (-1) or down (+1) in the list. */
  move = async (entry: ProjectExtensionEntry, delta: -1 | 1): Promise<void> => {
    const order = orderAfterMove(this.entries.map((e) => e.use), entry.use, delta);
    if (!order) return;
    await this.mutate(entry.use, (dir) => this.deps.reorder(dir, order), () => entry.carries.styles);
  };

  /**
   * Choose a look from the gallery, in one step: the target is added (a
   * built-in not listed yet) or switched on, moved to the old look's place in
   * the list, and the old look goes — a built-in is removed, an npm or folder
   * look only switched off. Refused while the book has two or more looks on
   * (that setup is the Extensions tab's to change) or when the card is already the look.
   */
  chooseLook = async (card: LookCard): Promise<void> => {
    const looks = this.enabledLooks;
    const old = looks[0];
    if (looks.length > 1 || old?.use === card.use) return;
    const listed = this.entries.some((e) => e.use === card.use);
    await this.mutate(
      card.use,
      async (dir) => {
        if (listed) await this.deps.setEnabled(dir, card.use, true);
        else await this.deps.add(dir, card.use);
        if (!old) return true;
        // Every `use` once (what `reorder` insists on), the target where the old look is.
        const order = this.entries.map((e) => e.use).filter((u) => u !== card.use);
        order.splice(order.indexOf(old.use), 0, card.use);
        await this.deps.reorder(dir, order);
        if (old.kind === "bundled") await this.deps.remove(dir, old.use);
        else await this.deps.setEnabled(dir, old.use, false);
        return true;
      },
      () => true,
      `Couldn't switch to ${card.label}. ${old ? `Your book still uses ${old.label}. ` : ""}`,
    );
  };

  /**
   * "Make an editable copy" of a built-in look: the host copies it into
   * `extensions/<id>/` and lists the copy (`./extensions/<id>`) where the
   * built-in was. The copy takes the built-in's card in the gallery, so
   * nothing moves; it is a folder look from then on, the author's to edit.
   */
  copyLook = async (card: LookCard): Promise<void> => {
    if (card.from !== null) return;
    const copy = await this.mutate(
      card.use,
      async (dir) => {
        const added = await this.deps.addBuiltIn(dir, card.use);
        // Before the list reloads, so the card never shows anywhere else.
        this.galleryOrder = this.galleryOrder.map((use) => (use === card.use ? added.use : use));
        return added;
      },
      () => true,
      `Couldn't copy ${card.label}. `,
    );
    if (copy) this.announceAdded(copy);
  };

  /**
   * Add a built-in extra or look to the list by its bundled name, so nothing
   * is installed or copied. A look added here is stacked on the book's look:
   * it goes last, so it wins where the two disagree.
   */
  addExtra = async (b: BundledExtensionInfo): Promise<void> => {
    await this.mutate(b.use, (dir) => this.deps.add(dir, b.use), carriesStyles);
  };

  /** Add an npm package by name (or `name@version`): the one add path of the typed name and a search result. */
  private addPackage(name: string, exportName?: string): Promise<ProjectExtensionEntry | null | undefined> {
    return this.mutate(name, (dir) => this.deps.add(dir, name, exportName), carriesStyles);
  }

  /** "Add by exact name" → `add`, with the named export when one is typed. A cancelled trust gate keeps the drafts. */
  addNpm = async (): Promise<void> => {
    const name = this.npmName.trim();
    if (!name) {
      this.error = "Enter an npm package name (e.g. markdown-it-highlightjs).";
      return;
    }
    const added = await this.addPackage(name, this.npmExport.trim() || undefined);
    if (!added) return;
    this.npmName = "";
    this.npmExport = "";
    this.announceAdded(added);
  };

  /** Add a search result: the package name IS the specifier `ext add` takes. */
  addSearched = async (match: NpmExtensionMatch): Promise<void> => {
    const added = await this.addPackage(match.name);
    if (added) this.announceAdded(added);
  };

  /** A folder or plugin file from the native picker, referenced in place. */
  addLocal = async (): Promise<void> => {
    const added = await this.mutate("__local__", (dir) => this.deps.addLocal(dir), carriesStyles);
    if (added) this.announceAdded(added);
  };

  /**
   * #106: import a look from a `.zip` package or a bare `.css` file via the
   * native file picker. The host validates (rejects on a parse failure, unsafe
   * paths, or over-cap) and returns non-fatal warnings, which are surfaced
   * without blocking the import.
   */
  importFile = async (): Promise<void> => {
    this.importWarnings = [];
    const result = await this.mutate("__file__", (dir) => this.deps.importFromFile(dir), () => true);
    if (result) this.announceImported(result);
  };

  importUrl = async (): Promise<void> => {
    const url = this.url.trim();
    if (!url) {
      this.error = "Enter a web address (a .css file or an extension folder).";
      return;
    }
    this.importWarnings = [];
    const result = await this.mutate("__url__", (dir) => this.deps.importFromUrl(dir, url), () => true);
    if (!result) return;
    this.url = "";
    this.announceImported(result);
  };

  /** After a successful add (the list is already reloaded): surface the host's non-fatal warnings. */
  private announceAdded(entry: ProjectExtensionEntry): void {
    if (entry.warnings?.length) this.notice = entry.warnings.join(" ");
  }

  private announceImported(result: ExtensionImportResult): void {
    this.importWarnings = result.warnings.map((w) => w.message);
    this.announceAdded(result.entry);
  }
}
