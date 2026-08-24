#!/usr/bin/env node
/**
 * Fills the Chromium Issue Tracker's new-issue wizard for our three upstream
 * reports (#149, #150, #152), then STOPS and hands you the browser.
 *
 * It does not submit anything. The wizard's last step is a reCAPTCHA, and the
 * Submit click is a public, permanent, attributed action — both are yours.
 * The script does the tedious part: the right role, the right category, and
 * three long bodies typed into the right fields without transcription errors.
 *
 *   node tools/file-upstream-chromium-bugs.mjs            # all three, in turn
 *   node tools/file-upstream-chromium-bugs.mjs 149         # just one
 *   node tools/file-upstream-chromium-bugs.mjs 150 152     # a subset
 *
 * A Chrome window opens with a persistent profile at
 * ~/.cache/gutterpress-crbug-profile, so you sign in to Google ONCE and the
 * session carries across all three filings and future runs.
 *
 * For each report the script:
 *   1. opens https://issues.chromium.org/issues/new
 *   2. selects role "Web Developer" and category "Content"
 *   3. ticks the "I have searched for existing issues" acknowledgement
 *   4. clicks Next
 *   5. fills Chrome version, summary, repro steps, description, comments
 *   6. waits for YOU to solve the reCAPTCHA and click Submit
 *
 * Then it detects the created issue URL, prints it, and moves to the next one.
 *
 * NOTE ON COMPONENT: the wizard does not let a non-committer choose the
 * component — every report lands wherever the category routes it, and triage
 * moves it. Each description therefore asks for `Blink > Layout > Printing`
 * explicitly. (The reporter of crbug 438364050 hit the same wall and said so
 * in their filing.)
 *
 * Verified against the live wizard on 2026-08-24. If Google reshuffles the
 * form, the selectors in STEP1/STEP2 below are the only things to fix.
 */
import { chromium } from "../packages/desktop/node_modules/playwright-core/index.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE = join(homedir(), ".cache", "gutterpress-crbug-profile");
const WIZARD = "https://issues.chromium.org/issues/new";
const CHROME_VERSION = "151.0.7922.75";

const STEP1 = {
  role: "#mat-radio-1-input", // "Web Developer — I am trying to build something on a website."
  category: '[aria-label="Choose issue category"]',
  categoryOption: "Content", // "Problems with webpages not working correctly"
  ack: "#mat-mdc-checkbox-0-input", // "I have searched for existing issues…"
};
const STEP2 = {
  version: '[aria-label="Chrome version"]',
  summary: 'textarea[name="summary"]',
  repro: 'textarea[name="reproSteps"]',
  description: 'textarea[name="description"]',
  comments: '[aria-label="Additional comments"]',
};

const COMPONENT_ASK =
  "Please route to Blink > Layout > Printing — the wizard offers no way to " +
  "set it from this form.";

const REPORTS = {
  149: {
    ours: "https://github.com/dimm-city/gutterpress/issues/149",
    summary:
      "A gradient in @page { background } paints nothing in print; a solid colour in the same place paints the full sheet",
    repro: `1. Save this as page.html:

<!doctype html>
<html><head><style>
@page {
  size: 5in 3in;
  margin: 0.5in;
  background: linear-gradient(180deg, #2d6cdf, #1e8a4c);
}
</style></head><body><p>content</p></body></html>

2. Print it to PDF:

google-chrome --headless=new --disable-gpu --no-sandbox \\
  --virtual-time-budget=12000 --no-pdf-header-footer \\
  --print-to-pdf=out.pdf file://$PWD/page.html

3. Rasterise:  pdftoppm -r 150 -png -f 1 -l 1 out.pdf ras

4. Repeat with the "background:" line deleted, and compare the two rasters.

They are byte-identical: the gradient painted nothing. Replace the gradient
with "background: #2d6cdf" and the whole sheet is filled.`,
    description: `A gradient value in @page { background } is discarded in the print path. A
solid colour in exactly the same position paints the whole sheet.

Measured by differential rendering on Chrome ${CHROME_VERSION} — each variant
compared pixel-for-pixel against the same page with no @page background. Mean
absolute pixel difference; 0.000 means the declaration changed nothing:

  #2d6cdf (solid)                            152.866   paints the full sheet
  linear-gradient(180deg,#2d6cdf,#1e8a4c)      0.000   paints NOTHING
  radial-gradient(circle,#2d6cdf,#1e8a4c)      0.000   paints NOTHING
  repeating-linear-gradient(45deg,…)           0.000   paints NOTHING

Controls from the same run, which show gradients are not broken in print
generally — only as the @page box's own background:

  html { background: linear-gradient(…) }     82.880   renders
  gradient as a @bottom-right margin-box bg    6.150   renders

EXPECTED: a gradient in @page { background } should paint the sheet exactly as
a solid colour does. CSS Paged Media does not carve out an exception for
gradient values.

The solid-colour row is the important one: same property, same position, same
page, and only the gradient value is dropped — so this is an inconsistency
inside Chromium's own implementation rather than "@page backgrounds are
unsupported".

${COMPONENT_ASK}`,
    comments: `Reproduced on Chromium 148 and 151; the measurements above are from
${CHROME_VERSION}. Print path: --print-to-pdf and page.pdf() via
puppeteer-core, both affected.

Tracked on our side at https://github.com/dimm-city/gutterpress/issues/149,
which carries the full fixture set.`,
  },

  150: {
    ours: "https://github.com/dimm-city/gutterpress/issues/150",
    summary:
      "@page margin boxes silently drop every stacking-context and outside-the-box property (box-shadow, transform, opacity, outline, filter, mix-blend-mode)",
    repro: `1. Save this as sticker.html:

<!doctype html>
<html><head><style>
@page {
  size: 6in 4in;
  margin: 0.5in;
  @bottom-right {
    content: "STICKER";
    background: #ffd700;
    border: 3px solid #c00;      /* paints */
    padding: 4px 10px;
    font: bold 10pt sans-serif;
    box-shadow: 6px 6px 0 #c00;  /* discarded, no error */
    transform: rotate(-8deg);    /* discarded, no error */
  }
}
</style></head><body><p>content</p></body></html>

2. Print to PDF and rasterise (same two commands as any print repro).

3. Delete the box-shadow and transform lines and repeat.

The two rasters are byte-identical. The border renders at the declared weight
and colour, so the box itself is being styled — these two properties are
dropped specifically.`,
    description: `A page margin box (@top-center, @bottom-right, …) silently discards every
property that would establish a stacking context or paint outside its border
box. Every other property on the same box is honoured, so this is not "margin
boxes ignore styling".

Differential rendering on Chrome ${CHROME_VERSION}: each property added to an
otherwise identical margin box, page compared pixel-for-pixel. 0.0000 means
the declaration changed nothing.

DROPPED:
  box-shadow: 6px 6px 0 #c00      0.0000
  transform: rotate(-8deg)        0.0000
  transform: scale(1.6)           0.0000
  transform: translateX(-40px)    0.0000
  opacity: 0.35                   0.0000
  outline: 4px solid #0a0         0.0000
  filter: blur(2px)               0.0000
  mix-blend-mode: multiply        0.0000

HONOURED on the same box:
  background: linear-gradient     6.1497
  background: radial-gradient     6.2054
  border: 8px solid               3.3342
  font-size: 18pt                 0.7651
  writing-mode: vertical-rl       0.3648
  border-radius: 12px             0.3152
  letter-spacing: 4px             0.3056
  padding: 14px 30px              0.2950
  text-transform: lowercase       0.2416
  text-shadow: 4px 4px 0 #c00     0.1164
  color: #00f                     0.0319

CONTROLS proving the harness detects change in that region: removing the
margin box entirely gives 7.8710; changing only the border colour gives 1.2678.

THE PATTERN: everything dropped either establishes a stacking context
(transform, opacity, filter, mix-blend-mode) or paints outside the border box
(box-shadow, outline). Everything confined to the box interior paints
normally. text-shadow (0.1164) beside box-shadow (0.0000) is the sharpest
pair — two shadows, separated by exactly whether the paint escapes the box.

That suggests margin boxes are painted through a path with no support for a
self-painting layer, rather than eight unrelated property bugs.

EXPECTED: margin boxes are otherwise-styleable boxes per CSS Paged Media; the
spec carves out no exception for these properties.

${COMPONENT_ASK}`,
    comments: `Originally observed on Chromium 148, repro re-verified on 151; the property
table above is from ${CHROME_VERSION}.

Tracked on our side at https://github.com/dimm-city/gutterpress/issues/150.`,
  },

  152: {
    ours: "https://github.com/dimm-city/gutterpress/issues/152",
    summary:
      "@page { background: url() } is not painted unless the document references the same image somewhere else",
    repro: `1. Save any small PNG as tile.png, and this as page.html:

<!doctype html>
<html><head><style>
@page {
  size: 5in 3in;
  margin: 0.5in;
  background: #c9c5be url("tile.png") repeat;
  background-size: 1.5in auto;
}
</style></head><body><p>content</p></body></html>

2. Print to PDF, rasterise, and measure a strip inside the LEFT MARGIN — the
   @page background paints there and body content never reaches it. It is flat
   background colour: standard deviation 0.00. The image is absent.

3. Add ONE line to <head> and repeat:

   <link rel="preload" as="image" href="tile.png">

   The texture now paints: standard deviation 18.63.

An html { background: url(same) } rule, or even a 1x1 opacity:0 <img> pointing
at the same URL, has the identical effect.`,
    description: `A url() image in @page { background } is not painted when the @page rule is
the document's ONLY reference to it. The page shows the background colour
alone, with no warning. Any second reference to the same URL makes it paint.

Measured on Chrome ${CHROME_VERSION}, left-margin strip standard deviation
(flat colour = 0.00, texture well above 1):

  @page background alone                    0.00   image dropped
  + <link rel="preload" as="image">        18.63   paints
  + html { background: url(same) }         18.63   paints
  + 1x1 opacity:0 <img src=same>           18.63   paints

RULED OUT:

- Not a fetch failure. Serving the page over local HTTP shows
  "GET /tile.png" in the access log on the FAILING run. The image is
  requested; it is simply not painted.
- Not a race. --virtual-time-budget at 30s and 60s both still produce 0.00.
- Not image size. Same artwork at 450x582, 638x825 and 2550x3300 behaves
  identically in both directions — all three paint with a second reference,
  all three are dropped without one.
- Not FragmentedOofInCb. Enabling or disabling that feature changes nothing
  here (9/9 cells identical), so this is not crbug 438364050.

This looks like the page box being painted before the image decode lands, with
nothing invalidating it afterwards; a second reference gets the image decoded
early enough to be there when the page box paints.

EXPECTED: @page { background: url(…) } should paint the image without needing
an unrelated second reference to it elsewhere in the document.

A note on testing it: a fixture only exercises this if the @page rule is the
sole reference to the image. Ours passed for months because the image happened
to appear elsewhere on the page.

${COMPONENT_ASK}`,
    comments: `Measured on ${CHROME_VERSION}. Print path: --print-to-pdf and page.pdf() via
puppeteer-core.

Tracked on our side at https://github.com/dimm-city/gutterpress/issues/152.
Related but distinct: crbug 438364050 (a section background missing in print);
its FragmentedOofInCb fix does not affect this case.`,
  },
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ids = (wanted.length ? wanted : Object.keys(REPORTS)).map(String);
for (const id of ids) {
  if (!REPORTS[id]) {
    console.error(`No report ${id}. Known: ${Object.keys(REPORTS).join(", ")}`);
    process.exit(1);
  }
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: "chrome",
  viewport: null,
  args: ["--start-maximized"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

console.log(`\nProfile: ${PROFILE}`);
console.log("If this is your first run, sign in to Google in the window that opened.\n");

for (const [i, id] of ids.entries()) {
  const r = REPORTS[id];
  console.log(`\n─── ${i + 1}/${ids.length}  our #${id} ───────────────────────────────`);
  console.log(`    ${r.summary}\n`);

  await page.goto(WIZARD, { waitUntil: "domcontentloaded" });

  // ── Step 1: role, category, acknowledgement ────────────────────────────
  await page.waitForSelector(STEP1.role, { timeout: 120_000 });
  await page.check(STEP1.role, { force: true });

  await page.click(STEP1.category);
  await page.getByRole("option", { name: new RegExp(`^${STEP1.categoryOption}`) }).click();

  await page.check(STEP1.ack, { force: true });
  await page.getByRole("button", { name: "Next" }).first().click();

  // ── Step 2: the fields ─────────────────────────────────────────────────
  await page.waitForSelector(STEP2.summary, { timeout: 60_000 });
  await page.fill(STEP2.version, CHROME_VERSION);
  await page.fill(STEP2.summary, r.summary);
  await page.fill(STEP2.repro, r.repro);
  await page.fill(STEP2.description, r.description);
  await page.fill(STEP2.comments, r.comments);

  console.log("    Filled. Over to you:");
  console.log("      1. read it — this posts publicly under your account");
  console.log("      2. solve the reCAPTCHA");
  console.log("      3. click Submit");
  console.log("    Waiting… (Ctrl+C to stop and skip the rest)\n");

  // Wait for the wizard to hand us a real issue URL. No timeout — take as long
  // as you like, including editing the text before submitting.
  await page.waitForURL(/issues\.chromium\.org\/issues\/\d+/, { timeout: 0 });
  const url = page.url();
  const num = url.match(/issues\/(\d+)/)?.[1];
  console.log(`    FILED: https://issues.chromium.org/issues/${num}`);
  console.log(`    Now paste that link onto ${r.ours} and add it to that`);
  console.log(`    entry's "Tracking:" line in docs/known-limitations.md.\n`);
}

console.log("\nAll done. Leaving the browser open.\n");
