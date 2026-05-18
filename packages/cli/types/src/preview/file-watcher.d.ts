/**
 * File watcher setup and management for preview server
 *
 * Handles watching input files and triggering rebuilds on changes.
 * Uses the simplified markdown pipeline (renderChapters from lib/markdown).
 */
import { type FSWatcher } from 'chokidar';
import type { ServerState } from './server-context';
/**
 * Generate HTML from markdown and write book.html to the temp directory.
 * renderChapters() does all the work (CSS, Paged.js script). We only inject
 * the toolbar interface script. The viewer's iframe loads `book.html` via
 * a relative URL — same name in dev and in published static-site builds.
 *
 * Empty `inputPath` writes a static placeholder — the viewer app (packages/viewer)
 * supplies a real path via its own folder picker.
 */
export declare function generateAndWriteHtml(inputPath: string, tempDir: string, config: {
    title?: string;
    styles?: string[];
    source?: {
        files?: string[] | null;
    };
    plugins?: any[];
}): Promise<void>;
/**
 * Create and configure a file watcher for the input directory.
 *
 * Watches the project's input path AND any manifest-declared asset roots
 * that live outside it (e.g. a sibling `../_shared` directory). Without the
 * external roots, edits to shared CSS like `_shared/css/core/05-components.css`
 * are never mirrored into the temp dir and the preview server never broadcasts
 * a reload.
 */
export declare function createFileWatcher(state: ServerState): FSWatcher;
/**
 * Start file watching if not disabled via options. No-input mode skips the
 * watcher entirely (nothing to watch yet) — restartPreview wires up a
 * watcher once the user picks a directory through the viewer.
 */
export declare function startFileWatcher(state: ServerState): void;
/**
 * Stop the file watcher and clean up resources
 */
export declare function stopFileWatcher(state: ServerState): Promise<void>;
