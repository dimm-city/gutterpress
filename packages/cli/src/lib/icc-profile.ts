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
    condition: "CGATS 21-2 CRPC1 (ISO 15339-2)",
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
 * (textDescriptionType, ASCII) or v4 `mluc` (UTF-16BE, first record) form.
 * `undefined` when the bytes are not a profile or carry no description.
 */
export function iccProfileDescription(bytes: Uint8Array): string | undefined {
  if (bytes.length < 132) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...bytes.subarray(at, at + n));
  if (ascii(36, 4) !== "acsp") return undefined;
  const count = view.getUint32(128);
  for (let i = 0; i < count; i++) {
    const entry = 132 + 12 * i;
    if (entry + 12 > bytes.length) return undefined;
    if (ascii(entry, 4) !== "desc") continue;
    const at = view.getUint32(entry + 4);
    const size = view.getUint32(entry + 8);
    if (at + size > bytes.length || size < 12) return undefined;
    const type = ascii(at, 4);
    if (type === "desc") {
      const n = view.getUint32(at + 8);
      if (12 + n > size) return undefined;
      return ascii(at + 12, n).replace(/\0+$/, "") || undefined;
    }
    if (type === "mluc") {
      if (view.getUint32(at + 8) < 1 || size < 28) return undefined;
      const len = view.getUint32(at + 20);
      const from = at + view.getUint32(at + 24);
      if (from + len > at + size) return undefined;
      let text = "";
      for (let j = 0; j + 1 < len; j += 2) text += String.fromCharCode(view.getUint16(from + j));
      return text.replace(/\0+$/, "") || undefined;
    }
    return undefined;
  }
  return undefined;
}
