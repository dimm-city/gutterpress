/**
 * README <-> `--help` drift test (UX finding M18).
 *
 * packages/cli/README.md's "## Commands" section documents each subcommand's
 * usage line and flags in a fenced ```sh block right after a
 * "### `gutterpress <name>`" heading. This test parses that section and the
 * *real* `gutterpress <name> --help` output (built from source, no stale dist)
 * and fails if they've drifted apart:
 *
 *   - a command citty registers is missing from the README entirely (the
 *     "new/publish/audit/preflight" omission M18 reported)
 *   - the README documents a flag that doesn't exist (the "lint --files"
 *     fiction M18 reported)
 *   - `--help` has a real flag the README never mentions (the repair
 *     "--force" and preview one-shot flags M18 reported as omitted)
 *   - the README's usage line implies a positional argument the command
 *     doesn't actually declare, or vice versa (the "validate [input-dir]"
 *     fiction M18 reported — validate silently ignores it and validates cwd)
 *
 * The list of registered commands is read straight out of cli.ts's
 * SUBCOMMANDS map (not hand-duplicated here), so a future command addition
 * that forgets the README fails this test immediately.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPublishProviders } from "./lib/publish/registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(__dirname, "cli.ts");
const CLI_SOURCE_PATH = CLI_ENTRY;
const README_PATH = path.join(__dirname, "..", "README.md");

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function runHelp(cmd: string): string {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", CLI_ENTRY, cmd, "--help"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return stripAnsi(`${result.stdout.toString()}\n${result.stderr.toString()}`);
}

/** The single source of truth for "what commands exist" — parsed from cli.ts's SUBCOMMANDS map. */
function getRegisteredCommands(): string[] {
  const src = fs.readFileSync(CLI_SOURCE_PATH, "utf8");
  const block = src.match(/const SUBCOMMANDS = \{([\s\S]*?)\}\s*as const;/);
  const blockBody = block?.[1];
  if (!blockBody) {
    throw new Error("readme-drift.test.ts: could not find `const SUBCOMMANDS = {...} as const;` in cli.ts — update the parser.");
  }
  const names: string[] = [];
  const re = /^\s*(\w[\w-]*):\s*\(\)\s*=>\s*import/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockBody)) !== null) {
    const commandName = m[1];
    if (commandName) names.push(commandName);
  }
  if (names.length === 0) {
    throw new Error("readme-drift.test.ts: parsed zero commands out of cli.ts's SUBCOMMANDS block — update the parser.");
  }
  return names;
}

interface ReadmeCommandSection {
  usageLine: string;
  flags: string[];
  hasPositional: boolean;
}

/** Parse README.md's "### `gutterpress <name>`" sections into flags + positional-presence. */
function parseReadmeCommands(readme: string): Map<string, ReadmeCommandSection> {
  const sections = new Map<string, ReadmeCommandSection>();
  const headingRe = /^### `gutterpress ([\w-]+)`\s*$/gm;
  const headings: Array<{ name: string; index: number }> = [];
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(readme)) !== null) {
    const cmdName = hm[1];
    if (cmdName) headings.push({ name: cmdName, index: hm.index });
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (!heading) continue;
    const { name, index: start } = heading;
    const nextHeading = headings[i + 1];
    const end = nextHeading ? nextHeading.index : readme.length;
    const body = readme.slice(start, end);

    const fenceRe = /```sh\n([\s\S]*?)```/g;
    let usageLine: string | null = null;
    let flagBlockText = "";
    let fm: RegExpExecArray | null;
    while ((fm = fenceRe.exec(body)) !== null) {
      const block = fm[1] ?? "";
      const firstLine = (block.split("\n")[0] ?? "").trim();
      if (firstLine.startsWith(`gutterpress ${name}`)) {
        usageLine = firstLine;
        flagBlockText = block;
        break;
      }
    }
    if (usageLine === null) continue;

    const flags = Array.from(
      new Set(Array.from(flagBlockText.matchAll(/--[a-zA-Z][a-zA-Z0-9-]*/g)).map((m2) => m2[0])),
    );

    // A positional is documented when the token right after "gutterpress <name>"
    // is a bracket/angle group other than the literal "[options]" (e.g.
    // "[input-dir]", "<name>", "[dir]").
    const afterCmd = usageLine.slice(`gutterpress ${name}`.length).trim();
    const firstToken = afterCmd.split(/\s+/)[0] ?? "";
    const hasPositional =
      /^[[<]/.test(firstToken) && firstToken.replace(/[[\]<>]/g, "") !== "options";

    sections.set(name, { usageLine, flags, hasPositional });
  }
  return sections;
}

/** citty synthesizes a `--no-x` negation for defaulted-true booleans, and some
 *  commands declare their own literal `--no-x` flag (e.g. preview's
 *  `--no-watch`). Either way, comparing README <-> --help flag *sets* only
 *  needs a stable bucketing — not a "real" boolean-pair resolution — so
 *  bucket `--no-x` and `--x` together on both sides of the comparison. */
function canonicalFlag(flag: string): string {
  const bare = flag.replace(/^--/, "");
  return bare.startsWith("no-") ? bare.slice(3) : bare;
}

function parseHelpFlags(helpText: string): Set<string> {
  const matches = helpText.matchAll(/--[a-zA-Z][a-zA-Z0-9-]*/g);
  return new Set(Array.from(matches).map((m) => canonicalFlag(m[0])));
}

function helpHasPositional(helpText: string): boolean {
  return /\bARGUMENTS\b/.test(helpText);
}

/**
 * Parse the `--provider <id>     itch | drivethrurpg | kdp | ...` line out
 * of README.md's `### \`gutterpress publish\`` section into its individual
 * provider id tokens (B3 — the gdrive-publish review found this table was
 * NOT actually pinned by the per-command flag/positional checks above:
 * those compare flag NAMES and positional presence, never a flag's
 * documented VALUES, so a future provider could be added to the registry
 * without ever touching this line and nothing here would catch it).
 */
function parseReadmeProviderIds(readme: string): string[] {
  const m = readme.match(/--provider <id>\s+([^\n]+)/);
  if (!m?.[1]) {
    throw new Error(
      "readme-drift.test.ts: could not find the `--provider <id>` list in README.md's " +
        "`gutterpress publish` section — update parseReadmeProviderIds if the format changed.",
    );
  }
  return m[1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

const readmeSource = fs.readFileSync(README_PATH, "utf8");
const registeredCommands = getRegisteredCommands();
const readmeCommands = parseReadmeCommands(readmeSource);

describe("packages/cli/README.md command reference matches `--help` (M18)", () => {
  test("every citty-registered subcommand has a README `### gutterpress <name>` section", () => {
    const missing = registeredCommands.filter((c) => !readmeCommands.has(c));
    expect(missing).toEqual([]);
  });

  test("README documents no stale/removed subcommands", () => {
    const stale = Array.from(readmeCommands.keys()).filter(
      (c) => !registeredCommands.includes(c),
    );
    expect(stale).toEqual([]);
  });

  for (const cmd of registeredCommands) {
    test(`gutterpress ${cmd} --help matches its README section`, () => {
      const section = readmeCommands.get(cmd);
      expect(section).toBeDefined();
      if (!section) return;

      const helpText = runHelp(cmd);
      const helpFlagsCanonical = parseHelpFlags(helpText);
      const readmeFlagsCanonical = new Set(section.flags.map(canonicalFlag));

      // Every flag the README documents must really exist on the command.
      const bogusFlags = section.flags.filter(
        (f) => !helpFlagsCanonical.has(canonicalFlag(f)),
      );
      expect({ cmd, bogusFlags }).toEqual({ cmd, bogusFlags: [] });

      // Every real flag must be documented in the README — nothing silently
      // omitted (the repair --force / preview one-shot flags this finding
      // reported missing).
      const undocumentedFlags = Array.from(helpFlagsCanonical).filter(
        (f) => !readmeFlagsCanonical.has(f),
      );
      expect({ cmd, undocumentedFlags }).toEqual({ cmd, undocumentedFlags: [] });

      // The README's usage line must not claim a positional the command
      // doesn't declare (validate/preflight/audit) nor omit one it does
      // declare (build/preview/lint/publish/repair/new).
      expect({ cmd, hasPositional: section.hasPositional }).toEqual({
        cmd,
        hasPositional: helpHasPositional(helpText),
      });
    });
  }
});

describe("packages/cli/README.md `publish` provider table matches listPublishProviders() (B3)", () => {
  test("every registered publish provider id is documented in the README's --provider list", () => {
    const registeredIds = listPublishProviders()
      .map((p) => p.id)
      .sort();
    const readmeIds = parseReadmeProviderIds(readmeSource);
    const missing = registeredIds.filter((id) => !readmeIds.includes(id));
    expect(missing).toEqual([]);
  });

  test("README's --provider list names no stale/unknown provider id", () => {
    const registeredIds = new Set<string>(listPublishProviders().map((p) => p.id));
    const readmeIds = parseReadmeProviderIds(readmeSource);
    const stale = readmeIds.filter((id) => !registeredIds.has(id));
    expect(stale).toEqual([]);
  });
});
