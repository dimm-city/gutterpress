#!/usr/bin/env bun
/**
 * content-hash.ts — Content integrity gate for field guide migration
 *
 * Captures text fingerprints from a rendered HTML file and detects prose
 * changes after migration. Syntax migration = PASS. Any word of body text
 * changing = FAIL.
 *
 * Commands:
 *   capture <html-file> [-o manifest.json]   Build a baseline manifest
 *   verify  <html-file> <manifest.json>      Compare current HTML against baseline
 *   diff    <before.json> <after.json>       Compare two saved manifests
 *
 * Usage during migration:
 *   1. bun content-hash.ts capture book.html -o baseline.json
 *   2. (migrate a batch of markdown)
 *   3. bun content-hash.ts verify book.html baseline.json   # must PASS
 *   4. git commit only on exit 0
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Section = {
  id: string;
  heading: string;
  level: number;
  text: string;
  hash: string;
};

type Manifest = {
  source: string;
  capturedAt: string;
  documentHash: string;
  totalSections: number;
  sections: Section[];
};

// ---------------------------------------------------------------------------
// HTML text extraction
// ---------------------------------------------------------------------------

function extractText(html: string): string {
  return (
    html
      // Drop entire style/script blocks
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      // Drop paged.js margin-box / folio content (headers/footers)
      .replace(/<div[^>]+class="[^"]*pagedjs_margin[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
      // Strip all remaining tags
      .replace(/<[^>]+>/g, " ")
      // Decode entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&[a-zA-Z]+;/g, " ")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

function md5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Section parsing — split on h1–h4 boundaries
// ---------------------------------------------------------------------------

function parseSections(html: string): Section[] {
  const sections: Section[] = [];

  // Split at each heading tag, keeping the delimiter
  const parts = html.split(/(?=<h[1-4][\s>])/i);
  // Deduplicate ids (same heading text appearing multiple times)
  const idCounts = new Map<string, number>();

  for (const part of parts) {
    const m = part.match(/^<(h[1-4])[^>]*>([\s\S]*?)<\/\1>([\s\S]*)/i);
    if (!m) continue;

    const [, tagName, headingHtml, contentHtml] = m;
    const level = parseInt(tagName[1], 10);
    const heading = extractText(headingHtml);
    if (!heading) continue;

    const content = extractText(contentHtml);
    const fullText = content ? `${heading}\n${content}` : heading;

    const baseId = slugify(heading);
    const count = idCounts.get(baseId) ?? 0;
    idCounts.set(baseId, count + 1);
    const id = count === 0 ? baseId : `${baseId}-${count}`;

    sections.push({
      id,
      heading,
      level,
      text: fullText,
      hash: md5(fullText),
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function captureCommand(htmlFile: string, outputFile: string): Promise<void> {
  const html = await Bun.file(htmlFile).text();
  const sections = parseSections(html);
  const fullText = extractText(html);

  const manifest: Manifest = {
    source: htmlFile,
    capturedAt: new Date().toISOString(),
    documentHash: md5(fullText),
    totalSections: sections.length,
    sections,
  };

  await Bun.write(outputFile, JSON.stringify(manifest, null, 2));
  console.log(`✓ Captured ${sections.length} sections → ${outputFile}`);
  console.log(`  Document hash: ${manifest.documentHash}`);
}

async function verifyCommand(htmlFile: string, manifestFile: string): Promise<void> {
  const html = await Bun.file(htmlFile).text();
  const baseline: Manifest = JSON.parse(await Bun.file(manifestFile).text());

  const fullText = extractText(html);
  const documentHash = md5(fullText);

  if (documentHash === baseline.documentHash) {
    console.log("✓ PASS — document hash matches, content unchanged");
    return;
  }

  // Document changed: drill down to locate which sections changed
  console.log("⚠  Document hash changed — running section diff...\n");

  const currentSections = parseSections(html);
  const baselineMap = new Map(baseline.sections.map((s) => [s.id, s]));
  const currentMap = new Map(currentSections.map((s) => [s.id, s]));

  const failures: string[] = [];
  const warnings: string[] = [];

  for (const [id, base] of baselineMap) {
    const curr = currentMap.get(id);
    if (!curr) {
      failures.push(`  ✗ MISSING  h${base.level}: "${base.heading}"`);
    } else if (curr.hash !== base.hash) {
      failures.push(`  ✗ CHANGED  h${base.level}: "${base.heading}"`);
      failures.push(`            before: ${base.hash}`);
      failures.push(`            after:  ${curr.hash}`);
    }
  }

  for (const [id, curr] of currentMap) {
    if (!baselineMap.has(id)) {
      warnings.push(`  + NEW      h${curr.level}: "${curr.heading}" (verify manually)`);
    }
  }

  if (failures.length > 0) {
    console.log("⛔ GATE FAILURE — prose content changed during migration:");
    failures.forEach((l) => console.log(l));
  }

  if (warnings.length > 0) {
    console.log("\nℹ  New sections detected (may be OK):");
    warnings.forEach((l) => console.log(l));
  }

  if (failures.length > 0) {
    console.log("\nMigration must not alter prose. Fix the above before committing.");
    process.exit(1);
  } else {
    // Only new sections, no regressions
    console.log("✓ PASS — no baseline sections changed");
  }
}

async function diffCommand(beforeFile: string, afterFile: string): Promise<void> {
  const before: Manifest = JSON.parse(await Bun.file(beforeFile).text());
  const after: Manifest = JSON.parse(await Bun.file(afterFile).text());

  if (before.documentHash === after.documentHash) {
    console.log("✓ Documents identical");
    return;
  }

  const beforeMap = new Map(before.sections.map((s) => [s.id, s]));
  const afterMap = new Map(after.sections.map((s) => [s.id, s]));

  let failCount = 0;

  for (const [id, b] of beforeMap) {
    const a = afterMap.get(id);
    if (!a) {
      console.log(`  - REMOVED  h${b.level}: "${b.heading}"`);
      failCount++;
    } else if (a.hash !== b.hash) {
      console.log(`  ~ CHANGED  h${b.level}: "${b.heading}"`);
      failCount++;
    }
  }

  for (const [id, a] of afterMap) {
    if (!beforeMap.has(id)) {
      console.log(`  + ADDED    h${a.level}: "${a.heading}"`);
    }
  }

  if (failCount > 0) {
    console.log(`\n${failCount} section(s) changed or removed.`);
    process.exit(1);
  } else {
    console.log("✓ No baseline sections changed (new sections only)");
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const [, , command, ...args] = process.argv;

switch (command) {
  case "capture": {
    const htmlFile = args[0];
    if (!htmlFile) {
      console.error("Usage: content-hash.ts capture <html-file> [-o manifest.json]");
      process.exit(1);
    }
    const oIdx = args.indexOf("-o");
    const outputFile =
      oIdx !== -1 && args[oIdx + 1]
        ? args[oIdx + 1]
        : htmlFile.replace(/\.html$/, "-manifest.json");
    await captureCommand(htmlFile, outputFile);
    break;
  }

  case "verify": {
    const [htmlFile, manifestFile] = args;
    if (!htmlFile || !manifestFile) {
      console.error("Usage: content-hash.ts verify <html-file> <manifest.json>");
      process.exit(1);
    }
    await verifyCommand(htmlFile, manifestFile);
    break;
  }

  case "diff": {
    const [beforeFile, afterFile] = args;
    if (!beforeFile || !afterFile) {
      console.error("Usage: content-hash.ts diff <before.json> <after.json>");
      process.exit(1);
    }
    await diffCommand(beforeFile, afterFile);
    break;
  }

  default:
    console.log(`content-hash.ts — Content integrity gate for field guide migration

Usage:
  bun content-hash.ts capture <html-file> [-o manifest.json]
  bun content-hash.ts verify  <html-file> <manifest.json>
  bun content-hash.ts diff    <before.json> <after.json>

Exit codes:
  0  PASS — no prose content changed
  1  FAIL — content changed, missing sections, or bad arguments`);
    process.exit(1);
}
