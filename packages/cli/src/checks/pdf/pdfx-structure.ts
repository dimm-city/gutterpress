type PdfxFlavor = "x1a" | "x3";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRef(value: unknown): value is string {
  return typeof value === "string" && /^\d+\s+\d+\s+R$/.test(value);
}

function getObjectsRoot(doc: unknown): JsonObject | null {
  if (!isObject(doc)) return null;
  const objects = doc.objects;
  return isObject(objects) ? objects : null;
}

function resolveRef(objects: JsonObject, ref: unknown): JsonObject | null {
  if (!isRef(ref)) return null;
  const resolved = objects[ref];
  return isObject(resolved) ? resolved : null;
}

function resolveDict(objects: JsonObject, value: unknown): JsonObject | null {
  if (isObject(value)) return value;
  return resolveRef(objects, value);
}

function getCatalog(objects: JsonObject): JsonObject | null {
  const trailer = objects.trailer;
  if (!isObject(trailer)) return null;
  return resolveRef(objects, trailer["/Root"]);
}

function getInfoDict(objects: JsonObject): JsonObject | null {
  const trailer = objects.trailer;
  if (!isObject(trailer)) return null;
  return resolveRef(objects, trailer["/Info"]);
}

function expectedVersionMarkers(flavor: PdfxFlavor): string[] {
  if (flavor === "x3") return ["PDF/X-3"];
  return ["PDF/X-1a", "PDF/X-1"];
}

export function parseQpdfObjectsJson(stdout: string): JsonObject | null {
  try {
    return getObjectsRoot(JSON.parse(stdout));
  } catch {
    return null;
  }
}

export function getPdfxOutputIntentIssues(objects: JsonObject): string[] {
  const issues: string[] = [];
  const catalog = getCatalog(objects);

  if (!catalog) {
    issues.push("Unable to resolve Catalog object from trailer /Root.");
    return issues;
  }

  const outputIntents = catalog["/OutputIntents"];
  if (!Array.isArray(outputIntents) || outputIntents.length === 0) {
    issues.push("Catalog is missing a non-empty /OutputIntents array.");
    return issues;
  }

  const intentDict = outputIntents
    .map((intent) => resolveDict(objects, intent))
    .find((intent): intent is JsonObject => Boolean(intent));

  if (!intentDict) {
    issues.push("Catalog /OutputIntents entries do not resolve to dictionaries.");
    return issues;
  }

  if (intentDict["/Type"] !== "/OutputIntent") {
    issues.push("OutputIntent dictionary must include /Type /OutputIntent.");
  }

  if (intentDict["/S"] !== "/GTS_PDFX") {
    issues.push("OutputIntent dictionary must include /S /GTS_PDFX.");
  }

  const destOutputProfile = intentDict["/DestOutputProfile"];
  if (!isRef(destOutputProfile)) {
    issues.push("/DestOutputProfile must be an indirect object reference.");
  } else if (!resolveRef(objects, destOutputProfile)) {
    issues.push("/DestOutputProfile reference does not resolve to an object.");
  }

  return issues;
}

export function getPdfxMetadataIssues(
  objects: JsonObject,
  flavor: PdfxFlavor
): string[] {
  const issues: string[] = [];
  const info = getInfoDict(objects);

  if (!info) {
    issues.push("Trailer /Info dictionary is missing; PDF/X DOCINFO markers unavailable.");
    return issues;
  }

  const version = info["/GTS_PDFXVersion"];
  if (typeof version !== "string" || version.length === 0) {
    issues.push("DOCINFO is missing /GTS_PDFXVersion.");
  } else if (!expectedVersionMarkers(flavor).some((marker) => version.includes(marker))) {
    issues.push(`DOCINFO /GTS_PDFXVersion (${version}) does not match requested ${flavor}.`);
  }

  if (flavor === "x1a") {
    const conformance = info["/GTS_PDFXConformance"];
    if (typeof conformance !== "string" || conformance.length === 0) {
      issues.push("DOCINFO is missing /GTS_PDFXConformance for PDF/X-1a.");
    } else if (!conformance.includes("PDF/X-1a")) {
      issues.push(
        `DOCINFO /GTS_PDFXConformance (${conformance}) does not match requested x1a.`
      );
    }
  }

  const trapped = info["/Trapped"];
  if (trapped !== "/True" && trapped !== "/False" && trapped !== "/Unknown") {
    issues.push("DOCINFO is missing /Trapped (required for PDF/X conformance).");
  }

  return issues;
}
