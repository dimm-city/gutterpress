import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// A10: every publish provider (itch, drivethrurpg, kdp, azure-swa, shopify)
// has a "publish.<id>" entry in this hand-maintained JSON Schema so authors
// editing manifest.yaml get autocomplete/field descriptions. gdrive was
// missing one. This file has no schema-validation harness (no ajv
// dependency in this package — see CLAUDE.md §1/§3 on keeping the compiled
// binary free of runtime-fs-resolving deps), so this test (a) confirms the
// schema stays valid JSON with a well-formed gdrive entry matching the
// other providers' style, and (b) runs a small structural check — good
// enough for this schema's shape (plain "type"/"properties"/"enum", no
// $ref/oneOf) — confirming a real manifest.yaml's publish.gdrive.* values
// validate against it.

const SCHEMA_PATH = path.join(import.meta.dirname, "manifest.schema.json");

interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  enum?: unknown[];
}

/** Minimal structural validator sufficient for this schema's shape (no
 * $ref/oneOf/anyOf here) — not a general JSON Schema implementation. */
function validate(node: JsonSchemaNode, value: unknown, at: string): string[] {
  const errors: string[] = [];
  if (node.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${at}: expected object`);
      return errors;
    }
    for (const [key, propValue] of Object.entries(value as Record<string, unknown>)) {
      const propSchema = node.properties?.[key];
      if (!propSchema) continue; // additionalProperties not restricted on this object
      errors.push(...validate(propSchema, propValue, `${at}.${key}`));
    }
  } else if (node.type === "string") {
    if (typeof value !== "string") errors.push(`${at}: expected string`);
    else if (node.enum && !node.enum.includes(value)) {
      errors.push(`${at}: "${value}" is not one of ${JSON.stringify(node.enum)}`);
    }
  }
  return errors;
}

test("manifest.schema.json is valid JSON with a gdrive publish entry matching the other providers' style", async () => {
  const raw = await readFile(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(raw) as { properties: { publish: JsonSchemaNode } };

  const publishProps = schema.properties.publish.properties!;
  for (const id of ["itch", "drivethrurpg", "kdp", "azure-swa", "shopify", "gdrive"]) {
    expect(publishProps[id]).toBeDefined();
    expect(publishProps[id]!.type).toBe("object");
  }

  const gdrive = publishProps.gdrive!;
  expect(gdrive.properties?.folder?.type).toBe("string");
  expect(gdrive.properties?.folderId?.type).toBe("string");
  expect(gdrive.properties?.credential?.type).toBe("string");
  expect(gdrive.properties?.format?.type).toBe("string");
  expect(gdrive.properties?.format?.enum).toEqual(["pdf", "html"]);
});

test("a manifest.yaml with publish.gdrive.* fields validates cleanly against the updated schema", async () => {
  const raw = await readFile(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(raw) as { properties: { publish: JsonSchemaNode } };

  const manifestYaml = `
title: My Book
authors: [Author]
publish:
  gdrive:
    folder: My Books
    folderId: "abc123"
    credential: studio
    format: html
`;
  const manifest = parseYaml(manifestYaml) as { publish: { gdrive: unknown } };
  const errors = validate(schema.properties.publish, manifest.publish, "publish");
  expect(errors).toEqual([]);
});

test("an invalid publish.gdrive.format value fails the enum check (sanity check on the validator itself)", async () => {
  const raw = await readFile(SCHEMA_PATH, "utf8");
  const schema = JSON.parse(raw) as { properties: { publish: JsonSchemaNode } };
  const errors = validate(schema.properties.publish, { gdrive: { format: "epub" } }, "publish");
  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0]).toContain("format");
});
