/**
 * The words an Author reads on the screens #448 reshaped (docs/ux-design-contract.md,
 * Vocabulary): one idea per word, and the Git words stay out. The pure copy is
 * pinned beside its module (save-status, backup-state, version-timeline,
 * sync-controller); this pins the prose that lives in the templates.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../src/${rel}`, import.meta.url), "utf8");

/** A component's markup: no script, style or comments, so what is left is what is drawn (and the expressions that draw it). */
function markup(rel: string): string {
  return read(rel)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

// Never shown to an Author. Three exceptions: "(GitHub calls it a repository)" where the author acts on
// github.com, the command pasted into their own Git tool, and the Sync button's own words (the contract's
// **Sync** row): its labels and tooltips, and prose naming the button.
const BANNED = [
  /\b(commits?|branch(es)?|push(ed|ing)?|pull(ed|ing)?|merge[ds]?|remote|repositor(y|ies)|snapshots?|sync(ing|ed)?|clone[ds]?|online backups?|previous versions|reconnect(ing)?)\b/gi,
  /\bHEAD\b/g,
];
const EXCEPTIONS = [
  /GitHub calls it a repository/g,
  /<code>git remote set-url origin https:\/\/…<\/code>/g,
  // The Sync button: "Sync" / "Sync now" / "Syncing…", the tooltips, and prose naming it (<em>/<strong>Sync</strong>).
  /"Sync now"/g,
  /"Syncing…"/g,
  /"Sync"/g,
  /"Sync — new changes are online: get them, then back up yours"/g,
  /"Sync: get the latest changes from the online copy, then back up yours"/g,
  /"Sync — new changes are online"/g,
  /<(em|strong)>Sync<\/\1>/g,
];

/** The banned words a component draws. */
function gitWords(rel: string): string[] {
  const text = EXCEPTIONS.reduce((t, rx) => t.replace(rx, ""), markup(rel));
  return BANNED.flatMap((rx) => [...text.matchAll(rx)].map((m) => m[0]));
}

describe("the screens that were reshaped use the product's words", () => {
  for (const file of [
    "lib/components/HelpContent.svelte",
    "lib/components/ProjectConnectionsSection.svelte",
    "lib/components/RevisionsList.svelte",
    "lib/components/VersionHistoryView.svelte",
    "lib/components/StatusBar.svelte",
    "lib/components/SettingsView.svelte",
    "lib/components/CrashRecoveryDialog.svelte",
    "lib/components/TwoVersionsPanel.svelte",
    "lib/components/LogsPanel.svelte",
  ]) {
    test(`${file} draws no Git word`, () => {
      expect(gitWords(file)).toEqual([]);
    });
  }
});

describe("Update, Get the changes and Back up now", () => {
  test("the status bar has one Update button (it replaced Get latest and Sync), with tooltips that say what it does", () => {
    const bar = read("lib/components/StatusBar.svelte");
    for (const text of ['"Updating…"', '"Get the changes from the online copy. Your own changes stay as they are."', '"Send your changes to the online copy."', '"Get the latest changes from the online copy, then send yours."']) {
      expect(bar).toContain(text);
    }
    expect(bar).not.toContain('"Sync"');
    expect(bar).not.toContain('"Get latest"');
    expect(bar).not.toContain("New online");
    // The tab's full pass is Back up now, with sending automatically on or off: no Sync there.
    expect(markup("lib/components/ProjectConnectionsSection.svelte")).not.toMatch(/Sync now/);
  });

  test("the tab's Get latest is the one button when only the online copy has news, and quiet beside Back up now otherwise", () => {
    const tab = read("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain('"get-changes": "Get latest"');
    expect(tab).toContain('"Getting the latest…"');
    expect(tab).toContain('<button class="quiet" onclick={() => void getLatest()}');
    expect(read("lib/routes/sync-controller.svelte.ts")).toContain('{ label: "Get changes", onClick: () => void this.handleGetLatest() }');
  });

  test("Back up now is the Online tab's full pass, and Help describes it and the one Update button", () => {
    const tab = read("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain('"back-up": "Back up now"');
    expect(tab).toContain('update: "Back up now"');
    expect(tab).not.toContain('"Send now"');
    const help = markup("lib/components/HelpContent.svelte");
    expect(help).toContain("<em>Back up now</em>");
    expect(help).toContain("<em>Get latest</em>");
    expect(help).toContain("<em>Get changes</em>");
    expect(help).toContain("<em>Update</em>");
  });
});

describe("Book setup → Online", () => {
  test("the tab is Online, id online-copy; nothing links to the old Backup tab", () => {
    const view = read("lib/components/ProjectSettingsView.svelte");
    expect(view).toContain('{ id: "online-copy", label: "Online" }');
    expect(view).not.toMatch(/id: "backup"|label: "Backup"/);
    expect(read("routes/+page.svelte")).toContain('"online-copy"');
    expect(read("routes/+page.svelte")).not.toMatch(/"backup"/);
  });

  test("status card, Waiting, Saved versions, Drafts, then the drawer for when something is wrong", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    const order = [tab.indexOf('class="section-card status'), tab.indexOf("<WaitingChanges"), tab.indexOf('id="version-history-title"'), tab.indexOf("<RevisionsList"), tab.indexOf("Something wrong with the online copy?")];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(tab).toContain('<details class="trouble section-card span" bind:open={troubleOpen}>');
    // The Drafts banner (an unfinished switch, saved copies after a repair) is put first on the tab.
    expect(read("lib/components/ProjectConnectionsSection.svelte")).toContain(".online-copy > :global(.drafts-banner) { order: -1; }");
  });

  test("the drawer: Check the connection, Sign in again, Repair, then (under More…) Start over", () => {
    const all = markup("lib/components/ProjectConnectionsSection.svelte");
    const tab = all.slice(all.indexOf("Something wrong with the online copy?"));
    const order = ["Check the connection", "Sign in again", "Repair…", "More…", "Start over…"].map((t) => tab.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("Version history is a screen of its own, opened from the tab, never in the editor pane", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain("See all");
    expect(tab).not.toContain("<ProjectActivityView");
    const page = read("routes/+page.svelte");
    expect(page).toContain("<VersionHistoryView");
    expect(page).not.toMatch(/ProjectActivityView|showActivityView|editorView|paneViewRestore|versionPreview|lookAtVersion/);
  });

  test("each situation's action is worded as the design says", () => {
    // The button labels live in the script (LABELS), the drawer's in the markup.
    const tab = read("lib/components/ProjectConnectionsSection.svelte");
    for (const text of ["Turn on version history", "Put this book online…", "Back up now", "Get latest", "Try again", "Save a version…", "See all versions", "Send changes automatically", "Repair…", "Start over…", "Check the connection", "Sign in again"]) {
      expect(tab).toContain(text);
    }
  });

  test("Drafts: New draft sits in the card's header, above the list", () => {
    const rev = markup("lib/components/RevisionsList.svelte");
    expect(rev.indexOf("New draft")).toBeGreaterThan(-1);
    expect(rev.indexOf("New draft")).toBeLessThan(rev.indexOf('<ul class="rev-list" aria-label="Drafts"'));
  });

  test("Drafts: the four places, the actions, and the notes the design asks for", () => {
    const rev = read("lib/components/RevisionsList.svelte");
    for (const text of [
      "You are here",
      "Not backed up yet",
      "Only on this computer",
      "Online only, not on this computer yet",
      "Checking the online copy…",
      "Switch",
      "Rename…",
      "Delete…",
      "New draft",
      "Delete on this computer only",
      "Delete everywhere",
      "It is deleted from the online copy. It isn't on this computer.",
      "It is renamed in the online copy. It isn't on this computer.",
      "Find a draft",
      "No drafts match.",
      "This also renames it in the online copy. Anyone else working on",
      "Couldn't check the online copy just now, so drafts made elsewhere may be missing.",
      "Saved copies after a repair",
    ]) {
      expect(rev).toContain(text);
    }
  });

  test("Drafts: Rename… for every draft, Delete… for all but the open one", () => {
    const rev = markup("lib/components/RevisionsList.svelte");
    const start = rev.indexOf('role="menu"');
    const menu = rev.slice(start, rev.indexOf("</div>", start));
    // Rename… is unconditional; only Delete… sits behind "not the open one".
    expect(menu.indexOf("Rename…")).toBeGreaterThan(-1);
    expect(menu.indexOf("Rename…")).toBeLessThan(menu.indexOf("{#if !r.current}"));
    expect(menu.indexOf("{#if !r.current}")).toBeLessThan(menu.indexOf("Delete…"));
  });
});

describe("Version history", () => {
  const view = markup("lib/components/VersionHistoryView.svelte");

  test("a short card on Online: Save a version… first, today's automatic versions, the named ones, See all versions", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain('<h3 id="version-history-title">Saved versions</h3>');
    expect(tab.indexOf("Save a version…")).toBeLessThan(tab.indexOf("Today · "));
    expect(tab.indexOf("Today · ")).toBeLessThan(tab.indexOf("See all versions"));
    expect(tab).not.toContain("Go back to one of these");
  });

  test("the screen: versions on the left, the selected one's Changes or Pages, a restore that says it is the whole book", () => {
    expect(view).toContain("Version history</h1>");
    expect(view).toContain("Restore the whole book to this version…");
    expect(read("lib/components/VersionHistoryView.svelte")).toContain("Restored the whole book to");
    expect(view).toContain(">Changes</button>");
    expect(view).toContain(">Pages</button>");
    expect(view).toContain("Your current work is saved as a version first.");
    expect(view).toContain("Only on this computer");
    expect(view).not.toContain("Go back to this version");
  });

  test("versions online and not here yet: one banner, and Get them", () => {
    expect(view).toContain(">{getting ? \"Getting…\" : \"Get them\"}</button>");
    expect(view).toContain('aria-label="Online, not yet on this computer"');
  });

  test("the search says what it looks through", () => {
    expect(view).toContain('placeholder="Find a version or a file — e.g. ch07"');
    expect(view).toContain("Older versions match once they are listed.");
  });
});

describe("Settings and Help", () => {
  test("Settings: Keep version history, and backing up is for books with an online copy", () => {
    const settings = read("lib/components/SettingsView.svelte");
    expect(settings).toContain('"Keep version history"');
    expect(settings).toContain("For books with an online copy.");
    expect(settings).toContain("Turn on Keep version history first.");
  });

  test("Help describes the combine-and-mark model, not a list of files to choose from", () => {
    const help = markup("lib/components/HelpContent.svelte");
    expect(help).not.toMatch(/lists each file|Where your work is kept|Edits saved/i);
    expect(help).toContain("marks the overlapping passage as two takes");
    expect(help).toContain("online copy");
    expect(help).toContain("Online");
  });
});
