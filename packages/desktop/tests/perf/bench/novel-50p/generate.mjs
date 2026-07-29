#!/usr/bin/env node
/**
 * Deterministic generator for the `novel-50p` perf fixture.
 *
 * Emits the checked-in chapter markdown next to this file. Content is FULLY
 * DETERMINISTIC — a fixed word bank indexed by a seeded integer sequence
 * (NO Math.random) — so re-running produces byte-identical output and the
 * re-render baseline stays reproducible across machines and CI runs.
 *
 * The fixture is TEXT-ONLY (prose paragraphs + headings, no tables/images/
 * plugins) so the re-render latency gate measures pagination cost in
 * isolation. Sized to paginate to ~50 pages under themes/novel/theme.css
 * (8.5x11in, 0.7in margins, ~11pt body).
 *
 * The generated .md files are COMMITTED. This script is kept only so the
 * fixture can be regenerated/retuned deterministically; it is not run by CI.
 *
 *   Usage:  node generate.mjs
 */
import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const CHAPTERS = 10;
const SECTIONS_PER_CHAPTER = 7;
const PARAS_PER_SECTION = 5;
const SENTENCES_PER_PARA = 6;

// A closed word bank. Deterministic selection below keeps prose varied without
// any randomness — the same (chapter, section, para, sentence, word) position
// always yields the same word.
const WORDS = [
  "the", "old", "river", "carried", "a", "quiet", "light", "through", "the",
  "valley", "where", "the", "town", "had", "learned", "to", "wait", "for",
  "morning", "and", "the", "keeper", "of", "the", "bridge", "counted", "each",
  "traveler", "who", "crossed", "before", "the", "bells", "rang", "again",
  "long", "shadows", "fell", "across", "the", "stone", "and", "the", "wind",
  "spoke", "of", "distant", "harbors", "and", "colder", "seasons", "yet",
  "to", "come", "she", "remembered", "the", "letters", "folded", "in", "her",
  "coat", "and", "the", "promise", "made", "beneath", "the", "great", "clock",
  "he", "walked", "slowly", "past", "the", "shuttered", "shops", "and",
  "listened", "for", "the", "sound", "of", "footsteps", "that", "never",
  "arrived", "the", "market", "square", "held", "its", "breath", "as",
  "lanterns", "swayed", "and", "the", "night", "grew", "deep", "around",
  "them", "a", "small", "hope", "remained", "like", "an", "ember", "guarded",
  "against", "the", "rain", "and", "the", "long", "road", "home",
];

/** Deterministic index stream — a simple LCG seeded by position. No Math.random. */
function wordAt(seed) {
  const x = (seed * 1103515245 + 12345) & 0x7fffffff;
  return WORDS[x % WORDS.length];
}

function sentence(seedBase) {
  const len = 8 + (seedBase % 9); // 8..16 words, deterministic
  const words = [];
  for (let i = 0; i < len; i++) words.push(wordAt(seedBase * 131 + i * 17));
  let s = words.join(" ");
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s + ".";
}

function paragraph(seedBase) {
  const sentences = [];
  for (let i = 0; i < SENTENCES_PER_PARA; i++) {
    sentences.push(sentence(seedBase * 1009 + i * 7919));
  }
  return sentences.join(" ");
}

// Remove any previously generated chapter files so a re-tune can't leave stragglers.
for (const f of readdirSync(here)) {
  if (/^\d\d-chapter\.md$/.test(f)) unlinkSync(join(here, f));
}

for (let c = 1; c <= CHAPTERS; c++) {
  const lines = [`# Chapter ${c}`, ""];
  for (let s = 1; s <= SECTIONS_PER_CHAPTER; s++) {
    lines.push(`## Part ${c}.${s}`, "");
    for (let p = 0; p < PARAS_PER_SECTION; p++) {
      lines.push(paragraph((c * 100003 + s * 1009 + p * 31) >>> 0), "");
    }
  }
  const name = `${String(c).padStart(2, "0")}-chapter.md`;
  writeFileSync(join(here, name), lines.join("\n"));
  console.log(`[novel-50p] wrote ${name}`);
}
console.log(`[novel-50p] ${CHAPTERS} chapters generated`);
