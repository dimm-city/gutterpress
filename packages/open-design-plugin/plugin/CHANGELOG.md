# Changelog

All notable changes to the **Gutterpress Publishing** Open Design plugin.

The version in `open-design.json` is bumped whenever the package contents or
the workflow contract change. Changes to inputs, capabilities, edit scopes, or
ownership rules are user-visible compatibility changes.

## 0.2.0 - 2026-07-28

- Replaced apply-time inputs with a conversation-first runtime brief because
  Open Design 0.16.1 no longer renders plugin input forms in existing projects.
- Added one structured inline clarification form for genuinely ambiguous book,
  goal, scope, ownership, or preview decisions.
- Classified the package in Open Design's `refine` lane and recorded the tested
  Open Design floor.
- Corrected theme cascade, Browser-context, preview-pagination, trust, and
  distribution guidance to match current Open Design and Gutterpress behavior.
- Made the injected skill self-contained because Open Design stages companion
  files without exposing a stable package-relative path to the agent.
- Documented the CLI run's lack of Browser/form UI, the unenforced Open Design
  engine declaration, the unreleased Print-MD floor, output bundles, and
  stylesheet-only URL theme imports.
- Added package contract tests, compatibility fixtures, behavioral evals, and a
  release checklist.

## 0.1.0 - 2026-07-28

Initial package.

- `SKILL.md` — the workflow contract: resolve the book, inspect the publication
  contract, enforce `editScope` / `changeScope`, make the smallest stable
  change, verify against the running preview.
- `open-design.json` — `tune-collab` skill plugin with a three-stage
  inspect → edit → verify pipeline over first-party file and planning atoms,
  five inputs, and exactly three capabilities (`prompt:inject`, `fs:read`,
  `fs:write`).
- Five reference files covering the project contract, the CSS cascade and
  reference-based shared composition, semantic layout markers, the preview /
  source-metadata loop, and Git scope with plugin ownership.

Verified against the Print-MD source that shipped the package on 2026-07-28,
which includes:

- shared design composed **by reference** — a `styles:` entry is a path to read,
  so `source.assets` staging and flattening no longer exist (and a manifest
  carrying `source.assets` or `output` now fails the build);
- a full rebuild and complete Paged.js repagination after **every** stylesheet
  edit, replacing the old `<link>` hot-swap; and
- preview watching of the book's **declared external dependencies**, so editing
  a shared stylesheet or authored plugin refreshes the preview.

Licensed MPL-2.0, matching the repository that maintains the package.
