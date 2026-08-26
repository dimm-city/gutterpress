# Chapter One: Feature Probe

<p class="rh-probe">RUNNING-ELEMENT-SENTINEL</p>

This fixture exercises the CSS Paged Media / GCPM features flagged in issue #46.
Each feature is probed by the audit script.

## String Sets

The `h1` above sets the `probe-title` named string; the `@top-center` margin box
prints it on every page of this chapter.

@page

## Named Page

This page uses `@page probe-named` (assigned via the `.page-probe-named` class
emitted by the marker plugin), which has a distinctive margin-top so the audit
can measure whether the named-page rule applied.

@page probe-named

# Chapter Two: Named Page Target

Content on the named page. The named-page rule sets `margin-top: 2.5in`; on an
engine where named pages break, this page's content area starts at the default
0.875in instead.

@page

# Chapter Three: Multi-Column

@section .probe-columns

This section is set in two columns. Sed ut perspiciatis unde omnis iste natus
error sit voluptatem accusantium doloremque laudantium, totam rem aperiam,
eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae
dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur
aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione
voluptatem sequi nesciunt.

@column-break

After the forced column break. Neque porro quisquam est, qui dolorem ipsum quia
dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi
tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.

@end-section
