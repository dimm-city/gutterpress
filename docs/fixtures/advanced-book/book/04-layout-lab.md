@chapter "Layout Patterns" #ch-layout

@page

# Layout Patterns

This chapter is the layout torture bed: multi-column sections, forced
column and page breaks, a continued section, and a spread.

@section .gp-columns-2

## Two columns

Signal codes read best in narrow measure, so the code tables and their
commentary run in two columns. The first column carries the whistle
codes: one long is *hold position*, two long is *come to me*, three
long is *emergency, all wardens*. Short blasts are informational only
and never carry an order.

@column-break

The second column begins at the forced break, not where balancing
would put it. Lamp codes mirror whistle codes after dark: the lamp is
occluded with the flat of the hand, and a long occlusion is read
exactly as a long blast. No code mixes lamp and whistle in one
sentence.

@end-section

A paragraph at full measure between the column exercises, so each
section's geometry starts clean.

@section .gp-columns-2

## A continued section

Column sections may be interrupted for a plate and resumed. This first
half establishes the pattern: procedure text flows in columns until
the interruption point.

@continue

The continuation reopens the same section shape, marked as continued,
and the reader never sees a seam — only the interposed material breaks
the column flow.

@end-section

@page-break

## After a forced page break

The page break above is authored, not natural. Whatever the fill state
of the previous page, this heading starts a fresh page.

@spread

@page

## On a spread

Spread openers pair two facing pages. The left page of the spread
carries this explanatory text.

@page

The right page of the spread carries the counterpart text, and the
pair is laid out together when the book is imposed.
