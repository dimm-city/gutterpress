# ADR 0012 — One publishing system: a target defines its file

Date: 2026-11-14 · Status: accepted · Amends [ADR 0008](./0008-presets-and-publish-targets.md)

## Context

ADR 0008 split presets (how the book is designed) from targets (where it is
published) and said both are "consumed identically by the CLI and the
desktop (one implementation, two thin front-ends)". The code drifted from
that, and 0008 itself stopped one step short:

- **A target only validates.** 0008 made a target "a named validation-policy
  overlay" that "never changes how the book renders". Nothing connects a
  target to the file it needs. A book for DriveThruRPG print needs PDF/X;
  `gutterpress publish --provider drivethrurpg` sends the plain PDF, and the
  desktop builds one file and sends it to every destination.
- **Two lists, two id spaces.** `targets: [dtrpg, itch]` says what to check
  against; `publish: { drivethrurpg: … }` says where to send. They are not
  linked, and the same place has two names.
- **Three orderings of the same pieces.** The CLI's `build`, `publish` and
  `preflight`, the desktop's export, and the desktop's Publish view each
  compose `runBuild`, `executeValidation` and `runPublish` themselves, in
  different orders with different rules. The CLI's `publish` does not build;
  the desktop uploads before it checks.
- **Two per-user stores.** The CLI keeps saved accounts under
  `~/.config/gutterpress`; the desktop under its Electron `userData`,
  encrypted. An account connected in one is unknown to the other. A person's
  own publishing choices are read by the desktop only.
- **Words that exist in one front-end.** Check names, the target list and
  error wording are tables in the desktop; it recognises lib errors by
  matching their text.

## Decision

Publishing is one system in the shared lib. The terminal and the app are two
views of it and hold no publishing rules.

### 1. Each fact has one home

| What | Holds | Lives in |
| --- | --- | --- |
| The book's plan | Which targets, and the team's settings for them | `manifest.yaml`, `publish:` |
| A person's settings | Saved accounts, and their own choices per book | One Gutterpress folder on their computer |
| What a target is | Its file, its rules, how it is delivered | One registry in the lib |

### 2. A target is one definition

A target is a place the book goes. One definition says everything about it:

- **id and label**: `local`, `gdrive`, `itch`, `kdp`, `shopify`, `azure-swa`,
  `drivethrurpg-print`, `drivethrurpg-digital`. An extension's target is
  named by its package.
- **file**: either fixed (`drivethrurpg-print` is PDF/X; `itch` and
  `drivethrurpg-digital` are PDF; `azure-swa` is the website), or a list the
  person picks from (`local` and `gdrive`: PDF, PDF/X or website; `kdp` and
  `shopify`: PDF or PDF/X). The pick is saved and reused.
- **rules** (optional): the config overlay and required checks 0008 gave
  targets. `drivethrurpg-print` carries DriveThruRPG's print policy;
  `itch` and `drivethrurpg-digital` carry the digital-readiness policy. A
  target with no rules is checked against the book's own.
- **settings**: its fields, each marked as the book's or the person's.
- **account**: none, an API key, or a sign-in.
- **tools**: what must be installed to make and check its file.
- **deliver**: how the file gets there. A target with no way to upload, or
  no account connected, reports its file as ready to upload by hand.

The precedence chain is unchanged: **cli > manifest > target > preset**.
Core targets and extension targets use the same definition and the same
registry. An extension declares the data in its `package.json` (so listing
targets never loads code) and exports `deliver` from its entry. Today's
`"gutterpress": { "publish": true }` plugins keep working as targets whose
file is picked.

### 3. The manifest

`publish:` is the one list. A target is on because it is there.

```yaml
publish:
  drivethrurpg-print:
  drivethrurpg-digital:
  itch:
    target: toddward/field-guide
  gdrive:
    format: pdfx
    folder: Gutterpress
```

- One block per target; a target with nothing to set is just its name.
- `format` appears only where the target does not fix its file. One value.
  Left out, it is PDF.
- Nothing about one person or one computer is ever written here.
- No `publish:` key means the preset's default targets (the `dtrpg` preset
  implies `drivethrurpg-print`). `publish: {}` means none. Every creation
  flow writes `publish:` explicitly.
- **Old books keep working.** A manifest with a top-level `targets:` key or
  any `publish.<id>.enabled` key is read with its old meaning: the targets
  are the `targets:` list plus the sections with `enabled: true`. `dtrpg`
  and `drivethrurpg` both read as `drivethrurpg-print`. It is rewritten to
  the new form when a person changes the book's targets in the app; the CLI
  never rewrites a manifest it was not asked to edit.

### 4. A person's settings

One folder (`~/.config/gutterpress`, `%APPDATA%\gutterpress`, or
`GUTTERPRESS_CONFIG_DIR`), read and written by the lib for both views:

- **Saved accounts**, in one file readable only by that user. The desktop
  no longer keeps its own encrypted copy; accounts it already holds are
  moved over once, without overwriting an account already saved there.
  (Accepted cost: keys are no longer encrypted at rest by the OS keychain,
  which the CLI could not use.)
- **Per book** (keyed by the book's path, then the target's name, the same
  shape as `publish:`): which saved account each target uses; a `local`
  folder outside the book; their own Drive folder; and which of the book's
  targets they are sending this time.
- Reading lays the person's values over the book's, by target name. Each
  setting has one home, decided by the setting. `local` is saved whole: with
  its folder inside the book it is the book's; outside, the block is the
  person's.

### 5. One operation

The lib has one publish run. Both views start it and show what it reports.

1. **Plan.** From the chosen targets, work out which files are needed and
   which targets receive each. Targets with the same file spec share a file.
2. **Get the latest**, under the rule the desktop's export uses today (a
   book whose online copy Gutterpress can sync).
3. **Check the source.** Problems that must be fixed stop the run here,
   before the long build.
4. **Render once.** The Chromium render does not depend on the format; the
   PDF and the PDF/X are both made from it.
5. **Make each file once**, into `dist/<slug>/`, named as the CLI names them
   (`<slug>-pdf.pdf`, `<slug>-pdfx.pdf`). A target whose PDF/X spec differs
   from the book's gets a file named for it.
6. **Check each file against each target that receives it.**
7. **Send.** A target whose file fails its rules is held, alone, until the
   person says to send it anyway.

Checks are on by default; one switch skips them, and it is honoured
everywhere. Step names, check names and error explanations come from the
lib, with a stable code, a plain sentence and the original text, so both
views say the same thing and neither matches on wording.

### 6. The two views

| To do this | App | Terminal |
| --- | --- | --- |
| Quick draft PDF | Ctrl+Shift+E | `gutterpress build` |
| Check without sending | Publish, "Check only" | `gutterpress publish --dry-run` |
| Publish everything | Publish | `gutterpress publish` |
| Publish some targets | Tick them | `gutterpress publish itch gdrive` |
| Connect an account | Accounts | `gutterpress publish --connect itch` |

The app's Publish view has three steps: Targets (each card shows its file,
or a format picker), Set up (accounts and settings), Publish (the run, with
progress per file and a result per target). `gutterpress validate` and
`preflight` keep their flags; `--target` accepts the old ids.

## Consequences

- Choosing DriveThruRPG print and itch.io makes one PDF/X and one PDF from
  one render, each checked against its own rules. A print problem holds
  back the print target only.
- A new target is one definition. It then appears in the manifest, the app,
  the terminal and the checks with no other change. A test asserts the two
  views name no target, format or rule.
- Code goes away: the desktop's own export pipeline, account store, copied
  target and label tables, and its matching on error text; the CLI's
  separate preflight path and its lookup of a built file to publish.
- An account connected in either view works in the other.
- The desktop's saved accounts are no longer encrypted by the OS keychain.
- 0008's `targets:` key, its "a target never changes the output", and its
  separate target ids are superseded. Presets, the precedence chain,
  required checks and per-target validation stand.

## Build order

1. Lib: the target registry and the manifest plan (old and new forms).
2. Lib: the shared per-user store and saved accounts, with the one-time move.
3. Lib: the publish run.
4. Terminal, then app, as views of the run; remove what they duplicated.
5. Extension targets; docs; real-app verification.
