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
        "/DestOutputProfile": "3 0 R",
      },
      "3 0 R": {
        "/N": 4,
      },
      "5 0 R": {
        "/GTS_PDFXVersion": "PDF/X-1:2001",
        "/GTS_PDFXConformance": "PDF/X-1a:2001",
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
});
