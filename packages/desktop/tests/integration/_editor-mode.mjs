import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Seed `app-settings.json` for an integration run, pinning the editing mode.
 *
 * The app defaults to RICH editing (`AppSettings.editor.mode`), so a fresh
 * userData dir gets the ProseMirror surface — which lives in an iframe and has
 * no `.cm-editor` / `.cm-content` in the top document at all. Every suite that
 * drives the source editor by those selectors therefore has to say so, or it
 * silently drives the wrong editor and fails on a selector rather than on the
 * behaviour it is actually testing.
 *
 * This is not a workaround for the default. These suites exercise the SOURCE
 * surface specifically, and source mode is first-class, not a fallback.
 * Pinning makes each test's subject explicit rather than inherited from a
 * global default that can change again.
 *
 * ## Why it takes `extra`
 *
 * It is the ONE writer of this file. An earlier version was a bare pin, and
 * two suites that also seed their own settings simply overwrote it — the pin
 * became silently inert, which is the same class of failure it exists to
 * prevent. Passing the rest of the settings through here makes that
 * impossible: there is one write, so there is nothing to clobber.
 *
 * Call it BEFORE `electron.launch()`; the app reads this file out of userData
 * at startup and deep-merges it over the defaults, so only the keys a test
 * cares about need to be present.
 */
export function pinEditorMode(userDataDir, mode = "source", extra = {}) {
  mkdirSync(userDataDir, { recursive: true });
  const settings = {
    ...extra,
    editor: { ...(extra.editor ?? {}), mode },
  };
  writeFileSync(
    join(userDataDir, "app-settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf-8",
  );
  return userDataDir;
}
