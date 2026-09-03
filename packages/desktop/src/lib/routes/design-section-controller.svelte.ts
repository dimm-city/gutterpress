/**
 * DesignSectionController — the single owner of the guided Design section's
 * state + logic that used to live inline in `ProjectConfigPanel.svelte` (the
 * `:root` custom-property editor "ported verbatim from the retired DesignPanel").
 *
 * Centralises the active-stylesheet resolution (`cssPath` / `cssName`), the
 * parsed editable `tokens`, the load/error flags, the `designSaveStatus` badge,
 * and — the load-bearing part — the debounced, serialized, race-free token
 * writer: edits coalesce into `tokenPending` (keyed by name, last value wins)
 * behind ONE debounce timer; a flush reads the CSS once, folds ALL pending
 * mutations via `applyTokenUpdates`, and writes once, so two edits in the same
 * tick can't clobber each other. `commitChain` serializes overlapping flushes
 * so an unmount flush can't race the debounce timer onto a stale base string.
 *
 * Single-owner discipline mirrors `PageNavController`
 * (`routes/page-nav-controller.svelte.ts`): the component reads the public rune
 * getters and calls the intent methods; the callbacks passed down to
 * `DesignSection.svelte` are arrow fields so `this` survives prop passing.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the reactive `projectDir` accessor, the `listStyles` /
 * `readFile` / `writeFile` host calls, the `onError` (toast) + `onEditRawCss`
 * hooks, and the debounce timer primitives. Only type-only lib-shaped imports
 * (`ProjectStyle` / `StyleToken` from the local contract) plus the pure
 * `$lib/style-tokens` string helpers — ZERO `node:*` / lib value imports.
 *
 * `tokens` (from `parseStyleTokens`) already excludes `@internal`-annotated
 * declarations and carries each token's optional `@group` annotation (issue
 * #244) — see that function's doc in `$lib/style-tokens` for the comment
 * grammar. `customGroups` and the four kind-based getters below are what turn
 * that flat, annotated list into the sections `DesignSection.svelte` renders;
 * no host route or platform-adapter capability is needed for any of it since
 * the annotation comments live in the same CSS text `readFile` already fetches
 * and `parseStyleTokens` already parses, entirely client-side.
 */

import type { ProjectStyle, StyleToken } from "$lib/platform/dtos";
import {
  parseStyleTokens,
  applyTokenUpdates,
  type TokenUpdate,
} from "$lib/style-tokens";

export interface DesignSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** Resolve the project's editable stylesheets (the active set + fallbacks). */
  listStyles: (projectDir: string) => Promise<ProjectStyle[]>;
  /** Read a file as UTF-8 text. Path is absolute. */
  readFile: (path: string) => Promise<string>;
  /** Write UTF-8 content to a file. Path is absolute. */
  writeFile: (path: string, content: string) => Promise<unknown>;
  /** Surface a save failure (the panel wires this to a toast). */
  onError?: (message: string) => void;
  /** Escape hatch: open the active stylesheet in the raw-CSS editor. */
  onEditRawCss?: (cssPath: string) => void;
  /** Debounce window for coalesced token writes (ms). Default 250. */
  debounceMs?: number;
  /** Injected timer primitives (default real setTimeout/clearTimeout) for tests. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class DesignSectionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** Absolute path of the stylesheet whose tokens are being edited. */
  cssPath = $state<string | null>(null);
  /** Display name of that stylesheet. */
  cssName = $state("");
  /** The editable `:root` custom properties in source order. */
  tokens = $state<StyleToken[]>([]);
  /** True while the design section's initial load is in flight. */
  designLoading = $state(false);
  /** Last load/parse error, or null. */
  designError = $state<string | null>(null);
  /** The debounced-save badge state. */
  designSaveStatus = $state<"idle" | "saving" | "saved">("idle");

  // ── Non-reactive internals ──────────────────────────────────────────────────
  private readonly originals = new Map<string, string>();
  private readonly tokenPending = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private commitChain: Promise<void> = Promise.resolve();

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
  // (`parseStyleTokens` in `$lib/style-tokens`) is claimed by `customGroups`
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

  // ── Load ────────────────────────────────────────────────────────────────────
  async loadDesign(): Promise<void> {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    this.designLoading = true;
    this.designError = null;
    this.tokens = [];
    try {
      const list = await this.deps.listStyles(projectDir);
      const active = list.find((x) => x.active) ?? list[0];
      if (!active) {
        this.cssPath = null;
        this.cssName = "";
        return;
      }
      this.cssPath = active.path;
      this.cssName = active.displayName;
      const css = await this.deps.readFile(active.path);
      this.tokens = parseStyleTokens(css);
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
  private scheduleTokenWrite(name: string, value: string): void {
    this.tokenPending.set(name, value);
    this.designSaveStatus = "saving";
    if (this.flushTimer) this.clearTimer(this.flushTimer);
    this.flushTimer = this.setTimer(() => {
      this.flushTimer = null;
      void this.flushPendingTokenWrites();
    }, this.debounceMs);
  }

  /** Flush any pending token edits now (also used on unmount). */
  flushPendingTokenWrites(): Promise<void> {
    if (this.flushTimer) {
      this.clearTimer(this.flushTimer);
      this.flushTimer = null;
    }
    // Chain after any in-flight commit so each read-once/write-once pass sees
    // the previous write's result instead of a stale snapshot.
    this.commitChain = this.commitChain.then(() => this.commitPendingTokens());
    return this.commitChain;
  }

  private async commitPendingTokens(): Promise<void> {
    // Capture the target path BEFORE any await (finding #10): a concurrent
    // loadDesign() — a stylesheet/theme switch — can reassign `this.cssPath`
    // while we're parked on the read below. Reading `this.cssPath` again after
    // the await for the write would fold the OLD sheet's tokens into the NEWLY
    // selected file, corrupting it. Bind one local `cssPath` and read AND write
    // it, so a batch always lands on the exact sheet its edits came from.
    const cssPath = this.cssPath;
    if (!cssPath || this.tokenPending.size === 0) return;
    // Drain the coalesced edits into one batch, then read → fold → write once.
    const updates: TokenUpdate[] = [...this.tokenPending.entries()].map(
      ([name, value]) => ({ name, value }),
    );
    this.tokenPending.clear();
    try {
      const css = await this.deps.readFile(cssPath);
      await this.deps.writeFile(cssPath, applyTokenUpdates(css, updates));
      // Only advance the badge if the active sheet is still the one we wrote;
      // if a switch happened mid-flight, the badge belongs to the new sheet
      // (loadDesign already reset it to "idle") — don't clobber it with "saved".
      if (this.cssPath === cssPath && this.tokenPending.size === 0)
        this.designSaveStatus = "saved";
    } catch (e) {
      // Re-queue the failed batch (unless a newer edit already superseded it) so
      // a later flush can retry, and surface the error — but only while we're
      // still on the same sheet, so a failed OLD-sheet write can't leak its
      // edits into the pending queue of a sheet the user just switched to.
      if (this.cssPath === cssPath) {
        for (const u of updates) if (!this.tokenPending.has(u.name)) this.tokenPending.set(u.name, u.value);
        this.designSaveStatus = "idle";
      }
      this.deps.onError?.(`Couldn't save changes: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Intents (arrow fields: passed as callback props to DesignSection) ───────
  setToken = (t: StyleToken, value: string): void => {
    t.value = value;
    this.tokens = this.tokens; // nudge reactivity (mutated element)
    this.scheduleTokenWrite(t.name, value);
  };

  resetToken = (t: StyleToken): void => {
    const o = this.originals.get(t.name);
    if (o !== undefined && o !== t.value) this.setToken(t, o);
  };

  revertAllTokens = (): void => {
    for (const t of this.tokens) this.resetToken(t);
  };

  setLength = (t: StyleToken, num: string): void => {
    const n = num.trim();
    if (n === "") return;
    this.setToken(t, `${n}${t.unit ?? ""}`);
  };

  editRawCss = (): void => {
    if (this.cssPath) this.deps.onEditRawCss?.(this.cssPath);
  };
}
