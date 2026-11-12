/**
 * VersionHistoryView: the screen around the comparison.
 *  - It opens on a version (the newest, or the one asked for), with its
 *    first changed text file compared; never an empty pane.
 *  - What each version changed loads as its row (or session) scrolls into
 *    view (VersionChangesController), never for a whole page (#461, #484).
 *  - Versions in the online copy and not on this computer yet are one banner
 *    row; Get them runs the page's get-latest pass.
 *  - Selecting a version reads what its row loaded; only Pages renders.
 * Pinned on the component's source, like the other screen tests; the pure
 * list logic (sessions, filters, the file a version opens to) is tested in
 * version-timeline.test.ts, and the screen itself is driven in the real app.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/lib/components/VersionHistoryView.svelte", import.meta.url), "utf8");
const script = src.slice(src.indexOf("<script"), src.indexOf("</script>"));
const markup = src.slice(src.indexOf("</script>"), src.indexOf("<style>"));
const page = readFileSync(new URL("../../src/routes/+page.svelte", import.meta.url), "utf8");
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

describe("it opens on something", () => {
  test("the version kept from before, the one asked for, or the newest", () => {
    expect(fn("loadHistory")).toContain("void select(keep ?? entries.find((e) => e.id === initialId) ?? entries[0] ?? null);");
  });

  test("a version opens to the file the author had open, else its first text file, compared in place", () => {
    expect(script).toContain("const openPath = $derived(changes ? pickFile(changes.files, wanted) : null);");
    expect(markup).toContain("<VersionCompareView {projectDir} id={selected.id} path={openPath} />");
    expect(markup).not.toContain("onBack");
  });

  test("the file chips switch the file; ←/→ do too, outside text fields and the comparison", () => {
    expect(markup).toContain("onclick={() => { wanted = change.path; view = \"changes\"; }}");
    expect(fn("onWindowKeydown")).toContain('closest("input, textarea, [contenteditable], .cm-editor")');
  });
});

describe("the list", () => {
  test("a day folds its automatic saves into editing sessions; a search lists every match", () => {
    expect(script).toContain(": editingSessions(day.entries)");
    expect(script).toContain("shown = $derived(entries.filter((e) => matchesVersion(e, filter, query, changesOf.loaded[e.id])))");
    expect(snippet("sessionRow")).toContain("{sessionTitle(row.entries.length)}");
    expect(snippet("sessionRow")).toContain("{timeSpan(row.entries)}");
  });

  test("named versions carry a star; the author is named only when it is someone else", () => {
    expect(snippet("versionRow")).toContain('{#if isNamed(entry.message)}<Icon name="star" size={13} />{/if}');
    expect(script).toContain("a && a !== author");
    expect(script).toContain("const author = $derived(usualAuthor(entries));");
  });

  test("not online yet is a labelled marker, not a bare dot", () => {
    expect(snippet("versionRow")).toContain('<Icon name="cloud-off" size={11} /> not online yet');
    expect(markup).not.toContain('class="dot');
  });

  test("a row keeps its files line while they load, so it never grows", () => {
    expect(snippet("versionRow")).toContain('<span class="f">');
    expect(src).toMatch(/\.f \{[^}]*min-height: 1\.4em/);
  });

  test("first paint is skeleton rows", () => {
    expect(markup).toContain('<div class="row skeleton" aria-hidden="true">');
  });

  test("↑/↓ and Home/End move through the rows, selecting the versions they land on", () => {
    expect(markup).toContain('<div class="vh-scroll" onkeydown={(e) => void onListKeydown(e)}>');
    expect(fn("onListKeydown")).toContain('["ArrowDown", "ArrowUp", "Home", "End"]');
    expect(fn("onListKeydown")).toContain("void select(entry)");
  });
});

describe("what each version changed", () => {
  test("a row's changes load as it scrolls into view; a session asks for each of its versions", () => {
    expect(snippet("versionRow")).toContain("<li use:inView={[entry.id]}>");
    expect(snippet("sessionRow")).toContain("use:inView={row.entries.map((e) => e.id)}");
    expect(script).toContain("new VersionChangesController((id) => api.vcs.versionChanges(projectDir, id))");
    const inView = fn("inView");
    expect(inView).toContain("new IntersectionObserver(");
    expect(inView).toContain('root: node.closest(".vh-scroll")');
    expect(script).toContain("observer?.disconnect()");
  });

  test("listing a page asks for no changes (#461)", () => {
    expect(fn("loadHistory")).toContain("await changesOf.listFirst(onlineCopy.takeVersionsPage(projectDir) ?? api.vcs.listSnapshotsPage(projectDir))");
    expect(fn("loadOlder")).toContain("await changesOf.listFirst(api.vcs.listSnapshotsPage(projectDir");
    expect(fn("loadHistory")).not.toMatch(/versionChanges|changesOf\.(load|show)/);
    expect(script.match(/api\.vcs\.versionChanges\(/g)).toHaveLength(1);
  });

  test("selecting asks for the version's changes first; it never renders: only Pages does", () => {
    expect(fn("select")).toContain("await changesOf.load(entry.id)");
    expect(fn("select")).not.toContain("openVersionPreview");
    expect(script.match(/api\.vcs\.openVersionPreview\(/g)).toHaveLength(1);
  });
});

describe("versions online and not on this computer yet", () => {
  test("one banner row over the list, with Get them running the page's get-latest pass", () => {
    expect(markup).toContain("<span>{onlineSummary(online)}</span>");
    expect(fn("getThem")).toContain("await onGetLatest();");
    expect(page).toMatch(/<VersionHistoryView[\s\S]*?onGetLatest=\{\(\) => syncController\.handleGetLatest\(\)\}[\s\S]*?\/>/);
  });

  test("opened, they are selectable rows; compared only when this computer has them, never restored", () => {
    expect(markup).toContain("{#each online as entry (entry.id)}{@render versionRow(entry)}{/each}");
    expect(markup).toContain("{:else if changes && openPath && local}");
    expect(markup).toContain("disabled={selectedOnline}");
    expect(fn("restore")).toContain("selectedOnline");
  });

  test("checked once the version list is shown, so it never holds the list up", () => {
    expect(script).toContain("void loadHistory().then(() => (hasRemote ? loadOnline() : undefined));");
    expect(fn("loadOnline")).toContain("api.vcs.onlineVersions(projectDir");
  });
});
