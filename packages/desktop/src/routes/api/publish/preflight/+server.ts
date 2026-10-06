import path from 'node:path';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import {
  shapePreflight,
  type PreflightRawResult,
  type PreflightRow,
  type PreflightSeverity,
} from '$lib/preflight';
import type { RequestHandler } from './$types';

interface PreflightBody {
  projectDir: string;
  /** The selected destinations (provider ids), for provider-scoped rules. */
  providerIds: string[];
}

/**
 * Publish preflight (#105) — the pre-build readiness pass the wizard's Preflight
 * step runs on step-enter (and on manual Re-run).
 *
 * v1 scope: run the existing SOURCE + ASSET checks via the shared check
 * registry/runner (the same `executeValidation` machinery the Problems panel's
 * `lint:project` route uses — no reimplemented checks). Both categories are
 * `phase: "pre-build"`, so NO PDF is built here. Post-build PDF checks
 * (`category: "pdf"`/"heuristic") are OUT of v1 — they run at export time; the
 * wizard says so near the results.
 *
 * Host Node code (§8): may import the lib + `node:*` and run the registry. The
 * pure result-shaping (registry result → author-facing DTO, incl. `fixable`
 * derivation from a location) lives in `$lib/preflight` and is unit-tested.
 */
export const POST: RequestHandler = defineRoute<PreflightBody>({
  validate: async (raw) => {
    const r = raw as { projectDir?: string; providerIds?: unknown };
    return {
      projectDir: await requireProjectDir(r.projectDir, 'publish:preflight'),
      providerIds: Array.isArray(r.providerIds)
        ? r.providerIds.filter((x): x is string => typeof x === 'string')
        : [],
    };
  },
  call: async ({ body }): Promise<PreflightRow[]> => {
    const projectDir = body.projectDir;
    const lib = await loadLib();
    // SOURCE + ASSET, pre-build only — mirrors the lint:project pattern but
    // widens the category to also cover image/font asset checks.
    const execution = await lib.executeValidation({
      input: projectDir,
      category: 'source,asset',
      phase: 'pre-build',
    });

    const dirPrefix = projectDir.replace(/[\\/]+$/, '') + path.sep;
    const raws: PreflightRawResult[] = execution.report.results.map((res) => {
      const abs = res.file ? path.resolve(res.file) : undefined;
      const rel =
        abs && abs.startsWith(dirPrefix)
          ? abs.slice(dirPrefix.length).split(path.sep).join('/')
          : abs
            ? path.basename(abs)
            : undefined;
      return {
        checkId: res.checkId,
        // Category isn't on CheckResult; the id namespace is the authoritative
        // prefix ("source.*" / "asset.*").
        category: res.checkId.split('.')[0] ?? 'source',
        severity: res.severity as PreflightSeverity,
        message: res.message,
        filePath: abs,
        file: rel,
        line: res.line,
        column: res.column,
      };
    });

    // Provider-awareness (#105): the shared SOURCE + ASSET checks above always
    // run. Provider-specific readiness rules would attach per selected provider
    // HERE — but the check registry currently registers NO provider-scoped
    // checks (its categories are source/pdf/asset/heuristic only). So in v1
    // `body.providerIds` selects no extra registry checks; provider-specific
    // readiness (cover/ISBN/trim size) is emitted at publish time by each
    // provider's own `preflight()` (the wizard's "Check readiness" dry-run),
    // not by this registry pass. Structured as a per-provider loop so a future
    // `provider.<id>.*` check category slots in without reshaping this route.
    for (const _providerId of body.providerIds) {
      // No provider-scoped registry checks exist yet — intentionally a no-op.
      void _providerId;
    }

    return shapePreflight(raws);
  },
});
