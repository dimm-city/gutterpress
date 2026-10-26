# CI policy

Workflows live in [`.github/workflows`](../.github/workflows).
[Gate selection](../tools/ci-scope.mjs) is the authoritative path policy;
unknown paths and unavailable diffs run all gates. Renames count as deletion
and addition. Prose-only changes skip application CI; website documentation
still publishes through Pages.

| Change | Checks |
| --- | --- |
| CLI runtime, templates, or shared dependencies | CLI and consumers; rendering, preview, desktop acceptance |
| CLI tests | CLI build, types and tests; preview smoke for its own tests |
| Desktop | Desktop build, types and tests; acceptance for runtime/integration changes |
| Open Design plugin | Plugin contract tests |
| Example books or rendering fixtures | CLI tests, preview and rendering parity |
| Release metadata/tooling | Distribution-tooling tests and metadata consistency |
| Docker build inputs | Container build |
| Workflow/shared configuration or unknown paths | All gates |

PRs and pushes to integration branches select affected checks. Push validation
is retained because direct pushes are allowed; it also supplies exact-commit
evidence for releases. Superseded CI, Docker checks and debug builds cancel.
A manual CI dispatch runs every gate except base/head PDF comparison, which
requires a PR. Dependency audits run on dependency changes, weekly, or manually.

## Setup and cost controls

- Build, types, unit tests, preview smoke and desktop acceptance share a runner,
  dependency install and CLI build. Each workspace suite runs once.
- Use the Ubuntu 24.04 runner's Chrome and Xvfb. Preview does not download a
  second browser or refresh apt to update an existing X server.
- The PDF tools action caches the complete Ghostscript/qpdf/Poppler package set
  against the exact runner image and action definition. Warm installs use
  `dpkg` offline. Cold downloads have bounded retries/timeouts; cache creation
  completes before tests. Missing tools still fail the existing precondition tests.
- A separate container image is unnecessary for this cache strategy and would
  require maintaining another browser/font environment. Reconsider it if measured
  cold-cache frequency or setup time still dominates.
- Bun cache keys include architecture/version and only the root lockfile, so
  the parity job's second checkout cannot accidentally change the key.
- Release CLI targets build sequentially on one runner. Native desktop packages
  retain their platform runners and share cached Electron packaging tools.
  JavaScript Docker builds use the native build platform for both runtime arches.
- Release artifacts use no recompression and expire after three days; published
  release assets remain available. Site screenshots require the explicit manual
  `screenshots` input. A release link refresh uses committed screenshots.
- Release tests are reused only from successful push CI on the exact commit
  with a successful full-workspace test step. Partial or skipped CI runs do
  not authorize skipping release tests.

## Validate without spending hosted minutes

```sh
node --test tools/ci-scope.test.mjs
actionlint
git diff --check
```

Test changed setup commands locally, including a fresh offline container for
cached PDF tools. Workflow linting cannot prove GitHub cache permissions or
release publishing. Batch changes before pushing; avoid repeated hosted
experiments. When the Actions budget is exhausted, use a `[skip ci]` commit and
leave the PR as a draft with local evidence and the missing hosted validation
listed. Do not mark skipped checks as passed.

## Timing baseline (2026-10-26)

The last 100 runs covered October 24–26: 23 CI runs, 19 Docker checks,
16 preview runs, 12 desktop gates and 5 releases. Representative successful
jobs showed PDF setup at 46 seconds despite a cache hit (27 seconds refreshing
apt), Poppler setup at 78 seconds, and an Xvfb update at 44 seconds.
The latest preview run stalled at browser installation and was cancelled.

Sources: [CI](https://github.com/dimm-city/gutterpress/actions/runs/40345498465),
[desktop](https://github.com/dimm-city/gutterpress/actions/runs/40265988299),
[stalled preview](https://github.com/dimm-city/gutterpress/actions/runs/40347230798).
These are runner timings, not an account billing report. Savings remain
unmeasured until a hosted run is authorized; compare summed job durations and
gate counts, not only workflow wall-clock time.
