#!/usr/bin/env bun
/**
 * Render-parity gate CLI (issue #252) — a thin argv/IO wrapper over the pure
 * logic in ../src/lib/render-parity.ts, following native-parity-gate.ts's
 * convention for a bun script that imports straight from ../src (no build
 * step, no published subcommand — see BRIEF-REVISIONS.md item 3: the book
 * repo runs this from a gutterpress checkout, `bun packages/cli/scripts/
 * render-parity.ts ...`, not `npx gutterpress parity`).
 *
 * Usage:
 *   bun scripts/render-parity.ts extract <book.pdf> --out <report.json>
 *   bun scripts/render-parity.ts compare <baseline.json|.pdf> <candidate.json|.pdf>
 *                                [--tolerance 0.5] [--waive waivers.json] [--out diff.json]
 *
 * Exit codes: 0 clean (or fully waived), 1 unwaived diff, 2 usage/IO error.
 */
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  extractReport,
  serializeReport,
  compareReports,
  formatDiffs,
  WaiverValidationError,
  type Report,
  type Waiver,
} from "../src/lib/render-parity.ts";

const USAGE = `Usage:
  bun scripts/render-parity.ts extract <book.pdf> --out <report.json>
  bun scripts/render-parity.ts compare <baseline.json|.pdf> <candidate.json|.pdf> [--tolerance 0.5] [--waive waivers.json] [--out diff.json]

Exit codes: 0 clean (or fully waived), 1 unwaived diff, 2 usage/IO error.`;

function usageError(message: string): never {
  console.error(message);
  console.error();
  console.error(USAGE);
  process.exit(2);
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        usageError(`Missing value for --${key}`);
      }
      flags[key] = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** Minimal shape check — enough to fail with a clear message instead of a
 *  cryptic crash deep in compareReports if handed a foreign/corrupt JSON file. */
function assertReportShape(value: unknown, sourcePath: string): asserts value is Report {
  const r = value as Partial<Report> | null;
  if (
    !r ||
    typeof r !== "object" ||
    typeof r.pageCount !== "number" ||
    !Array.isArray(r.pages)
  ) {
    throw new Error(`${sourcePath} does not look like a render-parity report (missing pageCount/pages).`);
  }
}

async function loadReport(pathArg: string): Promise<Report> {
  const resolved = resolve(pathArg);
  if (extname(resolved).toLowerCase() === ".pdf") {
    return extractReport(resolved);
  }
  const raw = await readFile(resolved, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Cannot parse ${pathArg} as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assertReportShape(parsed, pathArg);
  return parsed;
}

async function runExtract(args: string[]): Promise<void> {
  const { positional, flags } = parseArgs(args);
  const [pdfPath] = positional;
  if (!pdfPath) usageError("extract requires a <book.pdf> path.");
  if (!flags.out) usageError("extract requires --out <report.json>.");

  let report: Report;
  try {
    report = await extractReport(resolve(pdfPath));
  } catch (err) {
    console.error(`Failed to extract ${pdfPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  await writeFile(resolve(flags.out), serializeReport(report), "utf8");
  console.log(`Wrote ${flags.out} (${report.pageCount} page(s))`);

  // Exit explicitly, exactly as runCompare already does below. Returning
  // normally hangs the process on a large book: on a 131MB/247-page field
  // guide the work finishes in ~10s and then the process never exits, and
  // has to be SIGKILLed. It is not the document cache and not the document
  // proxy — measured, with `process.getActiveResourcesInfo()` reporting an
  // EMPTY handle list at the moment main returns, and with neither
  // `clearPdfCache()` nor `await doc.destroy()` making any difference. The
  // runtime is holding a PDF.js worker it does not surface, so no
  // library-level teardown can release it; only exiting does. `compare`
  // never showed the bug precisely because it already exits here.
  process.exit(0);
}

async function runCompare(args: string[]): Promise<void> {
  const { positional, flags } = parseArgs(args);
  const [basePath, candPath] = positional;
  if (!basePath || !candPath) {
    usageError("compare requires <baseline> and <candidate> paths.");
  }

  let tolerance = 0.5;
  if (flags.tolerance !== undefined) {
    tolerance = Number(flags.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      usageError(`--tolerance must be a non-negative number, got "${flags.tolerance}".`);
    }
  }

  let waivers: Waiver[] = [];
  if (flags.waive) {
    let raw: string;
    try {
      raw = await readFile(resolve(flags.waive), "utf8");
    } catch (err) {
      console.error(`Cannot read waivers file ${flags.waive}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`Cannot parse waivers file ${flags.waive} as JSON: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
    if (!Array.isArray(parsed)) {
      console.error(`Waivers file ${flags.waive} must contain a JSON array.`);
      process.exit(2);
    }
    waivers = parsed as Waiver[];
  }

  let base: Report;
  let cand: Report;
  try {
    [base, cand] = await Promise.all([loadReport(basePath), loadReport(candPath)]);
  } catch (err) {
    console.error(`Failed to load reports: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  let result;
  try {
    result = compareReports(base, cand, { tolerance, waivers });
  } catch (err) {
    if (err instanceof WaiverValidationError) {
      console.error(`Invalid waiver: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const lines = formatDiffs(result, {
    basePageCount: base.pageCount,
    candPageCount: cand.pageCount,
    tolerance,
  });
  for (const line of lines) console.log(line);

  if (flags.out) {
    await writeFile(resolve(flags.out), JSON.stringify(result, null, 2) + "\n", "utf8");
  }

  process.exit(result.diffs.length > 0 ? 1 : 0);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "extract") {
    await runExtract(rest);
    return;
  }
  if (command === "compare") {
    await runCompare(rest);
    return;
  }
  usageError(command ? `Unknown command: ${command}` : "Missing command.");
}

await main();
