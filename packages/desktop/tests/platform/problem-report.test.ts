import { describe, expect, test } from "bun:test";
import {
  formatProblemReport,
  ISSUE_URL,
  redactHome,
  summarizeManifest,
  tailLog,
  type ProblemReportInput,
} from "../../src/lib/server/problem-report";

const base: ProblemReportInput = {
  desktopVersion: "0.11.10",
  libVersion: "0.11.10",
  electronVersion: "37.0.0",
  chromeVersion: "138.0.0.0",
  platform: { os: "linux", arch: "x64", release: "6.1", node: "22.0.0" },
  configDir: "/home/ada/.config/gutterpress",
  tools: [
    { name: "Ghostscript", found: true, version: "10.0", path: "/usr/bin/gs" },
    { name: "qpdf", found: false },
  ],
  book: null,
  appLog: "2026-10-03T00:00:00.000Z updater: check failed for /home/ada/Books/x",
  homeDir: "/home/ada",
};

describe("summarizeManifest", () => {
  test("describes the setup, never the content", () => {
    const lines = summarizeManifest(
      {
        preset: "book",
        targets: ["dtrpg"],
        styles: ["styles/book.css"],
        extensions: ["dc-components", { use: "./plugins/local.js" }],
        source: { files: null },
        page: { width: 6, height: 9 },
        lint: { enabled: false },
        // title/authors are not part of ManifestLike and must not leak even if present
        ...({ title: "Secret Book", authors: ["Ada"] } as object),
      },
      12,
    );
    const text = lines.join("\n");
    expect(text).toContain("preset: book");
    expect(text).toContain("extensions: dc-components, ./plugins/local.js");
    expect(text).toContain("all chapter files (12 .md in book folder)");
    expect(text).toContain("page: 6 × 9");
    expect(text).toContain("lint: disabled");
    expect(text).not.toContain("Secret Book");
    expect(text).not.toContain("Ada");
  });
});

describe("tailLog", () => {
  test("keeps whole lines from the end", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i} ${"x".repeat(100)}`).join("\n");
    const tail = tailLog(text, 1000);
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(1000);
    expect(tail.startsWith("line ")).toBe(true);
    expect(tail.endsWith("x")).toBe(true);
  });
  test("returns short logs unchanged", () => {
    expect(tailLog("a\nb\n", 100)).toBe("a\nb");
  });
});

describe("redactHome", () => {
  test("replaces both separator spellings of a Windows home", () => {
    const out = redactHome("C:\\Users\\ada\\x and C:/Users/ada/y", "C:\\Users\\ada");
    expect(out).toBe("~\\x and ~/y");
  });
});

describe("formatProblemReport", () => {
  test("report carries system, book and log sections with the home dir redacted", () => {
    const { report } = formatProblemReport(base);
    expect(report).toContain("Gutterpress desktop 0.11.10, lib 0.11.10");
    expect(report).toContain("config directory: ~/.config/gutterpress");
    expect(report).toContain("qpdf: NOT FOUND");
    expect(report).toContain("- (no book open)");
    expect(report).toContain("check failed for ~/Books/x");
    expect(report).not.toContain("/home/ada");
  });

  test("issue URL targets the bug template with system + book prefilled, log left to paste", () => {
    const { issueUrl } = formatProblemReport({ ...base, book: ["preset: book"] });
    const url = new URL(issueUrl);
    expect(`${url.origin}${url.pathname}`).toBe(ISSUE_URL);
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    const diagnostics = url.searchParams.get("diagnostics")!;
    expect(diagnostics).toContain("## System");
    expect(diagnostics).toContain("- preset: book");
    expect(diagnostics).not.toContain("## App log");
    expect(diagnostics).not.toContain("/home/ada");
    // Browsers and GitHub both reject very long URLs; the log is what grows, and it stays out.
    expect(issueUrl.length).toBeLessThan(4000);
  });

  test("unavailable and empty logs are stated, not blank", () => {
    expect(formatProblemReport({ ...base, appLog: null }).report).toContain("(app log unavailable)");
    expect(formatProblemReport({ ...base, appLog: "" }).report).toContain("(empty)");
  });
});
