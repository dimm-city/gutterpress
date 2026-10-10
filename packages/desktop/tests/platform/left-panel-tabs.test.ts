/**
 * Left-panel tab visibility ($lib/left-panel-tabs): the temporary hiding of
 * the Books tab, reader mode, and the fallback for a remembered hidden tab.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { HIDE_BOOKS_TAB, shownTabId, visibleTabIds } from "../../src/lib/left-panel-tabs";

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
  const markup = src.slice(src.indexOf('<div class="status-bar"'), src.indexOf("{#if summaryOpen}"));
  const at = (needle: string) => {
    const i = markup.indexOf(needle);
    expect(i).toBeGreaterThan(-1);
    return i;
  };

  test("left cluster: Books (folder) button precedes the book switcher; help is not there", () => {
    expect(at('<Icon name="folder"')).toBeLessThan(at("<BookSwitcher"));
    expect(at("<BookSwitcher")).toBeLessThan(at('class="status-right"'));
    expect(markup.indexOf('name="circle-help"')).toBeGreaterThan(at('class="status-right"'));
  });

  test("right side: sync pill, save indicator, then settings and help last", () => {
    const order = [
      at("<SyncStatusPill"),
      at('class="save-indicator'),
      at('class="shell-actions"'),
      at('name="settings"'),
      at('name="circle-help"'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the divider only renders with the save indicator", () => {
    expect(markup).toContain("class:divided={showSave}");
  });

  test("dividers sit on both sides of the book switcher and left of the save indicator", () => {
    const divider = '<span class="divider" aria-hidden="true"></span>';
    expect(markup).toMatch(
      /\{#if showBookSwitcher\}\s*<span class="divider" aria-hidden="true"><\/span>\s*<BookSwitcher[^\n]*\n\s*<span class="divider" aria-hidden="true"><\/span>\s*\{\/if\}/,
    );
    const save = markup.indexOf("{#if showSave}");
    expect(markup.indexOf(divider, save)).toBeLessThan(at('class="save-indicator'));
  });
});
