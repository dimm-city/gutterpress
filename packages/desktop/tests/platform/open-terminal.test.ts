import { describe, expect, test } from "bun:test";
import { findOnPath, terminalLaunch } from "../../src/lib/server/open-terminal";

describe("findOnPath", () => {
  test("Windows: walks PATH with PATHEXT and finds bash.exe", () => {
    const files = new Set(["C:\\Program Files\\Git\\bin\\bash.exe"]);
    const env = { PATH: "C:\\Windows;C:\\Program Files\\Git\\bin", PATHEXT: ".COM;.EXE" };
    expect(findOnPath("bash", env, "win32", (p) => files.has(p))).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });
  test("POSIX: first match wins; a missing name is null", () => {
    const files = new Set(["/usr/local/bin/xterm", "/usr/bin/xterm"]);
    const env = { PATH: "/usr/local/bin:/usr/bin" };
    expect(findOnPath("xterm", env, "linux", (p) => files.has(p))).toBe("/usr/local/bin/xterm");
    expect(findOnPath("konsole", env, "linux", (p) => files.has(p))).toBeNull();
  });
});

describe("terminalLaunch", () => {
  test("Windows with bash on PATH opens bash in a new console window", () => {
    const t = terminalLaunch("win32", "C:\\Books\\x", (n) => (n === "bash" ? "C:\\Git\\bin\\bash.exe" : null))!;
    expect(t.label).toBe("bash");
    expect(t.command).toBe("cmd.exe");
    expect(t.windowsVerbatimArguments).toBe(true);
    expect(t.args.at(-1)).toBe('"start "" "C:\\Git\\bin\\bash.exe" --login -i"');
  });
  test("Windows without bash falls back to a Command Prompt", () => {
    const t = terminalLaunch("win32", "C:\\Books\\x", () => null)!;
    expect(t.label).toBe("Command Prompt");
    expect(t.args.at(-1)).toBe('"start "" cmd.exe /k"');
  });
  test("macOS runs bash in Terminal, with the folder passed as an argument", () => {
    const t = terminalLaunch("darwin", "/Users/a/My \"Book\"", () => null)!;
    expect(t.command).toBe("osascript");
    expect(t.args.at(-1)).toBe("/Users/a/My \"Book\"");
    expect(t.args.join(" ")).toContain("exec /bin/bash -l");
  });
  test("Linux uses the first terminal found and runs bash", () => {
    const t = terminalLaunch("linux", "/home/a/book", (n) => (n === "konsole" ? "/usr/bin/konsole" : null))!;
    expect(t).toEqual({ command: "/usr/bin/konsole", args: ["--workdir", "/home/a/book", "-e", "bash"], label: "konsole" });
    expect(terminalLaunch("linux", "/home/a/book", () => null)).toBeNull();
  });
});
