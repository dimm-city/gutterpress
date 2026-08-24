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
| [#149](https://github.com/dimm-city/gutterpress/issues/149) | Gradient-only `@page { background }` paints nothing in print | Solid color and `url()` on the same `@page` paint the full sheet |
| [#150](https://github.com/dimm-city/gutterpress/issues/150) | `box-shadow` and `transform` silently dropped in `@page` margin boxes | `border` on the same margin box paints correctly |
| [#152](https://github.com/dimm-city/gutterpress/issues/152) | Large raster images silently dropped from `@page { background }` | 450×582 paints; 638×825 and up are dropped — same image, same CSS |

The control is the important half. It is what makes each of these a
Chromium inconsistency rather than "paged media is unsupported," and it is the
first thing triage will look for.

## Steps

1. Go to <https://issues.chromium.org/issues/new>, choose the **Chromium**
   tracker.
2. Component: **`Blink>Printing`** — all three are print-path only. Triage may
   reassign to `Blink>Paint`; that is fine, do not pre-guess.
3. Type **Bug**. Title: the row above.
4. Body: paste the GitHub issue's *Repro*, *Expected*, and *Environment*
   sections verbatim. They are already in the shape Chromium asks for. Add one
   line at the top linking back to our issue.
5. Attach the rasterized before/after if you have it — #152's flat-vs-textured
   pair and #149's blank-vs-painted sheet are the whole argument in one image.
6. State the versions from the issue (#149 and #152 reproduce on Chromium 148
   and 151; #150 on 148, repro re-verified on 151). Do not widen the range
   beyond what was measured.

## After filing

Three small updates, so the removal trigger becomes real:

1. Comment the `issues.chromium.org` link on our GitHub issue.
2. Add it to that entry's **Tracking:** line in
   [`known-limitations.md`](./known-limitations.md) (§1 = #149, §2 = #150,
   §3 = #152).
3. Leave our issue **open**. It stays the citable reference for theme authors
   and the trigger for deleting the book-side workaround — dc-op-manual's
   downsampled `brick-bg-01-tile.png` exists only because of #152 and should be
   deleted when #152 is fixed upstream.

Do not add a shim while waiting. See
[`CLAUDE.md`](../CLAUDE.md) — *"Chrome wins once it ships."*
