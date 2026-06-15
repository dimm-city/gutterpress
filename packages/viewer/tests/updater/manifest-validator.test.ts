// ──────────────────────────────────────────────────────────────────────────
// manifest-validator.test.ts — unit tests for manifest-validator.ts
// No electron, no network, no filesystem.
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../electron/updater/manifest-validator.js";

// ── helpers ───────────────────────────────────────────────────────────────

function validInput(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "web-ui-bundle",
    version: "1.2.3",
    requiresDesktopApi: 1,
    releasedAt: "2026-06-04T00:00:00Z",
    assets: {
      bundle: {
        name: "web-ui-bundle.zip",
        sha256: "a".repeat(64),
        size: 12345,
      },
    },
  };
}

// ── valid manifest round-trip ─────────────────────────────────────────────

describe("validateManifest – valid manifest", () => {
  test("accepts a fully-valid manifest and returns the correct shape", () => {
    const input = validInput();
    const result = validateManifest(input);
    expect(result.schemaVersion).toBe(1);
    expect(result.kind).toBe("web-ui-bundle");
    expect(result.version).toBe("1.2.3");
    expect(result.requiresDesktopApi).toBe(1);
    expect(result.releasedAt).toBe("2026-06-04T00:00:00Z");
    expect(result.assets.bundle.name).toBe("web-ui-bundle.zip");
    expect(result.assets.bundle.sha256).toBe("a".repeat(64));
    expect(result.assets.bundle.size).toBe(12345);
  });

  test("round-trips when the sha256 uses 0-9 and a-f only", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      sha256: "0123456789abcdef".repeat(4), // 64 chars, all valid hex chars
    };
    const result = validateManifest(input);
    expect(result.assets.bundle.sha256).toBe("0123456789abcdef".repeat(4));
  });

  test("requiresDesktopApi of 5 is accepted", () => {
    const input = { ...validInput(), requiresDesktopApi: 5 };
    const result = validateManifest(input);
    expect(result.requiresDesktopApi).toBe(5);
  });

  test("size of 0 is accepted", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      size: 0,
    };
    const result = validateManifest(input);
    expect(result.assets.bundle.size).toBe(0);
  });
});

// ── reject bad kind ───────────────────────────────────────────────────────

describe("validateManifest – bad kind", () => {
  test("throws when kind is missing", () => {
    const input = validInput();
    delete input["kind"];
    expect(() => validateManifest(input)).toThrow(/kind/);
  });

  test("throws when kind is wrong string", () => {
    const input = { ...validInput(), kind: "installer-bundle" };
    expect(() => validateManifest(input)).toThrow(/kind/);
  });

  test("throws when kind is a number", () => {
    const input = { ...validInput(), kind: 42 };
    expect(() => validateManifest(input)).toThrow(/kind/);
  });
});

// ── reject bad schemaVersion ──────────────────────────────────────────────

describe("validateManifest – bad schemaVersion", () => {
  test("throws when schemaVersion is 2", () => {
    const input = { ...validInput(), schemaVersion: 2 };
    expect(() => validateManifest(input)).toThrow(/schemaVersion/);
  });

  test("throws when schemaVersion is 0", () => {
    const input = { ...validInput(), schemaVersion: 0 };
    expect(() => validateManifest(input)).toThrow(/schemaVersion/);
  });

  test("throws when schemaVersion is missing", () => {
    const input = validInput();
    delete input["schemaVersion"];
    expect(() => validateManifest(input)).toThrow(/schemaVersion/);
  });

  test("throws when schemaVersion is a string", () => {
    const input = { ...validInput(), schemaVersion: "1" };
    expect(() => validateManifest(input)).toThrow(/schemaVersion/);
  });
});

// ── reject missing/bad version ────────────────────────────────────────────

describe("validateManifest – bad version", () => {
  test("throws when version is missing", () => {
    const input = validInput();
    delete input["version"];
    expect(() => validateManifest(input)).toThrow(/version/);
  });

  test("throws when version is empty string", () => {
    const input = { ...validInput(), version: "" };
    expect(() => validateManifest(input)).toThrow(/version/);
  });

  test("throws when version is whitespace only", () => {
    const input = { ...validInput(), version: "   " };
    expect(() => validateManifest(input)).toThrow(/version/);
  });

  test("throws when version is a number", () => {
    const input = { ...validInput(), version: 123 };
    expect(() => validateManifest(input)).toThrow(/version/);
  });
});

// ── reject non-hex sha256 ─────────────────────────────────────────────────

describe("validateManifest – bad sha256", () => {
  test("throws when sha256 has uppercase letters", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      sha256: "A".repeat(64), // uppercase not allowed
    };
    expect(() => validateManifest(input)).toThrow(/sha256/);
  });

  test("throws when sha256 is only 63 characters", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      sha256: "a".repeat(63),
    };
    expect(() => validateManifest(input)).toThrow(/sha256/);
  });

  test("throws when sha256 is 65 characters", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      sha256: "a".repeat(65),
    };
    expect(() => validateManifest(input)).toThrow(/sha256/);
  });

  test("throws when sha256 contains non-hex characters", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      sha256: "g".repeat(64), // 'g' is not hex
    };
    expect(() => validateManifest(input)).toThrow(/sha256/);
  });

  test("throws when sha256 is missing", () => {
    const input = validInput();
    const bundle = { ...(input["assets"] as Record<string, unknown>)["bundle"] as object } as Record<string, unknown>;
    delete bundle["sha256"];
    (input["assets"] as Record<string, unknown>)["bundle"] = bundle;
    expect(() => validateManifest(input)).toThrow(/sha256/);
  });
});

// ── reject missing assets.bundle ─────────────────────────────────────────

describe("validateManifest – missing assets.bundle", () => {
  test("throws when assets is missing", () => {
    const input = validInput();
    delete input["assets"];
    expect(() => validateManifest(input)).toThrow(/assets/);
  });

  test("throws when assets.bundle is missing", () => {
    const input = { ...validInput(), assets: {} };
    expect(() => validateManifest(input)).toThrow(/bundle/);
  });

  test("throws when assets.bundle is null", () => {
    const input = { ...validInput(), assets: { bundle: null } };
    expect(() => validateManifest(input)).toThrow(/bundle/);
  });

  test("throws when assets is an array", () => {
    const input = { ...validInput(), assets: [] };
    expect(() => validateManifest(input)).toThrow(/assets/);
  });
});

// ── reject bad assets.bundle.name ────────────────────────────────────────

describe("validateManifest – bad bundle name", () => {
  test("throws when bundle name is empty", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      name: "",
    };
    expect(() => validateManifest(input)).toThrow(/name/);
  });

  test("throws when bundle name is missing", () => {
    const input = validInput();
    const bundle = { ...(input["assets"] as Record<string, unknown>)["bundle"] as object } as Record<string, unknown>;
    delete bundle["name"];
    (input["assets"] as Record<string, unknown>)["bundle"] = bundle;
    expect(() => validateManifest(input)).toThrow(/name/);
  });
});

// ── reject bad requiresDesktopApi ────────────────────────────────────────

describe("validateManifest – bad requiresDesktopApi", () => {
  test("throws when requiresDesktopApi is 0", () => {
    const input = { ...validInput(), requiresDesktopApi: 0 };
    expect(() => validateManifest(input)).toThrow(/requiresDesktopApi/);
  });

  test("throws when requiresDesktopApi is missing", () => {
    const input = validInput();
    delete input["requiresDesktopApi"];
    expect(() => validateManifest(input)).toThrow(/requiresDesktopApi/);
  });

  test("throws when requiresDesktopApi is a float", () => {
    const input = { ...validInput(), requiresDesktopApi: 1.5 };
    expect(() => validateManifest(input)).toThrow(/requiresDesktopApi/);
  });

  test("throws when requiresDesktopApi is a string", () => {
    const input = { ...validInput(), requiresDesktopApi: "1" };
    expect(() => validateManifest(input)).toThrow(/requiresDesktopApi/);
  });
});

// ── reject bad releasedAt ─────────────────────────────────────────────────

describe("validateManifest – bad releasedAt", () => {
  test("throws when releasedAt is missing", () => {
    const input = validInput();
    delete input["releasedAt"];
    expect(() => validateManifest(input)).toThrow(/releasedAt/);
  });

  test("throws when releasedAt is empty string", () => {
    const input = { ...validInput(), releasedAt: "" };
    expect(() => validateManifest(input)).toThrow(/releasedAt/);
  });
});

// ── top-level type guards ─────────────────────────────────────────────────

describe("validateManifest – top-level type guards", () => {
  test("throws for null input", () => {
    expect(() => validateManifest(null)).toThrow();
  });

  test("throws for array input", () => {
    expect(() => validateManifest([])).toThrow();
  });

  test("throws for string input", () => {
    expect(() => validateManifest("string")).toThrow();
  });

  test("throws for number input", () => {
    expect(() => validateManifest(42)).toThrow();
  });
});

// ── bundle size validation ────────────────────────────────────────────────

describe("validateManifest – bundle size", () => {
  test("throws when size is negative", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      size: -1,
    };
    expect(() => validateManifest(input)).toThrow(/size/);
  });

  test("throws when size is a float", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      size: 1.5,
    };
    expect(() => validateManifest(input)).toThrow(/size/);
  });

  test("throws when size is a string", () => {
    const input = validInput();
    (input["assets"] as Record<string, unknown>)["bundle"] = {
      ...(input["assets"] as Record<string, unknown>)["bundle"] as object,
      size: "1000",
    };
    expect(() => validateManifest(input)).toThrow(/size/);
  });
});
