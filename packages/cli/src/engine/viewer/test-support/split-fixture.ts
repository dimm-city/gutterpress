/**
 * A small book of `data-gp-split` cards for the measured-split tests: the
 * markup contract the split reads, with the page geometry of a 360x300 sheet
 * (236px of content) so a few blocks overflow it.
 */
const WORDS = "lorem ipsum dolor sit amet consectetur ";

export const words = (n: number): string => WORDS.repeat(n).trim();

export interface CardOpts {
  scope?: string;
  /** flow markup between the tab and the foot */
  body: string;
  id?: string;
}

export function card({ scope = "a", body, id }: CardOpts): string {
  return (
    `<div class="card" data-gp-split=".inner" data-gp-split-scope="${scope}" ` +
    `data-gp-split-cut="cut"${id ? ` id="${id}"` : ""}>` +
    `<template data-gp-split-head><div class="card contd"><div class="tab">CARD ▸</div>` +
    `<div class="inner" data-gp-flow></div></div></template>` +
    `<div class="tab">CARD</div><div class="inner">${body}</div></div>`
  );
}

export const list = (tag: "ul" | "ol", n: number, tag2 = "item"): string =>
  `<${tag}>${Array.from({ length: n }, (_, i) => `<li>${tag2}${i + 1} ${words(6)}</li>`).join("")}</${tag}>`;

export const table = (n: number): string =>
  `<table><thead><tr><th>Roll</th><th>Result</th></tr></thead><tbody>` +
  Array.from({ length: n }, (_, i) => `<tr><td>row${i + 1}</td><td>${words(3)}</td></tr>`).join("") +
  `</tbody></table>`;

export const ladder = (n: number): string =>
  `<div class="ladder" data-gp-split-units=".tier" data-gp-split-repeat=".head"><div class="head">TIERS</div>` +
  Array.from({ length: n }, (_, i) => `<div class="tier">tier${i + 1} ${words(5)}</div>`).join("") +
  `</div>`;

export const para = (label: string, n = 4): string => `<p>${label} ${words(n)}</p>`;

export function bookHtml(cards: string, extra = "", script = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 360px 300px; margin: 32px; }
html { font: 12px/16px sans-serif; }
body { margin: 0; }
section { break-before: page; }
.card { border: 2px solid #000; padding: 6px; margin: 0 0 10px; }
.cut { margin-bottom: 0; border-bottom-style: dashed; }
.tab { font-weight: bold; background: #ddd; padding: 3px; margin-bottom: 6px; }
p, li { margin: 0 0 6px; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #999; padding: 0; }
.tier { border-top: 1px solid #000; padding: 3px; }
${extra}
</style></head><body><main><section>${cards}</section></main>${
    script ? `<script src="gutterpress-viewer.js"></script>` : ""
  }</body></html>`;
}
