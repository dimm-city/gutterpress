/**
 * Returns the path to a system Chrome/Chromium binary, or undefined if none found.
 * Prefer requireChromiumExecutable() for build paths that cannot continue without it.
 */
export declare function resolveChromiumExecutable(): string | undefined;
/**
 * Like resolveChromiumExecutable() but throws with actionable install instructions
 * when no Chrome/Chromium is found on the system.
 */
export declare function requireChromiumExecutable(): string;
