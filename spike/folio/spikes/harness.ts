/**
 * Tiny spike harness: named checks, machine-readable results, human output.
 * Every spike in §11 of the proposal is a file that exports `run()` and
 * asserts against real Chromium output — never against expectation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const OUT_DIR = join(import.meta.dir, "..", "out");

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface SpikeResult {
  id: string;
  title: string;
  /** null = informational probe (no go/no-go) */
  verdict: "PASS" | "FAIL" | "INFO";
  checks: Check[];
  notes: string[];
  data?: unknown;
}

export class Spike {
  checks: Check[] = [];
  notes: string[] = [];
  data: Record<string, unknown> = {};

  constructor(
    readonly id: string,
    readonly title: string,
  ) {}

  check(name: string, pass: boolean, detail = ""): boolean {
    this.checks.push({ name, pass, detail });
    const mark = pass ? "  ✓" : "  ✗";
    console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
    return pass;
  }

  eq(name: string, actual: unknown, expected: unknown): boolean {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    return this.check(name, a === e, a === e ? a : `got ${a}, want ${e}`);
  }

  near(name: string, actual: number, expected: number, tol: number): boolean {
    const ok = Math.abs(actual - expected) <= tol;
    return this.check(
      name,
      ok,
      `${actual.toFixed(3)} vs ${expected.toFixed(3)} (±${tol})`,
    );
  }

  note(text: string) {
    this.notes.push(text);
    console.log(`  · ${text}`);
  }

  finish(verdict?: "PASS" | "FAIL" | "INFO"): SpikeResult {
    const v =
      verdict ?? (this.checks.every((c) => c.pass) ? "PASS" : "FAIL");
    const result: SpikeResult = {
      id: this.id,
      title: this.title,
      verdict: v,
      checks: this.checks,
      notes: this.notes,
      data: this.data,
    };
    writeArtifact(join(OUT_DIR, `${this.id}.json`), JSON.stringify(result, null, 2));
    console.log(`\n[${this.id}] ${v} — ${this.title}\n`);
    return result;
  }
}

export function writeArtifact(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data as any);
}

export function banner(text: string) {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}
