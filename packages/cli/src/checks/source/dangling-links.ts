import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding } from "../policy";
import { isPrintResolvableHref } from "../../lib/build-staging";
import { renderedLocalRefs } from "./local-ref-parser";

/**
 * A relative link — `[text](docs/x.md)`, `[next](./02.md)`, even one to an
 * image the build copies — cannot be opened from the printed book: a PDF has
 * no files beside it, and every chapter is concatenated into one document at
 * the staging root, so the browser resolved the href to the build machine's
 * temp dir and baked that into the PDF (#263). The build now drops such an
 * href before print (lib/build-staging.ts `dropRelativeLinkHrefs`); this
 * check tells the author which links that affects, at the source line, so
 * they can choose `#anchor`, an absolute URL, or plain text instead.
 *
 * `source.links.local-refs` answers a different question — does the target
 * exist on disk — and a link can pass that while still being unopenable from
 * a PDF, which is why this is its own check (and can be switched off for an
 * HTML-only book via `validate.checks`).
 */
const check: Check = {
  id: "source.links.dangling",
  name: "Dangling Links",
  description: "Flags relative links the printed book cannot open (their href is dropped at print time)",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for await (const { ref, kind, line, file } of renderedLocalRefs(ctx, check.id, results)) {
      // Images are the build's copy plan, not links. Same predicate the
      // print build drops by, so this check cannot drift from it.
      if (kind !== "link" || isPrintResolvableHref(ref)) continue;
      results.push(
        finding(check.id, {
          severity: "warning",
          code: "dangling-link",
          data: { ref },
          message:
            `Link "${ref}" cannot be opened from the printed book: a PDF has no files ` +
            `beside it and no address of its own, so a relative link (a chapter file of ` +
            `this same book included) leads nowhere. The link text stays but its href is ` +
            `dropped at print time. Link to a heading with #anchor, use an absolute URL, ` +
            `or write it as plain text.`,
          file,
          line,
        }),
      );
    }
    return results;
  },
};

registerCheck(check);
export default check;
