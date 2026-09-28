import { describe, expect, test } from "bun:test";
import {
  EDITOR_PROTOCOL_VERSION,
  PROJECTION_SCHEMA_VERSION,
} from "../../src/core/contracts.ts";

describe("D1 protocol/schema version constants", () => {
  test("EDITOR_PROTOCOL_VERSION is 1", () => {
    expect(EDITOR_PROTOCOL_VERSION).toBe(1);
  });

  test("PROJECTION_SCHEMA_VERSION is 1", () => {
    expect(PROJECTION_SCHEMA_VERSION).toBe(1);
  });
});
