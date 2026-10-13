/**
 * Troubleshooting → Diagnostics → "Open terminal": which program to start so a
 * terminal window opens in the book's folder. Host code; pure (platform +
 * PATH lookup in, command out) so every platform is testable on any one. The
 * route (`api/shell/open-terminal`) spawns the result with `cwd` = the book.
 *
 * - Windows: bash if one is on PATH (Git Bash, WSL's launcher), else a
 *   Command Prompt — both in a new console window via `start`.
 * - macOS: Terminal.app, running bash in the book folder.
 * - Linux: the first terminal emulator found, running bash.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export interface TerminalLaunch {
  command: string;
  args: string[];
  /** Pass `args` to cmd.exe untouched (Windows `start` needs its own quoting). */
  windowsVerbatimArguments?: boolean;
  /** What opens, for the UI: "bash", "Command Prompt", "Terminal", or the emulator's name. */
  label: string;
}

/** First `name` on PATH (with PATHEXT on Windows), or null. */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isFile: (p: string) => boolean = (p) => existsSync(p) && statSync(p).isFile(),
): string | null {
  const win = platform === 'win32';
  const sep = win ? ';' : ':';
  const join = win ? path.win32.join : path.posix.join;
  const exts = win ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const dir of (env.PATH ?? '').split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir.replace(/^"|"$/g, ''), name + ext.toLowerCase());
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Linux terminal emulators, most generic first, each told to run bash. */
const LINUX_TERMINALS: Array<{ bin: string; args: (dir: string) => string[] }> = [
  { bin: 'x-terminal-emulator', args: () => ['-e', 'bash'] },
  { bin: 'gnome-terminal', args: (dir) => [`--working-directory=${dir}`, '--', 'bash'] },
  { bin: 'konsole', args: (dir) => ['--workdir', dir, '-e', 'bash'] },
  { bin: 'xfce4-terminal', args: (dir) => [`--working-directory=${dir}`, '-x', 'bash'] },
  { bin: 'xterm', args: () => ['-e', 'bash'] },
];

export function terminalLaunch(
  platform: NodeJS.Platform,
  dir: string,
  lookup: (name: string) => string | null,
): TerminalLaunch | null {
  if (platform === 'win32') {
    const bash = lookup('bash');
    // `start "" <program>` opens a new console window in the current directory
    // (the spawn's cwd). cmd.exe's /s strips only the outer quotes.
    const program = bash ? `"${bash}" --login -i` : 'cmd.exe /k';
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `"start "" ${program}"`],
      windowsVerbatimArguments: true,
      label: bash ? 'bash' : 'Command Prompt',
    };
  }
  if (platform === 'darwin') {
    // The folder goes in as an argument, never spliced into the script.
    return {
      command: 'osascript',
      args: [
        '-e', 'on run argv',
        '-e', 'tell application "Terminal" to do script "cd " & quoted form of (item 1 of argv) & " && exec /bin/bash -l"',
        '-e', 'tell application "Terminal" to activate',
        '-e', 'end run',
        dir,
      ],
      label: 'Terminal',
    };
  }
  for (const t of LINUX_TERMINALS) {
    const bin = lookup(t.bin);
    if (bin) return { command: bin, args: t.args(dir), label: t.bin };
  }
  return null;
}
