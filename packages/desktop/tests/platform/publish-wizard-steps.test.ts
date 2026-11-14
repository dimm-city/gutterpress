/**
 * The Publish wizard's step list and path display (src/lib/publish-wizard.ts).
 */
import { expect, test } from "bun:test";
import { displayPath, isCommandLineTip, wizardSteps } from "../../src/lib/publish-wizard";

const kinds = (steps: ReturnType<typeof wizardSteps>) => steps.map((s) => `${s.kind}:${s.label}`);

test("without checks there is no Check step, and the local folder has no step of its own", () => {
  expect(kinds(wizardSteps([], false))).toEqual(["format:Format", "choose:Choose", "finish:Save"]);
});

test("asking for checks adds the Check step just before the last one", () => {
  expect(kinds(wizardSteps([], true))).toEqual(["format:Format", "choose:Choose", "check:Check", "finish:Save"]);
});

test("each online destination gets a setup step, and the last step is Publish", () => {
  const steps = wizardSteps([{ id: "itch", label: "itch.io" }, { id: "drivethrurpg", label: "DriveThruRPG" }], true);
  expect(kinds(steps)).toEqual([
    "format:Format",
    "choose:Choose",
    "setup:itch.io",
    "setup:DriveThruRPG",
    "check:Check",
    "finish:Publish",
  ]);
  expect(steps[2]).toMatchObject({ cardId: "itch" });
});

test("paths inside the book read relative to it; others stay whole", () => {
  expect(displayPath("/books/mine/dist", "/books/mine")).toBe("dist");
  expect(displayPath("/books/mine/dist/My Book.pdf", "/books/mine")).toBe("dist/My Book.pdf");
  expect(displayPath("/books/mine", "/books/mine")).toBe(".");
  expect(displayPath("/elsewhere/out.pdf", "/books/mine")).toBe("/elsewhere/out.pdf");
  expect(displayPath("/books/mine-two/dist", "/books/mine")).toBe("/books/mine-two/dist");
});

test("the command-line tip on DriveThruRPG is recognised; ordinary notes are not", () => {
  expect(isCommandLineTip("drivethrurpg/validate-target")).toBe(true);
  expect(isCommandLineTip("drivethrurpg/title-missing")).toBe(false);
});
