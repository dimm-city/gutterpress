class s {
  constructor(e, t) {
    if (this.start = e, this.endExclusive = t, e > t)
      throw new Error(`Invalid range: [${e}, ${t})`);
  }
  static fromTo(e, t) {
    return new s(e, t);
  }
  static ofLength(e) {
    return new s(0, e);
  }
  static ofStartAndLength(e, t) {
    return new s(e, e + t);
  }
  static emptyAt(e) {
    return new s(e, e);
  }
  get isEmpty() {
    return this.start === this.endExclusive;
  }
  get length() {
    return this.endExclusive - this.start;
  }
  delta(e) {
    return new s(this.start + e, this.endExclusive + e);
  }
  deltaStart(e) {
    return new s(this.start + e, this.endExclusive);
  }
  deltaEnd(e) {
    return new s(this.start, this.endExclusive + e);
  }
  contains(e) {
    return this.start <= e && e < this.endExclusive;
  }
  containsRange(e) {
    return this.start <= e.start && e.endExclusive <= this.endExclusive;
  }
  intersects(e) {
    return Math.max(this.start, e.start) < Math.min(this.endExclusive, e.endExclusive);
  }
  intersectsOrTouches(e) {
    return Math.max(this.start, e.start) <= Math.min(this.endExclusive, e.endExclusive);
  }
  intersect(e) {
    const t = Math.max(this.start, e.start), n = Math.min(this.endExclusive, e.endExclusive);
    if (t <= n)
      return new s(t, n);
  }
  join(e) {
    return new s(
      Math.min(this.start, e.start),
      Math.max(this.endExclusive, e.endExclusive)
    );
  }
  isBefore(e) {
    return this.endExclusive <= e.start;
  }
  isAfter(e) {
    return this.start >= e.endExclusive;
  }
  substring(e) {
    return e.substring(this.start, this.endExclusive);
  }
  slice(e) {
    return e.slice(this.start, this.endExclusive);
  }
  equals(e) {
    return this.start === e.start && this.endExclusive === e.endExclusive;
  }
  toString() {
    return `[${this.start}, ${this.endExclusive})`;
  }
}
class a {
  constructor(e, t) {
    this.replaceRange = e, this.newText = t;
  }
  static insert(e, t) {
    return new a(s.emptyAt(e), t);
  }
  static replace(e, t) {
    return new a(e, t);
  }
  static delete(e) {
    return new a(e, "");
  }
  get isEmpty() {
    return this.replaceRange.isEmpty && this.newText.length === 0;
  }
  equals(e) {
    return this.replaceRange.equals(e.replaceRange) && this.newText === e.newText;
  }
  /**
   * Narrows this replacement to the span that actually changes, by trimming
   * the prefix and suffix it shares with the text it replaces in `source`.
   */
  removeCommonSuffixPrefix(e) {
    const t = this.replaceRange.substring(e), n = h(t, this.newText), r = Math.min(
      t.length - n,
      this.newText.length - n,
      u(t, this.newText)
    );
    return new a(
      new s(
        this.replaceRange.start + n,
        this.replaceRange.endExclusive - r
      ),
      this.newText.substring(n, this.newText.length - r)
    );
  }
  toString() {
    return `${this.replaceRange} -> ${JSON.stringify(this.newText)}`;
  }
}
function h(i, e) {
  const t = Math.min(i.length, e.length);
  let n = 0;
  for (; n < t && i.charCodeAt(n) === e.charCodeAt(n); )
    n++;
  return n;
}
function u(i, e) {
  const t = Math.min(i.length, e.length);
  let n = 0;
  for (; n < t && i.charCodeAt(i.length - n - 1) === e.charCodeAt(e.length - n - 1); )
    n++;
  return n;
}
class l {
  static empty = new l([]);
  static single(e) {
    return new l([e]);
  }
  static replace(e, t) {
    return new l([a.replace(e, t)]);
  }
  static insert(e, t) {
    return new l([a.insert(e, t)]);
  }
  static delete(e) {
    return new l([a.delete(e)]);
  }
  replacements;
  constructor(e) {
    let t = -1;
    for (const n of e) {
      if (n.replaceRange.start < t)
        throw new Error(
          `Edits must be disjoint and sorted. Found ${n} after ${t}`
        );
      t = n.replaceRange.endExclusive;
    }
    this.replacements = e;
  }
  get isEmpty() {
    return this.replacements.length === 0;
  }
  apply(e) {
    const t = [];
    let n = 0;
    for (const r of this.replacements)
      t.push(e.substring(n, r.replaceRange.start)), t.push(r.newText), n = r.replaceRange.endExclusive;
    return t.push(e.substring(n)), t.join("");
  }
  inverse(e) {
    const t = [];
    let n = 0;
    for (const r of this.replacements) {
      const c = e.substring(r.replaceRange.start, r.replaceRange.endExclusive);
      t.push(
        a.replace(
          s.ofStartAndLength(r.replaceRange.start + n, r.newText.length),
          c
        )
      ), n += r.newText.length - r.replaceRange.length;
    }
    return new l(t);
  }
  equals(e) {
    if (this.replacements.length !== e.replacements.length)
      return !1;
    for (let t = 0; t < this.replacements.length; t++)
      if (!this.replacements[t].equals(e.replacements[t]))
        return !1;
    return !0;
  }
  mapOffset(e) {
    let t = 0;
    for (const n of this.replacements) {
      if (n.replaceRange.start > e)
        break;
      if (n.replaceRange.endExclusive <= e)
        t += n.newText.length - n.replaceRange.length;
      else
        return n.replaceRange.start + t + n.newText.length;
    }
    return e + t;
  }
  toString() {
    return `[${this.replacements.map((e) => e.toString()).join(", ")}]`;
  }
}
function o(i, e) {
  return i === e ? l.empty : l.single(
    a.replace(new s(0, i.length), e).removeCommonSuffixPrefix(i)
  );
}
export {
  s as O,
  l as S,
  a,
  o as c
};
//# sourceMappingURL=stringEdit-CVDbCUBY.js.map
