/**
 * Left-panel tab visibility (#lib/left-panel-tabs): the temporary hiding of
 * the Books tab, reader mode, and the fallback for a remembered hidden tab.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { HIDE_BOOKS_TAB, shownTabId, showTabStrip, visibleTabIds } from "../../src/lib/left-panel-tabs";

describe("visibleTabIds", () => {
  test("Books is hidden while the temporary flag is set", () => {
    expect(HIDE_BOOKS_TAB).toBe(true);
    expect(visibleTabIds(false)).toEqual(["toc", "files", "media"]);
  });

  test("with the flag off, every tab is back in its original order", () => {
    expect(visibleTabIds(false, false)).toEqual(["projects", "toc", "files", "media"]);
  });

  test("reader mode keeps only TOC (Books too when un-hidden)", () => {
    expect(visibleTabIds(true)).toEqual(["toc"]);
    expect(visibleTabIds(true, false)).toEqual(["projects", "toc"]);
  });
});

describe("showTabStrip", () => {
  test("reader role shows no tab strip: the lone TOC panel is shown directly", () => {
    expect(showTabStrip(visibleTabIds(true))).toBe(false);
  });

  test("author role keeps the strip", () => {
    expect(showTabStrip(visibleTabIds(false))).toBe(true);
  });

  test("LeftPanel draws the strip only when stripShown, and labels the bare TOC panel by its heading", () => {
    const src = readFileSync(new URL("../../src/lib/components/LeftPanel.svelte", import.meta.url), "utf8");
    expect(src).toMatch(/\{#if stripShown\}\s*<div class="panel-tabs"/);
    expect(src).toContain('role={stripShown ? "tabpanel" : "region"}');
    expect(src).toContain('id="panel-heading-toc"');
  });
});

describe("shownTabId", () => {
  test("an active visible tab is shown as-is", () => {
    expect(shownTabId("files", visibleTabIds(false))).toBe("files");
  });

  test("a remembered Books tab shows the first visible tab while Books is hidden", () => {
    expect(shownTabId("projects", visibleTabIds(false))).toBe("toc");
  });

  test("a remembered Files/Media tab in reader mode falls back to the first visible tab", () => {
    expect(shownTabId("media", visibleTabIds(true, false))).toBe("projects");
    expect(shownTabId("files", visibleTabIds(true))).toBe("toc");
  });

  test("un-hiding Books restores a remembered Books selection", () => {
    expect(shownTabId("projects", visibleTabIds(false, false))).toBe("projects");
  });
});

describe("status bar structure", () => {
  const src = readFileSync(new URL("../../src/lib/components/StatusBar.svelte", import.meta.url), "utf8");
  const markup = src.slice(src.indexOf('<div class="status-bar"'), src.indexOf("<style>"));
  const at = (needle: string) => {
    const i = markup.indexOf(needle);
    expect(i).toBeGreaterThan(-1);
    return i;
  };

  test("left cluster: Books (folder) button, the book switcher, the one status control, then the Update button", () => {
    const order = [
      at('<Icon name="folder"'),
      at("<BookSwitcher"),
      at('class="status-control'),
      at('class="status-icon-btn labelled"'),
      at('class="shell-actions"'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(at('class="shell-actions"')).toBeGreaterThan(at('class="status-left"'));
  });

  test("right side: only settings then help", () => {
    const order = [at('class="shell-actions"'), at('name="settings"'), at('name="circle-help"')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).not.toContain("status-right");
  });

  test("there is one status control, and no second save indicator or sync pill", () => {
    expect(markup.match(/class="status-control/g)).toHaveLength(1);
    expect(markup).not.toContain("save-indicator");
    expect(markup).not.toContain("SyncStatusPill");
  });

  /** The one Update button: the last block of the left cluster, inside the block a reader never gets. */
  const update = () => {
    const start = at("{#if line.button && canSync}");
    return markup.slice(start, markup.indexOf("</div>", start));
  };

  test("a reader gets no status control and no Update button", () => {
    expect(markup).toContain("{#if showStatus}");
    expect(src).toContain("showStatus = $derived(!!projectDir && sourceMode === \"folder\" && !readerMode)");
    expect(update()).toContain("run(line.button!.action)");
    // The old Get latest and Sync buttons are gone: one button, driven by the state.
    expect(markup).not.toContain("get-latest");
    expect(markup).not.toContain('"Sync"');
    expect(markup.match(/class="status-icon-btn labelled"/g)).toHaveLength(1);
  });

  test("the Update button is disabled while a pass runs, shows Updating…, and its tooltip says what it does", () => {
    const block = update();
    expect(block).toContain("disabled={busy}");
    expect(block).toContain('"Updating…"');
    expect(block).toContain("title={buttonTitle}");
    expect(src).toContain("const busy = $derived(forceSyncing || gettingLatest || forceSaving)");
    // Back up now lives in the status popover and Book setup, not as a second button in the bar.
    expect(markup).not.toContain("Back up now");
  });

  test("a divider leads each group after Books, rendered only with its group", () => {
    expect(markup).toMatch(
      /\{#if showBookSwitcher\}\s*<span class="divider" aria-hidden="true"><\/span>\s*<BookSwitcher[^\n]*\n\s*\{\/if\}/,
    );
    expect(markup).toMatch(/\{#if showStatus\}\s*<span class="divider" aria-hidden="true"><\/span>\s*<div class="status-wrap">\s*<button[^>]*class="status-control/);
    expect(markup.match(/class="divider"/g)).toHaveLength(2);
  });

  test("aria-live carries only the time-free line, so the minute tick is silent", () => {
    expect(markup).toContain('aria-live="polite" aria-atomic="true">{line.announce}</span>');
    expect(markup.match(/aria-live/g)).toHaveLength(1);
    expect(src).toContain("setInterval(() => (now = Date.now()), 60_000)");
  });

  test("the popover is the BookSwitcher pattern: opens upward, closes on Escape or an outside click", () => {
    const pop = readFileSync(new URL("../../src/lib/components/StatusPopover.svelte", import.meta.url), "utf8");
    expect(pop).toContain("bottom: 100%");
    expect(pop).toContain('e.key === "Escape"');
    expect(pop).toContain('addEventListener("mousedown"');
  });
});
