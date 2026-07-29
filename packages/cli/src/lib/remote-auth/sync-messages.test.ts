/**
 * Guard for sync-messages.ts wording.
 *
 * The desktop's Advanced Setup dialog sanitizes every displayed message with
 * /https?:\/\/\S+/g → "(address hidden)" to keep remote URLs out of the UI.
 * A message that embeds a literal scheme token — e.g. "(http://)" — matches
 * that regex and renders as broken text ("… isn't secure ((address hidden) …").
 * So: author copy may say "https", never "http://" or "https://".
 */
import { test, expect } from "bun:test";

import * as messages from "./sync-messages";

const URL_SHAPED = /https?:\/\/\S+/;

test("no sync message contains a URL-shaped token (the desktop sanitizer would redact it)", () => {
  const offenders = Object.entries(messages)
    .filter(([, value]) => typeof value === "string" && URL_SHAPED.test(value))
    .map(([name]) => name);
  expect(offenders).toEqual([]);
});
