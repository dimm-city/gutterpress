/**
 * Spawn a child process, inherit stdio, reject on non-zero exit.
 */
export declare function run(cmd: string, args: string[], opts?: {
    cwd?: string;
}): Promise<void>;
/**
 * Spawn and capture stdout/stderr. Rejects on non-zero exit.
 */
export declare function execCapture(cmd: string, args: string[]): Promise<{
    stdout: string;
    stderr: string;
}>;
/**
 * Recursively copy a directory tree.
 */
export declare function copyDir(src: string, dst: string): Promise<void>;
