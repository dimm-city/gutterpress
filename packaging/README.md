# Package-manager metadata

`Formula/gutterpress.rb`, `bucket/gutterpress.json`, and the files under
`packaging/winget/` are generated from `packaging/package-manager-assets.json`.
Do not update their versions or hashes independently.

After a stable GitHub release is published, `release.yml` dispatches
`.github/workflows/package-managers.yml`. That workflow downloads the release's
attached `SHA256SUMS.txt`, regenerates all metadata, verifies it, and commits the
result to the default branch only after real Homebrew and Scoop installs have
downloaded, hash-checked, installed, and executed the published CLI binaries.
It can be manually re-run for an existing stable release without republishing
that release.

> **Known gap (as of 0.10.10).** The committed metadata is current —
> `Formula/gutterpress.rb`, `bucket/gutterpress.json`,
> `packaging/package-manager-assets.json` and the `packaging/winget/`
> manifests all read 0.10.10 — but it got there by hand, not by automation:
> #286 regenerated it from the published v0.10.10 `SHA256SUMS.txt` after it
> had sat at 0.8.3 for eleven stable releases. #286 also identified why the
> workflow failed (the commit job's `download-artifact` overlays onto the
> previous version's winget directory instead of replacing it, so `--check`
> rejected the result) and added a step that clears the generated trees
> before the download. No release has exercised that fix yet, so the
> end-to-end dispatch has still never been observed working. Do not assume
> this automation is working; verify a run actually completed and its commit
> landed before relying on it.

Local verification is dependency-free:

```sh
node tools/update-package-managers.test.mjs
node tools/update-package-managers.mjs --check
```

To regenerate from a downloaded stable-release checksum file:

```sh
node tools/update-package-managers.mjs --update 1.2.3 /path/to/SHA256SUMS.txt
```

The repository itself is a working Homebrew tap and Scoop bucket. The winget
file is submission-ready metadata only: making it available through `winget
install` requires a pull request to the external
[`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) community
repository. No repository-scoped GitHub token can submit that pull request, so
the workflow does not pretend to automate it or require an undeclared secret.

All generated metadata targets the clean-break Gutterpress release assets,
including the stable `Gutterpress-setup-win-x64.exe` installer basename.
