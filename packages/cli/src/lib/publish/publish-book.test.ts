/**
 * The one publish run (ADR 0012 §5), with the build and the checks faked and
 * real targets: `local` (copies into a folder), DriveThruRPG (prepares a
 * package; no account), and itch.io (needs an account, so it is not sent
 * here). Nothing is contacted.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileTokenStore } from "../remote-auth/token-store.ts";
import { PublishSelectionsStore } from "./selections.ts";
import { publishBook, type PublishBookDeps, type PublishProgress } from "./publish-book.ts";
import type { BuildRunnerOptions } from "../build-runner.ts";
import type { ValidationExecutionArgs, ValidationExecutionResult } from "../validation-exec.ts";

let root: string;
let book: string;
let builds: BuildRunnerOptions[];
let checks: ValidationExecutionArgs[];
/** What the fake checks report, by phase: each finding may name the target whose rules raised it. */
let findings: { "pre-build": object[]; "post-build": object[] };
let buildFails: unknown;

const dist = () => path.join(book, "dist", "field-guide");

async function writeBook(publish: string): Promise<void> {
  await writeFile(path.join(book, "manifest.yaml"), `title: Field Guide\nauthors: [Ada]\npreset: book\n${publish}`);
}

function deps(over: Partial<PublishBookDeps> = {}): PublishBookDeps {
  return {
    tokenStore: new FileTokenStore(path.join(root, "creds.json")),
    selections: new PublishSelectionsStore(path.join(root, "mine.json")),
    env: {},
    getLatest: async () => {},
    runBuild: async (opts) => {
      builds.push(opts);
      if (buildFails) throw buildFails;
      await mkdir(dist(), { recursive: true });
      if (opts.format === "html") {
        await writeFile(path.join(dist(), "book.html"), "<html></html>");
        return { outDir: dist(), htmlPath: path.join(dist(), "book.html"), pdfPath: null, fingerprintPath: null, diagnostics: [] };
      }
      const pdf = path.join(dist(), `field-guide-${opts.format}.pdf`);
      await writeFile(pdf, `%PDF ${opts.format}`);
      const plain = path.join(dist(), "field-guide-pdf.pdf");
      if (opts.withPlainPdf) await writeFile(plain, "%PDF pdf");
      return {
        outDir: dist(),
        htmlPath: null,
        pdfPath: pdf,
        ...(opts.withPlainPdf ? { plainPdfPath: plain } : {}),
        fingerprintPath: null,
        diagnostics: [],
      };
    },
    executeValidation: async (args) => {
      checks.push(args);
      const phase = args.phase as "pre-build" | "post-build";
      const asked = new Set((args.target ?? "").split(","));
      const results = findings[phase].filter((f) => {
        const t = (f as { target?: string }).target;
        return !t || asked.has(t);
      });
      return {
        report: { results },
        tools: { missing: [], skippedChecks: [], toolToChecks: new Map() },
      } as unknown as ValidationExecutionResult;
    },
    ...over,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-book-"));
  book = path.join(root, "field-guide");
  await mkdir(book);
  builds = [];
  checks = [];
  findings = { "pre-build": [], "post-build": [] };
  buildFails = undefined;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PRINT_ERROR = { checkId: "pdf.print.bleed", severity: "error" as const, message: "No bleed.", target: "drivethrurpg-print" };

describe("making the files", () => {
  test("print and digital targets get a PDF/X and a PDF from one build; each target is sent its own file", async () => {
    await writeBook("publish:\n  drivethrurpg-print:\n  local:\n    dir: out\n");
    const result = await publishBook({ projectDir: book }, deps());

    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ format: "pdfx", withPlainPdf: true, skipPreValidate: true, skipPostValidate: true });
    expect(result.files).toEqual([
      { format: "pdfx", path: path.join(dist(), "field-guide-pdfx.pdf") },
      { format: "pdf", path: path.join(dist(), "field-guide-pdf.pdf") },
    ]);
    const [print, local] = result.targets;
    expect(print).toMatchObject({ id: "drivethrurpg-print", format: "pdfx", status: "prepared", file: path.join(dist(), "field-guide-pdfx.pdf") });
    expect(local).toMatchObject({ id: "local", format: "pdf", status: "sent" });
    expect(await readdir(path.join(book, "out"))).toEqual(["field-guide-pdf.pdf"]);
    expect(result.ok).toBe(true);
  });

  test("a website target gets its own build, after the PDFs", async () => {
    await writeBook("publish:\n  local:\n  azure-swa:\n    environment: prod\n");
    await publishBook({ projectDir: book, checkOnly: true }, deps());
    expect(builds.map((b) => b.format)).toEqual(["pdf", "html"]);
  });

  test("a failed build stops the run with the lib's own words, and nothing is sent", async () => {
    await writeBook("publish:\n  local:\n    dir: out\n");
    buildFails = Object.assign(new Error("Ghostscript could not finish writing the PDF/X file…\n\nraw gs output"), { code: "DISK_FULL" });
    const result = await publishBook({ projectDir: book }, deps());
    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      code: "DISK_FULL",
      message: "Ghostscript could not finish writing the PDF/X file…",
      detail: "Ghostscript could not finish writing the PDF/X file…\n\nraw gs output",
    });
    expect(result.targets[0]?.status).toBe("waiting");
    expect(existsSync(path.join(book, "out"))).toBe(false);
  });
});

describe("checks", () => {
  test("a print problem holds back the print target only", async () => {
    await writeBook("publish:\n  drivethrurpg-print:\n  local:\n    dir: out\n");
    findings["post-build"].push(PRINT_ERROR);
    const result = await publishBook({ projectDir: book }, deps());
    const [print, local] = result.targets;
    expect(print?.status).toBe("held");
    expect(print?.failure?.code).toBe("CHECKS_FAILED");
    expect(print?.findings).toEqual([PRINT_ERROR]);
    expect(local?.status).toBe("sent");
    expect(local?.findings).toEqual([]);
    expect(result.ok).toBe(false);
  });

  test("send anyway sends a held target", async () => {
    await writeBook("publish:\n  drivethrurpg-print:\n");
    findings["post-build"].push(PRINT_ERROR);
    const result = await publishBook({ projectDir: book, sendAnyway: ["drivethrurpg-print"] }, deps());
    expect(result.targets[0]?.status).toBe("prepared");
    expect(result.ok).toBe(true);
  });

  test("send anyway takes a target by its old name, or every target", async () => {
    await writeBook("publish:\n  drivethrurpg-print:\n");
    findings["post-build"].push(PRINT_ERROR);
    const byOldName = await publishBook({ projectDir: book, targets: ["drivethrurpg"], sendAnyway: ["drivethrurpg"] }, deps());
    expect(byOldName.targets[0]?.status).toBe("prepared");
    const every = await publishBook({ projectDir: book, sendAnyway: true }, deps());
    expect(every.targets[0]?.status).toBe("prepared");
  });

  test("problems in the source stop the run before the build", async () => {
    await writeBook("publish:\n  local:\n");
    findings["pre-build"].push({ checkId: "source.markdown", severity: "error", message: "Broken link.", file: "a.md", line: 3 });
    const result = await publishBook({ projectDir: book }, deps());
    expect(builds).toHaveLength(0);
    expect(result.failure?.code).toBe("SOURCE_PROBLEMS");
    expect(result.sourceFindings).toEqual([
      { checkId: "source.markdown", severity: "error", message: "Broken link.", file: "a.md", line: 3 },
    ]);
  });

  test("targets with the same rules share one check run; the book's own rules are another", async () => {
    await writeBook("publish:\n  itch:\n    target: ada/guide\n  drivethrurpg-digital:\n  local:\n");
    await publishBook({ projectDir: book, checkOnly: true }, deps());
    const fileChecks = checks.filter((c) => c.phase === "post-build").map((c) => c.target);
    expect(fileChecks).toEqual(["itch,drivethrurpg-digital", "local"]);
    expect(checks.find((c) => c.phase === "pre-build")?.target).toBe("itch,drivethrurpg-digital,local");
  });

  test("in a shared check run, a finding that names one target holds that target alone", async () => {
    await writeBook("publish:\n  itch:\n    target: ada/guide\n  drivethrurpg-digital:\n");
    const required = { checkId: "pdf.print.embedded-fonts", severity: "error", message: "Fonts not embedded.", target: "drivethrurpg-digital" };
    findings["post-build"].push(required);
    const result = await publishBook({ projectDir: book, checkOnly: true }, deps());
    expect(result.targets.map((t) => [t.id, t.status])).toEqual([
      ["itch", "not-connected"],
      ["drivethrurpg-digital", "held"],
    ]);
  });

  test("skipping checks runs none", async () => {
    await writeBook("publish:\n  drivethrurpg-print:\n");
    findings["post-build"].push(PRINT_ERROR);
    const result = await publishBook({ projectDir: book, skipChecks: true }, deps());
    expect(checks).toEqual([]);
    expect(result.targets[0]?.status).toBe("prepared");
  });
});

describe("sending", () => {
  test("check only makes and checks the files and sends nothing", async () => {
    await writeBook("publish:\n  local:\n    dir: out\n");
    const result = await publishBook({ projectDir: book, checkOnly: true }, deps());
    expect(result.targets[0]?.status).toBe("checked");
    expect(existsSync(path.join(book, "out"))).toBe(false);
    expect(result.ok).toBe(true);
  });

  test("a target with no account connected is not sent; its file is ready to upload by hand", async () => {
    await writeBook("publish:\n  itch:\n    target: ada/guide\n");
    const result = await publishBook({ projectDir: book }, deps());
    const itch = result.targets[0];
    expect(itch?.status).toBe("not-connected");
    expect(itch?.failure?.code).toBe("NOT_CONNECTED");
    expect(itch?.failure?.message).toContain(path.join(dist(), "field-guide-pdf.pdf"));
    expect(result.ok).toBe(false);
  });

  test("missing settings stop the run before the build", async () => {
    await writeBook("publish:\n  itch:\n");
    const result = await publishBook({ projectDir: book }, deps());
    expect(builds).toHaveLength(0);
    expect(result.failure?.code).toBe("SETUP_INCOMPLETE");
    expect(result.targets[0]?.failure?.code).toBe("SETUP_INCOMPLETE");
  });

  test("a target the person turned off for themselves is not part of the run", async () => {
    await writeBook("publish:\n  drivethrurpg-print:\n  local:\n");
    const d = deps();
    await d.selections!.setSettings(book, "drivethrurpg-print", { send: "off" });
    const result = await publishBook({ projectDir: book }, d);
    expect(result.targets.map((t) => t.id)).toEqual(["local"]);
    expect(builds[0]?.format).toBe("pdf");
  });

  test("the targets asked for win over the book's list", async () => {
    await writeBook("publish:\n  drivethrurpg-print:\n  local:\n");
    const result = await publishBook({ projectDir: book, targets: ["drivethrurpg"] }, deps());
    expect(result.targets.map((t) => t.id)).toEqual(["drivethrurpg-print"]);
  });

  test("settings for this run only reach both the setup check and the send, and are never saved", async () => {
    await writeBook("publish:\n  itch:\n  local:\n    dir: out\n");
    const d = deps();
    const result = await publishBook(
      { projectDir: book, runSettings: { itch: { target: "ada/guide" }, local: { dir: "elsewhere" } } },
      d,
    );
    expect(result.targets.map((t) => t.status)).toEqual(["not-connected", "sent"]);
    expect(existsSync(path.join(book, "elsewhere"))).toBe(true);
    expect(existsSync(path.join(book, "out"))).toBe(false);
    expect(await d.selections!.settings(book)).toEqual({});
  });

  test("an unknown target stops the run, naming it", async () => {
    await writeBook("publish:\n  local:\n");
    const result = await publishBook({ projectDir: book, targets: ["nowhere"] }, deps());
    expect(result.failure?.code).toBe("UNKNOWN_TARGET");
    expect(result.failure?.message).toContain("nowhere");
  });
});

describe("the run as the person sees it", () => {
  test("each step says what it is doing, in order", async () => {
    await writeBook("publish:\n  local:\n    dir: out\n");
    const seen: PublishProgress[] = [];
    await publishBook({ projectDir: book, onProgress: (p) => seen.push(p) }, deps());
    expect(seen.map((p) => p.step)).toEqual(["plan", "source", "check", "send"]);
    expect(seen.at(-1)).toEqual({ step: "send", message: "Sending to A folder on this computer…", target: "local" });
  });

  test("a book without a manifest says what to do", async () => {
    const result = await publishBook({ projectDir: book }, deps());
    expect(result.failure?.code).toBe("NO_MANIFEST");
  });

  test("a manifest that cannot be read stops the run with the reader's own words", async () => {
    await writeFile(path.join(book, "manifest.yaml"), "title: Broken\nchapters:\n\t- a.md\n");
    const result = await publishBook({ projectDir: book }, deps());
    expect(result.failure?.code).toBe("NO_MANIFEST");
    expect(result.failure?.message).toContain("Invalid YAML");
    const missing = path.join(book, "missing.yaml");
    const named = await publishBook({ projectDir: book, manifestPath: missing }, deps());
    expect(named.failure?.code).toBe("NO_MANIFEST");
    expect(named.failure?.message).toContain(`manifest not found: ${missing}`);
  });

  test("a book with no targets says how to add one", async () => {
    await writeBook("publish: {}\n");
    const result = await publishBook({ projectDir: book }, deps());
    expect(result.failure?.code).toBe("NO_TARGETS");
  });

  test("stopping the run is a cancel, not a failure to explain", async () => {
    await writeBook("publish:\n  local:\n");
    const stop = new AbortController();
    stop.abort();
    const result = await publishBook({ projectDir: book, signal: stop.signal }, deps());
    expect(result.failure).toEqual({ code: "CANCELED", message: "" });
    expect(builds).toHaveLength(0);
  });
});
