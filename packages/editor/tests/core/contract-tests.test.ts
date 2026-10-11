/**
 * Runs the shared `runDocumentHostContractTests` suite
 * (`../../src/core/contract-tests.ts`) against `MemoryDocumentHost`
 * (SFE-P1c, Lane B).
 *
 * `memory-host.test.ts` is untouched by this run and stays green: it is the
 * ORIGINAL, hand-written pin for `MemoryDocumentHost`'s behavior. This file
 * exists to prove the newly-extracted shared suite is a faithful
 * generalization of those same assertions (not a copied, silently-weakened
 * variant) — the SAME suite this file runs also runs against
 * `DesktopDocumentHost` in `packages/desktop/tests/editor/desktop-document-host.test.ts`,
 * which is the actual substitutability proof D7 calls for.
 *
 * This file's coverage therefore PARTIALLY DUPLICATES `memory-host.test.ts`
 * by design and by the run specification — both files stay, both stay
 * green, and neither weakens the other.
 */
import { describe, expect, test } from "bun:test";
import { runDocumentHostContractTests } from "../../src/core/contract-tests.ts";
import { MemoryDocumentHost } from "../../src/core/memory-host.ts";

runDocumentHostContractTests(
  describe,
  test,
  expect,
  (initialText, opts) => new MemoryDocumentHost({ text: initialText, version: 0 }, opts),
);
