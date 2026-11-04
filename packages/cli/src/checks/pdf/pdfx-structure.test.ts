import { describe, expect, test } from "bun:test";
import {
  getPdfxMetadataIssues,
  getPdfxOutputIntentIssues,
} from "./pdfx-structure";

describe("PDF/X structural inspection", () => {
  test("accepts valid OutputIntent and DOCINFO markers", () => {
    const objects = {
      "1 0 R": {
        "/Type": "/Catalog",
        "/OutputIntents": ["2 0 R"],
      },
      "2 0 R": {
        "/Type": "/OutputIntent",
        "/S": "/GTS_PDFX",
        "/OutputConditionIdentifier": "CGATS21-2-CRPC1",
        "/DestOutputProfile": "3 0 R",
      },
      "3 0 R": {
        "/N": 4,
      },
      "5 0 R": {
        "/GTS_PDFXVersion": "PDF/X-1:2001",
        "/GTS_PDFXConformance": "PDF/X-1a:2001",
        "/Trapped": "/False",
      },
      trailer: {
        "/Root": "1 0 R",
        "/Info": "5 0 R",
      },
    };

    expect(getPdfxOutputIntentIssues(objects)).toEqual([]);
    expect(getPdfxMetadataIssues(objects, "x1a")).toEqual([]);
  });

  test("flags malformed OutputIntent and mismatched DOCINFO", () => {
    const objects = {
      "1 0 R": {
        "/Type": "/Catalog",
        "/OutputIntents": ["2 0 R"],
      },
      "2 0 R": {
        "/Type": "/OutputIntent",
        "/S": "/GTS_PDFX",
        "/DestOutputProfile": "/tmp/profile.icc",
      },
      "5 0 R": {
        "/GTS_PDFXVersion": "PDF/X-3:2002",
      },
      trailer: {
        "/Root": "1 0 R",
        "/Info": "5 0 R",
      },
    };

    expect(getPdfxOutputIntentIssues(objects)).toContain(
      "/DestOutputProfile must be an indirect object reference."
    );
    expect(getPdfxMetadataIssues(objects, "x1a")).toContain(
      "DOCINFO /GTS_PDFXVersion (PDF/X-3:2002) does not match requested x1a."
    );
    expect(getPdfxMetadataIssues(objects, "x1a")).toContain(
      "DOCINFO is missing /GTS_PDFXConformance for PDF/X-1a."
    );
  });

  test("requires an OutputConditionIdentifier, and one that names a known embedded profile's condition", () => {
    const withIdentifier = (identifier?: string) => ({
      "1 0 R": { "/Type": "/Catalog", "/OutputIntents": ["2 0 R"] },
      "2 0 R": {
        "/Type": "/OutputIntent",
        "/S": "/GTS_PDFX",
        ...(identifier ? { "/OutputConditionIdentifier": identifier } : {}),
        "/DestOutputProfile": "3 0 R",
      },
      "3 0 R": { "/N": 4 },
      trailer: { "/Root": "1 0 R" },
    });

    expect(getPdfxOutputIntentIssues(withIdentifier("CGATS21-2-CRPC1"), "CGATS21_CRPC1.icc")).toEqual([]);
    // SWOP's registry name over a CRPC1 profile: the mismatch x1a builds shipped.
    expect(getPdfxOutputIntentIssues(withIdentifier("CGATS TR 001"), "CGATS21_CRPC1.icc")).toEqual([
      "/OutputConditionIdentifier (CGATS TR 001) does not name the embedded profile's printing condition (CGATS21-2-CRPC1).",
    ]);
    // PDF/X requires the identifier whatever the profile is.
    const missing = ["OutputIntent dictionary must include a string /OutputConditionIdentifier."];
    expect(getPdfxOutputIntentIssues(withIdentifier(), "CGATS21_CRPC1.icc")).toEqual(missing);
    expect(getPdfxOutputIntentIssues(withIdentifier(), "Coated FOGRA39 (ISO 12647-2:2004)")).toEqual(missing);
    expect(getPdfxOutputIntentIssues(withIdentifier())).toEqual(missing);
    // A profile without a known registry name cannot have its identifier judged.
    expect(getPdfxOutputIntentIssues(withIdentifier("FOGRA39"), "Coated FOGRA39 (ISO 12647-2:2004)")).toEqual([]);
    expect(getPdfxOutputIntentIssues(withIdentifier("CGATS TR 001"))).toEqual([]);
  });
});
