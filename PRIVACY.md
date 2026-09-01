# Privacy Policy — Gutterpress

**Effective date:** 2026-09-01

Gutterpress is a desktop application and command-line tool that turns
Markdown into print-ready PDFs. This policy covers the one feature that
involves a third-party account: **publishing to Google Drive**. Every other
part of Gutterpress works entirely on your own computer, on your own files,
and sends nothing anywhere.

## There is no Gutterpress server

Gutterpress — the desktop app and the CLI alike — has no backend server of
any kind. There is no service operated by this project, or by Dimm City,
that your files, your Google account, or your OAuth tokens ever pass
through. When you connect Google Drive, your browser talks directly to
Google's own sign-in pages, and Gutterpress running on your machine talks
directly to Google's own API endpoints (`accounts.google.com`,
`oauth2.googleapis.com`, `www.googleapis.com`). Nothing is relayed,
logged, or stored anywhere except your own computer and your own Google
Drive.

## What Gutterpress can see and do in your Google Drive

Google Drive publishing requests exactly one OAuth scope,
[`drive.file`](https://developers.google.com/identity/protocols/oauth2/scopes#drive),
plus `openid` and `email`. This is Google's deliberately narrow,
non-sensitive access tier:

- **`drive.file` grants access only to files and folders that Gutterpress
  itself creates** — typically a single folder (named "Gutterpress" by
  default, or a name you choose) that Gutterpress creates the first time you
  publish. Gutterpress cannot see, list, read, or modify anything else in
  your Drive: not your other documents, not your other folders, not
  anything a collaborator shared with you. This was verified against a real,
  populated Google account: a folder listing returned exactly the one folder
  Gutterpress had created, nothing else.
- **`openid` and `email` are used only to label the connected account** —
  so Gutterpress can show you "Google Drive — you@example.com" when you have
  more than one account connected. This information is stored alongside
  your credential (see below) and never transmitted anywhere else.
- **What gets uploaded is exactly what you publish**: the finished PDF, or a
  single zip of the HTML export, written to the folder described above.
  Gutterpress does not scan, index, or transmit any other content from your
  project.

## Where your Google credentials are stored

Connecting Google Drive stores one thing locally: a **refresh token**, used
to mint short-lived access tokens on demand. It is never written to your
project folder, never committed to Git, and never leaves your machine except
in requests sent directly to Google's own token endpoint.

- **Desktop app** — encrypted at rest using Electron's `safeStorage`, which
  defers to your operating system's own credential vault (Keychain on
  macOS, DPAPI on Windows, libsecret/kwallet on Linux where available).
- **Command-line tool** — stored in a private file with `0600` permissions
  (readable only by you) inside your user configuration directory, the same
  store used for every other publish provider's credentials.

Access tokens minted from the refresh token live only in memory for the
duration of a single publish, and are never written to disk, logged, or
included in any error message.

## Sharing and visibility

Gutterpress never changes who can see a file it uploads. A file Gutterpress
publishes is visible only to you, exactly like anything else you add to
Drive by hand, unless and until you share it yourself using Drive's own
**Share** button. Gutterpress has no mechanism to grant, change, or remove
sharing permissions on your behalf.

## Revoking access

You can disconnect Google Drive at any time:

- From inside Gutterpress (**Settings → Connections**, or
  `gutterpress publish --provider gdrive --disconnect`), which deletes the
  locally stored refresh token and makes a best-effort request to revoke it
  with Google.
- Directly from your Google Account's
  [Third-party apps & services](https://myaccount.google.com/permissions)
  page, which revokes Gutterpress's access immediately regardless of what
  Gutterpress itself does.

Either way, once revoked, any locally stored token stops working and
Gutterpress can no longer access your Drive until you connect again.

## Other data

Gutterpress does not collect analytics, telemetry, or usage data about your
Google Drive connection, your books, or your project files. There being no
Gutterpress server, there is nowhere for that data to be sent even if it
were collected.

## Changes to this policy

If this policy changes, the update will be published at this same URL with a
new effective date. Material changes affecting how Google account data is
handled will be called out in the project's
[changelog](https://github.com/dimm-city/gutterpress/blob/main/CHANGELOG.md).

## Contact

Gutterpress is open source. Questions, concerns, or reports about this
policy are welcome as an issue at
<https://github.com/dimm-city/gutterpress/issues>.
