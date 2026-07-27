# Package-manager metadata

`Formula/print-md.rb`, `bucket/print-md.json`, and the files under
`packaging/winget/` are generated from `packaging/package-manager-assets.json`.
Do not update their versions or hashes independently.

After a stable GitHub release is published, `release.yml` dispatches
`.github/workflows/package-managers.yml`. That workflow downloads the release's
attached `SHA256SUMS.txt`, regenerates all metadata, verifies it, and commits the
result to the default branch only after real Homebrew and Scoop installs have
downloaded, hash-checked, installed, and executed the published CLI binaries.
It can be manually re-run for an existing stable release without republishing
that release.

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

The `v0.8.3` source metadata retains that release's historical versioned
Windows viewer installer basename because published release assets are
immutable. Every newly generated release requires
`print-md-viewer-setup-win-x64.exe`; its winget URL remains scoped to the
versioned `v<version>` release tag.
