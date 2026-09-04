/**
 * A pipe table's header row is a `th` row inside `thead` in the book's HTML.
 *
 * The fork builds every table cell as a `td` and leaves the header row a
 * direct child of the `table`, because its own editing model treats all rows
 * alike (the delimiter row is a real row it hides while the table is
 * inactive). markdown-it, and therefore every printed page, emits
 * `thead > tr > th`. A book styles its tables against that shape — the design
 * guide's header bar is a bare `th` rule, and its page templates reach for
 * `thead` — so in the editor the header row lost its own styling AND changed
 * the table's column widths, which re-wrapped every cell under it.
 *
 * The body rows get the same treatment: markdown-it puts them in a `tbody`
 * and never emits the delimiter row at all, so a book that names a row by
 * its position (`tbody > tr:nth-of-type(3)`, which is how the pipeline's
 * own row attributes reach the editor) or stripes rows by parity counts
 * from the same rows the page does.
 *
 * Locked only: this rewrites the elements the fork maps a caret into, and the
 * reader's view is the one where there is no caret to map. The fork rebuilds
 * a block from its source whenever it becomes active, so nothing here
 * survives into an edit.
 */
export function promoteTableHeader(element: HTMLElement, node: { readonly kind: string }): void {
  if (node.kind !== "table") return;
  const table = element.tagName === "TABLE" ? element : element.querySelector("table");
  if (!table) return;
  const row = table.querySelector("tr");
  // A table whose first row is the delimiter row has no header to promote.
  if (!row || row.classList.contains("md-table-delimiter-row")) return;
  const doc = element.ownerDocument;
  for (const cell of Array.from(row.children)) {
    if (cell.tagName !== "TD") continue;
    const th = doc.createElement("th");
    for (const attr of Array.from(cell.attributes)) th.setAttribute(attr.name, attr.value);
    while (cell.firstChild) th.appendChild(cell.firstChild);
    // The pipes the fork keeps in the cell and hides are not in the book's
    // HTML, and their presence is the difference between a header cell that
    // matches `th:empty` and one that does not. The design guide collapses an
    // empty header bar with exactly that selector — books use a table as a
    // boxed list with no header text — so a cell holding nothing but hidden
    // pipes has to be genuinely empty here too.
    for (const hidden of Array.from(th.querySelectorAll(".md-glue-hidden, .md-marker-hidden"))) hidden.remove();
    if (!(th.textContent ?? "").trim()) th.replaceChildren();
    cell.replaceWith(th);
  }
  if (row.parentElement && row.parentElement.tagName !== "THEAD") {
    const head = doc.createElement("thead");
    row.replaceWith(head);
    head.appendChild(row);
  }
  for (const delimiter of Array.from(table.querySelectorAll(":scope > tr.md-table-delimiter-row"))) delimiter.remove();
  const bodyRows = Array.from(table.children).filter((child) => child.tagName === "TR");
  if (bodyRows.length) {
    const body = doc.createElement("tbody");
    bodyRows[0]!.replaceWith(body);
    for (const bodyRow of bodyRows) body.appendChild(bodyRow);
  }
}
