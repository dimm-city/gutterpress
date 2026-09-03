# CSS ownership contract

A theme with more than a couple of CSS files usually needs a few rules about
who owns what — "only `page-templates.css` may set `columns:N`", "`dc-tokens.css`
holds no style rules, only custom properties" — so two files don't quietly
fight over the same property, and so a "bare `.dc-*` rule with no page/chapter
qualifier" doesn't leak project-wide chrome onto everything. Before this
existed, those rules lived only as prose in each file's own header comment,
each ending in a natural-language "AGENT RULE" aimed at whoever edited the
file next. That works only when it's honored, and a 2026-09-01 review of the
Dimm City design guide found several places where it quietly wasn't
(guide-only selectors leaking into a shared file, named-page wiring split
across three files, a book-prefixed rule inside the shared engine sheet).

`source.css-ownership` (`packages/cli/src/checks/source/css-ownership.ts`)
turns those header-comment contracts into a postcss-based lint check, run the
same way `source.stylelint` (the print-safety checks) already are — no
stylelint (see `CLAUDE.md` §3: stylelint can't be bundled into the compiled
binary). It reports through the same `gutterpress validate`/build-warning
channel as every other check, all findings at `severity: warning`.

## It is entirely optional

With no contract file, the check reports nothing — for every project,
including ones that have never heard of this feature. There is no default
contract and no built-in opinion about how your CSS should be organized.

## Where the contract lives

By default, `.gutterpress/css-contract.yaml` (or `.yml`) in the project root
(next to `manifest.yaml`). To use a different path, or to turn the check off
entirely, set it in the manifest:

```yaml
validate:
  source:
    cssOwnership: ".gutterpress/css-contract.yaml" # default location, shown explicitly
    # cssOwnership: false                           # disable the check
```

## Shape

```yaml
files:
  css/dc-tokens.css:
    allow: [":root", "@font-face"]
  css/page-templates.css:
    owns-properties: [columns, column-count, column-fill]
  css/page-rules.css:
    owns-at-rules: [page]
  css/fg-overrides.css:
    forbid-unscoped-selectors: ["\\.dc-", "\\.pmd-"]
```

Every file you want checked is listed under `files:`, keyed by its
project-relative path (the same form `styles:` entries use). A file with no
entry in `files:` gets no allow-list/forbid checks of its own, but — see
`owns-properties`/`owns-at-rules` below — is still checked against every
OTHER file's ownership claims, since a collision can just as easily show up
in a file nobody thought to annotate.

### `allow` — a closed list for the file's top-level content

For a file meant to hold nothing but a specific, narrow shape (tokens and
font faces, say), `allow` lists exactly what may appear at the TOP LEVEL of
the file (a plain entry matches a rule's selector; an `@`-prefixed entry
matches an at-rule's name). Anything else at the top level is flagged.
Deliberately not recursive into `@media`/`@supports` — this checks the file's
own flat structure, not every possible nesting; wrapping a rule in `@media`
does not exempt it, since the `@media` itself is a top-level construct that
must also be in the allow-list (or it will be flagged on its own).

### `forbid-properties` — a per-file denylist

Properties that must never be declared anywhere in this specific file,
independent of any ownership claim below. Use this for a narrower, local rule
("this override file must never set `z-index` directly, only the
`--gp-z-*` ladder") that doesn't need a whole ownership map.

### `owns-properties` / `owns-at-rules` — exclusive ownership, checked project-wide

The file listed is the sole permitted declarer of these CSS properties (or,
for `owns-at-rules`, at-rule names — e.g. `page` for `@page`). Every active
stylesheet is checked against every ownership claim, not just the files named
in the contract, so a stray `columns: 2` in some unrelated file is still
caught. This is the direct fix for the motivating example:

> `page-templates.css`: "COLUMN OWNERSHIP RULE: If a THEME rule sets
> `columns:N` anywhere in this project, it belongs here and ONLY here. Any
> `columns:N` found in another file is a bug."

```yaml
files:
  css/page-templates.css:
    owns-properties: [columns, column-count, column-fill]
```

A `columns: 2` declared anywhere else now produces:

```
source.css-ownership: "columns" belongs to css/page-templates.css (its CSS
contract entry claims exclusive ownership) — found in css/dc-components.css
too. Move this declaration to css/page-templates.css.
```

### `forbid-unscoped-selectors` — no bare component classes

Regex patterns (as strings) that must never appear as the OUTERMOST part of a
selector — i.e. with nothing preceding it. A rule is flagged when one of its
comma-separated branches matches a pattern with nothing before the match in
that branch; a branch with an ancestor before the match (`.page .dc-callout`)
passes. This is the direct fix for:

> `fg-overrides.css`: "MUST NOT CONTAIN — CORE CONSTRAINT: Any bare `.dc-*` or
> `.pmd-*` rule without a page/chapter context qualifier."

```yaml
files:
  css/fg-overrides.css:
    forbid-unscoped-selectors: ["\\.dc-", "\\.pmd-"]
```

`.dc-callout { … }` is flagged; `.page .dc-callout { … }` and
`#ch-bestiary .dc-callout { … }` are not.

## What this deliberately does not check

The original proposal for this feature also sketched a project-wide
`prefixes: { allow, warn-unprefixed }` block — flag every CSS class that
doesn't start with an approved brand prefix. That is not implemented. Core
itself emits bare, unprefixed structural classes authors are meant to style
directly (`.section`, `.page`, `.spread`, `.chapter`, `.col` — see
`CLAUDE.md` §6), and a project's own non-branded utility classes (this user
guide's own `.lede`, for one) are completely legitimate CSS. A blanket sweep
would flag both of those on every single run, in every project that turned it
on — the kind of constant, undifferentiated noise that gets a lint rule
disabled rather than fixed. The five checks above stay opt-in, file by file,
and each fires only for a specific, real ownership violation.

## See also

- [Schema reference — `validate.source`](./schema-autocomplete.md#validate-object)
- [CSS architecture review, finding C6](./audits/2026-09-01-css-architecture-review.md) — the review this check implements
- `packages/cli/src/lib/printsafe.ts` — the sibling postcss-based print-safety
  checks this follows the same no-stylelint approach as
