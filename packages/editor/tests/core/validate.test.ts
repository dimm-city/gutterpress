import { describe, expect, test } from "bun:test";
import {
  isDocumentSnapshot,
  isSourceEdit,
  validateDocumentSnapshot,
  validateSourceEdit,
} from "../../src/core/validate.ts";

const VALID_EDIT = { from: 2, to: 5, insert: "xyz", expectedVersion: 3 };
const VALID_SNAPSHOT = { text: "hello", version: 1 };

describe("validateSourceEdit — accepted shapes", () => {
  test("a well-formed SourceEdit validates and echoes the exact fields", () => {
    const result = validateSourceEdit(VALID_EDIT);
    expect(result).toEqual({ valid: true, value: VALID_EDIT });
  });

  test("zero and negative-looking but valid numeric fields (0 is a legitimate offset)", () => {
    const result = validateSourceEdit({ from: 0, to: 0, insert: "", expectedVersion: 0 });
    expect(result.valid).toBe(true);
  });

  test("extra unrelated own keys are ignored, not rejected", () => {
    const result = validateSourceEdit({ ...VALID_EDIT, somethingElse: "ignored" });
    expect(result).toEqual({ valid: true, value: VALID_EDIT });
  });
});

describe("validateSourceEdit — never throws, always returns a typed result", () => {
  for (const bad of [null, undefined, 42, "a string", true, Symbol("x"), () => {}]) {
    test(`non-object input (${String(bad)}) is rejected without throwing`, () => {
      expect(() => validateSourceEdit(bad)).not.toThrow();
      const result = validateSourceEdit(bad);
      expect(result.valid).toBe(false);
    });
  }

  test("an array is rejected, not treated as an object", () => {
    const result = validateSourceEdit([1, 2, 3]);
    expect(result.valid).toBe(false);
  });

  test("missing fields are reported, not silently defaulted", () => {
    const result = validateSourceEdit({ from: 0, to: 1 });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("wrong primitive types per field are all reported", () => {
    const result = validateSourceEdit({
      from: "0",
      to: "1",
      insert: 42,
      expectedVersion: "3",
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.length).toBe(4);
  });

  test("NaN and Infinity numeric fields are rejected", () => {
    const withNaN = validateSourceEdit({ ...VALID_EDIT, from: Number.NaN });
    expect(withNaN.valid).toBe(false);
    const withInfinity = validateSourceEdit({ ...VALID_EDIT, to: Number.POSITIVE_INFINITY });
    expect(withInfinity.valid).toBe(false);
  });
});

describe("validateSourceEdit — prototype-pollution-shaped payloads", () => {
  test("Object.create(null) with valid fields validates without throwing", () => {
    const obj = Object.create(null) as Record<string, unknown>;
    obj.from = 0;
    obj.to = 1;
    obj.insert = "x";
    obj.expectedVersion = 0;
    expect(() => validateSourceEdit(obj)).not.toThrow();
    const result = validateSourceEdit(obj);
    expect(result).toEqual({
      valid: true,
      value: { from: 0, to: 1, insert: "x", expectedVersion: 0 },
    });
  });

  test("a getter on 'from' is rejected as an accessor, never invoked", () => {
    let getterCalls = 0;
    const obj = {
      get from() {
        getterCalls++;
        return 0;
      },
      to: 1,
      insert: "x",
      expectedVersion: 0,
    };
    const result = validateSourceEdit(obj);
    expect(result.valid).toBe(false);
    expect(getterCalls).toBe(0);
  });

  test("a getter on 'expectedVersion' that returns a different value each call is still rejected, not read twice with different results", () => {
    let calls = 0;
    const obj = {
      from: 0,
      to: 1,
      insert: "x",
      get expectedVersion() {
        calls++;
        return calls; // would differ across reads if ever invoked (TOCTOU)
      },
    };
    const result = validateSourceEdit(obj);
    expect(result.valid).toBe(false);
    expect(calls).toBe(0);
  });

  test("a literal '__proto__' own key from JSON.parse is ignored and does not pollute Object.prototype", () => {
    const payload = JSON.parse(
      '{"from":0,"to":1,"insert":"x","expectedVersion":0,"__proto__":{"polluted":true}}',
    ) as unknown;

    // JSON.parse creates "__proto__" as an ordinary own data property, not
    // the exotic setter — confirm the fixture actually exercises that shape.
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);

    const result = validateSourceEdit(payload);
    expect(result).toEqual({
      valid: true,
      value: { from: 0, to: 1, insert: "x", expectedVersion: 0 },
    });

    // The validator never reads or copies unrelated keys, so no shared
    // object was polluted by validating this payload.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
  });

  test("a deeply nested prototype-pollution attempt inside 'insert' is just a string value, not special-cased", () => {
    const payload = JSON.parse(
      '{"from":0,"to":0,"insert":"{\\"__proto__\\":{\\"x\\":1}}","expectedVersion":0}',
    ) as unknown;
    const result = validateSourceEdit(payload);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("unreachable");
    expect(typeof result.value.insert).toBe("string");
  });
});

describe("validateDocumentSnapshot", () => {
  test("a well-formed DocumentSnapshot validates", () => {
    expect(validateDocumentSnapshot(VALID_SNAPSHOT)).toEqual({
      valid: true,
      value: VALID_SNAPSHOT,
    });
  });

  test("non-string text is rejected", () => {
    const result = validateDocumentSnapshot({ text: 42, version: 1 });
    expect(result.valid).toBe(false);
  });

  test("non-object input is rejected without throwing", () => {
    expect(() => validateDocumentSnapshot(null)).not.toThrow();
    expect(validateDocumentSnapshot(null).valid).toBe(false);
  });

  test("a getter on 'text' is rejected, never invoked", () => {
    let calls = 0;
    const obj = {
      get text() {
        calls++;
        return "x";
      },
      version: 1,
    };
    expect(validateDocumentSnapshot(obj).valid).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("isSourceEdit / isDocumentSnapshot — boolean guards mirror the validators", () => {
  test("isSourceEdit agrees with validateSourceEdit", () => {
    expect(isSourceEdit(VALID_EDIT)).toBe(true);
    expect(isSourceEdit({ from: 0 })).toBe(false);
    expect(isSourceEdit(null)).toBe(false);
  });

  test("isDocumentSnapshot agrees with validateDocumentSnapshot", () => {
    expect(isDocumentSnapshot(VALID_SNAPSHOT)).toBe(true);
    expect(isDocumentSnapshot({ text: "x" })).toBe(false);
    expect(isDocumentSnapshot(42)).toBe(false);
  });
});
