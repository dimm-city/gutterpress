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

describe("Sync, Get latest and Back up now", () => {
  test("the status bar says Sync, Syncing… and the tooltip the design gives; the Online copy tab says Sync now", () => {
    const bar = markup("lib/components/StatusBar.svelte");
    for (const text of ['"Sync"', '"Syncing…"', '"Sync: get the latest changes from the online copy, then back up yours"', '"Sync — new changes are online"']) {
      expect(bar).toContain(text);
    }
    // The tab names its one button for the state: Back up now, Update, Get the changes, Try again.
    expect(markup("lib/components/ProjectConnectionsSection.svelte")).not.toMatch(/Sync now|Get latest/);
  });

  test("Get latest is back in the bar, the tab and the toast, as in 0.11.22 (#485)", () => {
    const bar = markup("lib/components/StatusBar.svelte");
    for (const text of ['"Get latest"', '"New online"', '"Getting…"', '"Get latest: bring in changes from the online copy without sending yours"']) {
      expect(bar).toContain(text);
    }
    const tab = read("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain('"Get the changes"');
    expect(tab).toContain('"Getting the changes…"');
    expect(read("lib/routes/sync-controller.svelte.ts")).toContain('{ label: "Get latest", onClick: () => void this.handleGetLatest() }');
  });

  test("Back up now is back in the Online copy tab, and Help names both (#485)", () => {
    const tab = read("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain('"Back up now"');
    expect(tab).toContain('update: "Update"');
    const help = markup("lib/components/HelpContent.svelte");
    expect(help).toContain("<em>Back up now</em>");
    expect(help).toContain("<em>Get latest</em>");
  });
});

describe("Book setup → Backup & history", () => {
  test("the tab is Backup & history, id online-copy; nothing links to the old Backup tab", () => {
    const view = read("lib/components/ProjectSettingsView.svelte");
    expect(view).toContain('{ id: "online-copy", label: "Backup & history" }');
    expect(view).not.toMatch(/id: "backup"|label: "Backup"/);
    expect(read("routes/+page.svelte")).toContain('"online-copy"');
    expect(read("routes/+page.svelte")).not.toMatch(/"backup"/);
  });

  test("status card, History, Drafts, then the drawer for when something is wrong", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    const order = [tab.indexOf('class="section-card status'), tab.indexOf('id="version-history-title"'), tab.indexOf("<RevisionsList"), tab.indexOf("Something wrong with the online copy?")];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(tab).toContain('<details class="trouble section-card" bind:open={troubleOpen}>');
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
    for (const text of ["Turn on version history", "Back up online…", "Back up now", "Get the changes", "Update", "Try again", "Save a version", "Repair…", "Start over…", "Check the connection", "Sign in again"]) {
      expect(tab).toContain(text);
    }
  });

  test("Drafts: New draft sits in the card's header, above the list", () => {
    const rev = markup("lib/components/RevisionsList.svelte");
    expect(rev.indexOf("New draft")).toBeGreaterThan(-1);
    expect(rev.indexOf("New draft")).toBeLessThan(rev.indexOf('<ul class="rev-list"'));
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

  test("a short card on Backup & history: the newest versions, Save a version and See all", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain('<h3 id="version-history-title">History</h3>');
    expect(tab.indexOf("Save a version")).toBeLessThan(tab.indexOf("See all"));
  });

  test("the screen: versions on the left, the selected one's Pages or Changed files, Go back to this version at its top", () => {
    expect(view).toContain("Version history</h1>");
    expect(view).toContain("Go back to this version");
    expect(read("lib/components/VersionHistoryView.svelte")).toContain("Went back to");
    expect(view).toContain(">Pages</button>");
    expect(view).toContain("Changed files");
    expect(view).toContain("Your current work is saved as a version first.");
    expect(view).toContain("Only on this computer");
  });

  test("versions online and not here yet are listed under their own heading, and say when they come in (#484)", () => {
    expect(view).toContain("Online, not yet on this computer</h2>");
    expect(view).toContain("They come in with <strong>Get latest</strong>, or the next time this book backs up.");
  });

  test("each card names what its version changed, in 0.11.22's words (#484)", () => {
    expect(view).toContain("No changes");
    expect(view).toContain("and {more} more");
    expect(view).toMatch(/\{change\.path\}<\/span> · \{change\.hint\}/);
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
    expect(help).toContain("Backup &amp; history");
  });
});
