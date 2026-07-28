# Changelog

All notable changes to the **Print-MD Publishing** Open Design plugin.

The version in `open-design.json` is bumped whenever the package contents or
the workflow contract change. Changes to inputs, capabilities, edit scopes, or
ownership rules are user-visible compatibility changes.

## 0.1.0 — 2026-07-28

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

Verified against Print-MD `main` at 2026-07-28, which includes:

- shared design composed **by reference** — a `styles:` entry is a path to read,
  so `source.assets` staging and flattening no longer exist (and a manifest
  carrying `source.assets` or `output` now fails the build);
- a full rebuild and complete Paged.js repagination after **every** stylesheet
  edit, replacing the old `<link>` hot-swap; and
- preview watching of the book's **declared external dependencies**, so editing
  a shared stylesheet or authored plugin refreshes the preview.

Licensed MPL-2.0, matching the repository that maintains the package.
