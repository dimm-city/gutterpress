# Phase 1 — Remove the three free OS dependencies

> Status: plan (no code changed). Implements Phase 1 of
> [ADR 0002](./adr/0002-prefer-in-process-libraries-over-os-dependencies.md).
> Scope: replace `grep`, `markdownlint-cli2`, and `htmlhint` (CLI) with pure-JS
> equivalents. No fidelity loss; removes two system dependencies and makes three
> checks always-run instead of silently-skipped.

## Why these three first

- **Zero fidelity loss** — exact behavioral equivalents (grep) or the same
  engine behind the CLI (markdownlint, htmlhint).
- **Pure JS, no native, no WASM** — bundles cleanly under `bun build --compile`
  and Electron; no ADR-0001 risk.
- **Removes silent-skip** — these checks currently no-op when the tool is
  missing. After Phase 1 they always run.

## Files touched

| File | Change |
|---|---|
| `packages/lib/src/checks/pdf/transparency.ts` | grep → `node:fs` byte scan; drop `requiredTools` |
| `packages/lib/src/checks/pdf/color-spaces.ts` | grep → `node:fs` byte scan; drop `requiredTools` |
| `packages/lib/src/checks/source/markdownlint.ts` | `markdownlint-cli2` spawn → `markdownlint` lib; drop `requiredTools` |
| `packages/lib/src/checks/source/htmlhint.ts` | `htmlhint` spawn → `HTMLHint.verify()`; drop `requiredTools` |
| `packages/lib/package.json` | add `markdownlint` (dep), `htmlhint` (devDep → dep); remove `markdownlint-cli2` (devDep) |
| `packages/lib/src/lib/diagnostics.ts` | (none — grep/markdownlint/htmlhint are not in `TOOLS_TO_PROBE`) |
| `packages/lib/src/checks/tool-check.ts` | remove the `source.markdownlint` / `source.htmlhint` tool-config filter lines (no longer needed) |
| tests | add unit tests for each migrated check (see Testing) |

> Note: `grep`, `markdownlint-cli2`, and `htmlhint` do **not** appear in
> `diagnostics.ts`'s `TOOLS_TO_PROBE` (only gs/qpdf/poppler/imagemagick do), so
> the Help/About dialog needs no change for Phase 1.

---

## 1. grep → `node:fs` byte scan

Both checks scan the PDF for literal ASCII markers in uncompressed bytes. Read
the file once as `latin1` (lossless byte↔char) and use `.includes()`.

**Shared helper** — add to `packages/lib/src/lib/pdf-parse.ts` (co-located with
the other PDF-reading helpers):

```ts
import { readFile } from "node:fs/promises";

/**
 * Scan a PDF's raw bytes for literal markers. Reads the file as latin1 so each
 * byte maps 1:1 to a char (never use utf8 on binary data). Behavioral
 * equivalent of the previous `grep -ao` usage, including its one limitation:
 * markers inside FlateDecode-compressed streams are not visible to a raw scan.
 * grep had the identical blind spot, so this is a like-for-like replacement.
 */
export async function scanPdfMarkers(
  pdfPath: string,
  markers: string[]
): Promise<Record<string, boolean>> {
  const data = await readFile(pdfPath, "latin1");
  const found: Record<string, boolean> = {};
  for (const m of markers) found[m] = data.includes(m);
  return found;
}
```

**`transparency.ts`** — replace the `execCapture("grep", …)` block:

```ts
import { scanPdfMarkers } from "../../lib/pdf-parse";
// remove: import { execCapture } from "../../lib/exec";
// remove from the check object: requiredTools: ["grep"],

const hits = await scanPdfMarkers(ctx.pdfPath, ["/Transparency", "/SMask", "/BM /"])
  .catch(() => ({} as Record<string, boolean>));

const found: string[] = [];
if (hits["/Transparency"]) found.push("Transparency group");
if (hits["/SMask"]) found.push("Soft mask (SMask)");
if (hits["/BM /"]) found.push("Blend mode");
// …rest unchanged
```

**`color-spaces.ts`** — same pattern with markers
`["/DeviceRGB", "/Lab", "/Separation", "/DeviceN"]`. Note the original grep
pattern used `/Lab\b` (word boundary). A plain `.includes("/Lab")` is slightly
looser — it would also match e.g. `/Label`. **Mitigation:** match with a small
regex per marker to preserve the boundary semantics where it matters:

```ts
const data = await readFile(ctx.pdfPath, "latin1").catch(() => "");
const has = (re: RegExp) => re.test(data);
if (has(/\/DeviceRGB/)) { … }
if (has(/\/Lab\b/))      { … }   // preserves the original \b
if (has(/\/Separation/)) { … }
if (has(/\/DeviceN/))    { … }
```

Use whichever reads cleaner; the regex form is the faithful port of the grep
pattern. Keep the `.catch()` so an unreadable file degrades to "no findings"
exactly as the old `.catch(() => ({ stdout: "" }))` did.

**Drop `requiredTools: ["grep"]`** from both checks — they no longer skip.

---

## 2. markdownlint-cli2 (spawn) → `markdownlint` library

Use the core `markdownlint` lib (the engine behind the CLI). Keep the existing
config-discovery logic; the one new wrinkle is parsing YAML/JSONC config files,
which the CLI did natively. `yaml` is **already a runtime dep** of the lib, so
reuse it.

```ts
import { lint } from "markdownlint/sync";
// remove: import { execCapture } from "../../lib/exec";
```

Inside `run()`, after resolving `resolvedConfig` (keep `findConfig` as-is):

```ts
// Parse the config file we discovered (markdownlint wants a config object).
let config: Record<string, unknown> = { default: true };
if (resolvedConfig) {
  const raw = await readFile(resolvedConfig, "utf8");
  config = resolvedConfig.endsWith(".json") || resolvedConfig.endsWith(".jsonc")
    ? JSON.parse(stripJsonComments(raw))   // .jsonc → strip comments first
    : parseYaml(raw);                       // .yaml/.yml — reuse existing `yaml` dep
}

const results = lint({ files, config });

// Convert markdownlint's result shape → CheckResult[]
const out: CheckResult[] = [];
for (const [file, violations] of Object.entries(results)) {
  for (const v of violations as LintError[]) {
    out.push({
      checkId: check.id,
      severity: "warning",
      message: `${v.ruleNames.join("/")} ${v.ruleDescription}`,
      file,
      line: v.lineNumber,
      column: v.errorRange?.[0],
    });
  }
}
return out;
```

- Keep the early-return guards (`markdownlint === false`, no files, no config
  found and not explicit → skip). Behavior preserved.
- `parseMarkdownlintOutput` (the text-scraper) is **deleted** — we now get
  structured `LintError` objects, no string parsing.
- **JSONC caveat:** the current config-name list includes `.markdownlint.jsonc`
  and `.markdownlint-cli2.jsonc`. `JSON.parse` rejects comments. Either add a
  tiny comment-stripper or use `yaml.parse` (YAML is a JSON superset and
  tolerates `//`-free JSONC; safest is a 5-line strip-comments helper). Flag
  during implementation.
- **`.markdownlint-cli2.{yaml,jsonc}` shape:** cli2 config files nest rules
  under a `config:` key, whereas `.markdownlint.*` files are the rules object
  directly. If we keep supporting the cli2-named files, read `parsed.config ??
  parsed`. Decide whether to keep cli2-named files in `CONFIG_NAMES` (recommend:
  keep, with the `.config ?? parsed` unwrap).
- Drop `requiredTools: ["markdownlint-cli2"]`.

---

## 3. htmlhint (spawn) → `HTMLHint.verify()`

The package already ships a programmatic API; stop spawning.

```ts
import { HTMLHint } from "htmlhint";
import type { Hint, Ruleset } from "htmlhint/types";  // if types are exported; else inline
// remove: import { execCapture } from "../../lib/exec";
```

Inside `run()`, after resolving config (keep `findConfig`):

```ts
const html = await readFile(ctx.htmlPath, "utf8");

// ⚠️ Empty ruleset = NO rules in HTMLHint. Start from defaults, layer config on top.
let ruleset: Ruleset = HTMLHint.defaultRuleset;
if (resolvedConfig) {
  const raw = await readFile(resolvedConfig, "utf8");
  ruleset = { ...HTMLHint.defaultRuleset, ...JSON.parse(raw) }; // .htmlhintrc is JSON
}

const messages: Hint[] = HTMLHint.verify(html, ruleset);

return messages.map((m) => ({
  checkId: check.id,
  severity: m.type === "error" ? "error" : "warning",
  message: `${m.rule.id}: ${m.message}`,
  file: ctx.htmlPath!,
  line: m.line,
  column: m.col,
}));
```

- **Critical:** never call `HTMLHint.verify(html, {})` — an empty object disables
  all rules. Always spread `HTMLHint.defaultRuleset`.
- Keep the early-returns (`htmlhint === false`, no `htmlPath`, no config and not
  explicit → skip). Behavior preserved.
- `parseHtmlhintOutput` (JSON + line scraper) is **deleted**.
- Drop `requiredTools: ["htmlhint"]`.

---

## 4. package.json + tool-check cleanup

`packages/lib/package.json`:

```jsonc
"dependencies": {
  // …existing…
  "htmlhint": "^1.9.2",      // was devDependency
  "markdownlint": "^0.40.0"  // new
},
"devDependencies": {
  // remove "htmlhint"
  // remove "markdownlint-cli2"
}
```

`tool-check.ts`: remove the two now-irrelevant filter lines
(`source.markdownlint` / `source.htmlhint`) — those checks no longer declare
`requiredTools`, so they're never in the tool→checks map anyway. The
`source.stylelint` line stays (stylelint was dropped per CLAUDE.md, but verify
it's not still registered before removing). Leave the rest of `tool-check.ts`
untouched.

> **Viewer note:** moving `htmlhint` + `markdownlint` to runtime deps means they
> now ship in the Electron bundle (electron-builder packages prod deps only).
> This is intended — it's what makes the source checks run in the viewer. It
> also retires the "lazy-import a devDep, gate behind a viewer skip flag" hack
> for these two specifically (see `feedback_viewer_devdeps_dont_ship` memory).

---

## 5. Testing

Per the repo rule "integration tests must verify rendered output," and to lock
the behavioral-equivalence claim:

1. **grep checks:** craft (or reuse) a small PDF fixture containing
   `/Transparency` and `/DeviceRGB` in an uncompressed dict, and one without.
   Assert `transparency.ts` / `color-spaces.ts` produce the same findings as
   before. Confirm an unreadable path → `[]` (no throw).
2. **markdownlint:** lint a string/file with a known violation (e.g. `#Heading`
   → MD018) and assert the `CheckResult` has the right rule, line, severity.
   Test with a `.markdownlint.yaml` and a `.markdownlint.json` config to cover
   both parse paths. Test "no config + not explicit → `[]`".
3. **htmlhint:** verify HTML with a known violation (e.g. `<IMG>` →
   `tagname-lowercase`) and assert mapping. Test that **without** a config the
   default ruleset is applied (regression guard for the empty-ruleset gotcha).
4. **Delete stale tests:** any existing test that asserts these checks *skip*
   when the CLI tool is absent must be removed/updated — they always run now
   (per `feedback_delete_stale_tests_with_source`).

## 6. Verification checklist

- [ ] `cd packages/lib && bun run build` succeeds (required before CLI test —
      `lib-dist-rebuild-required` memory).
- [ ] `bun test` green in `packages/lib`.
- [ ] Run `print-md validate` on `examples/print-md-user-guide` from a shell
      where `grep`/`markdownlint-cli2`/`htmlhint` are NOT on PATH — the three
      checks must now run (previously skipped). Compare findings to a run with
      the tools present: identical.
- [ ] `bun run build` the CLI binary (`packages/cli/scripts/compile.ts`) and run
      the same `validate` — confirms the new deps bundle under `--compile`.
- [ ] Build the viewer; confirm `markdownlint`/`htmlhint` are present in the
      packaged app and the source checks run via IPC.

## 7. Rollback

Each check is independent and self-registering; revert any single file without
affecting the others. The `package.json` dep moves are the only cross-cutting
change — keep them in the same commit as the four check edits so a single
`git revert` restores the prior state cleanly.

## Out of scope (later phases)

- Poppler / qpdf / ImageMagick / Ghostscript / Chromium — Phases 2–4 in ADR 0002.
- No changes to `diagnostics.ts` `TOOLS_TO_PROBE` in Phase 1.
</content>
