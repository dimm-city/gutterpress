/**
 * What a PDF/X OutputIntent says about its ICC output profile.
 *
 * The OutputIntent names the printing condition the file was separated for
 * (`/OutputConditionIdentifier`), and a PDF/X consumer may check that name
 * against the ICC characterization registry and the embedded profile. The
 * build derives the name from the profile's own description, so the two
 * cannot disagree, and `pdf.print.pdfx-markers` reads both back from the
 * finished file.
 */

/** The printing condition an OutputIntent names for one profile. */
export interface OutputCondition {
  /** `/OutputConditionIdentifier`: the registry name, or the profile's description when it is not a known one */
  identifier: string;
  /** `/OutputCondition`: a readable name for the condition */
  condition: string;
  /** true when `identifier` is a name in the ICC registry (http://www.color.org) */
  registered: boolean;
}

/**
 * Known profiles, keyed by their ICC description. Only profiles whose
 * description and registry name were checked against the file belong here:
 * the shipped `profiles/CGATS21_CRPC1.icc` describes itself as
 * `CGATS21_CRPC1.icc`, and CGATS 21-2 CRPC1's registry name is
 * `CGATS21-2-CRPC1` (`CGATS TR 001` is SWOP's).
 */
const KNOWN: Record<string, Omit<OutputCondition, "registered">> = {
  "CGATS21_CRPC1.icc": {
    identifier: "CGATS21-2-CRPC1",
    condition: "CGATS 21-2 CRPC1 (ISO/PAS 15339-2)",
  },
};

/**
 * The OutputIntent names for a profile description. An unknown profile keeps
 * its own description as the identifier and is not claimed as registered.
 */
export function outputConditionFor(description: string): OutputCondition {
  const known = KNOWN[description];
  return known
    ? { ...known, registered: true }
    : { identifier: description, condition: description, registered: false };
}

/**
 * The description (`desc` tag) of an ICC profile: the v2 `desc`
 * (textDescriptionType, ASCII) or v4 `mluc` (UTF-16BE; the English record,
 * else the first) form. `undefined` when the bytes are not a profile or carry
 * no readable description.
 */
export function iccProfileDescription(bytes: Uint8Array): string | undefined {
  try {
    return readDescription(bytes);
  } catch {
    return undefined;
  }
}

function readDescription(bytes: Uint8Array): string | undefined {
  if (bytes.length < 132) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, n: number) =>
    Buffer.from(bytes.subarray(at, at + n)).toString("latin1").replace(/\0+$/, "");
  if (text(36, 4) !== "acsp") return undefined;
  const count = view.getUint32(128);
  for (let i = 0; i < count; i++) {
    const entry = 132 + 12 * i;
    if (entry + 12 > bytes.length) return undefined;
    if (text(entry, 4) !== "desc") continue;
    const at = view.getUint32(entry + 4);
    const size = view.getUint32(entry + 8);
    if (at + size > bytes.length || size < 12) return undefined;
    const type = text(at, 4);
    if (type === "desc") {
      const n = view.getUint32(at + 8);
      if (12 + n > size) return undefined;
      return text(at + 12, n) || undefined;
    }
    if (type === "mluc") {
      const records = view.getUint32(at + 8);
      if (records < 1 || size < 16 + 12 * records) return undefined;
      const starts = Array.from({ length: records }, (_, r) => at + 16 + 12 * r);
      const record = starts.find((r) => text(r, 2) === "en") ?? starts[0]!;
      const len = view.getUint32(record + 4);
      const from = at + view.getUint32(record + 8);
      if (from + len > at + size) return undefined;
      // UTF-16BE; `Buffer.from` copies, so the swap does not touch the profile.
      return Buffer.from(bytes.subarray(from, from + len)).swap16().toString("utf16le").replace(/\0+$/, "") || undefined;
    }
    return undefined;
  }
  return undefined;
}
