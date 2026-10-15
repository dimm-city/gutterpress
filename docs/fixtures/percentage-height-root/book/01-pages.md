@page

## One

The first page block. Its height is a percentage of its containing block: the
flow root in print, the viewer's strip on screen. Print resolves it to auto,
and the preview has to do the same.

@page

## Two

The second page block, the same rule. Where the percentage resolves, the
heading fills the block and this paragraph has nowhere to go but the next
fragment.

@page

## Three

The third page block. Between blocks a spilled paragraph is absorbed by the
next block's forced break, so only the last block of a run shows the cost.

@page

## Four

The last page block. If its percentage resolved in the preview and not in
print, the preview would end on a blank page the PDF does not have.
