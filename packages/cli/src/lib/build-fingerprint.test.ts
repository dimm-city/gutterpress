import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBuildFingerprint } from "./build-fingerprint";
import { providerFor, listWorkdirChanges, stageChanges } from "./source-provider";
import { PACKAGE_META } from "./version";

// Covers the migration of build-fingerprint's private runCapture() onto
// exec.ts's shared execCapture (arch finding #16) and the shared
// PACKAGE_META import (arch finding #18 / version.ts).
//
// ARCH finding #20: getGitRevision must be backed by isomorphic-git via the
// source-provider layer, NOT a spawn of the system `git` binary (CLAUDE.md
// §7). These tests build a REAL repo with the provider layer's own
// isomorphic-git-backed `initVersionHistory`/`snapshot` (the same fixture
// style as source-provider.test.ts) and assert the fingerprint's
// `sourceRevision` reflects it — a spawn-based implementation would also
// pass the null-degradation tests below, so this file additionally proves
// the positive (real sha + dirty-flag) path.

type SourceRevision = {
  root: string;
  commit: string;
  shortCommit: string;
  dirty: boolean;
} | null;

async function readFingerprint(outPath: string): Promise<{
  tools: Record<string, string | null>;
  sourceRevision: SourceRevision;
}> {
  return JSON.parse(await readFile(outPath, "utf8"));
}

test("writeBuildFingerprint records the real lib version via the shared PACKAGE_META, not 'unknown'", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-"));
  try {
    const outPath = await writeBuildFingerprint({
      command: "build",
      outputDir: dir,
      args: {},
      pdfx: {
        requestedFlavor: null,
        resolvedFlavor: "x1a",
        iccPath: null,
        stripAnnotations: null,
      },
    });

    const payload = JSON.parse(await readFile(outPath, "utf8")) as {
      tools: Record<string, string | null>;
    };

    expect(payload.tools["gutterpress"]).toBe(PACKAGE_META.version);
    expect(payload.tools["gutterpress"]).not.toBe("unknown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeBuildFingerprint degrades to sourceRevision: null for a non-git directory (no system git spawn involved)", async () => {
  // getGitRevision tries [sourceDir, process.cwd()] as candidates, so a
  // naive in-process call here would find THIS repo via the process.cwd()
  // fallback (this test file lives inside gutterpress's own git repo). Run the
  // check in a SUBPROCESS whose cwd is also the non-git temp dir, so neither
  // candidate resolves to a repo — a true test of the graceful-null path.
  const nonGitDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-nogit-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-out-"));
  try {
    const buildFingerprintUrl = new URL("./build-fingerprint.ts", import.meta.url).href;
    const runnerPath = join(nonGitDir, "run-fingerprint.mjs");
    await writeFile(
      runnerPath,
      [
        `import { writeBuildFingerprint } from ${JSON.stringify(buildFingerprintUrl)};`,
        `const outPath = await writeBuildFingerprint({`,
        `  command: "build",`,
        `  outputDir: ${JSON.stringify(outDir)},`,
        `  sourceDir: ${JSON.stringify(nonGitDir)},`,
        `  args: {},`,
        `  pdfx: { requestedFlavor: null, resolvedFlavor: "x1a", iccPath: null, stripAnnotations: null },`,
        `});`,
        `process.stdout.write(outPath);`,
      ].join("\n"),
    );

    const proc = Bun.spawn([process.execPath, runnerPath], {
      cwd: nonGitDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`fingerprint runner subprocess failed (exit ${exitCode}): ${stderr}`);
    }

    const payload = await readFingerprint(stdout.trim());
    expect(payload.sourceRevision).toBeNull();
  } finally {
    await rm(nonGitDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeBuildFingerprint records root/commit/shortCommit/dirty:false for a clean isomorphic-git repo", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-out-"));
  try {
    // Build a real repo entirely via the provider layer's isomorphic-git
    // backend (source-provider.ts) — no system `git` binary involved.
    await writeFile(join(repoDir, "chapter-01.md"), "# Hello\n");
    await providerFor({ type: "local-folder", path: repoDir }).initVersionHistory({
      projectDir: repoDir,
      initialMessage: "Initial snapshot",
    });

    const outPath = await writeBuildFingerprint({
      command: "build",
      outputDir: outDir,
      sourceDir: repoDir,
      args: {},
      pdfx: {
        requestedFlavor: null,
        resolvedFlavor: "x1a",
        iccPath: null,
        stripAnnotations: null,
      },
    });

    const payload = await readFingerprint(outPath);
    const rev = payload.sourceRevision;
    expect(rev).not.toBeNull();
    expect(rev!.root).toBe(repoDir);
    expect(rev!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(rev!.shortCommit).toBe(rev!.commit.slice(0, 7));
    expect(rev!.dirty).toBe(false);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeBuildFingerprint resolves a REAL sourceRevision even with no `git` binary on PATH (proves isomorphic-git, not a spawn)", async () => {
  // The decisive test for arch finding #20: a spawn-based implementation
  // degrades to sourceRevision: null when `git` isn't on PATH (see the old
  // "tolerates a missing git binary" test this replaces). The isomorphic-git
  // implementation must still resolve the real commit — it never shells out.
  const repoDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-nopath-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-out-"));
  try {
    await writeFile(join(repoDir, "chapter-01.md"), "# Hello\n");
    await providerFor({ type: "local-folder", path: repoDir }).initVersionHistory({
      projectDir: repoDir,
      initialMessage: "Initial snapshot",
    });

    const buildFingerprintUrl = new URL("./build-fingerprint.ts", import.meta.url).href;
    // The runner script must live OUTSIDE repoDir — writing it inside would
    // itself be an untracked file in the working tree and falsely flip
    // dirty:true.
    const runnerPath = join(outDir, "run-fingerprint.mjs");
    await writeFile(
      runnerPath,
      [
        `import { writeBuildFingerprint } from ${JSON.stringify(buildFingerprintUrl)};`,
        `const outPath = await writeBuildFingerprint({`,
        `  command: "build",`,
        `  outputDir: ${JSON.stringify(outDir)},`,
        `  sourceDir: ${JSON.stringify(repoDir)},`,
        `  args: {},`,
        `  pdfx: { requestedFlavor: null, resolvedFlavor: "x1a", iccPath: null, stripAnnotations: null },`,
        `});`,
        `process.stdout.write(outPath);`,
      ].join("\n"),
    );

    // Empty PATH: any attempt to spawn "git" (or "gs"/"qpdf") resolves to
    // ENOENT. Keep the other env vars bun itself needs (TMPDIR/HOME) but
    // deliberately drop PATH.
    const proc = Bun.spawn([process.execPath, runnerPath], {
      cwd: repoDir,
      env: { ...process.env, PATH: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`fingerprint runner subprocess failed (exit ${exitCode}): ${stderr}`);
    }

    const payload = await readFingerprint(stdout.trim());
    const rev = payload.sourceRevision;
    expect(rev).not.toBeNull();
    expect(rev!.root).toBe(repoDir);
    expect(rev!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(rev!.dirty).toBe(false);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeBuildFingerprint records dirty:true when the working tree has unsaved changes", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-out-"));
  try {
    await writeFile(join(repoDir, "chapter-01.md"), "# Hello\n");
    await providerFor({ type: "local-folder", path: repoDir }).initVersionHistory({
      projectDir: repoDir,
      initialMessage: "Initial snapshot",
    });
    // Unsaved edit after the snapshot — the working tree now differs from
    // the index, which listWorkdirChanges/hasPendingChanges must catch.
    await writeFile(join(repoDir, "chapter-01.md"), "# Hello\n\nUnsaved.\n");

    const outPath = await writeBuildFingerprint({
      command: "build",
      outputDir: outDir,
      sourceDir: repoDir,
      args: {},
      pdfx: {
        requestedFlavor: null,
        resolvedFlavor: "x1a",
        iccPath: null,
        stripAnnotations: null,
      },
    });

    const payload = await readFingerprint(outPath);
    expect(payload.sourceRevision).not.toBeNull();
    expect(payload.sourceRevision!.dirty).toBe(true);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("writeBuildFingerprint records dirty:true for STAGED-but-uncommitted changes (code-review: not just WORKDIR-vs-STAGE)", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-fingerprint-out-"));
  try {
    await writeFile(join(repoDir, "chapter-01.md"), "# Hello\n");
    await providerFor({ type: "local-folder", path: repoDir }).initVersionHistory({
      projectDir: repoDir,
      initialMessage: "Initial snapshot",
    });
    // Edit AND stage it (like `git add`), so the working tree matches the
    // index but the index differs from HEAD. The old WORKDIR-vs-STAGE-only
    // dirty check reported clean here; hasUncommittedChanges must report dirty.
    await writeFile(join(repoDir, "chapter-01.md"), "# Hello\n\nStaged edit.\n");
    const cache = {};
    await stageChanges(repoDir, await listWorkdirChanges(repoDir, cache), cache);

    const outPath = await writeBuildFingerprint({
      command: "build",
      outputDir: outDir,
      sourceDir: repoDir,
      args: {},
      pdfx: { requestedFlavor: null, resolvedFlavor: "x1a", iccPath: null, stripAnnotations: null },
    });

    const payload = await readFingerprint(outPath);
    expect(payload.sourceRevision).not.toBeNull();
    expect(payload.sourceRevision!.dirty).toBe(true);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});
