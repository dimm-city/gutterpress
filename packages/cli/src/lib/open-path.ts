import { spawn } from "node:child_process";

/**
 * Open a file in the user's default OS desktop. Detached + unref'd so the
 * caller can exit immediately without waiting on the desktop process.
 */
export function openPath(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];
    switch (process.platform) {
      case "darwin":
        cmd = "open";
        args = [filePath];
        break;
      case "win32":
        cmd = "cmd";
        args = ["/c", "start", "", filePath];
        break;
      default:
        cmd = "xdg-open";
        args = [filePath];
    }
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
