import type { DocumentSnapshot, SourceEdit } from "./contracts.ts";

/**
 * Hand-rolled runtime validators for the D3 protocol (NO new dependencies —
 * this package has zero runtime deps by design). D3: "All protocol messages
 * are runtime validated at process/webview boundaries." These validators
 * treat every input as `unknown` and NEVER throw; a malformed message
 * always comes back as a typed `{ valid: false, errors }` result the caller
 * can turn into a diagnostic (see diagnostics.ts).
 *
 * Prototype-pollution defense: every field is read via `ownField` below,
 * which uses `Object.getOwnPropertyDescriptor` — never `obj.field`,
 * `obj[key]`, `for...in`, or a generic spread/merge. That means:
 *   - an object created with `Object.create(null)` validates correctly
 *     (no `.hasOwnProperty` method is ever called on the value itself);
 *   - a literal `"__proto__"` key in a JSON-parsed payload (which
 *     `JSON.parse` creates as an ordinary OWN data property, not the
 *     exotic accessor) is simply ignored, because it is never one of the
 *     four named fields these validators read;
 *   - a getter defined on a named field (e.g. a hostile `get from() {...}`
 *     that could return a different value on every read — a TOCTOU vector)
 *     is detected via the property descriptor and rejected outright, never
 *     invoked.
 * These validators never assign into any object, so there is no path by
 * which validating an adversarial payload could itself pollute
 * `Object.prototype` or any other shared object.
 */

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false; readonly errors: readonly string[] };

/** Sentinel returned by `ownField` when the named property is an accessor. */
const ACCESSOR_PROPERTY: unique symbol = Symbol("editor-validate-accessor-property-rejected");

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  return true;
}

/**
 * Reads an OWN property by exact key via its property descriptor. Returns
 * `undefined` if the key is absent, `ACCESSOR_PROPERTY` if it is a getter/
 * setter (never invoked), or the plain data value otherwise. Works
 * identically on null-prototype objects because it never calls a method ON
 * the value — only static `Object.getOwnPropertyDescriptor`.
 */
function ownField(obj: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) return ACCESSOR_PROPERTY;
  return descriptor.value;
}

function isFiniteNumberField(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates that `message` is shaped like a `SourceEdit` — correct field
 * presence and primitive types. Does NOT re-validate the D3 range rule
 * (`0 <= from <= to <= text.length`); that requires a snapshot to check
 * against and is `applyEdit`'s job (apply-edit.ts), which reports it as
 * `reason: "invalid-range"`. This validator's job is the protocol-boundary
 * shape check that must pass before an edit is even a candidate for
 * `applyEdit`.
 */
export function validateSourceEdit(message: unknown): ValidationResult<SourceEdit> {
  if (!isPlainObject(message)) {
    return { valid: false, errors: ['expected a plain object, got "' + describeType(message) + '"'] };
  }

  const errors: string[] = [];

  const from = ownField(message, "from");
  const to = ownField(message, "to");
  const insert = ownField(message, "insert");
  const expectedVersion = ownField(message, "expectedVersion");

  if (from === ACCESSOR_PROPERTY) errors.push('"from" must be a plain data property, not an accessor');
  else if (!isFiniteNumberField(from)) errors.push('"from" must be a finite number');

  if (to === ACCESSOR_PROPERTY) errors.push('"to" must be a plain data property, not an accessor');
  else if (!isFiniteNumberField(to)) errors.push('"to" must be a finite number');

  if (insert === ACCESSOR_PROPERTY) errors.push('"insert" must be a plain data property, not an accessor');
  else if (typeof insert !== "string") errors.push('"insert" must be a string');

  if (expectedVersion === ACCESSOR_PROPERTY) {
    errors.push('"expectedVersion" must be a plain data property, not an accessor');
  } else if (!isFiniteNumberField(expectedVersion)) {
    errors.push('"expectedVersion" must be a finite number');
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    // Safe: every branch above already proved the correct primitive type
    // for a non-empty `errors` array to have been avoided.
    value: {
      from: from as number,
      to: to as number,
      insert: insert as string,
      expectedVersion: expectedVersion as number,
    },
  };
}

/** Validates that `message` is shaped like a `DocumentSnapshot`. */
export function validateDocumentSnapshot(message: unknown): ValidationResult<DocumentSnapshot> {
  if (!isPlainObject(message)) {
    return { valid: false, errors: ['expected a plain object, got "' + describeType(message) + '"'] };
  }

  const errors: string[] = [];

  const text = ownField(message, "text");
  const version = ownField(message, "version");

  if (text === ACCESSOR_PROPERTY) errors.push('"text" must be a plain data property, not an accessor');
  else if (typeof text !== "string") errors.push('"text" must be a string');

  if (version === ACCESSOR_PROPERTY) errors.push('"version" must be a plain data property, not an accessor');
  else if (!isFiniteNumberField(version)) errors.push('"version" must be a finite number');

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: { text: text as string, version: version as number },
  };
}

export function isSourceEdit(value: unknown): value is SourceEdit {
  return validateSourceEdit(value).valid;
}

export function isDocumentSnapshot(value: unknown): value is DocumentSnapshot {
  return validateDocumentSnapshot(value).valid;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
