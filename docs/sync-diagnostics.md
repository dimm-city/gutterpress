# Diagnosing a failed sync

Sync logs are available through **Previous versions → Technical details**.
Background sync errors also supply that log path to the status pill.

## Collect one complete attempt

After installing a build containing these diagnostics, reproduce the problem
with Sync and copy the log from `starting sync` through `sync complete`, including
any warnings between them. Include the app version shown in the app and whether
this was a manual sync, background sync, or a sync on exit. A reported installer
version alone does not prove which process produced an older log.

Each line carries `run`, the loaded library's `version`, `platform`, and `node`.
Use `run` to group lines when operations overlap. The start and result record
whether pushing was enabled. `elapsedMs` is the total duration, including time
waiting for the repository lock. Stage timestamps locate slower operations.
The full local and fetched commit IDs are recorded at merge/push boundaries.

`sync complete` means the operation returned; its `status` says whether it
succeeded. A `status=error` result is not a successful sync. An attempt without
a result may still be running or may have been interrupted; its last `starting`
line identifies the operation to investigate. Do not infer success from silence.

## Read the failing stage

| Stage | What to investigate |
| --- | --- |
| `repo`, `lock`, `branch`, `transport` | Repository discovery, waiting operations, selected branch, remote configuration |
| `snapshot`, `snapshot-after-fetch` | Saving local changes, index or filesystem errors |
| `fetch` | Connectivity, HTTP status, authentication, downloaded objects |
| `merge`, `merge-base` | Original Git error and its affected paths; common history |
| `read-conflict-blobs` | A required historical file could not be read; inspect the original code and object ID |
| `write-conflict-file`, `delete-conflict-file`, `snapshot-equalized` | Preparing conflicting files while retaining both versions in history |
| `checkout`, `rollback` | Late edits or filesystem failures; whether the branch was restored after checkout refused |
| `restore-conflict-file`, `snapshot-restored` | Restoring kept versions after merge |
| `compare-trees`, `merged-ref` | Reading the resulting commit and its metadata |
| `push` | GitHub/remote rejection, permissions, network failure, or a non-fast-forward race |

Errors include allowlisted Git/OS details: code, caller, stack, file paths,
object/ref IDs, HTTP status, remote rejection details, and up to two nested
causes. Arrays and text are bounded. Credentials in known forms and credentials
resolved for the operation are redacted. Request headers, configuration objects,
and file contents are not dumped. Paths and repository identifiers remain useful
support information; the log is not an anonymous report.

## Avoid misleading conclusions

- `snapshot=none` means this attempt did not create a new snapshot. Older local
  commits may still need uploading.
- A pull-only result can leave local commits waiting for the scheduled push.
  Look for `push=false` and `push deferred`.
- Repeated `sync pass 1/3` entries are separate attempts. Only a non-fast-forward
  push rejection advances the bounded retry loop within one attempt.
- A generic unsupported merge is not evidence of unrelated repositories.
- Successful reads of HEAD and the index do not prove every historical object
  is readable. Keep the original failure, even if the shallow health check passes.

## Fix and verify the identified failure

Preserve the affected local working files and Git history before attempting any
repair. Reproduce the failing stage on a copy of that state, including local-only
commits and nested book folders. Avoid reset, forced checkout/push, or replacing
`.git` as a diagnostic shortcut.

Add a regression that fails against the broken implementation, then validate
that both authors' changes survive and reach the remote. The local smart-HTTP
fixture and injected filesystem errors cover protocol/control-flow behavior;
they do not establish that a Windows installation or real GitHub accepts the
same operation. Confirm the fix on the affected machine, then inspect a full
successful push-enabled result and verify the changes online.

Focused checks:

```sh
bun test packages/cli/src/lib/remote-auth
bun test packages/desktop/tests/platform/auto-sync-orchestrator.test.ts
bun run --cwd packages/cli typecheck
```
