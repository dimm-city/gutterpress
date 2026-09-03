// CSS ownership contract (#232) — an OPTIONAL per-project lint that turns the
// prose "AGENT RULE" contracts theme authors write into stylesheet headers
// (e.g. "If a THEME rule sets columns:N anywhere in this project, it belongs
// HERE and ONLY here") into a machine-checked postcss pass, instead of an
// honor system. Runs on postcss, same as printsafe.ts — no stylelint
// (CLAUDE.md §3: stylelint cannot be bundled into the `bun build --compile`
// binary).
//
// Fully opt-in: with no `.gutterpress/css-contract.yaml` (or an explicit
// `validate.source.cssOwnership` path) present, this check returns zero
// results for every project — same discovery pattern as markdownlint.ts /
// htmlhint.ts. All findings are `severity: "warning"` (never "error"): this
// is a NEW rule with no track record, and CLAUDE.md's standard for a lint
// gate is that it must earn its seat, not block legitimate work by default.
//
// Scope, deliberately smaller than the issue's sketch: the sketch's
// `prefixes.allow` / `warn-unprefixed` (a blanket "every class must carry an
// approved prefix" sweep) is NOT implemented. Core itself emits bare,
// unprefixed structural classes authors are meant to style directly
// (`.section`, `.page`, `.spread`, `.chapter` — see markers.js /
// CLAUDE.md §6), and a project's own non-branded utility classes (e.g. the
// `.lede` class used in this very user guide) are completely legitimate.
// Sweeping every class in every stylesheet against an allow-list would flag
// all of those on every run — exactly the zero-signal noise that gets a gate
// deleted. The five per-file/cross-file rule kinds below are all opt-in
// (named file by file in the contract) and precise about what they check, so
// a project that enables one gets warnings for real, specific ownership
// violations, not incidental style choices.
import { readFile } from "node:fs/promises";
import { relDisplay } from "../../lib/style-resolver.ts";
import { relative, sep } from "node:path";
import postcss from "postcss";
import { parse as parseYaml } from "yaml";
import { registerCheck } from "../registry";
import { findConfigFile } from "./config-file";
import type { Check, CheckContext, CheckResult } from "../types";

const CONFIG_NAMES = [".gutterpress/css-contract.yaml", ".gutterpress/css-contract.yml"];

/** One file's rules in the contract. Every key is optional — a file entry
 * with none of these is legal (and pointless) but never an error. */
export interface CssContractFileRules {
  /**
   * Closed allow-list for this file's TOP-LEVEL content only (direct children
   * of the stylesheet root — deliberately not recursive into `@media`/
   * `@supports`, keeping this a check on the file's own flat structure, not a
   * search through every possible nesting). A plain entry (e.g. ":root")
   * matches a top-level rule's selector, trimmed, exactly. An `@`-prefixed
   * entry (e.g. "@font-face") matches a top-level at-rule's name. Anything
   * else at the top level is a violation.
   */
  allow?: string[];
  /** Property names (case-insensitive) that must never be declared anywhere
   * in this file, independent of any ownership claim below. */
  "forbid-properties"?: string[];
  /**
   * Property names this file exclusively owns. Checked project-wide: ANY
   * OTHER css file passed to this check (whether or not that file has its
   * own contract entry) that declares one of these properties is flagged —
   * the whole point being that a collision can appear in a file nobody
   * thought to annotate.
   */
  "owns-properties"?: string[];
  /** Same mechanism as `owns-properties`, keyed by at-rule name (without the
   * leading `@`, e.g. "page" for `@page`). */
  "owns-at-rules"?: string[];
  /**
   * Regex source strings (case-insensitive). A rule is flagged when one of
   * its comma-separated selector branches matches a pattern AND nothing
   * precedes the match in that branch — i.e. the matched class/pattern is the
   * outermost compound selector, with no page/chapter/section ancestor
   * qualifying it. `.page .dc-callout` is scoped and passes; a bare
   * `.dc-callout` does not.
   */
  "forbid-unscoped-selectors"?: string[];
}

export interface CssContract {
  files?: Record<string, CssContractFileRules>;
}

interface Violation {
  message: string;
  node: postcss.Node;
}

async function loadContract(configPath: string): Promise<CssContract> {
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = parseYaml(raw);
  if (parsed && typeof parsed === "object") return parsed as CssContract;
  return {};
}


/** Split a selector list on top-level commas only — a comma inside `:is()`,
 * `:where()`, `:not()`, etc. does not start a new branch. */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function checkAllow(root: postcss.Root, allow: string[], file: string): Violation[] {
  const out: Violation[] = [];
  const selectorAllow = new Set(allow.filter((a) => !a.startsWith("@")).map((a) => a.trim()));
  const atRuleAllow = new Set(
    allow.filter((a) => a.startsWith("@")).map((a) => a.slice(1).trim().toLowerCase())
  );
  const allowList = allow.join(", ");
  root.each((node) => {
    if (node.type === "rule") {
      if (!selectorAllow.has(node.selector.trim())) {
        out.push({
          message: `"${node.selector}" is a top-level rule in ${file}, which only allows ${allowList} at the top level.`,
          node,
        });
      }
    } else if (node.type === "atrule") {
      if (!atRuleAllow.has(node.name.toLowerCase())) {
        out.push({
          message: `"@${node.name}" is a top-level at-rule in ${file}, which only allows ${allowList} at the top level.`,
          node,
        });
      }
    }
  });
  return out;
}

function checkForbidProperties(
  root: postcss.Root,
  forbidden: string[],
  file: string
): Violation[] {
  const out: Violation[] = [];
  const set = new Set(forbidden.map((p) => p.toLowerCase()));
  root.walkDecls((decl) => {
    if (set.has(decl.prop.toLowerCase())) {
      out.push({ message: `"${decl.prop}" is forbidden in ${file} by its CSS contract entry.`, node: decl });
    }
  });
  return out;
}

function checkForbidUnscoped(root: postcss.Root, patterns: string[], file: string): Violation[] {
  const out: Violation[] = [];
  const regexes = patterns.map((p) => new RegExp(p, "i"));
  root.walkRules((rule) => {
    for (const branch of splitSelectorList(rule.selector)) {
      for (const re of regexes) {
        const m = re.exec(branch);
        if (!m) continue;
        const before = branch.slice(0, m.index).trim();
        if (before === "") {
          out.push({
            message:
              `"${branch}" in ${file} matches the forbidden unscoped pattern /${re.source}/ ` +
              `with no ancestor qualifier. Add a page/chapter/section context ` +
              `(e.g. ".page ${branch}") or move this rule to the file that owns unscoped chrome for it.`,
            node: rule,
          });
          break;
        }
      }
    }
  });
  return out;
}

interface OwnershipMaps {
  properties: Map<string, string>;
  atRules: Map<string, string>;
}

function buildOwnershipMaps(contract: CssContract): OwnershipMaps {
  const properties = new Map<string, string>();
  const atRules = new Map<string, string>();
  for (const [file, rules] of Object.entries(contract.files ?? {})) {
    for (const prop of rules["owns-properties"] ?? []) properties.set(prop.toLowerCase(), file);
    for (const at of rules["owns-at-rules"] ?? []) atRules.set(at.toLowerCase().replace(/^@/, ""), file);
  }
  return { properties, atRules };
}

function checkOwnership(root: postcss.Root, file: string, maps: OwnershipMaps): Violation[] {
  const out: Violation[] = [];
  root.walkDecls((decl) => {
    const owner = maps.properties.get(decl.prop.toLowerCase());
    if (owner && owner !== file) {
      out.push({
        message: `"${decl.prop}" belongs to ${owner} (its CSS contract entry claims exclusive ownership) — found in ${file} too. Move this declaration to ${owner}.`,
        node: decl,
      });
    }
  });
  root.walkAtRules((at) => {
    const owner = maps.atRules.get(at.name.toLowerCase());
    if (owner && owner !== file) {
      out.push({
        message: `"@${at.name}" belongs to ${owner} (its CSS contract entry claims exclusive ownership) — found in ${file} too. Move this rule to ${owner}.`,
        node: at,
      });
    }
  });
  return out;
}

const check: Check = {
  id: "source.css-ownership",
  name: "CSS ownership contract",
  description:
    "Checks an optional per-project CSS ownership contract (.gutterpress/css-contract.yaml): which file may declare which properties/at-rules, and which selectors must never appear unscoped.",
  category: "source",
  phase: "pre-build",
  enabledWhen: (config) => config.validate.source.cssOwnership !== false,
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (ctx.config.validate.source.cssOwnership === false) return [];

    const files = ctx.cssFiles;
    if (!files || files.length === 0) return [];

    const explicit =
      typeof ctx.config.validate.source.cssOwnership === "string"
        ? ctx.config.validate.source.cssOwnership
        : null;
    const configPath = findConfigFile(ctx.inputDir, CONFIG_NAMES, explicit);
    // No contract found, and none explicitly requested: opt-in feature, so
    // silently report nothing — same convention as markdownlint.ts.
    if (!configPath) return [];

    let contract: CssContract;
    try {
      contract = await loadContract(configPath);
    } catch (err) {
      return [
        {
          checkId: check.id,
          severity: "error",
          message: `Failed to parse CSS ownership contract "${configPath}": ${err instanceof Error ? err.message : String(err)}`,
          file: configPath,
        },
      ];
    }

    const fileRules = contract.files ?? {};
    const ownership = buildOwnershipMaps(contract);
    const results: CheckResult[] = [];

    for (const absFile of files) {
      // Defense in depth: every production caller already drops minified CSS
      // when it builds `cssFiles` (lib/validation-exec.ts, lib/lint-runner.ts),
      // so this only bites a direct caller that passes an unfiltered list.
      if (absFile.endsWith(".min.css")) continue;
      let css: string;
      try {
        css = await readFile(absFile, "utf8");
      } catch {
        continue;
      }

      let root: postcss.Root;
      try {
        root = postcss.parse(css, { from: absFile });
      } catch {
        continue; // source.stylelint's printsafe/syntax-error already reports this
      }

      const rel = relDisplay(ctx.inputDir, absFile);
      const violations: Violation[] = [
        // Ownership is enforced project-wide: every active stylesheet is
        // checked against every declared owner, not just the files the
        // contract happens to name explicitly.
        ...checkOwnership(root, rel, ownership),
      ];

      const rules = fileRules[rel];
      if (rules) {
        if (rules.allow) violations.push(...checkAllow(root, rules.allow, rel));
        if (rules["forbid-properties"]) {
          violations.push(...checkForbidProperties(root, rules["forbid-properties"], rel));
        }
        if (rules["forbid-unscoped-selectors"]) {
          violations.push(...checkForbidUnscoped(root, rules["forbid-unscoped-selectors"], rel));
        }
      }

      for (const v of violations) {
        results.push({
          checkId: check.id,
          severity: "warning",
          message: v.message,
          file: absFile,
          line: v.node.source?.start?.line ?? 1,
          column: v.node.source?.start?.column ?? 1,
        });
      }
    }

    return results;
  },
};

registerCheck(check);
export default check;
