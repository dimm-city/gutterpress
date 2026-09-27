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

> **History.** This automation first worked end to end on the 0.10.11
> stable cut: [run 35902797310](https://github.com/dimm-city/gutterpress/actions/runs/35902797310)
> committed `a1a89aa0`, moving all four metadata files to 0.10.11 and
> replacing the winget directory rather than adding a second one beside it.
> Every checksum it wrote matches the release's `SHA256SUMS.txt`. Before
> that, the metadata had not moved since 0.8.3: the commit job's
> `download-artifact` overlaid the previous version's winget directory
> instead of replacing it, so `--check` rejected the tree. #286 regenerated
> 0.10.10's metadata by hand and added the step that clears the generated
> trees before the download; 0.10.11 was the first release to exercise it.

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
