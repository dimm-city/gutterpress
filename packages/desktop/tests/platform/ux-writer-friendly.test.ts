/**
 * Version history timeline — every message the app records into history
 * must read as writer copy once fed through the classifier the view renders
 * with (otherwise machine messages render as bold "Version saved by you" +
 * raw text). Superseded spellings
 * stay listed forever: existing history keeps them.
 */
import { expect, test, describe } from "bun:test";
import { bannedTermsIn } from "../../../cli/src/test-helpers/vocabulary";
import {
  versionKind,
  versionLabel,
  versionDescription,
} from "../../src/lib/routes/version-timeline";

describe("Version history timeline — machine history entries read as writer copy", () => {
  // Every message the app records into history, fed THROUGH the classifier the
  // view renders with (otherwise machine messages render as bold "Version
  // saved by you" + raw text).
  // Superseded spellings stay listed forever: existing history keeps them.
  const MACHINE_MESSAGES = [
    "Automatic version",
    "First version",
    "Automatic version before backing up",
    "Automatic version before restoring",
    "Saved before switching revision",
    "Repaired the online copy",
    "Saved the edit you made while backing up",
    "Before deleting chapter-01.md",
    "Getting your changes ready to combine with the online copy's changes",
    "Combined your changes with the online copy's",
    "Kept both takes of the files that can't be combined",
    "Created project",
    "Set up as a gutterpress book",
    // Superseded spellings:
    "Automatic snapshot",
    "Initial snapshot",
    "Automatic backup of your work",
    "Snapshot before syncing", // pre-0.10.1 spelling, persists in old history
    "Saved the edit you made while syncing",
    "Automatic backup before restoring an earlier version",
    "Saved before switching copy",
    "Repaired online backup",
    "Getting your changes ready to combine with the online version",
    "Combined your changes with the online version",
    "Kept both versions of the files that can't be combined",
  ];

  test("no machine message renders as a hand-saved version", () => {
    for (const m of MACHINE_MESSAGES) {
      expect(versionKind(m)).not.toBe("manual");
      expect(versionLabel(m)).not.toBe("Version saved by you");
    }
  });

  test("machine rows show an honest label and never echo the raw message", () => {
    for (const m of MACHINE_MESSAGES) {
      expect(versionDescription(m)).toBeNull();
      expect(bannedTermsIn(versionLabel(m))).toEqual([]);
    }
  });
});
