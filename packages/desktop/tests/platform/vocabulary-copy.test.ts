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

// Never shown to an Author. Two exceptions: "(GitHub calls it a repository)" where the author acts on
// github.com, and the command pasted into their own Git tool.
const BANNED = [
  /\b(commits?|branch(es)?|push(ed|ing)?|pull(ed|ing)?|merge[ds]?|remote|repositor(y|ies)|snapshots?|sync(ing|ed)?|clone[ds]?|online backups?|previous versions|reconnect(ing)?)\b/gi,
  /\bHEAD\b/g,
];
const EXCEPTIONS = [/GitHub calls it a repository/g, /<code>git remote set-url origin https:\/\/…<\/code>/g];

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
    "lib/components/ProjectActivityView.svelte",
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

describe("Book setup → Online copy", () => {
  test("the tab is Online copy, id online-copy; nothing links to the old Backup tab", () => {
    const view = read("lib/components/ProjectSettingsView.svelte");
    expect(view).toContain('{ id: "online-copy", label: "Online copy" }');
    expect(view).not.toMatch(/id: "backup"|label: "Backup"/);
    expect(read("routes/+page.svelte")).toContain('"online-copy"');
    expect(read("routes/+page.svelte")).not.toMatch(/"backup"/);
  });

  test("status, the line about this computer, revisions and the collapsed failing tools, in that order", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    const order = [tab.indexOf('class="headline"'), tab.indexOf("Save a version"), tab.indexOf("<RevisionsList"), tab.indexOf("If backing up keeps failing")];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(tab).toContain('<details class="failing">');
  });

  test("if backing up keeps failing: Test connection, Sign in again, Repair, then Start over", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    const order = ["Test connection", "Sign in again", "Repair the online copy", "Start over from the online copy"].map((t) => tab.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("Version history opens inside the tab, not in the editor pane", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    expect(tab).toContain("<ProjectActivityView");
    const page = read("routes/+page.svelte");
    expect(page).not.toMatch(/ProjectActivityView|showActivityView|editorView|paneViewRestore/);
  });

  test("each situation's action is worded as the design says", () => {
    const tab = markup("lib/components/ProjectConnectionsSection.svelte");
    for (const text of ["Turn on version history", "Keep this book safe online…", "Version history…", "Repair the online copy", "Start over from the online copy", "Test connection", "Sign in again"]) {
      expect(tab).toContain(text);
    }
  });

  test("Revisions: New revision… sits above the list", () => {
    const rev = markup("lib/components/RevisionsList.svelte");
    expect(rev.indexOf("New revision…")).toBeGreaterThan(-1);
    expect(rev.indexOf("New revision…")).toBeLessThan(rev.indexOf('<ul class="item-list"'));
  });

  test("Revisions: the four places, the actions, and the notes the design asks for", () => {
    const rev = read("lib/components/RevisionsList.svelte");
    for (const text of [
      "You're working on this",
      "Online · not backed up yet",
      "Only on this computer",
      "Only online",
      "Switch",
      "Rename…",
      "Delete…",
      "New revision…",
      "Delete on this computer only",
      "Delete everywhere",
      "from the online copy? It isn't on this computer.",
      "Find a revision",
      "No revisions match.",
      "This also renames it in the online copy. Anyone else working on",
      "Couldn't check the online copy for other revisions. This list shows the revisions on this computer.",
    ]) {
      expect(rev).toContain(text);
    }
  });
});

describe("Version history", () => {
  const view = markup("lib/components/ProjectActivityView.svelte");

  test("is called Version history, with Save a version at the top and the new badges", () => {
    expect(view).toContain("Version history</h2>");
    expect(view).toContain("Online copy</button>");
    expect(view.indexOf("Save a version")).toBeLessThan(view.indexOf("No versions yet."));
    expect(view).toContain("Only on this computer");
    expect(view).toContain("In the online copy, not yet on this computer");
    expect(view).toContain("Restore this version");
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
    expect(help).toContain("Online copy");
  });
});
