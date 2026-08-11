@page

# Pinned Pictures

A pinned image leaves the flow entirely and sets itself against its
@page container — centered by default, or against an edge with the
gp-top, gp-bottom, gp-left, and gp-right modifiers. This page pins a
small heron to the page foot while the text above it flows normally.

The pin resolves against the @page container this markdown sits in, so
a single-page layout like this one is genuinely page-relative. The pin
never disturbs pagination: it is out of flow, and the parity gate holds
this book to identical page maps in the preview and the print engine.

![A heron pinned to the page foot](assets/heron.jpg){.gp-pin .gp-bottom .gp-small}

@page

# Pinned to a Corner

The second pinned page sets the heron into the top-right corner with
two edge modifiers, while a quarter-width copy floats in the running
text to prove flow and pin compose on the same page without touching
each other.

![A heron, floated right](assets/heron.jpg){.gp-right .gp-small}

The tide table is a promise the water mostly keeps. The wind rewrites
it at the margins, the moon signs it twice a month, and the marsh files
it away under mud and eelgrass until the next low water opens the book
again to the same dog-eared page.

![A heron pinned to the top right corner](assets/heron.jpg){.gp-pin .gp-top .gp-right .gp-small}
