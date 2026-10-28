/**
 * DesignSectionController — the single owner of the book's design settings
 * (the `:root` custom properties): the Look tab's six brand settings and live
 * sample, and Advanced's "All design settings".
 *
 * What the panel shows is the cascade the book renders with: the `:root`
 * custom properties of every ENABLED extension that carries styles, read in
 * list (= cascade) order through `readCss` (a bundled look's inlined CSS, or
 * a path/npm entry's declared sheets), overlaid with the book's own active
 * stylesheet, which loads last and wins (`cascadeStyleTokens`). What it
 * writes is ONLY that book stylesheet (`cssPath` / `cssName` — `styles/book.css`
 * by default): an edit updates the sheet's own `:root` declaration of the
 * token, or adds one to its `:root` block (`applyTokenUpdates`). A look's own
 * files are never written; the author's stylesheet is the one place a look is
 * styled over (#427). A book with no stylesheet of its own gets
 * `styles/book.css` on its first edit (`ensureStylesheet`). Revert is an undo:
 * a token the book declared gets its own value back, and one only a look
 * declared has the book's declaration of it removed again, so the look's value
 * shows through instead of being pinned.
 *
 * The six brand settings (`BRAND`) are the shared vocabulary every built-in
 * look defines, so they carry across looks; `sampleDoc` is the enabled looks'
 * CSS over a fixed sample with the current values on top.
 *
 * The load-bearing part is the debounced, serialized, race-free token
 * writer: edits coalesce into `tokenPending` (keyed by name, last value wins)
 * behind ONE debounce timer; a flush reads the CSS once, folds ALL pending
 * mutations via `applyTokenUpdates`, and writes once, so two edits in the same
 * tick can't clobber each other. `commitChain` serializes overlapping flushes
 * so an unmount flush can't race the debounce timer onto a stale base string.
 *
 * Single-owner discipline mirrors `PageNavController`
 * (`routes/page-nav-controller.svelte.ts`): the component reads the public rune
 * getters and calls the intent methods; the callbacks passed down to
 * the sections are arrow fields so `this` survives prop passing.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8): the reactive `projectDir` accessor, the `listStyles` /
 * `listExtensions` / `readCss` / `readFile` / `writeFile` / `setActiveStyles`
 * host calls, the `onError` (toast) hook, and the debounce timer primitives.
 * Only type-only lib-shaped imports plus pure string helpers — ZERO `node:*` /
 * lib value imports.
 *
 * `tokens` (from `parseStyleTokens`) already excludes `@internal`-annotated
 * declarations and carries each token's optional `@group` annotation (issue
 * #244) — see that function's doc in `#lib/style-tokens.ts` for the comment
 * grammar. `customGroups` and the four kind-based getters below are what turn
 * that flat, annotated list into the sections `DesignSection.svelte` renders.
 */

import type { ProjectExtensionEntry, ProjectStyle, StyleToken } from "#lib/platform/dtos.ts";
import {
  cascadeStyleTokens,
  parseStyleTokens,
  applyTokenUpdates,
  type TokenUpdate,
} from "#lib/style-tokens.ts";
import { sampleSrcdoc } from "#lib/components/config/config-helpers.ts";
import { joinPath } from "#lib/platform/paths.ts";

/** The stylesheet a book without one gets on its first edit (what `gutterpress new` scaffolds). */
const BOOK_STYLESHEET = "styles/book.css";

export interface DesignSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** Resolve the project's editable stylesheets (the active set + fallbacks). */
  listStyles: (projectDir: string) => Promise<ProjectStyle[]>;
  /** The project's configured extensions in cascade order (#265). */
  listExtensions: (projectDir: string) => Promise<ProjectExtensionEntry[]>;
  /** One extension's stylesheets as CSS text: a bundled look's, or a path/npm entry's declared sheets concatenated. */
  readCss: (projectDir: string, use: string) => Promise<string>;
  /** Read a file as UTF-8 text. Path is absolute. */
  readFile: (path: string) => Promise<string>;
  /** Write UTF-8 content to a file. Path is absolute. */
  writeFile: (path: string, content: string) => Promise<unknown>;
  /** Replace the manifest's `styles:` list (project-relative paths). */
  setActiveStyles: (projectDir: string, paths: string[]) => Promise<unknown>;
  /** Surface a save failure (the panel wires this to a toast). */
  onError?: (message: string) => void;
  /** Debounce window for coalesced token writes (ms). Default 250. */
  debounceMs?: number;
  /** Injected timer primitives (default real setTimeout/clearTimeout) for tests. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class DesignSectionController {
  /** The Look tab's brand settings, in the order it shows them. */
  static readonly BRAND = ["--font-body", "--font-display", "--fs-body", "--leading", "--color-ink", "--color-accent"];

  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** Absolute path of the book stylesheet edits are written to. */
  cssPath = $state<string | null>(null);
  /** Display name of that stylesheet. */
  cssName = $state("");
  /** The editable `:root` custom properties, in cascade order, with their effective values. */
  tokens = $state<StyleToken[]>([]);
  /** True while the design section's initial load is in flight. */
  designLoading = $state(false);
  /** Last load/parse error, or null. */
  designError = $state<string | null>(null);
  /** The Book setup header's Saving… / Saved, for token writes. */
  designSaveStatus = $state<"idle" | "saving" | "saved">("idle");
  /** The last token write's failure, until a write succeeds. */
  designSaveError = $state<string | null>(null);
  /** Display names of the enabled looks whose tokens the panel shows, in cascade order. */
  lookLabels = $state<string[]>([]);

  // ── Non-reactive internals ──────────────────────────────────────────────────
  private readonly originals = new Map<string, string>();
  /** The tokens the book's own sheet declared at load (the rest come from looks). */
  private bookDeclared = new Set<string>();
  /** Each token's value from the enabled looks alone (what shows when the book's override goes). */
  private lookValues = new Map<string, string>();
  /** The enabled looks' CSS, in cascade order (the sample's base). */
  private lookCss = "";
  /** The manifest's active stylesheets (project-relative), for `ensureStylesheet`. */
  private activeStyles: string[] = [];
  /** Coalesced edits by name: a value to write, or null to remove the book's declaration. */
  private readonly tokenPending = new Map<string, string | null>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private commitChain: Promise<boolean> = Promise.resolve(true);

  private readonly deps: DesignSectionDeps;
  private readonly debounceMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(deps: DesignSectionDeps) {
    this.deps = deps;
    this.debounceMs = deps.debounceMs ?? 250;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));
  }

  // ── Derivations (getters so bun unit tests need only the $state shim) ───────
  //
  // Grouping (issue #244): a token carrying an `@group` annotation
  // (`parseStyleTokens` in `#lib/style-tokens`) is claimed by `customGroups`
  // and excluded from every heuristic kind-based bucket below via `ungrouped`
  // — each token appears exactly once, either under its author-named heading
  // or under the Fonts/Colors/Sizes/Other one its `kind` picks. A theme with
  // no `@group` annotations leaves every token's `group` undefined, so
  // `ungrouped` is just `tokens` and the heuristic buckets are unchanged.

  /** Tokens not claimed by an explicit `@group` — the pool the heuristic
   * kind-based getters below draw from. */
  private get ungrouped(): StyleToken[] {
    return this.tokens.filter((t) => !t.group);
  }

  /** Explicitly annotated groups, in the order their names first appear in
   * the stylesheet, each holding its tokens in source order regardless of
   * `kind` — a "Colors" group can mix a color and a text token if the theme
   * author puts them there. Rendered before the heuristic buckets (the
   * DesignSection template renders this list first), which is what "annotated
   * groups order before heuristic ones" (issue #244) means in practice. Empty
   * when no token in the file carries a `@group` annotation.
   */
  get customGroups(): { name: string; tokens: StyleToken[] }[] {
    const order: string[] = [];
    const byName = new Map<string, StyleToken[]>();
    for (const t of this.tokens) {
      if (!t.group) continue;
      let bucket = byName.get(t.group);
      if (!bucket) {
        bucket = [];
        byName.set(t.group, bucket);
        order.push(t.group);
      }
      bucket.push(t);
    }
    return order.map((name) => ({ name, tokens: byName.get(name)! }));
  }

  get fontTokens(): StyleToken[] {
    return this.ungrouped.filter((t) => t.kind === "font");
  }
  get colorTokens(): StyleToken[] {
    return this.ungrouped.filter((t) => t.kind === "color");
  }
  // "length" (has a unit) and "number" (unitless, e.g. `--leading: 1.55`)
  // share one numeric-input control in the panel, so one bucket serves both.
  get sizeTokens(): StyleToken[] {
    return this.ungrouped.filter((t) => t.kind === "length" || t.kind === "number");
  }
  get otherTokens(): StyleToken[] {
    return this.ungrouped.filter((t) => t.kind === "text");
  }
  get anyDirty(): boolean {
    return this.tokens.some((t) => this.isDirty(t));
  }

  /** True when the token's live value differs from the loaded original. */
  isDirty = (t: StyleToken): boolean =>
    this.originals.has(t.name) && this.originals.get(t.name) !== t.value;

  /** True when the book's stylesheet overrides a value an enabled look sets
   * (a saved edit from an earlier session, or a hand-written rule), so the
   * look's value can be put back with `resetToken`. */
  overridesLook = (t: StyleToken): boolean =>
    !this.isDirty(t) &&
    this.bookDeclared.has(t.name) &&
    this.lookValues.has(t.name) &&
    this.lookValues.get(t.name) !== t.value;

  /** The value the enabled looks give the token, or undefined when none sets it. */
  lookValue = (t: StyleToken): string | undefined => this.lookValues.get(t.name);

  /** The brand settings an enabled look or the book's stylesheet declares, in `BRAND` order. */
  get brandTokens(): StyleToken[] {
    return DesignSectionController.BRAND.flatMap((name) => this.tokens.filter((t) => t.name === name));
  }

  /** True when the book sets a brand setting a look also sets, or one was changed here. */
  get brandOverridden(): boolean {
    return this.brandTokens.some(
      (t) => this.isDirty(t) || (this.bookDeclared.has(t.name) && this.lookValues.has(t.name)),
    );
  }

  /** The Look tab's live sample: the enabled looks' CSS, then the current values. */
  get sampleDoc(): string {
    return sampleSrcdoc(`${this.lookCss}\n:root{${this.tokens.map((t) => `${t.name}:${t.value};`).join("")}}`);
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  async loadDesign(): Promise<void> {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.designLoading = true;
    this.designError = null;
    this.tokens = [];
    try {
      // Two independent host calls — the extension list only needs
      // `projectDir`, so it is fetched alongside the style list, not after it.
      const [list, extensions] = await Promise.all([
        this.deps.listStyles(projectDir),
        this.deps.listExtensions(projectDir).catch(() => []),
      ]);
      // A book with no stylesheet of its own yet still shows its looks'
      // settings; the first edit creates one (`ensureStylesheet`).
      const active = list.find((x) => x.active) ?? list[0];
      this.cssPath = active?.path ?? null;
      this.cssName = active?.displayName ?? "";
      this.activeStyles = list.filter((x) => x.active).map((x) => x.displayName);
      // Every enabled look in cascade order, then the book's own sheet, which
      // loads after all of them. A look whose CSS can't be read (a missing
      // folder) contributes nothing here; Advanced's extension list reports it.
      const looks = extensions.filter((e) => e.enabled && e.carries.styles);
      const sheets = await Promise.all([
        ...looks.map((e) => this.deps.readCss(projectDir, e.use).catch(() => "")),
        active ? this.deps.readFile(active.path) : "",
      ]);
      this.lookLabels = looks.map((e) => e.label);
      this.lookCss = sheets.slice(0, -1).join("\n");
      this.tokens = cascadeStyleTokens(sheets);
      this.bookDeclared = new Set(parseStyleTokens(sheets.at(-1)!).map((t) => t.name));
      this.lookValues = new Map(cascadeStyleTokens(sheets.slice(0, -1)).map((t) => [t.name, t.value]));
      this.originals.clear();
      for (const t of this.tokens) this.originals.set(t.name, t.value);
      this.designSaveStatus = "idle";
    } catch (e) {
      this.designError = e instanceof Error ? e.message : String(e);
    } finally {
      this.designLoading = false;
    }
  }

  // ── Debounced, serialized token writes ──────────────────────────────────────
  private scheduleTokenWrite(name: string, value: string | null): void {
    this.tokenPending.set(name, value);
    this.designSaveStatus = "saving";
    if (this.flushTimer) this.clearTimer(this.flushTimer);
    this.flushTimer = this.setTimer(() => {
      this.flushTimer = null;
      void this.flushPendingTokenWrites();
    }, this.debounceMs);
  }

  /** Flush any pending token edits now (also used on close). Resolves to false when the write failed. */
  flushPendingTokenWrites(): Promise<boolean> {
    if (this.flushTimer) {
      this.clearTimer(this.flushTimer);
      this.flushTimer = null;
    }
    // Chain after any in-flight commit so each read-once/write-once pass sees
    // the previous write's result instead of a stale snapshot.
    this.commitChain = this.commitChain.then(() => this.commitPendingTokens());
    return this.commitChain;
  }

  private async commitPendingTokens(): Promise<boolean> {
    // Capture the target path BEFORE any await: a concurrent
    // loadDesign() — a stylesheet/theme switch — can reassign `this.cssPath`
    // while we're parked on the read below. Reading `this.cssPath` again after
    // the await for the write would fold the OLD sheet's tokens into the NEWLY
    // selected file, corrupting it. Bind one local `cssPath` and read AND write
    // it, so a batch always lands on the exact sheet its edits came from.
    let cssPath = this.cssPath;
    if (this.tokenPending.size === 0) return true;
    // Drain the coalesced edits into one batch, then read → fold → write once.
    const updates: TokenUpdate[] = [...this.tokenPending.entries()].map(
      ([name, value]) => ({ name, value }),
    );
    this.tokenPending.clear();
    try {
      cssPath ??= await this.ensureStylesheet();
      if (!cssPath) return true;
      const css = await this.deps.readFile(cssPath);
      await this.deps.writeFile(cssPath, applyTokenUpdates(css, updates));
      // Only advance the badge if the active sheet is still the one we wrote;
      // if a switch happened mid-flight, the badge belongs to the new sheet
      // (loadDesign already reset it to "idle") — don't clobber it with "saved".
      if (this.cssPath === cssPath) {
        this.designSaveError = null;
        if (this.tokenPending.size === 0) this.designSaveStatus = "saved";
      }
      return true;
    } catch (e) {
      // Re-queue the failed batch (unless a newer edit already superseded it) so
      // a later flush can retry, and surface the error — but only while we're
      // still on the same sheet, so a failed OLD-sheet write can't leak its
      // edits into the pending queue of a sheet the user just switched to.
      const reason = e instanceof Error ? e.message : String(e);
      if (this.cssPath === cssPath) {
        for (const u of updates) if (!this.tokenPending.has(u.name)) this.tokenPending.set(u.name, u.value);
        this.designSaveStatus = "idle";
        this.designSaveError = `Couldn't save your change: ${reason}`;
      }
      this.deps.onError?.(`Couldn't save changes: ${reason}`);
      return false;
    }
  }

  /**
   * Give a book with no stylesheet of its own one, so an edit has somewhere
   * to go: `styles/book.css` holding an empty `:root {}`, added to the
   * manifest's `styles:`. A no-op once the book has one. Resolves to its path
   * (null without a project).
   */
  ensureStylesheet = async (): Promise<string | null> => {
    const projectDir = this.deps.projectDir();
    if (this.cssPath || !projectDir) return this.cssPath;
    const path = joinPath(projectDir, ...BOOK_STYLESHEET.split("/"));
    await this.deps.writeFile(path, ":root {\n}\n");
    this.activeStyles = [...this.activeStyles, BOOK_STYLESHEET];
    await this.deps.setActiveStyles(projectDir, this.activeStyles);
    this.cssPath = path;
    this.cssName = BOOK_STYLESHEET;
    return path;
  };

  // ── Intents (arrow fields: passed as callback props to DesignSection) ───────
  setToken = (t: StyleToken, value: string): void => {
    t.value = value;
    this.tokens = this.tokens; // nudge reactivity (mutated element)
    this.scheduleTokenWrite(t.name, value);
  };

  /**
   * Undo a token edit. While the edit is unsaved-in-session (dirty) the loaded
   * value comes back; a clean token the book overrides from an earlier session
   * drops its override instead, so the look's value shows through again.
   * Never pins: only a value the book itself declared is written back.
   */
  resetToken = (t: StyleToken): void => {
    if (this.isDirty(t)) {
      const o = this.originals.get(t.name)!;
      t.value = o;
      this.tokens = this.tokens; // nudge reactivity (mutated element)
      this.scheduleTokenWrite(t.name, this.bookDeclared.has(t.name) ? o : null);
      return;
    }
    if (!this.overridesLook(t)) return;
    const fromLook = this.lookValues.get(t.name)!;
    t.value = fromLook;
    this.tokens = this.tokens; // nudge reactivity (mutated element)
    this.bookDeclared.delete(t.name);
    this.originals.set(t.name, fromLook);
    this.scheduleTokenWrite(t.name, null);
  };

  /** Undo this session's edits only; stored overrides are left alone. */
  revertAllTokens = (): void => {
    for (const t of this.tokens) if (this.isDirty(t)) this.resetToken(t);
  };

  /**
   * "Use the look's settings": every brand setting the book sets (or that was
   * changed here) and a look also sets goes back to the look's value, and the
   * book's declaration of it is taken out, so the look shows through.
   */
  resetBrand = (): void => {
    for (const t of this.brandTokens) {
      const fromLook = this.lookValues.get(t.name);
      if (fromLook === undefined || !(this.bookDeclared.has(t.name) || this.isDirty(t))) continue;
      t.value = fromLook;
      this.bookDeclared.delete(t.name);
      this.originals.set(t.name, fromLook);
      this.scheduleTokenWrite(t.name, null);
    }
    this.tokens = this.tokens; // nudge reactivity (mutated elements)
  };

  setLength = (t: StyleToken, num: string): void => {
    const n = num.trim();
    if (n === "") return;
    this.setToken(t, `${n}${t.unit ?? ""}`);
  };
}
