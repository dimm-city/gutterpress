/**
 * VersionHistoryView (#484): 0.11.22's detail is back on the Version history
 * screen without giving up #461's speed.
 *  - Every card lists the files its version changed, loaded as the card
 *    scrolls into view (VersionChangesController), never for a whole page.
 *  - The versions in the online copy and not on this computer yet are listed
 *    at the top, each with its name, time, author and changed files, once the
 *    version list is shown.
 *  - Selecting a version reads what the cards loaded; only Pages renders.
 * Pinned on the component's source, like the other screen tests; the
 * end-to-end check is online-copy.pw.mjs.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/lib/components/VersionHistoryView.svelte", import.meta.url), "utf8");
const script = src.slice(src.indexOf("<script"), src.indexOf("</script>"));
const markup = src.slice(src.indexOf("</script>"), src.indexOf("<style>"));
/** The body of the script function `name`, up to the next top-level function. */
const fn = (name: string): string => {
  const start = script.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = script.indexOf("\n  }\n", start);
  return script.slice(start, end);
};
/** The markup of snippet `name`. */
const snippet = (name: string): string => {
  const start = markup.indexOf(`{#snippet ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("{/snippet}", start));
};

describe("each card's changed files", () => {
  test("a card shows what the controller loaded for it, and keeps a line while it loads", () => {
    const row = snippet("row");
    expect(row).toContain("{@const loaded = changesOf.loaded[entry.id]}");
    expect(row).toContain("{@render changedFiles(loaded.files, loaded.more)}");
    expect(row).toContain('<span class="ver-files pending" aria-hidden="true"></span>');
    // Inside the card's button, so the whole card still selects it.
    expect(row.indexOf("<button")).toBeLessThan(row.indexOf("{@render changedFiles"));
    expect(row.indexOf("{@render changedFiles")).toBeLessThan(row.indexOf("</button>"));
  });

  test("the files read as in 0.11.22: path · hint, then \"and N more\", or \"No changes\"", () => {
    const files = snippet("changedFiles");
    expect(files).toContain('<span class="ver-file"><span class="ver-path">{change.path}</span> · {change.hint}</span>');
    expect(files).toContain('{:else}\n      <span class="ver-file">No changes</span>');
    expect(files).toContain('{#if more}<span class="ver-file">and {more} more</span>{/if}');
  });

  test("a card's changes load as it scrolls into view, through the version-changes route", () => {
    expect(snippet("row")).toContain("<li use:cardInView={entry.id}>");
    expect(script).toContain("new VersionChangesController((id) => api.vcs.versionChanges(projectDir, id))");
    const inView = fn("cardInView");
    expect(inView).toContain("new IntersectionObserver(");
    expect(inView).toContain("changesOf.show(seenId)");
    expect(inView).toContain("changesOf.hide(seenId)");
    expect(inView).toContain('root: node.closest(".vh-list")');
    expect(script).toContain("observer?.disconnect()");
  });

  test("opening the screen and Show older versions list versions only (#461), ahead of any card", () => {
    for (const name of ["loadHistory", "loadOlder"]) {
      expect(fn(name)).toContain("await changesOf.listFirst(api.vcs.listSnapshotsPage(projectDir");
      expect(fn(name)).not.toMatch(/versionChanges|changesOf\.(load|show)/);
    }
    // The one call for a version's changes is the controller's.
    expect(script.match(/api\.vcs\.versionChanges\(/g)).toHaveLength(1);
  });
});

describe("selecting a version", () => {
  test("its Changed files are the ones its card loaded, asked for first when not loaded yet", () => {
    expect(script).toContain("const changes = $derived(selected ? (changesOf.loaded[selected.id] ?? null) : null);");
    expect(fn("select")).toContain("await changesOf.load(entry.id)");
  });

  test("it never renders the version: only Pages does", () => {
    expect(fn("select")).not.toContain("openVersionPreview");
    expect(fn("showPages")).toContain("api.vcs.openVersionPreview(");
    expect(script.match(/api\.vcs\.openVersionPreview\(/g)).toHaveLength(1);
  });
});

describe("versions online and not on this computer yet", () => {
  test("listed at the top of the versions, each with its name, time, author and changed files", () => {
    const list = markup.slice(markup.indexOf('<nav class="vh-list"'));
    expect(list.indexOf('<section class="online"')).toBeGreaterThan(-1);
    expect(list.indexOf('<section class="online"')).toBeLessThan(list.indexOf("{#each days as day"));
    const row = snippet("onlineRow");
    expect(row).toContain("{versionLabel(entry.message)}");
    expect(row).toContain('{when(entry.timestamp)}{entry.author ? ` · ${entry.author}` : ""}');
    expect(row).toContain("{@render changedFiles(entry.changes, entry.moreChanges)}");
    // Not a button: they come in with the next backup, nothing to select or restore yet.
    expect(row).toContain('<li class="online-ver">');
    expect(row).not.toContain("<button");
  });

  test("runs of automatic versions fold as they do in the list below", () => {
    const section = markup.slice(markup.indexOf('<section class="online"'), markup.indexOf("</section>"));
    expect(section).toContain("{#each collapseAutomaticRuns(online) as item (item.key)}");
    expect(section).toContain("<summary>{autoRunSummary(item.entries)}</summary>");
  });

  test("checked once the version list is shown, so it never holds the list up", () => {
    expect(script).toContain("void loadHistory().then(() => (hasRemote ? loadOnline() : undefined));");
    expect(fn("loadOnline")).toContain("api.vcs.onlineVersions(projectDir)");
  });
});
