/**
 * API route handlers for the preview server.
 *
 * The preview server is now headless. The toolbar, folder picker, and
 * GitHub clone live in packages/viewer (the desktop app). Only the
 * status endpoint remains here — kept so external tooling can detect
 * a running preview server.
 *
 * The folder-picker and GitHub-clone handlers (~500 lines) were removed
 * 2026-05-18 as part of the viewer extraction (spike/monorepo-electron-viewer).
 */
/**
 * Response shape for GET /api/status.
 */
export interface PreviewStatusResponse {
    hasInput: boolean;
    currentPath: string;
}
/**
 * Handle GET /api/status — report whether the server has an active input
 * directory.
 */
export declare function handleStatus(currentInputPath: string): Response;
