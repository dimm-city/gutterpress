/**
 * Open a file in the user's default OS viewer. Detached + unref'd so the
 * caller can exit immediately without waiting on the viewer process.
 */
export declare function openPath(filePath: string): Promise<void>;
