import { test, expect } from "bun:test";
import { normalizeImageSrc } from "./images";

test("normalizeImageSrc normalizes the intended images/ prefixes", () => {
  expect(normalizeImageSrc("./images/a.png")).toBe("images/a.png");
  expect(normalizeImageSrc("/images/a.png")).toBe("images/a.png");
  expect(normalizeImageSrc("images/a.png")).toBe("images/a.png");
});

test("normalizeImageSrc normalizes the intended temp/images/ prefixes", () => {
  expect(normalizeImageSrc("./temp/images/a.png")).toBe("images/a.png");
  expect(normalizeImageSrc("/temp/images/a.png")).toBe("images/a.png");
  expect(normalizeImageSrc("temp/images/a.png")).toBe("images/a.png");
});

test("normalizeImageSrc leaves a literal hidden '.images' directory unchanged", () => {
  expect(normalizeImageSrc(".images/icon.png")).toBe(".images/icon.png");
});

test("normalizeImageSrc leaves a literal hidden '.temp/images' directory unchanged", () => {
  expect(normalizeImageSrc(".temp/images/icon.png")).toBe(".temp/images/icon.png");
});

test("normalizeImageSrc leaves unrelated paths unchanged", () => {
  expect(normalizeImageSrc("assets/a.png")).toBe("assets/a.png");
  expect(normalizeImageSrc("https://example.com/img.png")).toBe(
    "https://example.com/img.png"
  );
});
