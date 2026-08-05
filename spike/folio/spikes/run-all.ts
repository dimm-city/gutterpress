/**
 * Run every spike against one Chromium and emit a machine-readable summary
 * plus a markdown table (out/results.json, out/results.md).
 *
 *   bun spikes/run-all.ts            # all
 *   bun spikes/run-all.ts s1 s5      # a subset, by id prefix
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureBundles } from "../src/bundles.ts";
import { launchChromium } from "../src/shared/cdp.ts";
import { banner, OUT_DIR, type SpikeResult } from "./harness.ts";

const SPIKES: Array<{ id: string; load: () => Promise<{ run: Function }> }> = [
  { id: "s0", load: () => import("./s0-native-baseline.ts") },
  { id: "s1", load: () => import("./s1-break-parity.ts") },
  { id: "s2", load: () => import("./s2-cssom-page-rules.ts") },
  { id: "s3", load: () => import("./s3-counter-style-map.ts") },
  { id: "s4", load: () => import("./s4-anchor-page-map.ts") },
  { id: "s5", load: () => import("./s5-thead-repetition.ts") },
  { id: "s6", load: () => import("./s6-named-pseudo.ts") },
  { id: "s7", load: () => import("./s7-instrumentation.ts") },
  { id: "s8", load: () => import("./s8-compiler.ts") },
  { id: "s9", load: () => import("./s9-dx-performance.ts") },
  { id: "s10", load: () => import("./s10-recto-breaks.ts") },
  { id: "s11", load: () => import("./s11-gcpm-complete.ts") },
  { id: "s12", load: () => import("./s12-pdfx-handoff.ts") },
];

const filter = process.argv.slice(2);
const selected = filter.length
  ? SPIKES.filter((s) => filter.some((f) => s.id === (f.startsWith("s") ? f : `s${f}`)))
  : SPIKES;

const built = await ensureBundles();
if (built.length) console.log(`built ${built.join(", ")}`);

const browser = await launchChromium();
const results: SpikeResult[] = [];
const started = Date.now();

try {
  for (const spike of selected) {
    const mod = await spike.load();
    banner(`${spike.id.toUpperCase()}`);
    try {
      results.push(await mod.run(browser));
    } catch (err) {
      results.push({
        id: spike.id,
        title: "(threw)",
        verdict: "FAIL",
        checks: [{ name: "spike completed", pass: false, detail: String(err) }],
        notes: [],
      });
      console.error(err);
    }
  }
} finally {
  await browser.close();
}

const rows = results.map((r) => {
  const pass = r.checks.filter((c) => c.pass).length;
  return `| ${r.id} | ${r.title} | ${r.verdict} | ${pass}/${r.checks.length} |`;
});
const md = [
  `# Folio spike — results`,
  ``,
  `Chromium: ${browser.version} · ${new Date(started).toISOString()} · ${(
    (Date.now() - started) /
    1000
  ).toFixed(0)}s`,
  ``,
  `| spike | what it proves | verdict | checks |`,
  `| --- | --- | --- | --- |`,
  ...rows,
  ``,
  ...results.flatMap((r) => [
    `## ${r.id} — ${r.title} (${r.verdict})`,
    ``,
    ...r.checks.map((c) => `- ${c.pass ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
    ...(r.notes.length ? ["", ...r.notes.map((n) => `> ${n}`)] : []),
    ``,
  ]),
].join("\n");

writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
writeFileSync(join(OUT_DIR, "results.md"), md);

const failed = results.filter((r) => r.verdict === "FAIL");
banner(
  `${results.length - failed.length}/${results.length} spikes passed in ${(
    (Date.now() - started) /
    1000
  ).toFixed(0)}s — out/results.md`,
);
for (const f of failed) console.log(`  FAILED: ${f.id} — ${f.title}`);
process.exitCode = failed.length ? 1 : 0;
