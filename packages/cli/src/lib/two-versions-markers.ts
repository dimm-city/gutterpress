/**
 * The exact lines a converge merge writes around a passage edited both here
 * and online (`remote-auth/converge-merge.ts`):
 *
 *     <<<<<<< your version
 *     …the passage as edited on this computer…
 *     =======
 *     …the passage as edited online…
 *     >>>>>>> online version
 *
 * Three consumers read them back and must agree byte for byte: the merge
 * that writes them, the `source.sync.merge-markers` check that reports them,
 * and the markdown rule that renders them as two labelled versions instead
 * of a setext heading (`markdown/two-versions.ts`). This file imports
 * nothing, so the node-free `/render` graph can depend on it too.
 *
 * (The desktop's editor panel keeps its own copy of the two sentinels — the
 * renderer may not value-import the lib — pinned to the merge's real output
 * by `packages/desktop/tests/editor/two-versions.test.ts`.)
 */

/** Marker labels — author language, never git jargon. */
export const YOUR_VERSION_LABEL = "your version";
export const ONLINE_VERSION_LABEL = "online version";

export const TWO_VERSIONS_OPEN = `<<<<<<< ${YOUR_VERSION_LABEL}`;
export const TWO_VERSIONS_SEPARATOR = "=======";
export const TWO_VERSIONS_CLOSE = `>>>>>>> ${ONLINE_VERSION_LABEL}`;
