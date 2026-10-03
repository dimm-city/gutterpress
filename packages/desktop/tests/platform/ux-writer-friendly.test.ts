/**
 * Previous-versions timeline — every message the app records into history
 * must read as writer copy once fed through the classifier the view renders
 * with (the old guard never did this, which is how machine messages shipped
 * rendering as bold "Version saved by you" + raw text). Superseded spellings
 * stay listed forever: existing history keeps them.
 */
import { expect, test, describe } from "bun:test";
import {
  versionKind,
  versionLabel,
  versionDescription,
} from "../../src/lib/routes/version-timeline";

describe("Previous versions timeline — machine history entries read as writer copy", () => {
  // Every message the app records into history, fed THROUGH the classifier the
  // view renders with (the old guard never did this, which is how machine
  // messages shipped rendering as bold "Version saved by you" + raw text).
  // Superseded spellings stay listed forever: existing history keeps them.
  const MACHINE_MESSAGES = [
    "Automatic snapshot",
    "Initial snapshot",
    "Created project",
    "Set up as a gutterpress book",
    "Automatic backup of your work",
    "Snapshot before syncing", // pre-0.10.1 spelling, persists in old history
    "Saved the edit you made while syncing",
    "Automatic backup before restoring an earlier version",
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
      expect(versionLabel(m).toLowerCase()).not.toMatch(/snapshot|commit|\bgit\b|merge|repo/);
    }
  });
});
