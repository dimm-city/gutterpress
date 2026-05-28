# Content Verification — Migration Stage Gate

> **⛔ CONTENT PROTECTION RULE — PRIMARY CONSTRAINT**
> Migration changes markdown **syntax only**. No prose, dialogue, flavor text, ability text, heading text, game mechanics, or any other author-written content may be altered, rewritten, trimmed, paraphrased, or "improved" without explicit user direction. A syntax migration that changes a single word of content is a failure. Run `content-hash.ts verify` before committing any batch.

`content-hash.ts` is a Bun TypeScript script that fingerprints the text content of a rendered HTML file, then detects any prose changes after migration. It is a **hard gate**: exit code 1 means the commit must not happen.

---

## How It Works

The script extracts visible text from the build output HTML:

1. Strips `<style>` and `<script>` blocks
2. Strips paged.js margin-box elements (running headers/footers) so folio text changes don't generate false positives
3. Strips all remaining HTML tags
4. Decodes HTML entities
5. Normalizes whitespace

It then segments the text by heading boundaries (`h1`–`h4`), hashes each segment with MD5, and hashes the entire document text as a fast-fail check.

A **manifest** (JSON) records the document hash, per-section hashes, and metadata. Verification recomputes hashes from the new HTML and compares against the saved manifest.

---

## Workflow: Capture → Migrate → Verify → Commit

### Step 1 — Build and capture a baseline

```sh
# Build the field guide to HTML first
bun print-md build --project dc-op-manual/field-guide/

# Capture the baseline manifest
bun examples/dc-design-guide/docs/field-guide-migration/content-hash.ts \
  capture dc-op-manual/field-guide/book.html \
  -o dc-op-manual/field-guide/content-manifests/full-book.json
```

The manifest is committed alongside the source. It is the contract that this batch's migration must not break.

### Step 2 — Migrate a batch

Apply the syntax changes from `syntax-examples.md` to one chapter or section of the field guide. Only change macro syntax — never touch prose, headings, game mechanics, or ability text.

### Step 3 — Rebuild

```sh
bun print-md build --project dc-op-manual/field-guide/
```

### Step 4 — Verify

```sh
bun examples/dc-design-guide/docs/field-guide-migration/content-hash.ts \
  verify dc-op-manual/field-guide/book.html \
  dc-op-manual/field-guide/content-manifests/full-book.json
```

**Exit 0 — PASS:** No prose changed. Proceed to commit.

**Exit 1 — FAIL:** One or more sections changed. The output names each changed section. Stop, investigate, fix.

### Step 5 — Commit only on PASS

```sh
# Only run this after verify exits 0
git add dc-op-manual/field-guide/ dc-op-manual/field-guide/content-manifests/
git commit -m "migrate(field-guide): chapter-02 syntax — @skill, @lede, alerts"
```

---

## Understanding Failures

### Document hash changed but no section changes found

The changed text falls between the first heading and the top of the document (preamble content, page title area). Check the beginning of the file.

### Section listed as MISSING

A heading that existed in the baseline is absent from the new HTML. Either:
- The heading text was edited (now appears under a different id)
- A section was accidentally deleted

### Section listed as CHANGED

The text content under that heading changed. Common causes during migration:
- A macro was replaced with one that emits different wrapper text
- An entity or special character round-tripped differently
- Whitespace-only changes in the source that changed how the markdown parser wrapped words

Whitespace-only round-trip differences should be investigated: re-check the original and migrated markdown against each other.

### New sections (warnings, not failures)

New sections appear as `+ NEW` in the output and do not fail the gate. They occur when new content sections are added during migration (for example, placeholder blocks that were missing). Verify manually that these are intentional additions and not accidentally duplicated sections.

---

## Comparing Two Manifests Directly

If you want to compare two captured baselines without rebuilding:

```sh
bun content-hash.ts diff baseline-before.json baseline-after.json
```

Useful when reviewing a batch someone else migrated before building yourself.

---

## False Positives to Know About

| Source | Cause | Mitigation |
|---|---|---|
| Running headers/footers | Paged.js injects folio text into the DOM | Stripped by the script automatically |
| Entity normalization | `&mdash;` → `—` in new markdown but `—` literal in old | Ensure source consistency before capturing baseline |
| Heading restructure (intentional) | An h3 becomes an h2 | Re-capture baseline after approved heading changes |
| New content additions | Author adds new sections while migrating | `+ NEW` warnings; verify manually |

---

## Where to Place Manifests

- Per-chapter manifests: `dc-op-manual/field-guide/content-manifests/chapter-XX.json`
- Whole-book manifest: `dc-op-manual/field-guide/content-manifests/full-book.json`
- Commit manifests alongside source so they travel with the branch

Do not commit a baseline that was captured from a build with known content errors — the manifest becomes the contract, so capture it from a clean known-good state.
