/**
 * SFE-P2a Lane C — the standard-Markdown corpus.
 *
 * Extends the six P1b no-edit byte-identity fixtures (originally inlined in
 * `tests/vscode-adapter/browser.cases.btest.ts`'s "case 1b — no-edit byte
 * identity (G-01)" describe block) with the CommonMark-oddity fixtures
 * SFE-P2a.md's behavior table names for the "Byte-identity corpus" row:
 * "extends P1b cases; adds CommonMark oddities: setext headings, lazy
 * continuation, hard breaks, entity refs, autolinks, nested lists 4-space vs
 * 2-space, tabs" — plus DETAILS (1)'s fuller list (link reference
 * definitions, CRLF, intraword-underscore emphasis, an empty document).
 *
 * Every entry is an inline TS string constant (DETAILS (1): "inline TS
 * constants preferred for byte-exactness") — no `.md` files, so nothing in
 * the toolchain (a text editor's "trim trailing whitespace on save", a
 * differently-configured `.gitattributes` line-ending filter, ...) can
 * silently mutate the exact bytes this corpus exists to protect.
 *
 * These are read-only fixtures (pr158-lessons.md AP-25: "Tests mutate
 * committed fixtures without restoration" — the fix is "Committed fixtures
 * are immutable inputs"). Every test in this directory constructs a FRESH
 * `MemoryDocumentHost` per fixture use; nothing here is ever edited in
 * place.
 */

export const FIXTURES: Readonly<Record<string, string>> = {
  // ── The P1b six (verbatim — see browser.cases.btest.ts "case 1b") ──────
  "mixed bullet characters": "- one\n* two\n- three\n",
  "trailing spaces before newlines": "line one   \nline two\t\nline three",
  "no final newline": "no trailing newline at the end of this document",
  "reference-style links": '[an example][1]\n\n[1]: https://example.com "Example Title"\n',
  "HTML comments": "<!-- a leading comment -->\n\nSome text after the comment.",
  "combined non-normalized markdown": [
    "- one\n* two",
    "",
    "line with trailing spaces   ",
    "",
    "<!-- comment -->",
    "",
    "[ref][1]",
    "",
    "[1]: https://example.com",
    "no final newline after this",
  ].join("\n"),

  // ── SFE-P2a additions: CommonMark oddities ─────────────────────────────

  /** ATX-alternative headings via `===`/`---` underlines, not `#` markers. */
  "setext headings": "Title One\n==========\n\nSubtitle Two\n------------\n\nBody text.\n",

  /**
   * CommonMark's "lazy continuation" rule: a blockquote/list paragraph may
   * continue on a following line with NO `>`/marker prefix, and the line
   * still belongs to the block. Includes both a lazy-only quote and a quote
   * that starts with an explicit continuation before going lazy, so both
   * shapes are exercised.
   */
  "lazy continuation in blockquote":
    "> This is the first line of a blockquote\nthat lazily continues without a `>` prefix.\n\n" +
    "> Second quote start\n> explicit continuation\nlazy continuation again.\n",

  /** Hard line break via two trailing spaces before the newline. */
  "hard line break - two trailing spaces": "First line.  \nSecond line.\n",

  /** Hard line break via a trailing backslash before the newline. */
  "hard line break - backslash": "First line.\\\nSecond line.\n",

  /** Named and numeric HTML entity references, left un-decoded in source. */
  "entity references": "Ampersand: &amp; less-than: &lt; and a numeric ref: &#169; and &copy;.\n",

  /** Bare-URL and `mailto:` autolinks in angle brackets. */
  autolinks: "See <https://example.com/path?query=1> and <mailto:person@example.com> for details.\n",

  /** Three levels of list nesting at 2-space-per-level indentation. */
  "nested list - 2-space indent": "- top\n  - nested\n    - deeper\n- top two\n",

  /** The same three-level nesting at 4-space-per-level indentation. */
  "nested list - 4-space indent": "- top\n    - nested\n        - deeper\n- top two\n",

  /**
   * A literal tab character used for indentation (CommonMark expands a tab
   * to the next 4-column stop, so 1 tab of indentation reads as a code
   * block). The tab byte itself must survive untouched either way.
   */
  "tab-indented content":
    "Normal paragraph.\n\n\tThis line starts with a literal tab character, which CommonMark treats " +
    "as four columns of indentation.\n",

  /**
   * CRLF line endings throughout. SFE-P2a.md DETAILS (1): "CRLF line
   * endings (if the pipeline preserves them — test and record)" — see
   * fixtures.test.ts's dedicated CRLF-preservation assertion and its
   * recorded finding at the `MemoryDocumentHost`/command-layer boundary
   * this lane covers (unit-level, no browser).
   */
  "CRLF line endings": "# Heading\r\n\r\nParagraph one.\r\n\r\n- item one\r\n- item two\r\n",

  /**
   * CommonMark's intraword-underscore rule: `_` inside a word does NOT open
   * emphasis, while `*` does, and a properly word-boundary-delimited `_..._`
   * still does. All three shapes appear so a command that (mis)treats every
   * underscore as an emphasis delimiter is distinguishable from one that
   * respects the rule.
   */
  "intraword underscores (emphasis edge case)":
    "A variable named snake_case_value stays literal (no emphasis), " +
    "but _this phrase_ at a word boundary is emphasis, and *so is this*.\n",

  /**
   * Multiple link reference definitions with no corresponding inline usage
   * for one of them ("baz") and no consuming token at all for the
   * definitions themselves — Markdown-it consumes reference definitions
   * without producing a rendered token (pr158-lessons.md AP-04: exactly the
   * shape that made reference definitions "a concrete case" for silent data
   * loss in the superseded architecture). Distinct from the P1b
   * "reference-style links" fixture above, which pairs one definition with
   * its one usage; this fixture stresses definitions as a source-preserved
   * region on their own.
   */
  "link reference definitions":
    "[foo]: https://example.com/foo\n" +
    '[bar]: <https://example.com/bar> "Bar Title"\n' +
    "[baz]: /relative/path 'Single quoted'\n" +
    "\n" +
    "Text referencing [foo] and [bar].\n",

  /** The zero-byte case: an empty document must round-trip as `""`. */
  "empty document": "",
};

/** Fixture names, stable insertion order — every consumer iterates this. */
export const FIXTURE_NAMES: readonly string[] = Object.freeze(Object.keys(FIXTURES));
