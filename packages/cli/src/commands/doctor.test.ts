import { afterEach, expect, spyOn, test } from "bun:test";
import { runCommand } from "citty";
import * as diagnosticsModule from "../lib/diagnostics.ts";
import doctorCommand from "./doctor.ts";

let diagnosticsSpy: ReturnType<typeof spyOn> | undefined;
let consoleLogSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  diagnosticsSpy?.mockRestore();
  consoleLogSpy?.mockRestore();
  diagnosticsSpy = undefined;
  consoleLogSpy = undefined;
});

test("doctor prints system details, tool status, install guidance, and the setup guide", async () => {
  diagnosticsSpy = spyOn(
    diagnosticsModule,
    "getSystemDiagnostics"
  ).mockResolvedValue({
    libVersion: "1.2.3",
    platform: { os: "linux", arch: "x64", release: "6.1", node: "22.0.0" },
    tools: [
      {
        id: "chromium",
        name: "Chromium-based browser",
        bin: "chromium",
        found: true,
        path: "/usr/bin/chromium",
        version: "123",
        usedBy: [{ feature: "Save PDF", severity: "required" }],
        installHint: "install chromium",
      },
      {
        id: "qpdf",
        name: "qpdf",
        bin: "qpdf",
        found: false,
        usedBy: [{ feature: "PDF/X validation", severity: "optional" }],
        installHint: "apt install qpdf\nor use your package manager",
      },
    ],
    configDir: "/home/test/.config/print-md",
    docsUrl: "https://example.test/setup",
  });

  const lines: string[] = [];
  consoleLogSpy = spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });

  await runCommand(doctorCommand, { rawArgs: [] });

  expect(lines[0]).toBe("print-md 1.2.3");
  expect(lines.join("\n")).toContain("System: linux x64 (6.1), Node 22.0.0");
  expect(lines.join("\n")).toContain("Config: /home/test/.config/print-md");
  expect(lines.join("\n")).toContain("[ok] Chromium-based browser");
  expect(lines.join("\n")).toContain("Path: /usr/bin/chromium");
  expect(lines.join("\n")).toContain("[missing] qpdf");
  expect(lines.join("\n")).toContain("apt install qpdf");
  expect(lines.join("\n")).toContain("Setup guide: https://example.test/setup");
});
