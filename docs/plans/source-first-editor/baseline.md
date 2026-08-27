# SFE-P0a Lane A — Execution baseline record

> Lane A deliverable for run `SFE-P0a` (see
> `docs/plans/source-first-editor/runs/SFE-P0a.md`, behavior-table rows
> "Baseline record" and "Deletion-ledger counts"). Every number below carries
> the exact command that produced it, run against this repository, so a later
> run can reproduce or re-derive it (D15: every run records exact commands,
> exit codes, base SHA, head SHA).
>
> **Scope note (read before using any count below):** production code,
> `package.json` manifests, and `bun.lock` are byte-for-byte identical between
> the recorded baseline SHA and this run's HEAD (proven in §1.3). All
> route/IPC/dependency/production-LOC counts below are therefore valid at
> *either* commit and were measured against the current working tree. Test LOC
> is different: the work branch already carries two new characterization test
> files from this run's own Lane B (`git diff --stat` in §1.3). Every test-LOC
> figure in §4 is given **at the baseline SHA** (i.e. excluding this run's own
> additions), with the current-tree (including Lane B's additions) figure
> given alongside for contrast. This is stated explicitly at each such number.

---

## 1. Baseline SHA, work branch, and ancestry proof

### 1.1 Recorded facts

- Baseline `origin/main` SHA: `ea7b60d50340b75b9c58666e5063bcbbbb666576`
  (merge of PR #196, `release/0.10.2`).
- Work branch: `claude/sonnet-opus-agent-workflow-4s81ps`.
- HEAD at the time this document was written: `2cda6b87fd137a1362370456771de222935ce097`.

### 1.2 Ancestry proof

```console
$ git rev-parse HEAD
2cda6b87fd137a1362370456771de222935ce097

$ git rev-parse origin/main
ea7b60d50340b75b9c58666e5063bcbbbb666576

$ git merge-base origin/main HEAD
ea7b60d50340b75b9c58666e5063bcbbbb666576

$ git merge-base --is-ancestor ea7b60d50340b75b9c58666e5063bcbbbb666576 HEAD && echo "YES ancestor"
YES ancestor

$ git log --oneline ea7b60d50340b75b9c58666e5063bcbbbb666576 -1
ea7b60d5 Merge pull request #196 from dimm-city/release/0.10.2
```

`git merge-base origin/main HEAD` returning exactly the baseline SHA proves
the work branch was created *at* that commit (no divergent history predates
it on either side) — this is the D1 "work branch created from the recorded
`origin/main` commit" requirement, verified directly rather than assumed.

### 1.3 Production code is unchanged since the baseline SHA

```console
$ git diff --stat ea7b60d50340b75b9c58666e5063bcbbbb666576..HEAD -- packages/cli/src packages/desktop/src packages/desktop/electron
(no output — zero files changed)

$ git diff --stat ea7b60d50340b75b9c58666e5063bcbbbb666576..HEAD -- package.json packages/cli/package.json packages/desktop/package.json packages/open-design-plugin/package.json bun.lock
(no output — zero files changed)

$ git diff --stat ea7b60d50340b75b9c58666e5063bcbbbb666576..HEAD -- .
 .claude/workflows/sfe-run.js                                          |  464 +++++
 .gitignore                                                            |    3 +-
 .../source-first-editor-enterprise-refactor.md                        | 2081 ++++++++
 docs/plans/source-first-editor/acceptance.md                          |   39 +
 docs/plans/source-first-editor/deletion-ledger.md                     |   50 +
 docs/plans/source-first-editor/mutation-inventory.md                  |  286 +++
 docs/plans/source-first-editor/platform-inventory.md                  |  715 +++++
 docs/plans/source-first-editor/pr158-lessons.md                       | 1517 ++++++
 docs/plans/source-first-editor/runs/SFE-P0a.md                        |  103 +
 docs/plans/source-first-editor/runs/SFE-P0b.md                        |  110 ++
 docs/plans/source-first-editor/runs/SFE-P1a.md                        |  137 ++
 .../tests/editor/inline-edit-controller-characterization.test.ts      |  213 ++
 .../tests/editor/preview-mutation-protocol-characterization.test.ts   |  166 ++
 13 files changed, 5883 insertions(+), 1 deletion(-)
```

Every changed path is plan documentation (`docs/plans/**`), orchestration
tooling outside any published package (`.claude/workflows/sfe-run.js`), a
`.gitignore` rule enabling that tooling to be tracked, or the two new
characterization test files this run's own Lane B added under
`packages/desktop/tests/editor/`. No production source, no manifest, and no
lockfile changed. This is why §3 (dependency inventory), §4's production-LOC
rows, and §5–§8 (routes/IPC/preload) are reported as single figures rather
than "baseline vs. current" pairs — they are the same figure at both commits.

---

## 2. Recorded release-management deviations (ratified in the run spec — not re-litigated here)

The run specification (`docs/plans/source-first-editor/runs/SFE-P0a.md`,
"Recorded baseline facts") already records two release-management deviations
as verified by the integrator before this run began. Per this run's
instructions, their wording is reproduced verbatim below rather than
re-derived or re-argued:

> Work branch: `claude/sonnet-opus-agent-workflow-4s81ps` — **deviation**: the
> plan names `feature/source-first-rich-editor-architecture`; the execution
> harness designates this branch instead. Ancestry holds: the work branch was
> created at exactly the baseline SHA.
>
> **Deviation (release management, non-blocking):** the final `v0.10.2` tag
> has not been pushed (latest tag `v0.10.2-beta.2`; package versions read
> `0.10.2-beta.2`), and `origin/release/0.11.0` does not exist yet. The plan's
> equality precondition is vacuously safe — there is no release branch to
> diverge from and the work branch equals `origin/main` — so execution
> proceeds; release management must create `release/0.11.0` from this
> baseline and cut the final `0.10.2` tag.

These are recorded as-ratified. This run does not re-verify or contest them.

---

## 3. Workspace package graph

Root `package.json`: workspace name `gutterpress`, `"private": true`,
workspaces glob `packages/*`. Root scripts: `cli`, `build` (delegates to
`packages/cli`), `test` (`bun --filter '*' test`), `typecheck`
(`bun --filter '*' typecheck`), `desktop:dev`, `desktop:electron`, `knip`.
Root `devDependencies`: `knip`, `playwright-core` (2).

| Package | `name` | `version` | Private/published | Key scripts |
|---|---|---|---|---|
| `packages/cli` | `gutterpress` | `0.10.2-beta.2` | **Published** (npm; has `bin`/`exports`, no `"private"` field) | `build:library`, `build`, `test` (`bun test`), `typecheck` (`tsc --noEmit`), `typecheck:engine-browser`, `parity:gate` |
| `packages/desktop` | `@dimm-city/gutterpress-desktop` | `0.10.2-beta.2` | `"private": true` | `dev` (`vite dev`), `build`, `test` (`svelte-kit sync` + 3 `.mjs` preview scripts + `bun test --isolate` over 5 dirs), `electron:build`, `electron:dev`, `dist`/`dist:linux`/`dist:win`/`dist:mac`, `check` (svelte-check), `lint`, `typecheck` (`tsc -p electron/tsconfig.json`), `perf-gate`, `rerender-gate` |
| `packages/open-design-plugin` | `@dimm-city/gutterpress-open-design-plugin` | `0.2.0` | `"private": true` | `test` (`bun test`) |

Command: `cat package.json` / `cat packages/{cli,desktop,open-design-plugin}/package.json`.

---

## 4. Measured counts

### 4.1 Desktop HTTP routes

```console
$ find packages/desktop/src/routes/api -name '+server.ts' | wc -l
104
```

Full per-namespace breakdown already produced by Lane C — see
`docs/plans/source-first-editor/platform-inventory.md` §6 (does not need to be
reproduced here; same command, same result, cited rather than duplicated).

### 4.2 `ipcMain` handler registrations

```console
$ grep -rn "ipcMain\.handle(" packages/desktop/electron/
packages/desktop/electron/preload.ts:20: * the SvelteKit SPA. Bump ONLY when an ipcMain.handle() method that the SPA
packages/desktop/electron/main.ts:981:  ipcMain.handle(channel, (event, ...args: Args) => {

$ grep -rn "ipcMain\.on(" packages/desktop/electron/
(no output — 0 hits)

$ grep -rn 'secureHandle(\s*"' packages/desktop/electron/ | wc -l
12
```

The literal `ipcMain.handle(` call site appears exactly **once** in real code
(`main.ts:981`) — it is the definition of `secureHandle`, the sole wrapper
every channel registers through (the other grep hit is a doc comment, not a
call). The practically meaningful "IPC handler count" is the number of
channels registered *through* that wrapper: **12** `secureHandle(...)`
registrations (full per-channel table: `platform-inventory.md` §8). There are
zero raw `ipcMain.on(` registrations anywhere. The deletion-ledger's "IPC
handlers" row (§9 below) uses **12** (registered channels), not 1 (wrapper
call sites), since 1 would never change as channels are added or removed and
would be useless as a deletion metric.

### 4.3 `contextBridge`-exposed method count

```console
$ grep -n "contextBridge.exposeInMainWorld" packages/desktop/electron/preload.ts
102:contextBridge.exposeInMainWorld("electron", {

$ awk '/contextBridge.exposeInMainWorld\("electron", \{/,0' packages/desktop/electron/preload.ts \
    | awk '/^\}\);/{exit} {print}' \
    | grep -cE '^\s{2}[a-zA-Z][a-zA-Z0-9]*:\s'
18
```

**18** top-level members are exposed on `window.electron`: 1 constant
(`apiVersion`), 1 nested object (`updater`, itself exposing 2 methods —
`applyNow`, `onEvent`), and 16 other top-level methods — 18 leaf entries in
total counting `updater`'s two children in place of the `updater` key itself.
Full per-member request/reply-vs-push classification: `platform-inventory.md`
§7 (12 of the 18 are `ipcRenderer.invoke` request/reply wrappers matching the
12 `secureHandle` channels 1:1; 9 are push subscriptions via the shared
`forwardPush` helper, with one channel, `fs:folderChanged`, wrapped twice).

### 4.4 Tracked generated files

Command (exactly as specified by the run):

```console
$ git ls-files | grep -E '(build|out|\.svelte-kit)/|dist/|\.tsbuildinfo$'
.svelte-kit/ambient.d.ts
.svelte-kit/generated/client/app.js
.svelte-kit/generated/client/matchers.js
.svelte-kit/generated/client/nodes/0.js
.svelte-kit/generated/client/nodes/1.js
.svelte-kit/generated/shared/error-template.js
.svelte-kit/tsconfig.json

$ git ls-files | grep -cE '(build|out|\.svelte-kit)/|dist/|\.tsbuildinfo$'
7
```

**Finding:** all 7 hits are a stray `.svelte-kit/` directory tracked at the
**repository root** — not under `packages/desktop/` (where SvelteKit actually
lives and where `.gitignore` correctly excludes `.svelte-kit`; root
`.gitignore` has no such rule). This is pre-existing baseline noise, not
something introduced by this run:

```console
$ git ls-tree -r --name-only ea7b60d50340b75b9c58666e5063bcbbbb666576 \
    | grep -cE '(build|out|\.svelte-kit)/|dist/|\.tsbuildinfo$'
7

$ git log --diff-filter=A --oneline -- .svelte-kit | tail -1
62177220 Require a preset when creating a book (ADR 0008)
```

The 7 files exist at the baseline SHA itself and were added in commit
`6217722` (a pre-plan commit, unrelated to this effort). `packages/cli/dist`
exists in the current working tree from a local build but is **not** tracked
(`git ls-files packages/cli/dist` returns 0 files; the `dist/` pattern above
correctly excludes it) — no false positive there. This root-level
`.svelte-kit/` tracking is exactly the kind of "tracked generated output"
`P0b` Lane A's "Generated and stale artifact hygiene" work is scoped to
remove; it is recorded here as a baseline fact, not fixed by this run (P0a is
docs/tests only — see "Allowed behavior changes: None" in the run spec).

### 4.5 Production LOC

Command pattern exactly as specified: `find <dir> -name '*.ts' -o -name
'*.svelte' -o -name '*.js'`. Because `packages/cli` co-locates its tests as
`*.test.ts` files directly under `src/` (there is no separate `packages/cli/src/__tests__`
tree), the literal `find packages/cli/src -name '*.ts' -o -name '*.svelte' -o
-name '*.js'` command mixes production and test code for that package only.
Both the literal (mixed) figure and the test-excluded (production-only)
figure are given so neither is silently wrong.

```console
# Literal command, packages/cli/src (mixes co-located tests — see note above)
$ find packages/cli/src -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) | wc -l
338
$ find packages/cli/src -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) -print0 | xargs -0 cat | wc -l
83016

# Production-only (excludes *.test.ts / *.spec.ts), packages/cli/src
$ find packages/cli/src -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) \
    ! -name '*.test.ts' ! -name '*.spec.ts' | wc -l
189
$ find packages/cli/src -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) \
    ! -name '*.test.ts' ! -name '*.spec.ts' -print0 | xargs -0 cat | wc -l
45523

# packages/desktop/src (no co-located tests found — 0 *.test.ts/*.spec.ts under src/)
$ find packages/desktop/src -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) | wc -l
237
$ find packages/desktop/src -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) -print0 | xargs -0 cat | wc -l
40145

# packages/desktop/electron (production Electron main+preload; lives outside src/, has no tests)
$ find packages/desktop/electron -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) | wc -l
45
$ find packages/desktop/electron -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) -print0 | xargs -0 cat | wc -l
9191

# packages/open-design-plugin: no src/ directory (it ships Markdown/JSON skill content, not code)
$ find packages/open-design-plugin/src -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) 2>&1
find: 'packages/open-design-plugin/src': No such file or directory
```

| Package | Scope | Files | Lines |
|---|---|---:|---:|
| `gutterpress` (cli) | `src/`, production-only | 189 | 45,523 |
| `@dimm-city/gutterpress-desktop` | `src/` | 237 | 40,145 |
| `@dimm-city/gutterpress-desktop` | `electron/` (outside `src/`, still production) | 45 | 9,191 |
| `@dimm-city/gutterpress-open-design-plugin` | (no `src/`) | 0 | 0 |
| **Total production LOC, strict `src/` only** | | **426** | **85,668** |
| **Total production LOC, workspace-wide (incl. `electron/`)** | | **471** | **94,859** |

### 4.6 Test LOC

Reported **at the baseline SHA** — the current tree (this run's own HEAD)
carries 2 additional files / 379 additional lines under
`packages/desktop/tests/editor/` from this run's own Lane B, proven isolated
in §1.3. Both figures are shown; the deletion-ledger's baseline column (§9)
uses the baseline-SHA figure.

```console
# packages/cli: co-located tests under src/ (*.test.ts / *.spec.ts)
$ find packages/cli/src -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) | wc -l
149
$ find packages/cli/src -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) -print0 | xargs -0 cat | wc -l
37493

# packages/cli: separate tests/ directory (integration/compat harnesses)
$ find packages/cli/tests -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' \) | wc -l
4
$ find packages/cli/tests -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 cat | wc -l
480

# packages/desktop/tests — CURRENT TREE (includes this run's 2 new files)
$ find packages/desktop/tests -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.svelte' \) | wc -l
164
$ find packages/desktop/tests -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.svelte' \) -print0 | xargs -0 cat | wc -l
39103

# packages/desktop/tests — BASELINE SHA (current minus this run's 2 new files, per §1.3's exact diff)
# 164 files - 2 = 162 files; 39103 lines - 379 lines = 38724 lines

# packages/open-design-plugin
$ wc -l packages/open-design-plugin/plugin.test.ts
164 packages/open-design-plugin/plugin.test.ts
```

| Package | Scope | Files (baseline SHA) | Lines (baseline SHA) | Files (current tree) | Lines (current tree) |
|---|---|---:|---:|---:|---:|
| `gutterpress` (cli) | co-located `*.test.ts`/`*.spec.ts` under `src/` | 149 | 37,493 | 149 | 37,493 |
| `gutterpress` (cli) | `tests/` (integration/compat) | 4 | 480 | 4 | 480 |
| `@dimm-city/gutterpress-desktop` | `tests/` | 162 | 38,724 | 164 | 39,103 |
| `@dimm-city/gutterpress-open-design-plugin` | `plugin.test.ts` | 1 | 164 | 1 | 164 |
| **Total** | | **316** | **76,861** | **318** | **77,240** |

(Cross-check: the run's actual test runners report file counts slightly below
these `find`-based totals because some files found here are excluded from
default execution by design — e.g. `packages/cli/tests/compat/*.pw.ts`
[Playwright, opt-in] and `packages/desktop/tests/integration/*.pw.mjs`
[explicitly not CI-gated, documented in `mutation-inventory.md` §4.1]. This is
a file-discovery vs. execution-scope distinction, not a counting error —
`mutation-inventory.md` §6 records `bun run test` executing 151 files in
`packages/cli` and 142 files in `packages/desktop`.)

### 4.7 Production dependency counts

```console
$ node -e "console.log(Object.keys(require('./packages/cli/package.json').dependencies||{}).length)"
28
$ node -e "console.log(Object.keys(require('./packages/cli/package.json').devDependencies||{}).length)"
8
$ node -e "console.log(Object.keys(require('./packages/desktop/package.json').dependencies||{}).length)"
13
$ node -e "console.log(Object.keys(require('./packages/desktop/package.json').devDependencies||{}).length)"
22
$ node -e "const p=require('./packages/open-design-plugin/package.json'); console.log(Object.keys(p.dependencies||{}).length, Object.keys(p.devDependencies||{}).length)"
0 0
$ node -e "console.log(Object.keys(require('./package.json').devDependencies||{}).length)"
2
```

| Package | Production deps | Dev deps |
|---|---:|---:|
| root | 0 | 2 (`knip`, `playwright-core`) |
| `gutterpress` (cli) | 28 | 8 |
| `@dimm-city/gutterpress-desktop` | 13 | 22 |
| `@dimm-city/gutterpress-open-design-plugin` | 0 | 0 |
| **Total (sum, not deduplicated)** | **41** | **32** |

### 4.8 Total lockfile package count

```console
$ awk '/^  "packages": {/{flag=1; next} flag && /^  }/{flag=0} flag' bun.lock | grep -cE '^\s{4}"[^"]+": \['
909

# cross-check
$ bun pm ls --all | wc -l
910   # includes 1 header line for the root workspace project itself
```

Both methods agree: **909** distinct resolved packages in `bun.lock`
(`lockfileVersion: 1`).

---

## 5. `Platform`/`HostServices` method count (cross-referenced)

Per this run's instructions, this figure is cross-referenced from Lane C's
already-committed `docs/plans/source-first-editor/platform-inventory.md`
rather than re-derived:

- `PlatformAdapter` (`packages/cli/src/platform.ts`): **9** members
  (platform-inventory.md §1).
- `HostServices` (`packages/desktop/src/lib/platform/contract.ts`): **21**
  members (platform-inventory.md §2).
- `Platform = Omit<PlatformAdapter, "openFolder"> & HostServices`, plus its
  own `openFolder` override: **30 members total** (platform-inventory.md §2,
  final paragraph).

## 6. Preview mutation protocol message count (cross-referenced)

Cross-referenced from `docs/plans/source-first-editor/mutation-inventory.md`
§1 rather than re-derived:

- **2 commands** (host → book): `beginBlockEdit`, `endBlockEdit`
  (mutation-inventory.md §1.1).
- **3 events** (book → host): `blockEditRequested`, `blockEditFinished`,
  `blockEditStateChanged` (mutation-inventory.md §1.2).
- **5 protocol messages total.**

---

## 7. Commands index (for reproduction at any later SHA)

```sh
# §1.2 ancestry proof
git rev-parse HEAD
git rev-parse origin/main
git merge-base origin/main HEAD
git merge-base --is-ancestor <baseline-sha> HEAD
git log --oneline <baseline-sha> -1

# §1.3 production-code-unchanged proof
git diff --stat <baseline-sha>..HEAD -- packages/cli/src packages/desktop/src packages/desktop/electron
git diff --stat <baseline-sha>..HEAD -- package.json packages/cli/package.json packages/desktop/package.json packages/open-design-plugin/package.json bun.lock
git diff --stat <baseline-sha>..HEAD -- .

# §4.1 desktop route count
find packages/desktop/src/routes/api -name '+server.ts' | wc -l

# §4.2 IPC handler registrations
grep -rn "ipcMain\.handle(" packages/desktop/electron/
grep -rn "ipcMain\.on(" packages/desktop/electron/
grep -rn 'secureHandle(\s*"' packages/desktop/electron/ | wc -l

# §4.3 contextBridge exposed methods
grep -n "contextBridge.exposeInMainWorld" packages/desktop/electron/preload.ts
awk '/contextBridge.exposeInMainWorld\("electron", \{/,0' packages/desktop/electron/preload.ts | awk '/^\}\);/{exit} {print}' | grep -cE '^\s{2}[a-zA-Z][a-zA-Z0-9]*:\s'

# §4.4 tracked generated files
git ls-files | grep -E '(build|out|\.svelte-kit)/|dist/|\.tsbuildinfo$'
git ls-tree -r --name-only <baseline-sha> | grep -cE '(build|out|\.svelte-kit)/|dist/|\.tsbuildinfo$'
git log --diff-filter=A --oneline -- .svelte-kit

# §4.5 production LOC (repeat per package/dir)
find <dir> -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) | wc -l
find <dir> -type f \( -name '*.ts' -o -name '*.svelte' -o -name '*.js' \) -print0 | xargs -0 cat | wc -l

# §4.6 test LOC (repeat per test dir)
find <dir> -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) | wc -l
find <dir> -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.svelte' \) | wc -l
wc -l <file>

# §4.7 dependency counts
node -e "console.log(Object.keys(require('./<pkg>/package.json').dependencies||{}).length)"
node -e "console.log(Object.keys(require('./<pkg>/package.json').devDependencies||{}).length)"

# §4.8 lockfile package count
awk '/^  "packages": {/{flag=1; next} flag && /^  }/{flag=0} flag' bun.lock | grep -cE '^\s{4}"[^"]+": \['
bun pm ls --all | wc -l
```

---

## 8. Verification run for this document

| Command | Exit code | Notes |
|---|---:|---|
| `bun run typecheck` (repo root; `bun --filter '*' typecheck`) | 0 | both `gutterpress` and `@dimm-city/gutterpress-desktop` typecheck scripts pass — confirms this doc-only run left production code, and its typecheck status, untouched |

No production code, test file, or configuration was modified by this Lane A
deliverable — only this file and `docs/plans/source-first-editor/deletion-ledger.md`
(baseline-counts table only) were written, per this run's write-ownership
boundary. There is accordingly no new test suite to run and no package-level
typecheck scoped narrower than the repo-wide command above; the repo-wide
command is the applicable verification for a docs-only change and is recorded
here rather than a package-specific one.

---

## 9. Deletion-ledger baseline values (for cross-reference; ledger itself is authoritative)

| Metric | Baseline value | Source |
|---|---:|---|
| Desktop HTTP routes (`+server.ts`) | 104 | §4.1 |
| IPC handlers (`secureHandle` registrations via the sole `ipcMain.handle` wrapper) | 12 | §4.2 |
| Preview mutation protocol messages | 5 (2 commands + 3 events) | §6 |
| `Platform`/`HostServices` methods | 30 (9 `PlatformAdapter` + 21 `HostServices`, combined with one override) | §5 |
| Production LOC (workspace `src/`, strict) | 426 files / 85,668 lines | §4.5 |
| Production LOC (workspace-wide incl. `electron/`) | 471 files / 94,859 lines | §4.5 |
| Test LOC (baseline SHA) | 316 files / 76,861 lines | §4.6 |
| Dependencies (workspace, prod, summed) | 41 | §4.7 |
| Tracked generated files | 7 (all a stray root-level `.svelte-kit/`, pre-existing at baseline SHA) | §4.4 |
| Total lockfile package count | 909 | §4.8 |

## Addendum — release-management deviations resolved (2026-08-27, post-P1a)

Both deviations recorded in §1 are now resolved or narrowed:

- **`v0.10.2` final tag: RESOLVED.** `origin/main` advanced to `5ec25e5a`
  (`chore: bump version to 0.10.2`) and the `v0.10.2` tag points at it. Net diff
  `ea7b60d5..5ec25e5a` is only the two `package.json` version bumps (the
  intermediate engine-bundle refresh commits reproduced identical bytes).
  The work branch merged `origin/main` at `c0966b55`; all fitness checks and
  typecheck stayed green.
- **`origin/release/0.11.0`: EXISTS, but points at `ea7b60d5`** — the pre-bump
  merge commit, 5 commits behind post-release `main` (`5ec25e5a`). The plan's
  equality precondition (`release/0.11.0` == post-release `main`) is therefore
  still not literally satisfied; release management should fast-forward
  `release/0.11.0` to `5ec25e5a`. Not blocking: the work branch contains
  `origin/main`, so the eventual merge into `release/0.11.0` carries the release
  commits either way.
