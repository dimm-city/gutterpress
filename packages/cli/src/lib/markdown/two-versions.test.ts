/**
 * two-versions.ts — a passage the converge merge left with two versions
 * renders as two labelled boxes, not as the setext heading and blockquote
 * stack its marker lines spell in plain markdown. The first test renders
 * the REAL merge output (not a hand-typed copy), so the rule, the merge and
 * the merge-marker check share one source of the sentinel lines and cannot
 * drift.
 */
import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer } from "./renderer";
import { mergeWithMarkers } from "../remote-auth/converge-merge";
import { TWO_VERSIONS_CSS } from "./two-versions";

const render = (src: string): string => createMarkdownRenderer([]).render(src, {});

describe("two_versions block rule", () => {
  test("renders the real merge output as two labelled versions, each parsed as markdown", () => {
    const combined = mergeWithMarkers(
      "# One\n\nThe vault door opened.\n\nAfter.\n",
      "# One\n\nThe vault door **groaned** open.\n\nAfter.\n",
      "# One\n\nThe vault door swung open.\n\nAfter.\n",
    );
    const html = render(combined);
    expect(html).toContain('<div class="gp-two-versions"');
    expect(html).toContain('<div class="gp-version gp-version-yours" data-label="Your version"');
    expect(html).toContain('<div class="gp-version gp-version-online" data-label="Online version"');
    // Each side is block markdown: the bold survives as <strong>.
    expect(html).toMatch(/<p[^>]*>The vault door <strong>groaned<\/strong> open\.<\/p>/);
    expect(html).toMatch(/<p[^>]*>The vault door swung open\.<\/p>/);
    // The failure this rule exists for: no setext heading, no blockquotes, no raw markers.
    expect(html).not.toMatch(/<h1[^>]*>The vault door/);
    expect(html).not.toContain("<blockquote");
    expect(html).not.toContain("&lt;&lt;&lt;&lt;&lt;&lt;&lt;");
    expect(html).not.toContain("&gt;&gt;&gt;&gt;&gt;&gt;&gt;");
    // The surrounding prose still renders normally.
    expect(html).toContain("<h1");
    expect(html).toMatch(/<p[^>]*>After\.<\/p>/);
  });

  test("opens right under a line of prose, as the merge writes it, and carries its source line", () => {
    const html = render(
      "Kept line.\n<<<<<<< your version\nmine\n=======\ntheirs\n>>>>>>> online version\nTail.\n",
    );
    expect(html).toMatch(/<p[^>]*>Kept line\.<\/p>/);
    expect(html).toContain('class="gp-two-versions"');
    expect(html).toMatch(/<p[^>]*>mine<\/p>/);
    expect(html).toMatch(/<p[^>]*>theirs<\/p>/);
    expect(html).toMatch(/<p[^>]*>Tail\.<\/p>/);
    // data-source-line (markdown-it-source-map) lands on the box: the line of the opener.
    expect(html).toMatch(/gp-two-versions[^>]*data-source-line="2"/);
  });

  test("a bare ======= stays setext markdown; a half-deleted family is left to the check", () => {
    expect(render("Heading\n=======\n\nBody.\n")).toMatch(/<h1[^>]*>Heading<\/h1>/);
    const orphan = render("Kept.\n>>>>>>> online version\n");
    expect(orphan).not.toContain("gp-two-versions");
    const unclosed = render("<<<<<<< your version\nmine\n=======\ntheirs\n");
    expect(unclosed).not.toContain("gp-two-versions");
    const noSeparator = render("<<<<<<< your version\nmine\n>>>>>>> online version\n");
    expect(noSeparator).not.toContain("gp-two-versions");
  });

  test("an empty side renders an empty labelled box; CRLF input works", () => {
    const html = render("<<<<<<< your version\r\n=======\r\ntheirs\r\n>>>>>>> online version\r\n");
    expect(html).toMatch(/data-label="Your version"[^>]*><\/div>/);
    expect(html).toMatch(/<p[^>]*>theirs<\/p>/);
  });

  test("two blocks in one file render as two boxes", () => {
    const html = render(
      "<<<<<<< your version\na\n=======\nb\n>>>>>>> online version\n\nmid\n\n<<<<<<< your version\nc\n=======\nd\n>>>>>>> online version\n",
    );
    expect(html.match(/class="gp-two-versions"/g)).toHaveLength(2);
    expect(html).toMatch(/<p[^>]*>mid<\/p>/);
  });

  test("the CSS styles only the two classes the rule emits", () => {
    expect(TWO_VERSIONS_CSS).toContain(".gp-two-versions");
    expect(TWO_VERSIONS_CSS).toContain("content: attr(data-label)");
  });
});
