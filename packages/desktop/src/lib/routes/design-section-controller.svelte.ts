/**
 * DesignSectionController — the single owner of the book's design settings
 * (the `:root` custom properties): the Look tab's six brand settings and live
 * sample, and Advanced's "All design settings".
 *
 * What the panel shows is the book's stylesheet as the build assembles it
 * (#454): `readBookCss` (the `style/book-css` route) returns it as ordered
 * chunks tagged with their origin — core, each enabled extension's files and
 * `css` export, each of the book's own `styles:` sheets — with the root-level
 * custom properties each declares, read host-side with postcss. The settings
 * are the extensions' and the book's (core's own are not settings), in the
 * order they are first declared, and each one's value is what the sample page
 * computes with that stylesheet (`computeValues`, `getComputedStyle`), so the
 * cascade is the browser's, not ranked here. What it writes is ONLY the
 * book's own sheets, through `editTokens` (the `style/edit-tokens` route, a
 * postcss edit): a token a book sheet declares is changed in place there, and
 * a new one goes into the `:root` of the book's first stylesheet (`cssPath` /
 * `cssName` — `styles/book.css` by default). A look's own files are never
 * written; the author's stylesheet is the one place a look is styled over
 * (#427). A book with no stylesheet of its own gets `styles/book.css` on its
 * first edit (`ensureStylesheet`). Revert is an undo: a token the book
 * declared gets its own declaration back as written, and one only a look
 * declared has the book's declaration of it removed again, so the look's
 * value shows through instead of being pinned.
 *
 * The six brand settings (`BRAND`) are the shared vocabulary every built-in
 * look defines, so they carry across looks; `sampleDoc` is the book's
 * stylesheet over a fixed sample with the current values on top.
 *
 * The load-bearing part is the debounced, serialized, race-free token
 * writer: edits coalesce into `tokenPending` (keyed by name, last value wins)
 * behind ONE debounce timer; a flush sends ALL pending mutations in one
 * `editTokens` call, which reads, folds and writes on the host, so two edits
 * in the same tick can't clobber each other. `commitChain` serializes
 * overlapping flushes so an unmount flush can't race the debounce timer.
 *
 * Single-owner discipline mirrors `PageNavController`
 * (`routes/page-nav-controller.svelte.ts`): the component reads the public rune
 * getters and calls the intent methods; the callbacks passed down to
 * the sections are arrow fields so `this` survives prop passing.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8): the reactive `projectDir` accessor, the `listStyles` /
 * `listExtensions` / `readBookCss` / `editTokens` / `writeFile` /
 * `setActiveStyles` host calls, the `computeValues` browser reading, the
 * `onError` (toast) hook, and the debounce timer primitives. Only type-only
 * lib-shaped imports plus pure string helpers — ZERO `node:*` / lib value
 * imports.
 *
 * A token's label and `@group` come from its first declaration (issue #244 —
 * see the lib's `root-tokens.ts` for the comment grammar; `@internal` ones
 * never arrive). `customGroups` and the four kind-based getters below are
 * what turn that flat, annotated list into the sections
 * `DesignSection.svelte` renders.
 */

import type {
  BookCss,
  ProjectExtensionEntry,
  ProjectStyle,
  RootToken,
  StyleToken,
  TokenUpdate,
} from "#lib/platform/dtos.ts";
import { makeStyleToken } from "#lib/style-tokens.ts";
import { sampleSrcdoc } from "#lib/components/config/config-helpers.ts";
import { joinPath } from "#lib/platform/paths.ts";

/** The stylesheet a book without one gets on its first edit (what `gutterpress new` scaffolds). */
const BOOK_STYLESHEET = "styles/book.css";

/** One declaration of a setting, and whether it is the book's own (else an extension's). */
type Declared = RootToken & { fromBook: boolean };

export interface DesignSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** Resolve the project's editable stylesheets (the active set + fallbacks). */
  listStyles: (projectDir: string) => Promise<ProjectStyle[]>;
  /** The project's configured extensions in cascade order (#265), for the looks' names. */
  listExtensions: (projectDir: string) => Promise<ProjectExtensionEntry[]>;
  /** The book's stylesheet as the build assembles it: ordered, origin-tagged chunks and their `:root` custom properties. */
  readBookCss: (projectDir: string) => Promise<BookCss>;
  /** Each named custom property's value as the sample page computes it with this CSS (`getComputedStyle`). */
  computeValues: (css: string, names: string[]) => Promise<Record<string, string>>;
  /** Write token edits to the book's own stylesheets: in place where one declares the token, else into `file`'s `:root`. */
  editTokens: (projectDir: string, file: string, updates: TokenUpdate[]) => Promise<unknown>;
  /** Write UTF-8 content to a file (the stylesheet `ensureStylesheet` creates). Path is absolute. */
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
  /** "Reset to the look's settings" was pressed: its Replace / Keep mine question shows. */
  brandResetAsked = $state(false);
  /** Display names of the enabled looks whose tokens the panel shows, in cascade order. */
  lookLabels = $state<string[]>([]);

  // ── Non-reactive internals ──────────────────────────────────────────────────
  private readonly originals = new Map<string, string>();
  /** The tokens the book's own sheets declared at load (the rest come from looks). */
  private bookDeclared = new Set<string>();
  /** The book's own declaration of each of those, as written (what an undo puts back). */
  private bookWritten = new Map<string, string>();
  /** Each token's value from the enabled looks alone (what shows when the book's override goes). */
  private lookValues = new Map<string, string>();
  /** The book's stylesheet, as the build assembles it (the sample's base). */
  private bookCss = "";
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

  /** True when a brand setting a look sets has another value here: the book's own, or one changed here. */
  get brandOverridden(): boolean {
    return this.brandTokens.some((t) => this.lookValues.has(t.name) && this.lookValues.get(t.name) !== t.value);
  }

  /** The Look tab's live sample: the book's stylesheet, then the current values. */
  get sampleDoc(): string {
    return sampleSrcdoc(`${this.bookCss}\n:root{${this.tokens.map((t) => `${t.name}:${t.value};`).join("")}}`);
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  async loadDesign(): Promise<void> {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.designLoading = true;
    this.designError = null;
    this.tokens = [];
    try {
      // Three independent host calls, fetched together.
      const [list, extensions, book] = await Promise.all([
        this.deps.listStyles(projectDir),
        this.deps.listExtensions(projectDir).catch(() => []),
        this.deps.readBookCss(projectDir),
      ]);
      // A book with no stylesheet of its own yet still shows its looks'
      // settings; the first edit creates one (`ensureStylesheet`). A file the
      // book only could use (a shared one) is not its stylesheet.
      const active = list.find((x) => x.active);
      this.cssPath = active?.path ?? null;
      this.cssName = active?.displayName ?? "";
      this.activeStyles = list.filter((x) => x.active).map((x) => x.displayName);
      this.lookLabels = extensions.filter((e) => e.enabled && e.carries.styles).map((e) => e.label);

      // The settings: every custom property an extension or the book's own
      // sheets declare, by name, in cascade order. Core's own are not settings.
      const byName = new Map<string, Declared[]>();
      for (const chunk of book.chunks) {
        if (chunk.origin.kind === "core") continue;
        for (const t of chunk.tokens) {
          const d = { ...t, fromBook: chunk.origin.kind === "book" };
          const ds = byName.get(t.name);
          if (ds) ds.push(d);
          else byName.set(t.name, [d]);
        }
      }
      const lookNames = [...byName].filter(([, ds]) => ds.some((d) => !d.fromBook)).map(([name]) => name);
      const sheet = (chunks: BookCss["chunks"]): string => chunks.map((c) => c.css).join("\n\n");
      this.bookCss = sheet(book.chunks);
      // Each value as the sample page computes it: with the whole stylesheet,
      // and with the looks alone (what shows once the book's own goes). A
      // value the page can't give (no sample, or one it computes as nothing)
      // falls back to the last declaration.
      const [values, lookOnly] = await Promise.all([
        this.deps.computeValues(this.bookCss, [...byName.keys()]),
        this.deps.computeValues(sheet(book.chunks.filter((c) => c.origin.kind !== "book")), lookNames),
      ]);
      const lastOf = (ds: Array<{ value: string }>): string => ds.at(-1)?.value.trim() ?? "";
      this.tokens = [...byName].map(([name, ds]) => {
        const token = makeStyleToken(name, values[name] || lastOf(ds));
        // Place and label come from the first declaration; the group from
        // the first that has one.
        const label = ds[0]!.label;
        if (label !== undefined) token.label = label;
        const group = ds.find((d) => d.group !== undefined)?.group;
        if (group !== undefined) token.group = group;
        return token;
      });
      const fromBook = [...byName.values()].flat().filter((d) => d.fromBook);
      this.bookDeclared = new Set(fromBook.map((d) => d.name));
      this.bookWritten = new Map(fromBook.map((d) => [d.name, d.value]));
      this.lookValues = new Map(
        lookNames.map((name) => [name, lookOnly[name] || lastOf(byName.get(name)!.filter((d) => !d.fromBook))]),
      );
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
    // Capture the target path BEFORE any await: a concurrent loadDesign() — a
    // stylesheet change in Advanced — can reassign `this.cssPath` while this
    // batch is in flight, and the batch must land on the sheet its edits came
    // from, never on the newly first one.
    let cssPath = this.cssPath;
    const projectDir = this.deps.projectDir();
    if (this.tokenPending.size === 0) return true;
    // Drain the coalesced edits into one batch: the host reads, folds and writes once.
    const updates: TokenUpdate[] = [...this.tokenPending.entries()].map(
      ([name, value]) => ({ name, value }),
    );
    this.tokenPending.clear();
    try {
      cssPath ??= await this.ensureStylesheet();
      if (!cssPath || !projectDir) return true;
      await this.deps.editTokens(projectDir, cssPath, updates);
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
      // The book's own declaration goes back as written; one only a look had is taken out again.
      this.scheduleTokenWrite(t.name, this.bookDeclared.has(t.name) ? (this.bookWritten.get(t.name) ?? o) : null);
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

  /** "Reset to the look's settings" asks before it replaces anything. */
  askBrandReset = (): void => {
    this.brandResetAsked = true;
  };

  /** "Keep mine": nothing changes. */
  keepBrand = (): void => {
    this.brandResetAsked = false;
  };

  /**
   * "Replace": every brand setting a look sets goes back to the look's value,
   * and the book's declaration of it is taken out, so the look shows through.
   * Like any edit here it is undone by `revertAllTokens` (Advanced's Undo
   * changes), which puts back what the book had when Book setup opened.
   */
  resetBrand = (): void => {
    this.brandResetAsked = false;
    for (const t of this.brandTokens) {
      const fromLook = this.lookValues.get(t.name);
      if (fromLook === undefined || fromLook === t.value) continue;
      t.value = fromLook;
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
