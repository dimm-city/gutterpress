# Filing the upstream Chromium bugs

Concrete steps for [`known-limitations.md`](./known-limitations.md)'s step 3 —
*"a maintainer with a crbug.com account files it against Chromium."* Three
reports are ready to file and have never been filed.

Each needs a Google account. `crbug.com` now redirects to the Chromium Issue
Tracker at **<https://issues.chromium.org>**.

## The three, ready to go

Every one already has a verified minimal repro, a known-good control, and
measured pixel evidence in its GitHub issue — copy the body across rather than
rewriting it.

| Ours | Title to file | Control that proves it is a bug |
|---|---|---|
| [#149](https://github.com/dimm-city/gutterpress/issues/149) | Gradient in `@page { background }` paints nothing in print (linear, radial and repeating alike) | A solid colour on the same `@page` paints the full sheet (152.866 vs 0.000). Cite the solid contrast, **not** `url()` — that one is #152. |
| [#150](https://github.com/dimm-city/gutterpress/issues/150) | Margin boxes silently drop stacking-context and outside-the-box properties — `box-shadow`, `transform`, `opacity`, `outline`, `filter`, `mix-blend-mode` | `text-shadow` (0.1164) is honoured on the same box while `box-shadow` (0.0000) is not — two shadows, split by whether it paints outside the box |
| [#152](https://github.com/dimm-city/gutterpress/issues/152) | `@page { background: url() }` not painted unless the image is referenced elsewhere | Adding a `<link rel=preload>` for the same URL makes it paint; the image is fetched either way |

The control is the important half. It is what makes each of these a
Chromium inconsistency rather than "paged media is unsupported," and it is the
first thing triage will look for.

## The script

`node tools/file-upstream-chromium-bugs.mjs` fills the wizard for all three
(or pass ids: `… 150 152`). It opens Chrome with a persistent profile so you
sign in to Google once, then for each report selects the role and category,
ticks the search acknowledgement, and types the summary, repro and description
into the right fields.

**It does not submit.** The wizard ends in a reCAPTCHA, and Submit is a
public, permanent, attributed action — both are yours. The script waits for
the URL to become a real issue number, prints it, and moves on.

Do the steps below by hand only if the wizard changes and the script breaks;
the selectors it depends on are in its `STEP1`/`STEP2` blocks.

## Steps

1. Go to <https://issues.chromium.org/issues/new>, choose the **Chromium**
   tracker.
2. Component: **`Blink > Layout > Printing`** — verified, not guessed: it is
   the component every existing `@page`/print bug below sits in. (An earlier
   draft of this file said `Blink>Printing`, which does not exist.) **The
   wizard will not let you set it** — a non-committer gets routed by category
   instead, so each report asks for the component in its description. The
   reporter of 438364050 hit the same wall and said so in their filing.
   Closest category: **Content** ("Problems with webpages not working
   correctly"); role: **Web Developer**.
3. Type **Bug**. Title: the row above.
4. Body: paste the GitHub issue's *Repro*, *Expected*, and *Environment*
   sections verbatim. They are already in the shape Chromium asks for. Add one
   line at the top linking back to our issue.
5. Attach the rasterized before/after if you have it — #152's flat-vs-textured
   pair and #149's blank-vs-painted sheet are the whole argument in one image.
   For #152, attach the *same* page with and without the one-line
   `<link rel="preload">`; that pair is the entire bug.
6. State the versions from the issue, and only those. All three now carry
   differential measurements taken on **151.0.7922.75**; #149 and #150 also
   record the original 148 observation. Do not widen the range beyond what was
   measured.

## Measure differentially, and always include a control

All three reports now carry measurements produced the same way: render the
page, render it again with the one declaration removed, and compare the
rasters pixel-for-pixel. A mean absolute difference of `0.000` is proof the
declaration changed nothing — far stronger than "it looks wrong", and it is
the form a Chromium engineer can re-run.

**Every run must include a control that MUST differ.** #152's original
diagnosis was wrong for exactly this reason: a harness returned "dropped" for
every cell including the case that was supposed to work, and without a control
there was nothing to distinguish a real universal failure from a broken test.
Two controls used here: removing the margin box entirely (diff 7.8710) and
changing only the border colour (1.2678).

## Related issues that already exist (checked 2026-08-24)

None of these duplicates our three, but link them from the new reports —
triage weights a bug that connects to live work.

| Chromium | What it is | Why it matters to us |
|---|---|---|
| [438364050](https://issues.chromium.org/issues/438364050) | "Second section with a background image fails to render only in print preview & resultant saved pdf". P2, on the *Rendering Core 2026 Fixit* hotlist. Comment #13 (Jan 2026, Chromium engineer): *"Already passes with FragmentedOofInCb enabled."* | **Not ours — checked, not assumed.** `--enable-features=FragmentedOofInCb` changes nothing in our case (9/9 cells identical vs `--disable-features` and default), so #152 is a separate bug and belongs in its own report, not as a comment there. |
| [382190915](https://issues.chromium.org/issues/382190915) | `background-attachment: fixed` does not cover page margins in print. P2, New. | Adjacent, not ours — same spec section ([css-page-3 §painting](https://drafts.csswg.org/css-page-3/#painting)) that #149 and #152 rest on. |
| [406926291](https://issues.chromium.org/issues/406926291) | "Support for @page :blank selector". P3, New, filed by a Chromium engineer; states forced left/right page breaks are unsupported. | Not one of the three. It is the upstream record for **recto/verso** — the removal trigger for our `break-before: recto` handling. |
| [40199963](https://issues.chromium.org/issues/40199963) | "Chrome PDF converts text to image when using drop-shadow CSS". P3, Assigned. | Upstream confirmation of exactly what `printsafe/no-risky-print-effects` warns about for `filter`, and the root cause behind dc-op-manual#28's ~30x build cost. |

**Not filed by anyone — file these fresh:**

- **#150** (`box-shadow`/`transform` dropped in margin boxes). Searching the
  component for "margin box" returns 7 results, all feature requests, mostly
  already Fixed — `page-margin-box @rules` shipped in
  [40341678](https://issues.chromium.org/issues/40341678). Nothing reports
  that properties are dropped inside those boxes.
- **#149** (gradient-only `@page { background }` paints nothing). No match in
  the component.

## After filing

Three small updates, so the removal trigger becomes real:

1. Comment the `issues.chromium.org` link on our GitHub issue.
2. Add it to that entry's **Tracking:** line in
   [`known-limitations.md`](./known-limitations.md) (§1 = #149, §2 = #150,
   §3 = #152).
3. Leave our issue **open**. It stays the citable reference for theme authors
   and the trigger for deleting the book-side workaround. Note for #152: the
   re-diagnosis means dc-op-manual's downsampled `brick-bg-01-tile.png` may not
   be the fix it was thought to be — a `<link rel="preload">` for the
   full-resolution asset should work instead. Re-test there before removing
   anything.

Do not add a shim while waiting. See
[`CLAUDE.md`](../CLAUDE.md) — *"Chrome wins once it ships."*
