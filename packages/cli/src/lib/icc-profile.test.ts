import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { getAssetPath } from "./embedded-assets";
import { iccProfileDescription, outputConditionFor } from "./icc-profile";

/** A minimal profile header and tag table with one `desc` tag of the given bytes. */
function profileWith(desc: Uint8Array): Uint8Array {
  const at = 144;
  const bytes = new Uint8Array(at + desc.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("acsp"), 36);
  view.setUint32(128, 1);
  bytes.set(new TextEncoder().encode("desc"), 132);
  view.setUint32(136, at);
  view.setUint32(140, desc.length);
  bytes.set(desc, at);
  return bytes;
}

test("reads the shipped CRPC1 profile's (ICC v4, mluc) description", async () => {
  const bytes = await readFile(await getAssetPath("profiles/CGATS21_CRPC1.icc"));
  expect(iccProfileDescription(bytes)).toBe("CGATS21_CRPC1.icc");
});

test("reads an ICC v2 textDescriptionType description", () => {
  const text = "Coated Press\0";
  const desc = new Uint8Array(12 + text.length);
  desc.set(new TextEncoder().encode("desc"), 0);
  new DataView(desc.buffer).setUint32(8, text.length);
  desc.set(new TextEncoder().encode(text), 12);
  expect(iccProfileDescription(profileWith(desc))).toBe("Coated Press");
});

test("bytes that are not a profile have no description", () => {
  expect(iccProfileDescription(new TextEncoder().encode("not-a-real-icc"))).toBeUndefined();
  expect(iccProfileDescription(new Uint8Array(200))).toBeUndefined();
});

test("the shipped profile maps to CGATS 21-2 CRPC1's registry name; an unknown one keeps its description", () => {
  expect(outputConditionFor("CGATS21_CRPC1.icc")).toEqual({
    identifier: "CGATS21-2-CRPC1",
    condition: "CGATS 21-2 CRPC1 (ISO 15339-2)",
    registered: true,
  });
  expect(outputConditionFor("My Press")).toEqual({
    identifier: "My Press",
    condition: "My Press",
    registered: false,
  });
});
