import { expect } from "bun:test";
import type { EditorCommand } from "../../../src/core/commands.ts";
import { MemoryDocumentHost } from "../../../src/core/memory-host.ts";
import { applyCommand, type CommandSelection } from "../../../src/web/standard/index.ts";

/**
 * Applies `command` at `selection` against a FRESH `MemoryDocumentHost`
 * seeded with `text` — the real accepted-edit path (`applyCommand` ->
 * `host.applyEdit`), not just constructing an edit and inspecting it in
 * isolation. Asserts the command was neither refused nor rejected by the
 * host (a version mismatch here would mean `applyCommand` computed
 * `expectedVersion` wrong), then returns the resulting text.
 */
export function applyViaHost(text: string, selection: CommandSelection, command: EditorCommand): string {
  const host = new MemoryDocumentHost({ text, version: 0 });
  const result = applyCommand(host.getSnapshot(), selection, command);
  if ("refused" in result) {
    throw new Error(`applyCommand refused unexpectedly: ${JSON.stringify(result.refused)}`);
  }
  const applied = host.applyEdit(result.edit);
  expect(applied.ok).toBe(true);
  return host.getSnapshot().text;
}
