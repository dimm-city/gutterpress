const C = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?", f = {
  wordSeparators: C,
  wordSegmenterLocales: []
};
function _(e, n) {
  return e !== void 0 && !/\s/u.test(e) && !n.includes(e);
}
class S {
  _separators;
  _segmenter;
  _cachedLine;
  _cachedWords = [];
  constructor(n) {
    this._separators = new Set(n.wordSeparators), this._segmenter = L(n.wordSegmenterLocales);
  }
  classify(n) {
    return n === void 0 || n === " " || n === "	" ? 1 : this._separators.has(n) ? 2 : 0;
  }
  previousIntlWord(n, i) {
    let t;
    for (const r of this._intlWords(n)) {
      if (r.index > i)
        break;
      t = r;
    }
    return t;
  }
  nextIntlWord(n, i) {
    return this._intlWords(n).find((t) => t.index >= i);
  }
  _intlWords(n) {
    if (!this._segmenter)
      return [];
    if (this._cachedLine === n)
      return this._cachedWords;
    const i = [];
    for (const t of this._segmenter.segment(n))
      t.isWordLike && i.push({ index: t.index, segment: t.segment });
    return this._cachedLine = n, this._cachedWords = i, i;
  }
}
function L(e) {
  if (e.length === 0)
    return;
  const n = [];
  for (const i of e) {
    if (typeof i != "string" || i.length === 0) {
      console.warn("Ignoring invalid editor.wordSegmenterLocales entry", i);
      continue;
    }
    try {
      n.push(...Intl.Segmenter.supportedLocalesOf(i));
    } catch (t) {
      console.warn(`Ignoring invalid editor.wordSegmenterLocales entry: ${i}`, t);
    }
  }
  if (n.length !== 0)
    try {
      return new Intl.Segmenter(n, { granularity: "word" });
    } catch (i) {
      console.warn(`Unable to initialize editor.wordSegmenterLocales: ${n.join(", ")}`, i);
      return;
    }
}
const y = /* @__PURE__ */ new Map();
function W(e) {
  const n = `${e.wordSeparators}/${e.wordSegmenterLocales.join(",")}`;
  let i = y.get(n);
  return i || (i = new S(e), y.set(n, i)), i;
}
function x(e, n, i = f) {
  if (n = p(n, 0, e.length), n === 0)
    return 0;
  let t = e.lastIndexOf(`
`, n - 1) + 1, r = e.indexOf(`
`, n);
  r === -1 && (r = e.length);
  let s = n - t;
  if (s === 0) {
    const a = t - 1;
    t = a <= 0 ? 0 : e.lastIndexOf(`
`, a - 1) + 1, r = a, s = Math.max(0, a - t);
  }
  const l = e.slice(t, r), d = W(i);
  let o = v(l, d, s);
  return o?.type === 1 && o.end - o.start === 1 && o.nextClass === 0 && (o = v(l, d, o.start)), t + (o?.start ?? 0);
}
function E(e, n, i = f) {
  if (n = p(n, 0, e.length), n === e.length)
    return e.length;
  let t = e.lastIndexOf(`
`, n - 1) + 1, r = e.indexOf(`
`, n);
  r === -1 && (r = e.length);
  let s = n - t;
  n === r && r < e.length && (t = r + 1, r = e.indexOf(`
`, t), r === -1 && (r = e.length), s = 0);
  const l = e.slice(t, r), d = W(i);
  let o = O(l, d, s);
  return o?.type === 1 && o.end - o.start === 1 && o.nextClass === 0 && (o = O(l, d, o.end)), t + (o?.end ?? l.length);
}
function A(e, n, i = f) {
  if (n = p(n, 0, e.length), n === 0)
    return 0;
  const t = n === 0 ? 0 : e.lastIndexOf(`
`, n - 1) + 1, r = n - t;
  if (r === 0)
    return n - 1;
  let s = r - 1;
  for (; s >= 0 && (e[t + s] === " " || e[t + s] === "	"); )
    s--;
  if (s + 1 < r - 1)
    return t + s + 1;
  let l = e.indexOf(`
`, n);
  l === -1 && (l = e.length);
  const d = e.slice(t, l), o = v(d, W(i), r);
  return t + (o?.start ?? 0);
}
function D(e, n, i = f) {
  if (n = p(n, 0, e.length), n === e.length)
    return e.length;
  const t = e.lastIndexOf(`
`, n - 1) + 1;
  let r = e.indexOf(`
`, n);
  r === -1 && (r = e.length);
  const s = n - t, l = e.slice(t, r);
  let d = s;
  for (; d < l.length && (l[d] === " " || l[d] === "	"); )
    d++;
  if (s < d)
    return t + d;
  const o = W(i), a = O(l, o, s);
  if (a)
    return t + a.end;
  if (n < r || r === e.length)
    return r;
  const h = r + 1;
  let c = e.indexOf(`
`, h);
  c === -1 && (c = e.length);
  const u = e.slice(h, c), g = O(u, o, 0);
  return h + (g?.start ?? u.length);
}
function R(e, n, i = f) {
  if (n = p(n, 0, e.length), n === e.length)
    return { start: n, end: n };
  const t = e[n];
  if (/\s/u.test(t)) {
    let g = n, m = n + 1;
    for (; g > 0 && /\s/u.test(e[g - 1]); )
      g--;
    for (; m < e.length && /\s/u.test(e[m]); )
      m++;
    return { start: g, end: m };
  }
  const r = e.lastIndexOf(`
`, n - 1) + 1;
  let s = e.indexOf(`
`, n);
  s === -1 && (s = e.length);
  const l = e.slice(r, s), d = n - r, o = W(i), a = o.previousIntlWord(l, d);
  if (a && d < a.index + a.segment.length)
    return {
      start: r + a.index,
      end: r + a.index + a.segment.length
    };
  const h = o.classify(t);
  let c = d, u = d + 1;
  for (; c > 0 && o.classify(l[c - 1]) === h; )
    c--;
  for (; u < l.length && o.classify(l[u]) === h; )
    u++;
  return { start: r + c, end: r + u };
}
function v(e, n, i) {
  let t;
  const r = n.previousIntlWord(e, i - 1);
  for (let s = i - 1; s >= 0; s--) {
    const l = n.classify(e[s]);
    if (r && s === r.index)
      return {
        start: r.index,
        end: r.index + r.segment.length,
        type: 0,
        nextClass: l
      };
    if (l === 0) {
      if (t === 1) {
        const d = s + 1;
        return { start: d, end: w(e, n, t, d), type: t, nextClass: l };
      }
      t = 0;
    } else if (l === 2) {
      if (t === 0) {
        const d = s + 1;
        return { start: d, end: w(e, n, t, d), type: t, nextClass: l };
      }
      t = 1;
    } else if (t !== void 0) {
      const d = s + 1;
      return { start: d, end: w(e, n, t, d), type: t, nextClass: l };
    }
  }
  return t === void 0 ? void 0 : {
    start: 0,
    end: w(e, n, t, 0),
    type: t,
    nextClass: 1
    /* Whitespace */
  };
}
function O(e, n, i) {
  let t;
  const r = n.nextIntlWord(e, i);
  for (let s = i; s < e.length; s++) {
    const l = n.classify(e[s]);
    if (r && s === r.index)
      return {
        start: r.index,
        end: r.index + r.segment.length,
        type: 0,
        nextClass: l
      };
    if (l === 0) {
      if (t === 1) {
        const d = s;
        return { start: I(e, n, t, d - 1), end: d, type: t, nextClass: l };
      }
      t = 0;
    } else if (l === 2) {
      if (t === 0) {
        const d = s;
        return { start: I(e, n, t, d - 1), end: d, type: t, nextClass: l };
      }
      t = 1;
    } else if (t !== void 0) {
      const d = s;
      return { start: I(e, n, t, d - 1), end: d, type: t, nextClass: l };
    }
  }
  return t === void 0 ? void 0 : {
    start: I(e, n, t, e.length - 1),
    end: e.length,
    type: t,
    nextClass: 1
    /* Whitespace */
  };
}
function w(e, n, i, t) {
  const r = n.nextIntlWord(e, t);
  for (let s = t; s < e.length; s++) {
    if (r && s === r.index + r.segment.length)
      return s;
    const l = n.classify(e[s]);
    if (l === 1 || i === 0 && l === 2 || i === 1 && l === 0)
      return s;
  }
  return e.length;
}
function I(e, n, i, t) {
  const r = n.previousIntlWord(e, t);
  for (let s = t; s >= 0; s--) {
    if (r && s === r.index)
      return s;
    const l = n.classify(e[s]);
    if (l === 1 || i === 0 && l === 2 || i === 1 && l === 0)
      return s + 1;
  }
  return 0;
}
function p(e, n, i) {
  return Math.min(Math.max(e, n), i);
}
export {
  f as D,
  E as a,
  A as b,
  D as c,
  R as d,
  C as e,
  x as f,
  _ as i
};
//# sourceMappingURL=config-BGeaJqWk.js.map
