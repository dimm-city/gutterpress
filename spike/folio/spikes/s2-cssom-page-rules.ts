/**
 * S2 (§11.2) — Does CSSOM expose margin at-rules inside `CSSPageRule`, and
 * what does it drop?
 *
 * Decides whether `gcpm-extract` can lean on CSSOM in the viewer or must use
 * its text path. Fallback (text path) is already implemented, so this is a
 * "how much can we skip" probe, not a go/no-go.
 */
import { launchChromium, type Browser } from "../../../packages/cli/src/engine/shared/cdp.ts";
import { extract } from "../../../packages/cli/src/engine/shared/gcpm-extract.ts";
import { Spike } from "./harness.ts";

const CSS = `
@page { size: 6in 9in; bleed: 0.125in; marks: crop; margin: 0.75in;
        @bottom-center { content: counter(page); font-size: 9pt; } }
@page chapter:first { margin-top: 1.5in;
        @top-right { content: string(chapter-title); } }
h1 { page: chapter; string-set: chapter-title content(); break-before: page; }
a.xref::after { content: " (p. " target-counter(attr(href url), page) ")"; }
`;

export async function run(browser: Browser) {
  const s = new Spike("s2-cssom-page-rules", "CSSOM exposure of @page internals (§11.2)");
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><style id="s">${CSS}</style><h1>x</h1>`);

  const probe = await page.evaluate<any>(`(() => {
    const sheet = document.getElementById('s').sheet;
    const rules = [...sheet.cssRules];
    const pageRules = rules.filter(r => r.constructor.name === 'CSSPageRule');
    const first = pageRules[0];
    return {
      hasCSSMarginRule: typeof CSSMarginRule !== 'undefined',
      pageRuleCount: pageRules.length,
      selectorText: pageRules.map(r => r.selectorText),
      cssText: first.cssText,
      styleProps: [...first.style].map(p => p + ': ' + first.style.getPropertyValue(p)),
      childRuleCount: first.cssRules ? first.cssRules.length : -1,
      childRuleText: first.cssRules ? [...first.cssRules].map(r => r.cssText) : [],
      childRuleTypes: first.cssRules ? [...first.cssRules].map(r => r.constructor.name) : [],
      // do the GCPM declarations survive on ordinary rules?
      h1StringSet: (() => {
        const r = rules.find(r => r.selectorText === 'h1');
        return { cssText: r.cssText, stringSet: r.style.getPropertyValue('string-set') };
      })(),
      xrefContent: (() => {
        const r = rules.find(r => r.selectorText === 'a.xref::after');
        return r ? r.style.getPropertyValue('content') : null;
      })(),
    };
  })()`);

  s.data.probe = probe;
  s.check(
    "CSSPageRule exposes margin at-rules as child rules",
    probe.childRuleCount > 0,
    `cssRules.length=${probe.childRuleCount} ${JSON.stringify(probe.childRuleTypes)}`,
  );
  s.check(
    "CSSMarginRule interface exists",
    probe.hasCSSMarginRule,
    String(probe.hasCSSMarginRule),
  );
  s.check(
    "named + pseudo page selector round-trips through CSSOM",
    probe.selectorText.includes("chapter:first"),
    JSON.stringify(probe.selectorText),
  );
  s.check(
    "CSSOM DROPS bleed/marks (text path required)",
    !/bleed/.test(probe.cssText),
    `@page cssText = ${JSON.stringify(probe.cssText)}`,
  );
  s.check(
    "CSSOM DROPS string-set (text path required)",
    !probe.h1StringSet.stringSet,
    `h1 cssText = ${JSON.stringify(probe.h1StringSet.cssText)}`,
  );
  // Whether this declaration survives CSSOM is regime-dependent, and BOTH
  // regimes are covered by `generatedContentCss()` out-specifying the
  // author's selector (see cdp.ts's REQUIRED_MILESTONE doc comment):
  //
  //  - 151+ PARSES target-counter() (computing it to `none`), so the
  //    declaration is RETAINED and would outrank a bare
  //    `[data-folio-after]::after` override on source order alone — this is
  //    exactly why the override reuses the author's own selector.
  //  - <151 fails to parse target-counter() at all, so the declaration is
  //    DROPPED before it ever reaches CSSOM, and there's nothing to
  //    out-specify.
  //
  // Not a pass/fail assertion (it's a fact about Chromium's parser, not about
  // us) — recorded so a regime change is visible without failing the spike.
  s.note(
    `xrefContent = ${probe.xrefContent ? `retained: ${JSON.stringify(probe.xrefContent)}` : "dropped by the parser"} (regime-dependent; generatedContentCss() out-specifies the author's selector either way)`,
  );

  // the text path must recover everything CSSOM dropped
  const model = extract(CSS);
  s.check(
    "gcpm-extract text path recovers bleed/marks",
    model.pageRules[0].decls.bleed === "0.125in" && model.pageRules[0].decls.marks === "crop",
    JSON.stringify(model.pageRules[0].decls),
  );
  s.check(
    "gcpm-extract text path recovers string-set",
    model.stringSets.length === 1 && model.stringSets[0].name === "chapter-title",
    JSON.stringify(model.stringSets),
  );
  s.check(
    "gcpm-extract text path recovers target-counter()",
    model.xrefs.length === 1 && model.xrefs[0].fn === "target-counter",
    JSON.stringify(model.xrefs),
  );
  s.note(
    "Conclusion: CSSOM is usable for `@page` geometry + margin-box discovery, but " +
      "every GCPM construct Folio must shim is invisible to it. gcpm-extract keeps the text path as primary.",
  );

  await page.close();
  return s.finish();
}

if (import.meta.main) {
  const b = await launchChromium();
  try {
    const r = await run(b);
    process.exitCode = r.verdict === "FAIL" ? 1 : 0;
  } finally {
    await b.close();
  }
}
