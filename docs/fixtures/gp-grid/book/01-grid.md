# Grid Runs

@page

## Two Ways to Split a Page

Gutterpress gives authors two core primitives for side-by-side layout.
`.gp-columns-2` flows one run of text down the first column and across
into the second, like a newspaper. `.gp-grid-2` places each block into
the next open slot, across then down, like a hand of cards laid on a
table. This fixture exercises the second one — the slotted grid — in the
exact place it was measured: rows that grow taller than the page and
must fragment across sheets in both the preview and the print engine.

The pages that follow hold nothing back. The first grid page carries two
sections long enough to spill across several sheets, with headings
buried deep in each column so the parity gate can check which sheet each
one lands on. The second uses three tracks. The last puts a small grid
inside an ordinary page, between plain paragraphs.

@page .gp-grid-2
@section

## Ledger of the West Bank

The west bank ledger opens with the spring survey, taken on foot at the
lowest tide of the season. Every stake line is walked twice, once at
first light and once near noon, because the morning sun flattens the
mudflat's relief and hides the drainage cuts that matter most.

Entries run in the order the walker meets them, not in the order the
map prefers. A cut that moved ten feet since autumn gets a fresh entry
and a cross-reference to its old position, so the ledger reads as a
history of the bank rather than a snapshot.

The middle reaches are the slowest going. The substrate shifts from
firm sand to a soft marl that takes a boot to the ankle, and the walker
learns to keep to the shell ridges, stepping stone to stone, reading
the water's edge for the sheen that means the tide has turned.

### Depth Soundings

Soundings are taken with a marked pole at every second stake, and the
figures go straight into the ledger's inner margin. Over a full season
the margin becomes a profile of the bank, a curve any reader can trace
without leaving the page.

Where the pole finds more than a fathom, the entry is flagged and the
line is resounded from a boat at slack water. The boat figures rarely
match the pole figures exactly, and the ledger keeps both, because the
difference between them is itself a measurement of the current.

The deepest cut on the west side has held its line for nine seasons
now, which the older ledgers say is unusual. The bank remembers storms
longer than the people do, and the ledger is how the remembering is
done — entry by entry, stake by stake, season over season.

### Closing the Season

The season closes when the first hard frost stiffens the upper flat.
The final walk is ceremonial as much as practical: every stake is
checked, straightened, or pulled, and the ledger's last page for the
year is ruled off with a double line and signed by every walker.

@section

## Ledger of the East Bank

The east bank runs steeper, and its ledger reads differently from the
first entry on. Where the west walker records drift and drainage, the
east walker records slump and scour, because the channel presses close
against this side and takes what it wants in the night.

Entries here are shorter and more frequent. A single tide can rewrite
the lower stakes, so the east ledger is walked on a weekly rhythm all
season long instead of surveyed once and amended. The handwriting gets
looser as the season wears on; the figures do not.

### Scour Watch

The scour watch is the east bank's particular duty. Three reference
posts, driven to refusal and capped with brass, mark the reach where
the channel bites hardest. Each visit records the exposed length of
every post to the quarter inch.

When a post shows more than a hand's width of new exposure between
visits, the watch doubles: the walker returns at the next low water
regardless of schedule. Two doubled watches in a row raise a flag in
the ledger that no one is permitted to rule off until the reach is
resounded from the boat.

The brass caps are the oldest instruments the ledger keeps. One dates
to the first survey, and its figures — copied forward year over year —
make the longest unbroken record the banks possess. The east ledger is
proud of this in its plain way: the cap's column is never abbreviated.

### Handover

At season's end the east ledger is read against the west in a single
sitting, page against page, until both walkers agree the banks have
been fairly described. Disagreements are written down too. The ledger
that admits its arguments is the one the next season trusts.

@end-section

@page .gp-grid-3
@section

### First Track

Three tracks share this page evenly. Each section takes the next slot
across, and the row stands as tall as the tallest of the three.

@section

### Second Track

The middle track carries one paragraph more than its neighbors, so the
row's height is set here, and the default stretch spaces the row to the
page in preview and print alike.

A second paragraph, to make the point.

@section

### Third Track

The last track is the shortest, and the grid neither reorders nor
rebalances it. Slots are slots.

@end-section

@page

## A Grid Between Paragraphs

A grid does not need to own its page. Here an ordinary page carries a
paragraph, then a small two-track grid of loose blocks, then another
paragraph. Inside the grid section every block takes a slot of its own,
across then down — placement, not flow.

@section .gp-grid-2

The first block takes the left slot of the first row.

The second block takes the right slot beside it.

The third block starts the second row on the left.

The fourth block completes the square.

@end-section

The page returns to ordinary flow after the grid closes, and the folio
below has never left the bottom margin.
