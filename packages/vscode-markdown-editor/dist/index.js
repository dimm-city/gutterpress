import { commands as Ft } from "./commands.js";
import { O as v, S, a as le, c as bs } from "./stringEdit-CVDbCUBY.js";
import ys from "katex";
import { observableValue as x, derived as I, transaction as te, Disposable as H, runOnChange as Vt, autorun as P, constObservable as _i } from "@vscode/observables";
import { D as vi, f as wi, a as ki, b as bi, c as yi, d as xs, i as Fe } from "./config-BGeaJqWk.js";
import { e as Ll } from "./config-BGeaJqWk.js";
import { parse as xi, preprocess as Ei, postprocess as Ci } from "micromark";
import { frontmatter as Si } from "micromark-extension-frontmatter";
import { math as Li } from "micromark-extension-math";
import { gfmTable as Mi } from "micromark-extension-gfm-table";
import { gfmTaskListItem as Ti } from "micromark-extension-gfm-task-list-item";
import { gfmStrikethrough as Oi } from "micromark-extension-gfm-strikethrough";
import { createDiffComputer as Ri } from "@vscode/diff";
class $t {
  constructor(e, t) {
    if (this.replaceRange = e, this.newLength = t, t < 0)
      throw new Error(`newLength must be non-negative, got ${t}`);
  }
  static replace(e, t) {
    return new $t(e, t);
  }
  get lengthDelta() {
    return this.newLength - this.replaceRange.length;
  }
  equals(e) {
    return this.replaceRange.equals(e.replaceRange) && this.newLength === e.newLength;
  }
  toString() {
    return `${this.replaceRange} -> +${this.newLength}`;
  }
}
class be {
  static empty = new be([]);
  static single(e) {
    return new be([e]);
  }
  static replace(e, t) {
    return new be([$t.replace(e, t)]);
  }
  replacements;
  constructor(e) {
    let t = -1;
    for (const s of e) {
      if (s.replaceRange.start < t)
        throw new Error(`Edits must be disjoint and sorted. Found ${s} after end ${t}`);
      t = s.replaceRange.endExclusive;
    }
    this.replacements = e;
  }
  get isEmpty() {
    return this.replacements.length === 0;
  }
  equals(e) {
    if (this.replacements.length !== e.replacements.length)
      return !1;
    for (let t = 0; t < this.replacements.length; t++)
      if (!this.replacements[t].equals(e.replacements[t]))
        return !1;
    return !0;
  }
  toString() {
    return this.isEmpty ? "LengthEdit.empty" : this.replacements.join(", ");
  }
}
class cn {
  constructor(e) {
    this.value = e;
  }
  get length() {
    return this.value.length;
  }
  substring(e) {
    return e.substring(this.value);
  }
  toString() {
    return this.value;
  }
}
class k {
  constructor(e, t) {
    this.anchor = e, this.active = t;
  }
  static collapsed(e) {
    return new k(e, e);
  }
  get isCollapsed() {
    return this.anchor === this.active;
  }
  get isForward() {
    return this.active >= this.anchor;
  }
  get range() {
    return this.isForward ? new v(this.anchor, this.active) : new v(this.active, this.anchor);
  }
  collapseToActive() {
    return k.collapsed(this.active);
  }
  withActive(e) {
    return new k(this.anchor, e);
  }
}
class Ni {
  constructor(e, t) {
    this.sourceOffsetBefore = e, this.sourceOffsetAfter = t;
  }
}
var O;
((n) => {
  function e(s) {
    return { kind: "source", offset: s };
  }
  n.source = e;
  function t(s) {
    return { kind: "virtual", line: s };
  }
  n.virtual = t;
})(O || (O = {}));
class ne {
  constructor(e, t) {
    this.x = e, this.y = t;
  }
  static ZERO = new ne(0, 0);
  translate(e, t) {
    return new ne(this.x + e, this.y + t);
  }
}
class C {
  constructor(e, t, s, i) {
    this.x = e, this.y = t, this.width = s, this.height = i;
  }
  static EMPTY = new C(0, 0, 0, 0);
  static fromPointPoint(e, t, s, i) {
    return new C(e, t, s - e, i - t);
  }
  static fromPointSize(e, t, s, i) {
    return new C(e, t, s, i);
  }
  get left() {
    return this.x;
  }
  get top() {
    return this.y;
  }
  get right() {
    return this.x + this.width;
  }
  get bottom() {
    return this.y + this.height;
  }
  get topLeft() {
    return new ne(this.x, this.y);
  }
  containsX(e) {
    return e >= this.left && e < this.right;
  }
  containsY(e) {
    return e >= this.top && e < this.bottom;
  }
  containsPoint(e) {
    return this.containsX(e.x) && this.containsY(e.y);
  }
  /** Same y/height, zero-width band at `x = this.left`. Useful for caret rects derived from a line. */
  withZeroWidthAt(e) {
    return new C(e, this.y, 0, this.height);
  }
  translate(e, t) {
    return new C(this.x + e, this.y + t, this.width, this.height);
  }
}
let Ii = 1;
class X {
  /**
   * A stable identity. Every node has one: it is minted on construction and
   * carried across edits by reconciliation, so a node that survives an edit
   * (even with changed content) keeps the same id.
   */
  id = Ii++;
  _length = -1;
  get length() {
    if (this._length < 0) {
      let e = 0;
      for (const t of this.children)
        e += t.length;
      this._length = e;
    }
    return this._length;
  }
  /**
   * True when `other` has the same content. Containers compare children *by
   * identity* (`===`): bottom-up reconciliation substitutes reused old
   * instances into the fresh tree first, so equal children already share
   * instances — keeping this O(children), not O(subtree). Leaves have no
   * children, so {@link _localEquals} is their whole comparison.
   */
  equalsShallow(e) {
    if (this === e)
      return !0;
    if (this.kind !== e.kind || this.length !== e.length || !this._localEquals(e))
      return !1;
    const t = this.children, s = e.children;
    if (t.length !== s.length)
      return !1;
    for (let i = 0; i < t.length; i++)
      if (t[i] !== s[i])
        return !1;
    return !0;
  }
  /** Compares only this node's own scalar fields (kind/length already match). */
  _localEquals(e) {
    return !0;
  }
  /**
   * A copy of this node that adopts `id`. Reconciliation uses this to carry an
   * old identity onto a node whose content changed. Nodes are immutable value
   * holders, so a shallow prototype copy with `id` overridden is sound.
   */
  cloneWithId(e) {
    const t = Object.create(Object.getPrototypeOf(this));
    return Object.assign(t, this), t.id = e, t;
  }
}
const Pi = [];
function A(n, e) {
  let t;
  for (let s = 0; s < e.length; s++) {
    const i = n.get(e[s]);
    i && i !== e[s] && ((t ??= e.slice())[s] = i);
  }
  return t ?? e;
}
function se(n, e) {
  const t = n.get(e);
  return t && t !== e ? t : e;
}
function re(n, e) {
  return e ? se(n, e) : void 0;
}
class it extends X {
  get children() {
    return Pi;
  }
  get length() {
    return this.content.length;
  }
  mapChildren() {
    return this;
  }
}
class Qe extends it {
  constructor(e) {
    super(), this.content = e;
  }
  kind = "text";
  _localEquals(e) {
    return this.content === e.content;
  }
}
class b extends it {
  constructor(e, t) {
    super(), this.markerKind = e, this.content = t;
  }
  kind = "marker";
  _localEquals(e) {
    return this.markerKind === e.markerKind && this.content === e.content;
  }
}
class $ extends it {
  constructor(e, t) {
    super(), this.content = e, this.glueKind = t;
  }
  kind = "glue";
  _localEquals(e) {
    return this.content === e.content && this.glueKind === e.glueKind;
  }
}
class Z extends X {
  /** Prepends {@link leadingTrivia}, if any, ahead of the block's own children. */
  _withLeading(e) {
    return this.leadingTrivia ? [this.leadingTrivia, ...e] : e;
  }
}
class ge extends Z {
  constructor(e, t) {
    super(), this.content = e, this.leadingTrivia = t;
  }
  kind = "thematicBreak";
  get children() {
    return this._withLeading(this.content);
  }
  get marker() {
    return ae(this.content, "content");
  }
  mapChildren(e) {
    return new ge(A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new ge(this.content, e);
  }
}
function ae(n, e) {
  return n.find((t) => t instanceof b && t.markerKind === e);
}
class Wt extends X {
  constructor(e, t, s) {
    super(), this.openMarker = e, this.content = t, this.closeMarker = s;
  }
  kind = "strong";
  get children() {
    return [this.openMarker, ...this.content, this.closeMarker];
  }
  mapChildren(e) {
    return new Wt(se(e, this.openMarker), A(e, this.content), se(e, this.closeMarker));
  }
}
class Ht extends X {
  constructor(e, t, s) {
    super(), this.openMarker = e, this.content = t, this.closeMarker = s;
  }
  kind = "emphasis";
  get children() {
    return [this.openMarker, ...this.content, this.closeMarker];
  }
  mapChildren(e) {
    return new Ht(se(e, this.openMarker), A(e, this.content), se(e, this.closeMarker));
  }
}
class Kt extends X {
  constructor(e, t, s) {
    super(), this.openMarker = e, this.content = t, this.closeMarker = s;
  }
  kind = "strikethrough";
  get children() {
    return [this.openMarker, ...this.content, this.closeMarker];
  }
  mapChildren(e) {
    return new Kt(se(e, this.openMarker), A(e, this.content), se(e, this.closeMarker));
  }
}
class zt extends X {
  constructor(e) {
    super(), this.content = e;
  }
  kind = "inlineCode";
  get children() {
    return this.content;
  }
  mapChildren(e) {
    return new zt(A(e, this.content));
  }
}
class qt extends X {
  constructor(e) {
    super(), this.content = e;
  }
  kind = "inlineMath";
  get children() {
    return this.content;
  }
  mapChildren(e) {
    return new qt(A(e, this.content));
  }
}
class Ne extends X {
  constructor(e, t) {
    super(), this.url = e, this.content = t;
  }
  kind = "link";
  get children() {
    return this.content;
  }
  mapChildren(e) {
    return new Ne(this.url, A(e, this.content));
  }
  _localEquals(e) {
    return this.url === e.url;
  }
}
class Ie extends X {
  constructor(e, t, s) {
    super(), this.alt = e, this.url = t, this.content = s;
  }
  kind = "image";
  get children() {
    return this.content;
  }
  mapChildren(e) {
    return new Ie(this.alt, this.url, A(e, this.content));
  }
  _localEquals(e) {
    return this.alt === e.alt && this.url === e.url;
  }
}
class pe extends Z {
  constructor(e, t, s) {
    super(), this.tokenType = e, this.content = t, this.leadingTrivia = s;
  }
  kind = "unhandledBlock";
  get children() {
    return this._withLeading(this.content);
  }
  get code() {
    return ae(this.content, "content");
  }
  /**
   * Lossless slices when this raw HTML block starts one comment after optional
   * whitespace. An open comment consumes the remaining source as its body. A
   * complete comment permits only trailing whitespace after its closer.
   */
  get htmlComment() {
    const e = this.code?.content;
    if (this.tokenType !== "htmlFlow" || e === void 0)
      return;
    const t = "<!--", s = "-->", i = e.indexOf(t);
    if (i < 0)
      return;
    const o = e.slice(0, i);
    if (o.trim().length > 0)
      return;
    const r = i + t.length, c = e.indexOf(s, r);
    if (c < 0)
      return {
        kind: "open",
        leadingWhitespace: o,
        opening: t,
        body: e.slice(r)
      };
    const a = e.slice(c + s.length);
    if (!(a.trim().length > 0))
      return {
        kind: "complete",
        leadingWhitespace: o,
        opening: t,
        body: e.slice(r, c),
        closing: s,
        trailingWhitespace: a
      };
  }
  mapChildren(e) {
    return new pe(this.tokenType, A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new pe(this.tokenType, this.content, e);
  }
  _localEquals(e) {
    return this.tokenType === e.tokenType;
  }
}
class he extends Z {
  constructor(e, t, s, i) {
    super(), this.level = e, this.marker = t, this.content = s, this.leadingTrivia = i;
  }
  kind = "heading";
  get children() {
    return this._withLeading([this.marker, ...this.content]);
  }
  mapChildren(e) {
    return new he(this.level, se(e, this.marker), A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new he(this.level, this.marker, this.content, e);
  }
  _localEquals(e) {
    return this.level === e.level;
  }
}
class ie extends Z {
  constructor(e, t) {
    super(), this.content = e, this.leadingTrivia = t;
  }
  kind = "paragraph";
  get children() {
    return this._withLeading(this.content);
  }
  mapChildren(e) {
    return new ie(A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new ie(this.content, e);
  }
}
class ye extends Z {
  constructor(e, t) {
    super(), this.content = e, this.leadingTrivia = t;
  }
  kind = "frontMatter";
  get children() {
    return this._withLeading(this.content);
  }
  get openFence() {
    return ae(this.content, "openFence");
  }
  get closeFence() {
    return ae(this.content, "closeFence");
  }
  get value() {
    return ae(this.content, "content");
  }
  mapChildren(e) {
    return new ye(A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new ye(this.content, e);
  }
}
class j extends Z {
  constructor(e, t, s, i) {
    super(), this.language = e, this.infoString = t, this.content = s, this.leadingTrivia = i;
  }
  kind = "codeBlock";
  _previous;
  _contentEdit;
  get children() {
    return this._withLeading(this.content);
  }
  get openFence() {
    return ae(this.content, "openFence");
  }
  get closeFence() {
    return ae(this.content, "closeFence");
  }
  get code() {
    return ae(this.content, "content");
  }
  /** Relative start offset of the {@link code} marker within this block. */
  get codeOffset() {
    let e = this.leadingTrivia?.length ?? 0;
    for (const t of this.content) {
      if (t.kind === "marker" && t.markerKind === "content")
        return e;
      e += t.length;
    }
    return e;
  }
  mapChildren(e) {
    return new j(this.language, this.infoString, A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new j(this.language, this.infoString, this.content, e);
  }
  _localEquals(e) {
    return this.language === e.language && this.infoString === e.infoString;
  }
  /**
   * A copy of this block carrying an incremental link to `previous`:
   * `contentEdit` (in the block's *content* coordinates) turns `previous`'s
   * content into this one. Uses a weak reference so the previous tree can be
   * garbage-collected.
   */
  withCodeDiff(e, t) {
    const s = this.cloneWithId(this.id);
    return s._previous = new WeakRef(e), s._contentEdit = t, s;
  }
  /**
   * When this block was incrementally derived from `previous` (same
   * fences/language, edit entirely within the content), returns the
   * content-coordinate edit; otherwise `undefined`.
   */
  getDiff(e) {
    if (this._contentEdit && this._previous?.deref() === e)
      return { stringEdit: this._contentEdit };
  }
}
class _e extends Z {
  constructor(e, t) {
    super(), this.content = e, this.leadingTrivia = t;
  }
  kind = "mathBlock";
  get children() {
    return this._withLeading(this.content);
  }
  get code() {
    return ae(this.content, "content");
  }
  mapChildren(e) {
    return new _e(A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new _e(this.content, e);
  }
}
class xe extends Z {
  constructor(e, t) {
    super(), this.content = e, this.leadingTrivia = t;
  }
  kind = "blockQuote";
  get children() {
    return this._withLeading(this.content);
  }
  get blocks() {
    return this.content.filter(Xt);
  }
  mapChildren(e) {
    return new xe(A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new xe(this.content, e);
  }
}
class z extends Z {
  constructor(e, t, s) {
    super(), this.ordered = e, this.content = t, this.leadingTrivia = s;
  }
  kind = "list";
  get children() {
    return this._withLeading(this.content);
  }
  get items() {
    return this.content.filter((e) => e instanceof q);
  }
  mapChildren(e) {
    return new z(this.ordered, A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new z(this.ordered, this.content, e);
  }
  _localEquals(e) {
    return this.ordered === e.ordered;
  }
}
class q extends X {
  constructor(e, t, s, i) {
    super(), this.marker = e, this.content = t, this.checked = s, this.leadingTrivia = i;
  }
  kind = "listItem";
  get children() {
    return this.leadingTrivia ? [this.leadingTrivia, this.marker, ...this.content] : [this.marker, ...this.content];
  }
  get blocks() {
    return this.content.filter(Xt);
  }
  mapChildren(e) {
    return new q(
      se(e, this.marker),
      A(e, this.content),
      this.checked,
      this.leadingTrivia ? se(e, this.leadingTrivia) : void 0
    );
  }
  withLeadingTrivia(e) {
    return new q(this.marker, this.content, this.checked, e);
  }
  _localEquals(e) {
    return this.checked === e.checked;
  }
}
class Ee extends Z {
  constructor(e, t) {
    super(), this.content = e, this.leadingTrivia = t;
  }
  kind = "table";
  get children() {
    return this._withLeading(this.content);
  }
  get _rows() {
    return this.content.filter((e) => e instanceof Me);
  }
  get headerRow() {
    return this._rows[0];
  }
  get delimiterRow() {
    return this._rows[1];
  }
  get bodyRows() {
    return this._rows.slice(2);
  }
  mapChildren(e) {
    return new Ee(A(e, this.content), re(e, this.leadingTrivia));
  }
  withLeadingTrivia(e) {
    return new Ee(this.content, e);
  }
}
class Me extends X {
  constructor(e) {
    super(), this.content = e;
  }
  kind = "tableRow";
  get children() {
    return this.content;
  }
  get cells() {
    return this.content.filter((e) => e instanceof Te);
  }
  mapChildren(e) {
    return new Me(A(e, this.content));
  }
}
class Te extends X {
  constructor(e) {
    super(), this.content = e;
  }
  kind = "tableCell";
  get children() {
    return this.content;
  }
  mapChildren(e) {
    return new Te(A(e, this.content));
  }
}
class Ut extends X {
  constructor(e) {
    super(), this.content = e;
  }
  kind = "document";
  get children() {
    return this.content;
  }
  get blocks() {
    return this.content.filter(Xt);
  }
  mapChildren(e) {
    return new Ut(A(e, this.content));
  }
}
function Xt(n) {
  return n instanceof he || n instanceof ie || n instanceof ye || n instanceof j || n instanceof _e || n instanceof ge || n instanceof xe || n instanceof z || n instanceof Ee || n instanceof pe;
}
function U(n, e) {
  if (n.id === e.id)
    return 0;
  let t = 0;
  for (const s of n.children) {
    const i = U(s, e);
    if (i !== void 0)
      return t + i;
    t += s.length;
  }
}
const Bi = /\[[ xX]\]/;
function Ai(n) {
  if (n.checked === void 0)
    return;
  const e = Bi.exec(Es(n));
  if (e)
    return v.ofStartAndLength(e.index, e[0].length);
}
function Es(n) {
  if (n instanceof it)
    return n.content;
  let e = "";
  for (const t of n.children)
    e += Es(t);
  return e;
}
function Di(n) {
  const e = xi({ extensions: [Si(), Li(), Mi(), Ti(), Oi()] }), t = Ei()(n, void 0, !0);
  return Ci(e.document().write(t)).map(([i, o]) => ({
    type: i,
    tokenType: o.type,
    startOffset: o.start.offset,
    endOffset: o.end.offset
  }));
}
function Fi(n) {
  return new Hi(Di(n), n).build();
}
const Vi = /* @__PURE__ */ new Set([
  "htmlFlow",
  "setextHeading",
  "definition"
]);
function Ve(n) {
  const e = [];
  for (let t = 0; t < n.length; t++) {
    const s = n[t], i = n[t + 1];
    if (s instanceof $ && s.glueKind === "indent") {
      const o = i !== void 0 ? $i(i, s) : void 0;
      if (o) {
        e.push(o), t++;
        continue;
      }
      const r = e[e.length - 1];
      if (r instanceof $ && r.glueKind === void 0) {
        e[e.length - 1] = new $(r.content + s.content);
        continue;
      }
      e.push(s);
      continue;
    }
    e.push(s);
  }
  return e;
}
function $i(n, e) {
  if (n instanceof z) {
    const t = n.content.findIndex((i) => i instanceof q);
    if (t < 0)
      return;
    const s = n.content.map((i, o) => o === t ? i.withLeadingTrivia(e) : i);
    return new z(n.ordered, s, n.leadingTrivia);
  }
  if (n instanceof q || n instanceof Z)
    return n.withLeadingTrivia(e);
}
function $e(n) {
  const e = [];
  for (let t = 0; t < n.length; t++) {
    const s = n[t];
    if (s instanceof $ && s.glueKind === void 0) {
      const i = e[e.length - 1], o = n[t + 1], r = i instanceof ie && o instanceof ie, c = new $(s.content, r ? "blockBreak" : "blockGap"), a = i !== void 0 ? Cs(i, c) : void 0;
      a ? e[e.length - 1] = a : e.push(c);
      continue;
    }
    e.push(s);
  }
  return e;
}
function Cs(n, e) {
  switch (n.kind) {
    case "paragraph": {
      const t = n;
      return new ie([...t.content, e], t.leadingTrivia);
    }
    case "heading": {
      const t = n;
      return new he(t.level, t.marker, [...t.content, e], t.leadingTrivia);
    }
    case "codeBlock": {
      const t = n;
      return new j(t.language, t.infoString, [...t.content, e], t.leadingTrivia);
    }
    case "frontMatter": {
      const t = n;
      return new ye([...t.content, e], t.leadingTrivia);
    }
    case "mathBlock": {
      const t = n;
      return new _e([...t.content, e], t.leadingTrivia);
    }
    case "thematicBreak": {
      const t = n;
      return new ge([...t.content, e], t.leadingTrivia);
    }
    case "unhandledBlock": {
      const t = n;
      return new pe(t.tokenType, [...t.content, e], t.leadingTrivia);
    }
    case "table": {
      const t = n;
      return new Ee([...t.content, e], t.leadingTrivia);
    }
    case "blockQuote": {
      const t = n;
      return new xe(ut(t.content, e), t.leadingTrivia);
    }
    case "list": {
      const t = n;
      return new z(t.ordered, ut(t.content, e), t.leadingTrivia);
    }
    case "listItem": {
      const t = n;
      return new q(t.marker, ut(t.content, e), t.checked, t.leadingTrivia);
    }
    default:
      return;
  }
}
function ut(n, e) {
  const t = n[n.length - 1], s = t !== void 0 ? Cs(t, e) : void 0;
  if (s) {
    const i = n.slice();
    return i[i.length - 1] = s, i;
  }
  return [...n, e];
}
function Wi(n) {
  return n.some((e) => !(e instanceof $)) ? n : [new ie(n)];
}
class B {
  constructor(e, t) {
    this._parentStart = e, this._source = t;
  }
  _entries = [];
  add(e, t) {
    this._entries.push({ node: e, start: t });
  }
  build(e, t) {
    this._entries.sort((c, a) => c.start - a.start);
    const s = [];
    let i = this._parentStart;
    const o = this._parentStart + e, r = (c, a) => {
      const l = this._source.substring(c, a), d = t ? null : /\n[^\S\n]+$/.exec(l);
      if (!d) {
        s.push(new $(l, t));
        return;
      }
      const u = l.slice(d.index + 1);
      s.push(new $(l.slice(0, l.length - u.length))), s.push(new $(u, "indent"));
    };
    for (const { node: c, start: a } of this._entries)
      c.length !== 0 && (a > i && r(i, a), s.push(c), i = a + c.length);
    return i < o && r(i, o), s;
  }
}
class Hi {
  constructor(e, t) {
    this._events = e, this._source = t;
  }
  _idx = 0;
  _checkChecked;
  build() {
    const e = new B(0, this._source);
    let t = 0;
    for (; this._idx < this._events.length; ) {
      const s = this._events[this._idx];
      if (s.type === "enter") {
        const i = s.startOffset, o = this._tryParseBlock();
        if (o)
          e.add(o, i), t = Math.max(t, i + o.length);
        else {
          const r = this._tryParseUnhandled(t);
          r && (e.add(r.node, r.start), t = Math.max(t, r.start + r.node.length));
        }
      } else
        this._idx++;
    }
    return new Ut(Wi($e(Ve(e.build(this._source.length)))));
  }
  _tryParseBlock() {
    switch (this._events[this._idx].tokenType) {
      case "yaml":
        return this._parseFrontMatter();
      case "atxHeading":
        return this._parseHeading();
      case "paragraph":
        return this._parseParagraph();
      case "codeFenced":
        return this._parseCodeFenced();
      case "codeIndented":
        return this._parseCodeIndented();
      case "mathFlow":
        return this._parseMathFlow();
      case "thematicBreak":
        return this._parseThematicBreak();
      case "blockQuote":
        return this._parseBlockQuote();
      case "listUnordered":
      case "listOrdered":
        return this._parseList();
      case "table":
        return this._parseTable();
      default:
        return;
    }
  }
  /**
   * Fallback for an unrecognized top-level token (a setext heading or any
   * extension construct). Consumes the whole
   * `enter…exit` span of that token — depth-counting so a same-typed nested
   * token cannot end it early — and captures the raw source verbatim as a
   * single `content` marker, so the text is preserved and rendered as an
   * explicit "unhandled" block instead of being demoted to invisible glue.
   */
  _parseUnhandledBlock() {
    const e = this._events[this._idx], t = e.tokenType;
    this._idx++;
    let s = 1, i = e;
    for (; this._idx < this._events.length && s > 0; ) {
      const r = this._events[this._idx];
      r.tokenType === t && (s += r.type === "enter" ? 1 : -1), s === 0 && (i = r), this._idx++;
    }
    const o = this._source.substring(e.startOffset, i.endOffset);
    return new pe(t, [new b("content", o)]);
  }
  /**
   * Decides what to do with an unrecognized `enter` token at the top of a
   * block-collecting loop (the document, a list item, a block quote), so all
   * three treat unknown constructs identically. A token in
   * {@link _UNHANDLED_BLOCK_TOKENS} that does not overlap an already-claimed
   * sibling (`start < coveredEnd`, e.g. a `setextHeading` micromark re-claims
   * back over a preceding `definition`) is captured verbatim via
   * {@link _parseUnhandledBlock}; every other token — a transparent `content`
   * wrapper, a structural prefix/indent, a line ending — is stepped over so it
   * tiles as glue. Returns the block and its start, or `undefined` when the
   * event was stepped over.
   */
  _tryParseUnhandled(e) {
    const t = this._events[this._idx], s = t.startOffset;
    if (s >= e && Vi.has(t.tokenType))
      return { node: this._parseUnhandledBlock(), start: s };
    this._idx++;
  }
  _parseHeading() {
    const e = this._consume("enter", "atxHeading");
    let t = 1, s = e.startOffset, i = e.startOffset;
    const o = [];
    for (; this._notExit("atxHeading"); ) {
      const d = this._events[this._idx];
      if (d.type === "enter" && d.tokenType === "atxHeadingSequence") {
        const u = this._consume("enter", "atxHeadingSequence"), h = this._consume("exit", "atxHeadingSequence");
        i === e.startOffset && (t = Math.min(6, Math.max(1, h.endOffset - u.startOffset)), s = u.startOffset, i = h.endOffset);
      } else d.type === "enter" && d.tokenType === "atxHeadingText" ? (this._consume("enter", "atxHeadingText"), this._parseInlines(o, "atxHeadingText"), this._consume("exit", "atxHeadingText")) : this._idx++;
    }
    const r = this._consume("exit", "atxHeading");
    i > s && o.length > 0 && (i = o[0].start);
    const c = new b("headingMarker", this._source.substring(e.startOffset, i)), a = new B(i, this._source);
    for (const d of o)
      a.add(d.node, d.start);
    const l = a.build(r.endOffset - i);
    return new he(t, c, l);
  }
  _parseParagraph() {
    const e = this._consume("enter", "paragraph"), t = [];
    for (; this._notExit("paragraph"); )
      this._parseInlineEvent(t);
    const s = this._consume("exit", "paragraph"), i = new B(e.startOffset, this._source);
    for (const o of t)
      i.add(o.node, o.start);
    return new ie(i.build(s.endOffset - e.startOffset));
  }
  _parseFrontMatter() {
    const e = this._consume("enter", "yaml"), t = new B(e.startOffset, this._source);
    let s = !1, i, o;
    for (; this._notExit("yaml"); ) {
      const c = this._events[this._idx];
      if (c.type === "enter" && c.tokenType === "yamlFence") {
        const a = this._consume("enter", "yamlFence");
        for (; this._notExit("yamlFence"); )
          this._idx++;
        const l = this._consume("exit", "yamlFence");
        t.add(new b(
          s ? "closeFence" : "openFence",
          this._source.substring(a.startOffset, l.endOffset)
        ), a.startOffset), s = !0;
      } else c.tokenType === "yamlValue" || c.tokenType === "lineEnding" ? (i === void 0 && (i = c.startOffset), o = c.endOffset, this._idx++) : this._idx++;
    }
    const r = this._consume("exit", "yaml");
    return i !== void 0 && t.add(new b("content", this._source.substring(i, o)), i), new ye(t.build(r.endOffset - e.startOffset));
  }
  _parseCodeFenced() {
    const e = this._consume("enter", "codeFenced");
    let t = "", s, i;
    const o = new B(e.startOffset, this._source);
    let r = !1, c, a;
    for (; this._notExit("codeFenced"); ) {
      const u = this._events[this._idx];
      if (u.type === "enter" && u.tokenType === "codeFencedFence") {
        const h = this._consume("enter", "codeFencedFence");
        for (; this._notExit("codeFencedFence"); ) {
          const m = this._events[this._idx];
          if (m.type === "enter" && (m.tokenType === "codeFencedFenceInfo" || m.tokenType === "codeFencedFenceMeta")) {
            const g = m.tokenType, _ = this._consume("enter", g);
            for (s ??= _.startOffset; this._notExit(g); ) {
              const p = this._events[this._idx];
              g === "codeFencedFenceInfo" && p.type === "enter" && p.tokenType === "data" && (t += this._source.substring(p.startOffset, p.endOffset)), this._idx++;
            }
            i = this._consume("exit", g).endOffset;
          } else
            this._idx++;
        }
        const f = this._consume("exit", "codeFencedFence");
        o.add(new b(
          r ? "closeFence" : "openFence",
          this._source.substring(h.startOffset, f.endOffset)
        ), h.startOffset), r = !0;
      } else u.tokenType === "codeFlowValue" || u.tokenType === "lineEnding" ? (c === void 0 && (c = u.startOffset), a = u.endOffset, this._idx++) : this._idx++;
    }
    const l = this._consume("exit", "codeFenced");
    c !== void 0 && o.add(new b("content", this._source.substring(c, a)), c);
    const d = s === void 0 ? "" : this._source.substring(s, i);
    return new j(t, d, o.build(l.endOffset - e.startOffset));
  }
  /**
   * An indented code block has no fences and no info string: micromark strips a
   * four-space `linePrefix` from each line and emits the rest as `codeFlowValue`.
   * Each line's `linePrefix` becomes a hideable `codeIndent` marker (so the
   * structural indentation can be dropped from the rendered block, like a
   * heading's `#`), while the actual code is kept verbatim as `content` markers
   * — one run per line — so the block round-trips the source.
   */
  _parseCodeIndented() {
    const e = this._consume("enter", "codeIndented"), t = new B(e.startOffset, this._source);
    let s, i;
    const o = () => {
      s !== void 0 && (t.add(new b("content", this._source.substring(s, i)), s), s = void 0);
    };
    for (; this._notExit("codeIndented"); ) {
      const c = this._events[this._idx];
      if (c.type === "enter" && c.tokenType === "linePrefix") {
        o();
        const a = this._consume("enter", "linePrefix"), l = this._consume("exit", "linePrefix");
        t.add(new b("codeIndent", this._source.substring(a.startOffset, l.endOffset)), a.startOffset);
      } else c.tokenType === "codeFlowValue" || c.tokenType === "lineEnding" ? (s === void 0 && (s = c.startOffset), i = c.endOffset, this._idx++) : this._idx++;
    }
    o();
    const r = this._consume("exit", "codeIndented");
    return new j("", "", t.build(r.endOffset - e.startOffset));
  }
  _parseMathFlow() {
    const e = this._consume("enter", "mathFlow"), t = new B(e.startOffset, this._source);
    let s = !1, i, o;
    for (; this._notExit("mathFlow"); ) {
      const c = this._events[this._idx];
      if (c.type === "enter" && c.tokenType === "mathFlowFence") {
        const a = this._consume("enter", "mathFlowFence");
        for (; this._notExit("mathFlowFence"); )
          this._idx++;
        const l = this._consume("exit", "mathFlowFence");
        t.add(new b(
          s ? "closeFence" : "openFence",
          this._source.substring(a.startOffset, l.endOffset)
        ), a.startOffset), s = !0;
      } else c.tokenType === "mathFlowValue" || c.tokenType === "lineEnding" ? (i === void 0 && (i = c.startOffset), o = c.endOffset, this._idx++) : this._idx++;
    }
    const r = this._consume("exit", "mathFlow");
    return i !== void 0 && t.add(new b("content", this._source.substring(i, o)), i), new _e(t.build(r.endOffset - e.startOffset));
  }
  _parseThematicBreak() {
    const e = this._consume("enter", "thematicBreak");
    for (; this._notExit("thematicBreak"); )
      this._idx++;
    const t = this._consume("exit", "thematicBreak"), s = new b("content", this._source.substring(e.startOffset, t.endOffset));
    return new ge([s]);
  }
  _parseBlockQuote() {
    const e = this._consume("enter", "blockQuote"), t = new B(e.startOffset, this._source);
    let s = !1, i = [], o = e.startOffset;
    for (; this._notExit("blockQuote"); ) {
      const a = this._events[this._idx];
      if (a.type === "enter" && a.tokenType === "blockQuotePrefix") {
        const l = this._consume("enter", "blockQuotePrefix");
        for (; this._notExit("blockQuotePrefix"); )
          this._idx++;
        const d = this._consume("exit", "blockQuotePrefix");
        if (!s)
          t.add(new b("blockQuoteMarker", this._source.substring(l.startOffset, d.endOffset)), l.startOffset);
        else {
          const u = i[i.length - 1];
          u && !/^[\r\n]*$/.test(this._source.substring(u.endOffset, l.startOffset)) && (i = []), i.push({ startOffset: l.startOffset, endOffset: d.endOffset });
        }
        o = Math.max(o, d.endOffset);
      } else if (a.type === "enter") {
        const l = a.startOffset, d = this._tryParseBlock();
        if (d)
          t.add(d, l), s = !0, i = [], o = Math.max(o, l + d.length);
        else {
          const u = this._tryParseUnhandled(o);
          u && (t.add(u.node, u.start), s = !0, i = [], o = Math.max(o, u.start + u.node.length));
        }
      } else
        this._idx++;
    }
    const r = this._consume("exit", "blockQuote"), c = i[i.length - 1];
    if (c && /^[\r\n]*$/.test(this._source.substring(c.endOffset, r.endOffset)))
      for (const a of i)
        t.add(
          new b("blockQuoteMarker", this._source.substring(a.startOffset, a.endOffset)),
          a.startOffset
        );
    return new xe($e(Ve(t.build(r.endOffset - e.startOffset))));
  }
  _parseList() {
    const e = this._events[this._idx].tokenType, t = e === "listOrdered", s = this._consume("enter", e), i = new B(s.startOffset, this._source);
    let o, r, c, a, l, d;
    const u = () => {
      if (o === void 0 || r === void 0 || a === void 0)
        return;
      const f = new b("listItemMarker", this._source.substring(r, c)), m = d ?? c, g = a.build(m - c);
      i.add(new q(f, $e(Ve(g)), l), o);
    };
    for (; this._notExit(e); ) {
      const f = this._events[this._idx];
      if (f.type === "enter" && f.tokenType === "listItemPrefix") {
        for (u(), this._consume("enter", "listItemPrefix"), o = f.startOffset, r = f.startOffset, l = void 0, d = void 0, this._checkChecked = void 0; this._notExit("listItemPrefix"); )
          this._idx++;
        c = this._events[this._idx].endOffset, this._consume("exit", "listItemPrefix"), a = new B(c, this._source);
      } else if (f.type === "enter") {
        const m = f.startOffset, g = this._tryParseBlock();
        if (g && a)
          a.add(g, m), d = m + g.length, l === void 0 && this._checkChecked !== void 0 && (l = this._checkChecked);
        else if (!g) {
          const _ = this._tryParseUnhandled(d ?? c ?? m);
          _ && a && (a.add(_.node, _.start), d = _.start + _.node.length);
        }
      } else
        this._idx++;
    }
    u();
    const h = this._consume("exit", e);
    return new z(t, $e(Ve(i.build(h.endOffset - s.startOffset))));
  }
  _parseTable() {
    const e = this._consume("enter", "table"), t = new B(e.startOffset, this._source);
    let s = 0;
    for (; this._notExit("table"); ) {
      const o = this._events[this._idx];
      if (o.type === "enter" && o.tokenType === "tableHead") {
        for (this._consume("enter", "tableHead"); this._notExit("tableHead"); ) {
          const r = this._events[this._idx];
          if (r.type === "enter" && r.tokenType === "tableRow") {
            const c = this._parseTableRow("tableHeader");
            s = c.cells.length, t.add(c, r.startOffset);
          } else if (r.type === "enter" && r.tokenType === "tableDelimiterRow") {
            const c = r.startOffset;
            for (; this._notExit("tableDelimiterRow"); )
              this._idx++;
            const a = this._events[this._idx].endOffset;
            this._idx++, t.add(this._buildDelimiterRow(c, a, s), c);
          } else
            this._idx++;
        }
        this._consume("exit", "tableHead");
      } else if (o.type === "enter" && o.tokenType === "tableBody") {
        for (this._consume("enter", "tableBody"); this._notExit("tableBody"); ) {
          const r = this._events[this._idx];
          r.type === "enter" && r.tokenType === "tableRow" ? t.add(this._parseTableRow("tableData"), r.startOffset) : this._idx++;
        }
        this._consume("exit", "tableBody");
      } else
        this._idx++;
    }
    const i = this._consume("exit", "table");
    return new Ee(t.build(i.endOffset - e.startOffset));
  }
  _buildDelimiterRow(e, t, s) {
    const i = this._source.substring(e, t), o = [];
    for (let l = 0; l < i.length; l++)
      i[l] === "|" && o.push(l);
    const r = [], c = Math.max(1, s);
    if (i[0] === "|")
      for (let l = 0; l < c && l < o.length; l++)
        r.push(o[l]);
    else {
      r.push(0);
      for (let l = 0; l < c - 1 && l < o.length; l++)
        r.push(o[l]);
    }
    const a = new B(e, this._source);
    for (let l = 0; l < r.length; l++) {
      const d = r[l], u = l + 1 < r.length ? r[l + 1] : i.length, h = new B(e + d, this._source), f = i.substring(d, u);
      l === r.length - 1 && f.length > 1 && f.endsWith("|") ? (h.add(new b("tableDelimiter", f.slice(0, -1)), e + d), h.add(new b("tableDelimiterClose", "|"), e + d + f.length - 1)) : h.add(new b("tableDelimiter", f), e + d), a.add(new Te(h.build(u - d)), e + d);
    }
    return new Me(a.build(t - e));
  }
  _parseTableRow(e) {
    const t = this._consume("enter", "tableRow"), s = new B(t.startOffset, this._source);
    for (; this._notExit("tableRow"); ) {
      const o = this._events[this._idx];
      if (o.type === "enter" && o.tokenType === e) {
        const r = this._consume("enter", e), c = [];
        for (; this._notExit(e); ) {
          const d = this._events[this._idx];
          if (d.type === "enter" && d.tokenType === "tableContent") {
            for (this._consume("enter", "tableContent"); this._notExit("tableContent"); )
              this._parseInlineEvent(c);
            this._consume("exit", "tableContent");
          } else
            this._idx++;
        }
        const a = this._consume("exit", e), l = new B(r.startOffset, this._source);
        for (const d of c)
          l.add(d.node, d.start);
        s.add(new Te(l.build(a.endOffset - r.startOffset, "tableCellGlue")), r.startOffset);
      } else
        this._idx++;
    }
    const i = this._consume("exit", "tableRow");
    return new Me(s.build(i.endOffset - t.startOffset));
  }
  _parseInlines(e, t) {
    for (; this._idx < this._events.length; ) {
      const s = this._events[this._idx];
      if (s.type === "exit" && s.tokenType === t)
        return;
      this._parseInlineEvent(e);
    }
  }
  _parseInlineEvent(e) {
    const t = this._events[this._idx];
    if (t.type === "enter")
      switch (t.tokenType) {
        case "strongSequence":
        case "emphasisSequence":
          this._parseEmphasisOrStrong(e);
          return;
        case "codeText":
          e.push(this._parseInlineCode());
          return;
        case "mathText":
          e.push(this._parseInlineMath());
          return;
        case "link":
          e.push(this._parseLink());
          return;
        case "image":
          e.push(this._parseImage());
          return;
        case "strikethrough":
          e.push(this._parseStrikethrough());
          return;
        case "hardBreakTrailing":
        case "hardBreakEscape":
          e.push(this._parseHardBreak());
          return;
      }
    t.type === "exit" && (t.tokenType === "data" || t.tokenType === "codeTextData") && e.push({ node: new Qe(this._source.substring(t.startOffset, t.endOffset)), start: t.startOffset }), t.type === "exit" && t.tokenType === "taskListCheckValueChecked" ? this._checkChecked = !0 : t.type === "exit" && t.tokenType === "taskListCheckValueUnchecked" && (this._checkChecked = !1), this._idx++;
  }
  /**
   * A GFM hard line break — either two-or-more trailing spaces
   * (`hardBreakTrailing`) or a backslash (`hardBreakEscape`) — followed by the
   * line ending it forces. Both halves are absorbed into a single
   * `hardBreak` marker, so the node *is* the whole break: a bare `lineEnding`
   * (a soft break) is never matched here and stays glue that collapses to a
   * space. Whether the line ending breaks is thus micromark's call, not ours.
   */
  _parseHardBreak() {
    const e = this._events[this._idx], t = e.tokenType;
    for (this._consume("enter", t); this._notExit(t); )
      this._idx++;
    let s = this._consume("exit", t).endOffset;
    const i = this._events[this._idx];
    return i && i.type === "enter" && i.tokenType === "lineEnding" && (this._consume("enter", "lineEnding"), s = this._consume("exit", "lineEnding").endOffset), { node: new b("hardBreak", this._source.substring(e.startOffset, s)), start: e.startOffset };
  }
  _parseEmphasisOrStrong(e) {
    const t = this._events[this._idx].tokenType, s = t === "strongSequence", i = this._consume("enter", t), o = this._consume("exit", t), r = [];
    for (; this._idx < this._events.length; ) {
      const c = this._events[this._idx];
      if (c.type === "enter" && c.tokenType === t) {
        const a = this._consume("enter", t), l = this._consume("exit", t), d = new b("openMarker", this._source.substring(i.startOffset, o.endOffset)), u = new b("closeMarker", this._source.substring(a.startOffset, l.endOffset)), h = new B(o.endOffset, this._source);
        for (const g of r)
          h.add(g.node, g.start);
        const f = h.build(a.startOffset - o.endOffset), m = s ? new Wt(d, f, u) : new Ht(d, f, u);
        e.push({ node: m, start: i.startOffset });
        return;
      }
      this._parseInlineEvent(r);
    }
    e.push({ node: new Qe(this._source.substring(i.startOffset, o.endOffset)), start: i.startOffset });
  }
  _parseInlineCode() {
    const e = this._consume("enter", "codeText"), t = new B(e.startOffset, this._source);
    let s = !1, i, o;
    for (; this._notExit("codeText"); ) {
      const c = this._events[this._idx];
      c.type === "enter" && c.tokenType === "codeTextSequence" ? (t.add(new b(s ? "closeMarker" : "openMarker", this._source.substring(c.startOffset, c.endOffset)), c.startOffset), s = !0) : c.type === "enter" && c.tokenType === "codeTextData" && (i === void 0 && (i = c.startOffset), o = c.endOffset), this._idx++;
    }
    const r = this._consume("exit", "codeText");
    return i !== void 0 && t.add(new b("content", this._source.substring(i, o)), i), { node: new zt(t.build(r.endOffset - e.startOffset)), start: e.startOffset };
  }
  _parseInlineMath() {
    const e = this._consume("enter", "mathText"), t = new B(e.startOffset, this._source);
    let s = !1, i, o;
    for (; this._notExit("mathText"); ) {
      const c = this._events[this._idx];
      c.type === "enter" && c.tokenType === "mathTextSequence" ? (t.add(new b(s ? "closeMarker" : "openMarker", this._source.substring(c.startOffset, c.endOffset)), c.startOffset), s = !0) : c.type === "enter" && c.tokenType === "mathTextData" && (i === void 0 && (i = c.startOffset), o = c.endOffset), this._idx++;
    }
    const r = this._consume("exit", "mathText");
    return i !== void 0 && t.add(new b("content", this._source.substring(i, o)), i), { node: new qt(t.build(r.endOffset - e.startOffset)), start: e.startOffset };
  }
  _parseStrikethrough() {
    const e = this._consume("enter", "strikethrough");
    let t, s, i = e.startOffset, o = e.startOffset;
    const r = [];
    for (; this._notExit("strikethrough"); ) {
      const l = this._events[this._idx];
      if (l.type === "enter" && l.tokenType === "strikethroughSequence") {
        const d = this._source.substring(l.startOffset, l.endOffset);
        t ? (s = new b("closeMarker", d), o = l.startOffset) : (t = new b("openMarker", d), i = l.endOffset), this._idx++;
      } else l.type === "enter" && l.tokenType === "strikethroughText" ? (this._consume("enter", "strikethroughText"), this._parseInlines(r, "strikethroughText"), this._consume("exit", "strikethroughText")) : this._idx++;
    }
    this._consume("exit", "strikethrough");
    const c = new B(i, this._source);
    for (const l of r)
      c.add(l.node, l.start);
    const a = c.build(o - i);
    return { node: new Kt(t, a, s), start: e.startOffset };
  }
  _parseLink() {
    const e = this._consume("enter", "link"), t = new B(e.startOffset, this._source), s = [];
    let i = "", o = !1;
    for (; this._notExit("link"); ) {
      const c = this._events[this._idx];
      if (c.type === "enter" && c.tokenType === "label") {
        for (this._consume("enter", "label"); this._notExit("label"); ) {
          const a = this._events[this._idx];
          if (a.type === "enter" && a.tokenType === "labelMarker")
            t.add(new b(o ? "closeBracket" : "openBracket", this._source.substring(a.startOffset, a.endOffset)), a.startOffset), o = !0;
          else if (a.type === "enter" && a.tokenType === "labelText") {
            this._consume("enter", "labelText"), this._parseInlines(s, "labelText"), this._consume("exit", "labelText");
            continue;
          }
          this._idx++;
        }
        this._consume("exit", "label");
      } else if (c.type === "enter" && c.tokenType === "resource") {
        this._consume("enter", "resource");
        let a = !1;
        for (; this._notExit("resource"); ) {
          const l = this._events[this._idx];
          l.type === "enter" && l.tokenType === "resourceMarker" ? (t.add(new b(a ? "closeParen" : "openParen", this._source.substring(l.startOffset, l.endOffset)), l.startOffset), a = !0) : l.type === "enter" && l.tokenType === "resourceDestinationString" && (i = this._source.substring(l.startOffset, l.endOffset), t.add(new b("url", i), l.startOffset)), this._idx++;
        }
        this._consume("exit", "resource");
      } else
        this._idx++;
    }
    const r = this._consume("exit", "link");
    for (const c of s)
      t.add(c.node, c.start);
    return { node: new Ne(i, t.build(r.endOffset - e.startOffset)), start: e.startOffset };
  }
  _parseImage() {
    const e = this._consume("enter", "image"), t = new B(e.startOffset, this._source);
    let s = "", i = "", o = !1;
    for (; this._notExit("image"); ) {
      const c = this._events[this._idx];
      if (c.type === "enter" && c.tokenType === "label") {
        for (this._consume("enter", "label"); this._notExit("label"); ) {
          const a = this._events[this._idx];
          a.type === "enter" && a.tokenType === "labelImageMarker" ? t.add(new b("bangBracket", this._source.substring(a.startOffset, a.endOffset)), a.startOffset) : a.type === "enter" && a.tokenType === "labelMarker" ? (t.add(new b(o ? "closeBracket" : "openBracket", this._source.substring(a.startOffset, a.endOffset)), a.startOffset), o = !0) : a.type === "enter" && a.tokenType === "labelText" && (s = this._source.substring(a.startOffset, a.endOffset)), this._idx++;
        }
        this._consume("exit", "label");
      } else if (c.type === "enter" && c.tokenType === "resource") {
        this._consume("enter", "resource");
        let a = !1;
        for (; this._notExit("resource"); ) {
          const l = this._events[this._idx];
          l.type === "enter" && l.tokenType === "resourceMarker" ? (t.add(new b(a ? "closeParen" : "openParen", this._source.substring(l.startOffset, l.endOffset)), l.startOffset), a = !0) : l.type === "enter" && l.tokenType === "resourceDestinationString" && (i = this._source.substring(l.startOffset, l.endOffset)), this._idx++;
        }
        this._consume("exit", "resource");
      } else
        this._idx++;
    }
    const r = this._consume("exit", "image");
    return { node: new Ie(s, i, t.build(r.endOffset - e.startOffset)), start: e.startOffset };
  }
  _notExit(e) {
    if (this._idx >= this._events.length)
      return !1;
    const t = this._events[this._idx];
    return !(t.type === "exit" && t.tokenType === e);
  }
  _consume(e, t) {
    const s = this._events[this._idx];
    if (!s || s.type !== e || s.tokenType !== t)
      throw new Error(`Expected ${e}:${t} at ${this._idx}, got ${s?.type}:${s?.tokenType}`);
    return this._idx++, s;
  }
}
class Ss {
  constructor(e) {
    this._edit = e;
  }
  /**
   * The original range corresponding to `mod`, or `undefined` if `mod`
   * overlaps any replaced/inserted text (i.e. is not provably unchanged).
   */
  getOriginalRange(e) {
    let t = 0;
    for (const s of this._edit.replacements) {
      const i = s.replaceRange.start + t;
      if (i >= e.endExclusive)
        break;
      const o = i + s.newText.length;
      if (Math.max(i, e.start) < Math.min(o, e.endExclusive))
        return;
      t += s.newText.length - s.replaceRange.length;
    }
    return e.delta(-t);
  }
  /** The original offset for `mod`, or `undefined` if it falls inside inserted text. */
  getOriginalOffset(e) {
    let t = 0;
    for (const s of this._edit.replacements) {
      const i = s.replaceRange.start + t;
      if (e < i)
        break;
      if (e < i + s.newText.length)
        return;
      t += s.newText.length - s.replaceRange.length;
    }
    return e - t;
  }
}
class Ki {
  _byRange = /* @__PURE__ */ new Map();
  _byId = /* @__PURE__ */ new Map();
  constructor(e) {
    this._walk(e, 0);
  }
  _walk(e, t) {
    const s = `${t}:${t + e.length}`;
    let i = this._byRange.get(s);
    i || (i = [], this._byRange.set(s, i)), i.push(e), this._byId.set(`${t}:${e.kind}`, e);
    let o = t;
    for (const r of e.children)
      this._walk(r, o), o += r.length;
  }
  /** The old node spanning exactly `range` with the given `kind`, if any. */
  lookupExact(e, t) {
    return this._byRange.get(`${e.start}:${e.endExclusive}`)?.find((s) => s.kind === t);
  }
  /** The old node that began at `originalStart` with the given `kind`. */
  lookupId(e, t) {
    return this._byId.get(`${e}:${t}`);
  }
}
function Ls(n, e, t, s, i) {
  let o, r = e;
  for (const u of n.children) {
    const h = Ls(u, r, t, s, i);
    h !== u && (o ??= /* @__PURE__ */ new Map()).set(u, h), r += u.length;
  }
  let c = o ? n.mapChildren(o) : n;
  const a = t.getOriginalRange(v.ofStartAndLength(e, n.length));
  if (a) {
    const u = s.lookupExact(a, c.kind);
    if (u && c.equalsShallow(u))
      return u;
  }
  const l = t.getOriginalOffset(e), d = l !== void 0 ? s.lookupId(l, c.kind) : void 0;
  if (d && d.id !== c.id && (c = c.cloneWithId(d.id)), c instanceof j && d instanceof j && l !== void 0) {
    const u = zi(c, d, l, i);
    if (u)
      return u;
  }
  return c;
}
function zi(n, e, t, s) {
  const i = e.code, o = n.code;
  if (!i || !o || n.infoString !== e.infoString || n.openFence?.content !== e.openFence?.content || n.closeFence?.content !== e.closeFence?.content)
    return;
  const r = t + e.codeOffset, c = r + i.length;
  if (!qi(s, r, c))
    return;
  const a = Ui(s, -r);
  if (a.apply(i.content) === o.content)
    return n.withCodeDiff(e, a);
}
function qi(n, e, t) {
  for (const s of n.replacements)
    if (s.replaceRange.start < e || s.replaceRange.endExclusive > t)
      return !1;
  return !0;
}
function Ui(n, e) {
  return new S(n.replacements.map((t) => le.replace(t.replaceRange.delta(e), t.newText)));
}
function Xi(n, e, t) {
  return Ls(n, 0, new Ss(t), new Ki(e), t);
}
function Gi(n, e, t) {
  const s = Fi(n);
  return !e || !t ? s : Xi(s, e, t);
}
class Yi {
  parse(e, t, s) {
    return Gi(e.value, t, s);
  }
}
function Qi(n, e, t = 0) {
  if (n.children.length === 0) {
    const o = Ms(e.substring(t, t + n.length));
    if (n instanceof Qe)
      return o;
    const r = n instanceof b ? n.markerKind : n.kind;
    return `<${r}${an(n)}>${o}</${r}>`;
  }
  let s = "", i = t;
  for (const o of n.children)
    s += Qi(o, e, i), i += o.length;
  return `<${n.kind}${an(n)}>${s}</${n.kind}>`;
}
function an(n) {
  const e = {};
  return n instanceof he ? e.level = String(n.level) : n instanceof z ? e.ordered = String(n.ordered) : n instanceof j ? n.language && (e.language = n.language) : n instanceof Ne ? e.url = n.url : n instanceof Ie ? (e.alt = n.alt, e.url = n.url) : n instanceof q ? n.checked !== void 0 && (e.checked = String(n.checked)) : n instanceof pe ? e.token = n.tokenType : n instanceof $ && n.glueKind && (e.kind = n.glueKind), Object.entries(e).map(([t, s]) => ` ${t}="${Ms(s)}"`).join("");
}
function Ms(n) {
  return n.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function ji(n) {
  return n instanceof Qe ? `text ${JSON.stringify(n.content)}` : n instanceof $ ? `glue${n.glueKind ? `(${n.glueKind})` : ""} ${JSON.stringify(n.content)}` : n instanceof b ? `marker(${n.markerKind}) ${JSON.stringify(n.content)}` : n instanceof ge ? `thematicBreak ${JSON.stringify(n.content)}` : n instanceof he ? `heading(level=${n.level})` : n instanceof z ? `list(ordered=${n.ordered})` : n instanceof q ? n.checked === void 0 ? "listItem" : `listItem(checked=${n.checked})` : n instanceof j ? `codeBlock(language=${JSON.stringify(n.language)})` : n instanceof _e ? "mathBlock" : n instanceof Ne ? `link(url=${JSON.stringify(n.url)})` : n instanceof Ie ? `image(alt=${JSON.stringify(n.alt)}, url=${JSON.stringify(n.url)})` : n.kind;
}
const ln = /* @__PURE__ */ new WeakMap();
let Zi = 0;
function Ji(n) {
  let e = ln.get(n);
  return e === void 0 && (e = Zi++, ln.set(n, e)), e;
}
function fl(n, e) {
  let t = 0;
  function s(i) {
    const o = t, r = i.children;
    let c;
    return r.length === 0 ? t += i.length : c = r.map(s), { label: `${ji(i)}  #${Ji(i)} nid=${i.id}`, range: [o, t], children: c };
  }
  return { $fileExtension: "ast.w", source: e, root: s(n) };
}
function eo(n) {
  let e = 0;
  const t = [];
  for (const s of n.replacements) {
    const i = s.replaceRange.start + e;
    t.push({
      original: s.replaceRange,
      modified: v.ofStartAndLength(i, s.newText.length)
    }), e += s.newText.length - s.replaceRange.length;
  }
  return t;
}
const to = {}, Ts = x(to, !1), no = Ts;
let Ct, ft;
function so() {
  return ft || (ft = Ri({ useWasm: !1 }).then((n) => {
    Ct = n, Ts.set(!0, void 0);
  }).catch(() => {
  })), ft;
}
so();
function io(n, e) {
  if (!Ct)
    throw new Error("Diff computer not loaded yet — await ensureDiffComputer() / observe diffComputerReady first.");
  const t = Ct.computeDiff(n, e, { extendToSubwords: !0 });
  return oo(t.edits.stripData());
}
function oo(n) {
  return new S(n.replacements.map((e) => le.replace(new v(e.range.start, e.range.endExclusive), e.newText)));
}
const ro = /* @__PURE__ */ new Set([
  "document",
  "list",
  "blockQuote",
  "table",
  "tableRow"
]), co = /* @__PURE__ */ new Set(["glue", "marker"]);
function ao(n, e, t) {
  const s = new Ss(t), i = eo(t);
  return Os(n, 0, e, 0, s, i);
}
function Os(n, e, t, s, i, o) {
  const r = dn(n, e), c = dn(t, s), a = [];
  let l = 0;
  for (const d of c) {
    const u = v.ofStartAndLength(d.start, d.node.length), h = i.getOriginalOffset(d.start);
    for (; l < r.length && h !== void 0 && r[l].start + r[l].node.length <= h; )
      a.push(hn(r[l], o)), l++;
    const f = l < r.length ? r[l] : void 0, m = f ? v.ofStartAndLength(f.start, f.node.length) : void 0, g = i.getOriginalRange(u);
    g && m && g.equals(m) ? (a.push({ kind: "unchanged", node: d.node, modifiedStart: d.start }), l++) : f && m && f.node.kind === d.node.kind && h !== void 0 && m.contains(h) ? (l++, ro.has(d.node.kind) ? a.push({
      kind: "nested",
      original: f.node,
      originalStart: f.start,
      modified: d.node,
      modifiedStart: d.start,
      children: Os(f.node, f.start, d.node, d.start, i, o)
    }) : a.push({
      kind: "replaced",
      original: f.node,
      originalStart: f.start,
      modified: d.node,
      modifiedStart: d.start,
      insertedLocal: je(u, d.start, o, "modified", "inserted"),
      deletedLocal: je(m, f.start, o, "original", "deleted")
    })) : a.push(lo(d, o));
  }
  for (; l < r.length; )
    a.push(hn(r[l], o)), l++;
  return a;
}
function dn(n, e) {
  const t = [];
  let s = e;
  for (const i of n.children)
    co.has(i.kind) || t.push({ node: i, start: s }), s += i.length;
  return t;
}
function lo(n, e) {
  const t = v.ofStartAndLength(n.start, n.node.length);
  let s = je(t, n.start, e, "modified", "inserted");
  return s.length === 0 && (s = [{ range: v.ofLength(n.node.length), kind: "inserted" }]), { kind: "added", node: n.node, modifiedStart: n.start, insertedLocal: s };
}
function hn(n, e) {
  const t = v.ofStartAndLength(n.start, n.node.length);
  let s = je(t, n.start, e, "original", "deleted");
  return s.length === 0 && (s = [{ range: v.ofLength(n.node.length), kind: "deleted" }]), { kind: "removed", node: n.node, originalStart: n.start, deletedLocal: s };
}
function je(n, e, t, s, i) {
  const o = [];
  for (const r of t) {
    const a = (s === "original" ? r.original : r.modified).intersect(n);
    a && !a.isEmpty && o.push({ range: a.delta(-e), kind: i });
  }
  return o;
}
const ho = Symbol("NO_ACTIVE_BLOCKS");
class ml {
  _parser = new Yi();
  _sourceEditListeners = /* @__PURE__ */ new Set();
  _sourceTextIds = /* @__PURE__ */ new WeakMap();
  _lastSourceTextId = 0;
  /**
   * The most recent edit applied to {@link sourceText}, used by
   * {@link document} to let the parser link incrementally edited code
   * blocks. Only trusted when it exactly bridges the previous and current
   * source text (see {@link document}).
   */
  _pendingEdit;
  sourceText = x(this, new cn(""));
  wordNavigationConfig = x(this, vi);
  /**
   * Read-only mode. When `true`, the editor never reveals a block's source
   * markers (markdown special characters like `**`, `#`, list bullets, code
   * fences, `$…$`) — every block stays in its clean rendered form regardless of
   * where the caret/selection is — and text-editing commands are ignored.
   * Explicit interactions with rendered controls, such as task checkboxes,
   * remain available. Plain text selection still works everywhere (so the user
   * can copy). The default (`false`) is the normal editing mode where the active
   * block reveals its markers.
   */
  readonlyMode = x(this, !1);
  /**
   * The current selection, or `undefined` when the editor has no caret
   * (e.g. an inactive/unfocused rendering).
   */
  selection = x(this, void 0);
  selectionSource = x(this, "user");
  /**
   * Whether a Ctrl/Cmd modifier is currently held. Set by the controller from
   * live keyboard state; the view reads it to show the link-open affordance
   * (underline + pointer cursor) only while a Ctrl/Cmd+click would open a link
   * whose block is active.
   */
  ctrlOrMetaDown = x(this, !1);
  /**
   * Whether a pointer-driven selection drag is currently in progress. Set by
   * the controller between the pointer-down that starts the drag and the
   * pointer-up/cancel that ends it. Contributions read it to defer UI that
   * would otherwise flicker mid-drag (e.g. the comment input box appears only
   * once the drag ends).
   */
  isSelecting = x(this, !1);
  /**
   * Gutter markers (source-control style change indicators) painted in the
   * left gutter. Each entry maps a source {@link OffsetRange} to a change kind
   * — see {@link GutterMarker}. Purely decorative: markers never affect the
   * parsed {@link document}, selection, or layout. Empty by default.
   */
  gutterMarkers = x(this, []);
  /**
   * Forces the rendered active-block set. `undefined` (the default)
   * derives the set from the current selection range (see
   * {@link activeBlocks}). The sentinel {@link NO_ACTIVE_BLOCKS} forces
   * "no active block" — useful in fixtures that always want the
   * collapsed/inactive rendering.
   */
  activeBlocksOverride = x(this, void 0);
  /**
   * The transient empty-paragraph editing state, or `undefined` when none is
   * armed. See {@link PendingParagraph}. This is *not* document data — it is
   * cleared by any source edit and lives only between the Enter that armed it
   * and the next content-producing edit.
   */
  pendingParagraph = x(this, void 0);
  cursorOffset = I(
    this,
    (e) => e.readObservable(this.selection)?.active
  );
  cursorPosition = I(this, (e) => {
    const t = e.readObservable(this.pendingParagraph);
    if (t)
      return O.virtual(t.cursorLine);
    const s = e.readObservable(this.selection)?.active;
    return s === void 0 ? void 0 : O.source(s);
  });
  /**
   * The parsed document. Threads the previous document into the parser so
   * unchanged blocks keep their object identity across reparses (see
   * {@link MarkdownParser.parse}). Writing `previous` inside the compute is
   * safe: unchanged source reuses it directly, while changed source produces
   * a result structurally identical to a full reparse.
   */
  document = (() => {
    let e, t;
    return I(this, (s) => {
      const i = s.readObservable(this.sourceText);
      if (e && t === i.value)
        return e;
      const o = this._pendingEdit, r = o && o.baseText === t && o.newText === i.value ? o.edit : void 0, c = this._parser.parse(i, e, r);
      return e = c, t = i.value, c;
    });
  })();
  /**
   * Block that contains the cursor (selection's active end). Used by
   * cursor navigation to know which block's marker ranges count as
   * visible. Unaffected by {@link activeBlocksOverride} because
   * navigation is independent of rendering.
   */
  activeBlock = I(this, (e) => {
    const t = e.readObservable(this.document), s = e.readObservable(this.cursorOffset);
    if (s !== void 0)
      return Gt(t, s);
  });
  /**
   * All blocks whose source range intersects the current selection.
   * The rendering side uses this to decide which blocks render in
   * their expanded (markers-visible) form. When the selection is
   * collapsed this is a one-element set holding {@link activeBlock}.
   */
  activeBlocks = I(this, (e) => {
    if (this.readonlyMode.read(e))
      return /* @__PURE__ */ new Set();
    if (e.readObservable(this.pendingParagraph) !== void 0)
      return /* @__PURE__ */ new Set();
    const t = e.readObservable(this.activeBlocksOverride);
    if (t === ho)
      return /* @__PURE__ */ new Set();
    if (t !== void 0)
      return new Set(t);
    const s = e.readObservable(this.document), i = e.readObservable(this.selection);
    return i === void 0 ? /* @__PURE__ */ new Set() : new Set(St(s, i.range.start, i.range.endExclusive));
  });
  /**
   * The baseline document to diff against. When set, the editor renders in
   * diff mode: the modified document ({@link document}) stays editable, while
   * the baseline's removed/changed blocks are shown as read-only decorations.
   * `undefined` (the default) renders normally.
   */
  baseline = x(this, void 0);
  _baselineDocument = I(this, (e) => {
    const t = e.readObservable(this.baseline);
    return t ? this._parser.parse(t) : void 0;
  });
  /**
   * The diff of {@link baseline} → {@link document}, or `undefined` when no
   * baseline is set. The view renders the {@link DiffItem}s as stacked
   * decorations; `insertedRanges` (modified-side change spans) drive the green
   * word-level highlight.
   */
  diff = I(this, (e) => {
    const t = e.readObservable(this._baselineDocument), s = e.readObservable(this.baseline);
    if (!t || !s || !e.readObservable(no))
      return;
    const i = e.readObservable(this.document), o = e.readObservable(this.sourceText), r = io(s.value, o.value), c = ao(t, i, r), a = [], l = (u, h) => {
      for (const f of u)
        if (f.kind === "replaced")
          for (const m of f.insertedLocal)
            a.push(m.range.delta(f.modifiedStart));
        else if (f.kind === "added" && !h)
          for (const m of f.insertedLocal)
            a.push(m.range.delta(f.modifiedStart));
        else f.kind === "nested" && l(f.children, !1);
    };
    l(c, !0);
    const d = /* @__PURE__ */ new Set();
    for (const u of c)
      u.kind === "replaced" && d.add(u.modified);
    return { items: c, insertedRanges: a, changedBlocks: d };
  });
  markerVisibleBlocks = I(this, (e) => {
    const t = e.readObservable(this.activeBlocks), s = e.readObservable(this.diff), i = this.readonlyMode.read(e) ? [] : e.readObservable(this.document).blocks.filter(
      (o) => o.kind === "codeBlock" && o.openFence !== void 0 && o.closeFence === void 0
    );
    return !s && i.length === 0 ? t : /* @__PURE__ */ new Set([
      ...t,
      ...s?.changedBlocks ?? [],
      ...i
    ]);
  });
  onWillApplySourceEdit(e) {
    return this._sourceEditListeners.add(e), { dispose: () => this._sourceEditListeners.delete(e) };
  }
  /** Returns a stable per-object identity without retaining the source text. */
  getSourceTextId(e) {
    let t = this._sourceTextIds.get(e);
    return t === void 0 && (t = ++this._lastSourceTextId, this._sourceTextIds.set(e, t)), t;
  }
  /**
   * Arm a {@link PendingParagraph} at the given gap, minting a fresh synthetic
   * AST node for it, and park the caret at the gap start. No source edit is
   * applied — the blank line exists only in the view until it is materialized.
   */
  armPendingParagraph(e) {
    te((t) => {
      this.pendingParagraph.set({
        ...e,
        text: "",
        cursorLine: new Ni(e.replaceRange.start, e.replaceRange.endExclusive),
        syntheticAst: new ie([])
      }, t), this.selectionSource.set("user", t), this.selection.set(k.collapsed(e.replaceRange.start), t);
    });
  }
  /** Discard the pending paragraph (if any) without touching the source. */
  cancelPendingParagraph() {
    this.pendingParagraph.get() !== void 0 && this.pendingParagraph.set(void 0, void 0);
  }
  /**
   * Replace the source with an authoritative value from the host, mapping the
   * selection through the changed span and atomically discarding transient
   * state anchored to the previous parse.
   */
  replaceSourceText(e) {
    const t = this.sourceText.get(), s = bs(t.value, e.value), i = this.selection.get(), o = i ? new k(
      We(s.mapOffset(We(i.anchor, t.value.length)), e.value.length),
      We(s.mapOffset(We(i.active, t.value.length)), e.value.length)
    ) : void 0;
    s.isEmpty || (this._pendingEdit = { baseText: t.value, newText: e.value, edit: s }), te((r) => {
      this.pendingParagraph.set(void 0, r), s.isEmpty || this.sourceText.set(e, r), o !== i && this.selection.set(o, r);
    });
  }
  /** Replace the transient horizontal whitespace on the pending line. */
  setPendingParagraphText(e) {
    if (this.readonlyMode.get())
      return;
    if (!/^[ \t]*$/.test(e))
      throw new TypeError("Pending paragraph text must contain only spaces and tabs");
    const t = this.pendingParagraph.get();
    !t || t.text === e || this.pendingParagraph.set({ ...t, text: e }, void 0);
  }
  /**
   * Turn the pending paragraph into real source: rewrite its gap so the typed
   * text, including any transient indentation, is separated from its neighbours
   * by blank lines, and place the caret after it.
   */
  materializePendingParagraph(e) {
    if (this.readonlyMode.get())
      return;
    const t = this.pendingParagraph.get();
    if (!t)
      return;
    const s = t.text + e, i = t.separateFromPreviousBlock ? `

` : "", o = i + s + (t.atEof ? "" : `

`), r = t.replaceRange.start + i.length + s.length, c = S.replace(t.replaceRange, o);
    this._applySourceEdit(c, k.collapsed(r));
  }
  /** Sets a rendered task checkbox state in either editing or read-only mode. */
  setTaskCheckboxChecked(e, t) {
    if (e.checked === t)
      return;
    const s = U(this.document.get(), e), i = Ai(e);
    if (s === void 0 || i === void 0)
      return;
    const o = S.replace(i.delta(s), t ? "[x]" : "[ ]");
    this._applySourceEdit(o, this.selection.get() ?? k.collapsed(0));
  }
  applyEdit(e, t) {
    if (this.readonlyMode.get())
      return;
    const s = this.selection.get() ?? k.collapsed(0), i = e.mapOffset(s.active);
    this._applySourceEdit(e, t ?? k.collapsed(i));
  }
  applyEditForSelection(e) {
    if (this.readonlyMode.get())
      return;
    const t = this.selection.get() ?? k.collapsed(0), s = e.mapOffset(t.range.endExclusive);
    this._applySourceEdit(e, k.collapsed(s));
  }
  _applySourceEdit(e, t) {
    const s = this.sourceText.get(), i = new cn(e.apply(s.value));
    this._pendingEdit = { baseText: s.value, newText: i.value, edit: e };
    const o = this._identifySourceEdit(s, i);
    te((r) => {
      this._emitWillApplySourceEdit({ ...o, edit: e, transaction: r }), this.pendingParagraph.set(void 0, r), this.sourceText.set(i, r), this.selectionSource.set("user", r), this.selection.set(t, r);
    });
  }
  _identifySourceEdit(e, t) {
    return {
      baseSourceTextId: this.getSourceTextId(e),
      resultSourceTextId: this.getSourceTextId(t)
    };
  }
  _emitWillApplySourceEdit(e) {
    for (const t of this._sourceEditListeners)
      t(e);
  }
}
function We(n, e) {
  return Math.max(0, Math.min(n, e));
}
function Gt(n, e) {
  const t = new Set(n.blocks);
  let s = 0, i;
  for (const o of n.children) {
    const r = s + o.length;
    if (t.has(o)) {
      if (s <= e && e < r)
        return o;
      r === e && (i = o);
    }
    s = r;
  }
  return i;
}
function St(n, e, t) {
  if (e === t) {
    const r = Gt(n, e);
    return r ? [r] : [];
  }
  const s = [], i = new Set(n.blocks);
  let o = 0;
  for (const r of n.children) {
    const c = o + r.length;
    i.has(r) && o < t && c > e && s.push(r), o = c;
  }
  return s;
}
class Pe {
  constructor(e) {
    this.lines = e, this.sourceLines = e.filter((t) => !t.virtualCursorLine);
  }
  static EMPTY = new Pe([]);
  static measure(e, t, s = t.capture()) {
    return mo(e, t, s);
  }
  /** Lines backed by source ranges, excluding source-less cursor lines. */
  sourceLines;
  get lineCount() {
    return this.lines.length;
  }
  get isEmpty() {
    return this.lines.length === 0;
  }
  lineRect(e) {
    return this.lines[e].rect;
  }
  // ---- SourceOffset → ... -------------------------------------------
  /**
   * Line whose runs cover the offset, or the nearest line by source
   * distance if no run covers it.
   *
   * An offset that is only a run's *trailing* boundary (`offset ===
   * endExclusive`) — most notably the source offset just past a
   * line-breaking `\n`, which a zero-width run reports as its end on the line
   * it terminates — belongs to the START of the NEXT line instead. Preferring
   * the line that actually *starts* the offset makes the caret advance past a
   * newline to the next line rather than collapsing onto the previous line's
   * end (which would render two distinct offsets at the same caret position).
   * The first such trailing-boundary line is remembered as a fallback for the
   * document's very last offset, where no later line starts it.
   */
  lineIndexOfOffset(e) {
    let t = -1;
    for (let o = 0; o < this.lines.length; o++) {
      if (this.lines[o].virtualCursorLine)
        continue;
      const r = this.lines[o].offsetMembership(e);
      if (r === "covers")
        return o;
      r === "end" && t < 0 && (t = o);
    }
    if (t >= 0)
      return t;
    let s = 0, i = 1 / 0;
    for (let o = 0; o < this.lines.length; o++) {
      if (this.lines[o].virtualCursorLine)
        continue;
      const r = this.lines[o].sourceDistanceTo(e);
      r < i && (i = r, s = o);
    }
    return s;
  }
  /**
   * x of the caret position before `offset`, on the line returned by
   * {@link lineIndexOfOffset}. Returns `0` when the map is empty.
   */
  xAtOffset(e) {
    return this.lines.length === 0 ? 0 : this.lines[this.lineIndexOfOffset(e)].xAtOffset(e);
  }
  /**
   * Line occupied by a source or virtual cursor position. A virtual position
   * returns `undefined` until its corresponding DOM line has been measured.
   */
  lineIndexOfPosition(e) {
    if (e.kind === "source")
      return this.lineIndexOfOffset(e.offset);
    const t = this.lines.findIndex((s) => s.virtualCursorLine === e.line);
    return t < 0 ? void 0 : t;
  }
  xAtPosition(e) {
    if (e.kind === "source")
      return this.xAtOffset(e.offset);
    const t = this.lineIndexOfPosition(e);
    return t === void 0 ? 0 : this.lines[t].rect.left;
  }
  // ---- Point2D → ... -------------------------------------------------
  /**
   * Line whose vertical band contains `y`, clamped to the first/last
   * line when `y` is outside the document.
   */
  lineIndexAtY(e) {
    if (this.lines.length === 0)
      return 0;
    for (let t = 0; t < this.lines.length; t++)
      if (!this.lines[t].virtualCursorLine && e < this.lines[t].rect.bottom)
        return t;
    for (let t = this.lines.length - 1; t >= 0; t--)
      if (!this.lines[t].virtualCursorLine)
        return t;
    return 0;
  }
  /**
   * Snap a 2D point to the nearest source offset. Uses `y` to pick a
   * line, then `x` to pick an offset within it. Up/down navigation
   * uses {@link offsetInLineAtX} directly to preserve desired column.
   */
  offsetAtPoint(e) {
    return this.offsetInLineAtX(this.lineIndexAtY(e.y), e.x);
  }
  /** Snap `x` to the nearest offset on a specific line. */
  offsetInLineAtX(e, t) {
    if (e < 0 || e >= this.lines.length)
      return 0;
    const s = this.lines[e].virtualCursorLine;
    return s ? s.sourceOffsetBefore : this.lines[e].offsetAtX(t);
  }
  positionInLineAtX(e, t) {
    if (e < 0 || e >= this.lines.length)
      return O.source(0);
    const s = this.lines[e].virtualCursorLine;
    return s ? O.virtual(s) : O.source(this.lines[e].offsetAtX(t));
  }
  lineStartOffset(e) {
    if (e < 0 || e >= this.lines.length)
      return;
    const t = this.lines[e];
    if (!t.virtualCursorLine)
      return t.offsetAtX(t.rect.left);
  }
  lineEndOffset(e) {
    if (e < 0 || e >= this.lines.length)
      return;
    const t = this.lines[e];
    if (!t.virtualCursorLine)
      return t.offsetAtX(t.rect.right);
  }
}
class ot {
  constructor(e, t, s) {
    this.rect = e, this.runs = t, this.virtualCursorLine = s;
  }
  static virtual(e, t) {
    return new ot(
      t,
      [me.visualLineAnchor(e.sourceOffsetBefore, t.withZeroWidthAt(t.left))],
      e
    );
  }
  containsOffset(e) {
    for (const t of this.runs)
      if (t.containsOffset(e))
        return !0;
    return !1;
  }
  /**
   * How `offset` relates to this line's runs:
   *   - `'covers'`: a run starts at or strictly contains the offset
   *     (`start <= offset < endExclusive`), or a zero-length visual-line
   *     anchor sits at the offset — the caret belongs on this line.
   *   - `'end'`: the offset is only some run's trailing boundary
   *     (`offset === endExclusive`) with no run covering it — a line-break
   *     boundary the caret should leave for the next line.
   *   - `'none'`: no run touches the offset.
   */
  offsetMembership(e) {
    let t = !1;
    for (const s of this.runs) {
      if (s.isVisualLineAnchor && e === s.sourceStart || e >= s.sourceStart && e < s.sourceEndExclusive)
        return "covers";
      e === s.sourceEndExclusive && (t = !0);
    }
    return t ? "end" : "none";
  }
  /**
   * Min `|offset - r|` over offsets `r` in any of this line's runs. Used
   * to pick the nearest line when no run actually covers the offset.
   */
  sourceDistanceTo(e) {
    let t = 1 / 0;
    for (const s of this.runs) {
      const i = s.sourceDistanceTo(e);
      i < t && (t = i);
    }
    return t;
  }
  /**
   * x of the caret position before `offset` on this line.
   *
   * The runs tile the source but are stored in paint order, not sorted by
   * source offset (hidden-marker runs are appended last). So this scans all
   * runs rather than assuming any ordering:
   *
   *  - A zero-source visual anchor owns its exact offset, so a marker-only line
   *    wins over the preceding line's inclusive end boundary.
   *  - Otherwise a run starting at `offset` owns that seam. This keeps an
   *    out-of-flow prefix from placing the caret at its trailing edge when the
   *    following body starts at a visually separate x.
   *  - Otherwise, if some run *covers* `offset`, its own geometry places the
   *    caret (exact glyph boundary for text runs). In the active,
   *    markers-visible form every interior offset is covered, so this branch
   *    keeps distinct offsets distinct.
   *  - Otherwise `offset` sits in a gap — a hidden inline marker such as the
   *    `**` of `**bold**`, or before/after the painted text. It snaps to the
   *    seam between the source-nearest runs on either side: the right edge of
   *    the closest run ending at/before `offset`, else the left edge of the
   *    closest run starting at/after it. A hidden marker collapses to zero
   *    width, so both edges coincide at the seam.
   */
  xAtOffset(e) {
    for (const r of this.runs)
      if (r.isVisualLineAnchor && r.sourceStart === e)
        return r.rect.left;
    for (const r of this.runs)
      if (r.sourceStart === e)
        return r.xAtOffset(e);
    for (const r of this.runs)
      if (r.containsOffset(e))
        return r.xAtOffset(e);
    let t, s = -1 / 0, i, o = 1 / 0;
    for (const r of this.runs)
      r.sourceEndExclusive <= e && r.sourceEndExclusive > s && (s = r.sourceEndExclusive, t = r.rect.right), r.sourceStart >= e && r.sourceStart < o && (o = r.sourceStart, i = r.rect.left);
    return t !== void 0 ? t : i !== void 0 ? i : this.runs[0].rect.left;
  }
  /**
   * Snap `x` to the nearest offset on this line. If `x` falls inside a
   * run, the run resolves the offset (exact glyph boundary for text runs,
   * nearer edge for source-less runs); otherwise it snaps to the closer
   * edge of the nearest run.
   */
  offsetAtX(e) {
    if (this.runs.length === 0)
      return 0;
    let t = this.runs[0], s = 1 / 0;
    for (const o of this.runs) {
      if (o.rect.containsX(e) || e === o.rect.right)
        return o.offsetAtX(e);
      const r = Math.min(Math.abs(e - o.rect.left), Math.abs(e - o.rect.right));
      r < s && (s = r, t = o);
    }
    const i = Math.min(Math.max(e, t.rect.left), t.rect.right);
    return t.offsetAtX(i);
  }
}
class me {
  constructor(e, t, s, i = !1) {
    this.sourceRange = e, this.rect = t, this.source = s, this.isVisualLineAnchor = i;
  }
  static visualLineAnchor(e, t) {
    return new me(v.emptyAt(e), t, void 0, !0);
  }
  get sourceStart() {
    return this.sourceRange.start;
  }
  get sourceEndExclusive() {
    return this.sourceRange.endExclusive;
  }
  get sourceLength() {
    return this.sourceRange.length;
  }
  containsOffset(e) {
    return e >= this.sourceStart && e <= this.sourceEndExclusive;
  }
  sourceDistanceTo(e) {
    return e < this.sourceStart ? this.sourceStart - e : e > this.sourceEndExclusive ? e - this.sourceEndExclusive : 0;
  }
  xAtOffset(e) {
    return this.sourceLength === 0 || e <= this.sourceStart ? this.rect.left : this.source ? uo(
      this.source.textNode,
      this.source.textNodeStart + (e - this.sourceStart),
      this.rect.left,
      this.source.coordinateSpace
    ) : (e - this.sourceStart) / this.sourceLength <= 0.5 ? this.rect.left : this.rect.right;
  }
  offsetAtX(e) {
    if (this.rect.width <= 0)
      return this.sourceStart;
    if (this.source) {
      const s = fo(
        this.source.textNode,
        this.source.textNodeStart,
        this.source.textNodeStart + this.sourceLength,
        e,
        this.source.coordinateSpace
      );
      return this.sourceStart + (s - this.source.textNodeStart);
    }
    const t = (this.rect.left + this.rect.right) / 2;
    return e < t ? this.sourceStart : this.sourceEndExclusive;
  }
}
function uo(n, e, t, s) {
  if (e <= 0)
    return t;
  const i = document.createRange();
  i.setStart(n, e - 1), i.setEnd(n, e);
  const o = i.getBoundingClientRect();
  return o.width === 0 && o.height === 0 ? t : s.capture().toLocalRect(o).right;
}
function fo(n, e, t, s, i) {
  const o = document.createRange(), r = i.capture();
  let c = e, a = 1 / 0;
  for (let l = e; l < t; l++) {
    o.setStart(n, l), o.setEnd(n, l + 1);
    const d = o.getBoundingClientRect();
    if (d.width === 0 && d.height === 0)
      continue;
    const u = r.toLocalRect(d), h = (u.left + u.right) / 2, f = Math.abs(s - u.left), m = Math.abs(s - u.right);
    if (f < a && (a = f, c = l), m < a && (a = m, c = l + 1), s >= u.left && s <= u.right)
      return s < h ? l : l + 1;
  }
  return c;
}
function mo(n, e, t) {
  const s = [];
  for (const u of n) {
    const h = s.length;
    u.viewNode.forEachTextLeaf(u.absoluteStart, (f, m) => {
      const g = f.dom;
      if (g.length === 0)
        return;
      const _ = document.createRange();
      _.selectNodeContents(g);
      const p = _.getClientRects();
      if (p.length === 0)
        return;
      const w = go(Array.from(p, (y) => t.toLocalRect(y))), E = _o(g.parentElement);
      if (f.sourceLength === 0) {
        s.push(me.visualLineAnchor(
          m,
          mt(w[0], E)
        ));
        return;
      }
      if (w.length === 1)
        s.push(new me(
          v.fromTo(m, m + g.length),
          mt(w[0], E),
          { textNode: g, textNodeStart: 0, coordinateSpace: e }
        ));
      else {
        const y = po(g, w, t);
        for (let L = 0; L < w.length; L++) {
          const R = L === 0 ? 0 : y[L - 1], V = L < y.length ? y[L] : g.length;
          s.push(new me(
            v.fromTo(m + R, m + V),
            mt(w[L], E),
            { textNode: g, textNodeStart: R, coordinateSpace: e }
          ));
        }
      }
    }), s.length === h && vo(s, u.viewNode, u.absoluteStart, t);
  }
  s.sort((u, h) => u.rect.y - h.rect.y || u.rect.x - h.rect.x);
  const i = [];
  let o = [], r = -1 / 0, c = 0, a = 1 / 0, l = -1 / 0;
  const d = () => {
    o.length !== 0 && i.push(new ot(
      C.fromPointPoint(a, r, l, r + c),
      o
    ));
  };
  for (const u of s) {
    const h = u.rect;
    o.length > 0 && Rs(
      C.fromPointSize(a, r, l - a, c),
      h
    ) ? (o.push(u), c = Math.max(c, h.y + h.height - r), a = Math.min(a, h.left), l = Math.max(l, h.right)) : (d(), o = [u], r = h.y, c = h.height, a = h.left, l = h.right);
  }
  return d(), new Pe(i);
}
function go(n) {
  const e = [];
  for (const t of n) {
    const s = e[e.length - 1];
    if (!s || !Rs(s, t)) {
      e.push(t);
      continue;
    }
    e[e.length - 1] = C.fromPointPoint(
      Math.min(s.left, t.left),
      Math.min(s.top, t.top),
      Math.max(s.right, t.right),
      Math.max(s.bottom, t.bottom)
    );
  }
  return e;
}
function Rs(n, e) {
  return Math.min(n.bottom, e.bottom) - Math.max(n.top, e.top) > Math.min(n.height, e.height) / 2;
}
function po(n, e, t) {
  const s = [], i = document.createRange();
  for (let o = 0; o < e.length - 1; o++) {
    const r = e[o + 1].y;
    let c = o === 0 ? 0 : s[o - 1], a = n.length;
    for (; c < a; ) {
      const l = c + a >>> 1;
      i.setStart(n, l), i.setEnd(n, Math.min(l + 1, n.length)), t.toLocalRect(i.getBoundingClientRect()).y < r - 1 ? c = l + 1 : a = l;
    }
    s.push(c);
  }
  return s;
}
function _o(n) {
  if (!n)
    return 0;
  const e = getComputedStyle(n);
  let t = parseFloat(e.lineHeight);
  return isFinite(t) || (t = parseFloat(e.fontSize) * 1.2), t;
}
function mt(n, e) {
  if (e <= n.height)
    return C.fromPointSize(n.x, n.y, n.width, n.height);
  const t = (e - n.height) / 2;
  return C.fromPointSize(n.x, n.y - t, n.width, e);
}
function vo(n, e, t, s) {
  const i = e.dom;
  if (i.nodeType !== 1)
    return;
  const o = i.getBoundingClientRect();
  if (o.width === 0 && o.height === 0)
    return;
  const r = s.toLocalRect(o);
  n.push(new me(
    v.fromTo(t, t + e.sourceLength),
    C.fromPointSize(r.x, r.y, r.width, r.height)
  ));
}
/**
 * gp-fork: measurement (SFE-P3f — the D13 fix). Translates a previously
 * computed Pe (a block's visual-line map, see mo() above) by a fixed
 * (dx, dy), using C's own unmodified translate(). Every line's rect and
 * every run's rect move by the same amount; sourceRange/source/
 * isVisualLineAnchor are carried over untouched. That is exact ONLY when
 * the caller has already proven the map's absoluteStart is byte-identical
 * to this block's CURRENT absoluteStart (see the __gpCache.absoluteStart
 * check at the one call site below) — sourceRange is an ABSOLUTE document
 * offset baked in by mo(), and this function has no way to shift it, so a
 * caller that invokes this after the block's absoluteStart changed (an
 * edit landed earlier in the document) would silently publish a stale
 * offset<->rect mapping. See PATCHES.md for why the call site's identity
 * check is sound and for the one call site that uses it.
 */
function gpTranslateVisualLineMap(n, e, t) {
  return e === 0 && t === 0 ? n : new Pe(n.lines.map((s) => new ot(
    s.rect.translate(e, t),
    s.runs.map((i) => new me(i.sourceRange, i.rect.translate(e, t), i.source, i.isVisualLineAnchor)),
    s.virtualCursorLine
  )));
}
class wo {
  _measurements = x(this, []);
  measurements = this._measurements;
  _virtualLines = x(this, []);
  /**
   * Concatenated visual line map across all mounted blocks. Every per-block
   * map uses the same editor-local coordinate space, so concatenation is
   * well-formed without translation or re-sorting.
   */
  visualLineMap = I(this, (e) => {
    const t = e.readObservable(this._measurements), s = e.readObservable(this._virtualLines), i = /* @__PURE__ */ new Map();
    for (const r of s) {
      const c = i.get(r.afterBlock);
      c ? c.push(r.line) : i.set(r.afterBlock, [r.line]);
    }
    const o = t.flatMap((r) => [
      ...r.visualLineMap?.lines ?? [],
      ...i.get(r.block) ?? []
    ]);
    return new Pe(o);
  });
  setMeasurements(e, t) {
    te((s) => {
      this._measurements.set(e, s), this._virtualLines.set(t, s);
    });
  }
}
const un = /* @__PURE__ */ new WeakMap(), ko = 64;
function Ce(n, e, t, s) {
  const i = s === "right" ? t + 1 : t - 1;
  return ce(n, e, t, i, s);
}
function ce(n, e, t, s, i, o = !0) {
  s = Math.min(Math.max(s, 0), n.length);
  const r = Ns(n, e, t);
  if (i === "right")
    for (let c = xo(r, s); c < r.length; c++) {
      const a = r[c];
      if (a.start > s)
        break;
      (a.contains(s) || o && a.start === s) && (s = a.endExclusive);
    }
  else
    for (let c = Eo(r, s); c >= 0; c--) {
      const a = r[c];
      if (a.endExclusive < s)
        break;
      (a.contains(s) || o && a.endExclusive === s) && (s = a.start);
    }
  return s;
}
function Ns(n, e, t) {
  const s = bo(n), i = yo(s, e, t), o = s.rangesByVisibilityKey.get(i);
  if (o)
    return s.rangesByVisibilityKey.delete(i), s.rangesByVisibilityKey.set(i, o), o;
  const r = [];
  for (const c of s.entries)
    if (!e.has(c.block))
      r.push(...c.hiddenRanges);
    else if (c.block.kind === "list")
      for (const a of Co(
        c.block,
        Yt(c.block, t - c.start)
      ))
        r.push(a.delta(c.start));
  return s.rangesByVisibilityKey.set(i, r), s.rangesByVisibilityKey.size > ko && s.rangesByVisibilityKey.delete(s.rangesByVisibilityKey.keys().next().value), r;
}
function bo(n) {
  let e = un.get(n);
  if (e)
    return e;
  const t = new Set(n.blocks), s = [], i = /* @__PURE__ */ new Map();
  let o = 0;
  for (const r of n.children) {
    if (t.has(r)) {
      const c = r, a = {
        block: c,
        index: s.length,
        start: o,
        hiddenRanges: So(c).map((l) => l.delta(o))
      };
      s.push(a), i.set(c, a);
    }
    o += r.length;
  }
  return e = { entries: s, entryByBlock: i, rangesByVisibilityKey: /* @__PURE__ */ new Map() }, un.set(n, e), e;
}
function yo(n, e, t) {
  const s = [];
  for (const i of e) {
    const o = n.entryByBlock.get(i);
    if (!o)
      continue;
    const r = i.kind === "list" ? Yt(i, t - o.start) ?? "" : "";
    s.push(`${o.index}:${r}`);
  }
  return s.sort(), s.join(",");
}
function xo(n, e) {
  let t = 0, s = n.length;
  for (; t < s; ) {
    const i = t + s >>> 1;
    n[i].endExclusive < e ? t = i + 1 : s = i;
  }
  return t;
}
function Eo(n, e) {
  let t = 0, s = n.length;
  for (; t < s; ) {
    const i = t + s >>> 1;
    n[i].start <= e ? t = i + 1 : s = i;
  }
  return t - 1;
}
function Yt(n, e) {
  let t = 0, s;
  for (let i = 0; i < n.children.length; i++) {
    const o = n.children[i], r = t + o.length, c = n.items.indexOf(o);
    if (c >= 0) {
      if (t <= e && e < r)
        return c;
      r === e && (s = c);
    }
    t = r;
  }
  return s;
}
function Co(n, e) {
  const t = [];
  let s = 0;
  for (const i of n.children) {
    const o = n.items.indexOf(i);
    if (o >= 0 && o !== e) {
      const r = n.items[o];
      Qt(r, s, t);
    }
    s += i.length;
  }
  return t.sort((i, o) => i.start - o.start), t;
}
function So(n) {
  const e = [];
  return Qt(n, 0, e), e.sort((t, s) => t.start - s.start), e;
}
function Qt(n, e, t) {
  if (n.children.length === 0) {
    n instanceof b && t.push(v.ofStartAndLength(e, n.length));
    return;
  }
  switch (n.kind) {
    case "frontMatter":
    case "codeBlock":
    case "mathBlock": {
      let i = e;
      for (const o of n.children)
        o instanceof b && (o.markerKind === "openFence" || o.markerKind === "closeFence") && t.push(v.ofStartAndLength(i, o.length)), i += o.length;
      return;
    }
    case "inlineCode":
    case "inlineMath": {
      let i = e;
      for (const o of n.children)
        o instanceof b && (o.markerKind === "openMarker" || o.markerKind === "closeMarker") && t.push(v.ofStartAndLength(i, o.length)), i += o.length;
      return;
    }
    case "thematicBreak":
      return;
    case "unhandledBlock":
      return;
    case "image": {
      t.push(v.ofStartAndLength(e, n.length));
      return;
    }
  }
  let s = e;
  for (const i of n.children)
    Qt(i, s, t), s += i.length;
}
const Lo = (n) => n.cursorPosition.kind === "virtual" ? rt(n, n.cursorPosition.line, "after", "right") : n.selection.isCollapsed ? O.source(Ce(
  n.document,
  n.markerVisibleBlocks,
  n.selection.active,
  "right"
)) : O.source(n.selection.range.endExclusive), Mo = (n) => n.cursorPosition.kind === "virtual" ? rt(n, n.cursorPosition.line, "before", "left") : n.selection.isCollapsed ? O.source(Ce(
  n.document,
  n.markerVisibleBlocks,
  n.selection.active,
  "left"
)) : O.source(n.selection.range.start), To = (n) => n.cursorPosition.kind === "virtual" ? rt(n, n.cursorPosition.line, "after", "right") : O.source(Ce(
  n.document,
  n.markerVisibleBlocks,
  n.selection.active,
  "right"
)), Oo = (n) => n.cursorPosition.kind === "virtual" ? rt(n, n.cursorPosition.line, "before", "left") : O.source(Ce(
  n.document,
  n.markerVisibleBlocks,
  n.selection.active,
  "left"
)), Ro = (n) => {
  const e = n.cursorPosition.kind === "virtual" ? n.cursorPosition.line.sourceOffsetAfter : n.selection.active;
  return O.source(ce(
    n.document,
    n.markerVisibleBlocks,
    n.selection.active,
    ki(n.text, e, n.wordNavigationConfig),
    "right",
    !1
  ));
}, No = (n) => {
  const e = n.cursorPosition.kind === "virtual" ? n.cursorPosition.line.sourceOffsetBefore : n.selection.active;
  return O.source(ce(
    n.document,
    n.markerVisibleBlocks,
    n.selection.active,
    wi(n.text, e, n.wordNavigationConfig),
    "left",
    !1
  ));
}, Lt = (n) => n.cursorPosition.kind === "virtual" ? n.cursorPosition : O.source(ce(
  n.document,
  n.markerVisibleBlocks,
  n.selection.active,
  n.selection.active === 0 ? 0 : n.text.lastIndexOf(`
`, n.selection.active - 1) + 1,
  "right"
)), Mt = (n) => {
  if (n.cursorPosition.kind === "virtual")
    return n.cursorPosition;
  const e = n.text.indexOf(`
`, n.selection.active);
  return O.source(ce(
    n.document,
    n.markerVisibleBlocks,
    n.selection.active,
    e === -1 ? n.text.length : e,
    "left"
  ));
}, Io = (n) => O.source(ce(
  n.document,
  n.markerVisibleBlocks,
  n.selection.active,
  0,
  "right"
)), Po = (n) => O.source(ce(
  n.document,
  n.markerVisibleBlocks,
  n.selection.active,
  n.text.length,
  "left"
)), Bo = (n) => {
  if (n.cursorPosition.kind === "virtual")
    return { position: n.cursorPosition, desiredColumn: void 0 };
  const e = n.lineMap.lineIndexOfPosition(n.cursorPosition);
  if (e === void 0)
    return { position: Lt(n), desiredColumn: void 0 };
  const t = n.lineMap.lineStartOffset(e), s = n.lineMap.lineEndOffset(e);
  if (t === void 0 || s === void 0)
    return { position: Lt(n), desiredColumn: void 0 };
  const i = t === 0 ? 0 : n.text.lastIndexOf(`
`, t - 1) + 1;
  let o = t;
  if (t === i) {
    for (; o < s && (n.text[o] === " " || n.text[o] === "	"); )
      o++;
    o === s && (o = t);
  }
  const r = o !== t && n.selection.active !== o ? o : t;
  return {
    position: O.source(ce(
      n.document,
      n.markerVisibleBlocks,
      n.selection.active,
      r,
      "right"
    )),
    desiredColumn: void 0
  };
}, Ao = (n) => {
  if (n.cursorPosition.kind === "virtual")
    return { position: n.cursorPosition, desiredColumn: void 0 };
  const e = n.lineMap.lineIndexOfPosition(n.cursorPosition);
  if (e === void 0)
    return { position: Mt(n), desiredColumn: void 0 };
  const t = n.lineMap.lineEndOffset(e);
  return t === void 0 ? { position: Mt(n), desiredColumn: void 0 } : {
    position: O.source(ce(
      n.document,
      n.markerVisibleBlocks,
      n.selection.active,
      t,
      "left"
    )),
    desiredColumn: void 0
  };
}, Do = (n) => {
  const e = n.lineMap.lineIndexOfPosition(n.cursorPosition);
  if (e === void 0)
    return Vo(n);
  const t = n.desiredColumn ?? n.lineMap.xAtPosition(n.cursorPosition);
  return e >= n.lineMap.lineCount - 1 ? { position: n.cursorPosition, desiredColumn: t } : { position: n.lineMap.positionInLineAtX(e + 1, t), desiredColumn: t };
}, fn = (n) => {
  const e = n.lineMap.lineIndexOfPosition(n.cursorPosition);
  if (e === void 0)
    return Fo(n);
  if (n.cursorPosition.kind === "virtual" && e > 0)
    return Is(n, e - 1);
  const t = n.desiredColumn ?? n.lineMap.xAtPosition(n.cursorPosition);
  return e <= 0 ? { position: n.cursorPosition, desiredColumn: t } : { position: n.lineMap.positionInLineAtX(e - 1, t), desiredColumn: t };
};
function rt(n, e, t, s) {
  const i = t === "before" ? e.sourceOffsetBefore : e.sourceOffsetAfter;
  return O.source(ce(
    n.document,
    n.markerVisibleBlocks,
    n.selection.active,
    i,
    s
  ));
}
function Fo(n) {
  if (n.cursorPosition.kind !== "virtual" || n.lineMap.isEmpty)
    return { position: n.cursorPosition, desiredColumn: n.desiredColumn };
  const e = n.lineMap.lineIndexOfOffset(n.cursorPosition.line.sourceOffsetBefore);
  return Is(n, e);
}
function Vo(n) {
  if (n.cursorPosition.kind !== "virtual" || n.lineMap.isEmpty)
    return { position: n.cursorPosition, desiredColumn: n.desiredColumn };
  const e = n.lineMap.lineIndexOfOffset(n.cursorPosition.line.sourceOffsetBefore), t = n.desiredColumn ?? n.lineMap.lineRect(e).left;
  return e >= n.lineMap.lineCount - 1 ? { position: n.cursorPosition, desiredColumn: t } : {
    position: n.lineMap.positionInLineAtX(e + 1, t),
    desiredColumn: t
  };
}
function Is(n, e) {
  const t = n.lineMap.lineRect(e).right;
  return {
    position: n.lineMap.positionInLineAtX(e, t),
    desiredColumn: t
  };
}
const Be = {
  tabSize: 4,
  insertSpaces: !0
}, Le = "  ", $o = /^([ \t]*)(`{3,}|~{3,})([ \t]*)$/, Wo = /^([ \t]*)(`{3,}|~{3,})/, mn = (n) => {
  const e = n.selection;
  if (!e.isCollapsed)
    return {
      edit: S.delete(e.range),
      selection: k.collapsed(e.range.start)
    };
  if (e.active === 0)
    return;
  const t = new v(Ce(n.document, n.markerVisibleBlocks, e.active, "left"), e.active);
  return {
    edit: S.delete(t),
    selection: k.collapsed(t.start)
  };
}, Ho = (n) => {
  const e = n.selection;
  if (!e.isCollapsed)
    return {
      edit: S.delete(e.range),
      selection: k.collapsed(e.range.start)
    };
  if (e.active >= n.text.length)
    return;
  const t = new v(e.active, Ce(n.document, n.markerVisibleBlocks, e.active, "right"));
  return {
    edit: S.delete(t),
    selection: k.collapsed(t.start)
  };
}, Ko = (n) => {
  const e = n.selection;
  if (!e.isCollapsed)
    return {
      edit: S.delete(e.range),
      selection: k.collapsed(e.range.start)
    };
  if (e.active === 0)
    return;
  const t = bi(n.text, e.active, n.wordNavigationConfig), s = new v(t, e.active), i = ct(n, s);
  if (!i.isEmpty)
    return {
      edit: i,
      selection: k.collapsed(i.mapOffset(t))
    };
}, zo = (n) => {
  const e = n.selection;
  if (!e.isCollapsed)
    return {
      edit: S.delete(e.range),
      selection: k.collapsed(e.range.start)
    };
  if (e.active >= n.text.length)
    return;
  const t = yi(n.text, e.active, n.wordNavigationConfig), s = new v(e.active, t), i = ct(n, s);
  if (!i.isEmpty)
    return {
      edit: i,
      selection: k.collapsed(i.mapOffset(e.active))
    };
}, qo = (n) => {
  const e = n.selection;
  if (!e.isCollapsed)
    return {
      edit: S.delete(e.range),
      selection: k.collapsed(e.range.start)
    };
  if (e.active === 0)
    return;
  let t = n.text.lastIndexOf(`
`, e.active - 1) + 1;
  if (t === e.active && t > 0 && t--, t === e.active)
    return;
  const s = ct(n, new v(t, e.active));
  if (!s.isEmpty)
    return {
      edit: s,
      selection: k.collapsed(s.mapOffset(t))
    };
}, Uo = (n) => {
  const e = n.selection;
  if (!e.isCollapsed)
    return {
      edit: S.delete(e.range),
      selection: k.collapsed(e.range.start)
    };
  const t = n.text.indexOf(`
`, e.active), s = t === -1 ? n.text.length : t === e.active ? t + 1 : t;
  if (s === e.active)
    return;
  const i = ct(n, new v(e.active, s));
  if (!i.isEmpty)
    return {
      edit: i,
      selection: k.collapsed(i.mapOffset(e.active))
    };
};
function ct(n, e) {
  const t = [];
  let s = e.start;
  for (const i of Ns(
    n.document,
    n.markerVisibleBlocks,
    n.selection.active
  ))
    if (!(i.endExclusive <= s)) {
      if (i.start >= e.endExclusive)
        break;
      s < i.start && t.push(le.delete(new v(s, Math.min(i.start, e.endExclusive)))), s = Math.max(s, i.endExclusive);
    }
  return s < e.endExclusive && t.push(le.delete(new v(s, e.endExclusive))), t.length === 0 ? S.empty : new S(t);
}
function Xo(n, e) {
  return (t) => {
    const s = Go(t, n, e);
    if (s)
      return s;
    const i = S.replace(t.selection.range, n), o = t.selection.range.start + n.length;
    return {
      edit: i,
      selection: k.collapsed(o)
    };
  };
}
function Go(n, e, t) {
  const s = n.activeBlock;
  if (s?.kind !== "codeBlock" || s.language !== "mermaid" || s.closeFence || !s.openFence || !t)
    return;
  const i = n.selection.range, o = n.text.lastIndexOf(`
`, i.start - 1) + 1, r = n.text.indexOf(`
`, i.endExclusive), c = r < 0 ? n.text.length : r, a = n.text.slice(o, i.start) + e + n.text.slice(i.endExclusive, c), l = $o.exec(a);
  if (!l)
    return;
  const d = l[1];
  if (t.start !== o || t.endExclusive > i.start || t.length !== d.length || t.substring(n.text) !== d)
    return;
  const u = U(n.document, s);
  if (u === void 0)
    return;
  const h = n.text.lastIndexOf(`
`, u - 1) + 1;
  if (h === o)
    return;
  const f = n.text.indexOf(`
`, h), m = n.text.slice(h, f < 0 ? n.text.length : f), g = Wo.exec(m);
  if (!g || l[2][0] !== g[2][0] || l[2].length < g[2].length || !d.includes("	") && d.length <= 3)
    return;
  const _ = g[1];
  if (!d.startsWith(_) || d.length <= _.length)
    return;
  const p = _ + l[2] + l[3], w = n.text.slice(o, i.start).length + e.length, E = _.length + Math.max(0, w - d.length);
  return {
    edit: S.replace(new v(o, c), p),
    selection: k.collapsed(o + E)
  };
}
function Yo(n = Be) {
  return at(n), (e) => {
    const t = e.selection, s = t.range, i = K(e.text, s.start), o = gn(e.text, s.start), c = s.endExclusive <= o && (s.start !== i || s.endExclusive !== o), a = t.isCollapsed ? Zt(e.document, e.text, t.active) : void 0, l = a ? U(e.document, a.item) : void 0, d = a ? U(e.document, a.item.marker) : void 0;
    if (a && l !== void 0 && d !== void 0 && K(e.text, d) === i) {
      const m = Ws(
        e.text,
        l,
        l + a.item.length,
        Hs(e.text, K(e.text, d), d)
      ), g = m[0];
      if (a.index === 0 && d - g >= Le.length)
        return;
      const _ = m.filter((w) => w < gn(e.text, w)).map((w) => le.insert(w, Le)), p = new S(_);
      return {
        edit: p,
        selection: k.collapsed(p.mapOffset(t.active))
      };
    }
    if (t.isCollapsed || c) {
      const m = Fs(
        e.text.slice(K(e.text, s.start), s.start),
        n
      );
      return {
        edit: S.replace(s, m),
        selection: k.collapsed(s.start + m.length)
      };
    }
    const u = Ds(e.text, s), h = u.map((m) => le.insert(m, lr(n))), f = new S(h);
    return {
      edit: f,
      selection: mr(f, t, new Set(u))
    };
  };
}
function Ps(n = Be) {
  return at(n), (e) => {
    if (e.selection.isCollapsed) {
      const i = Zt(e.document, e.text, e.selection.active), o = i ? U(e.document, i.item) : void 0, r = i ? U(e.document, i.item.marker) : void 0;
      if (i && o !== void 0 && r !== void 0 && K(e.text, r) === K(e.text, e.selection.active)) {
        const c = Ws(
          e.text,
          o,
          o + i.item.length,
          Hs(e.text, K(e.text, r), r)
        ).flatMap((l) => e.text.slice(l, l + Le.length) === Le ? [le.delete(new v(l, l + Le.length))] : []);
        if (c.length === 0)
          return;
        const a = new S(c);
        return {
          edit: a,
          selection: k.collapsed(a.mapOffset(e.selection.active))
        };
      }
    }
    const t = [];
    for (const i of Ds(e.text, e.selection.range)) {
      const o = hr(e.text, i), r = e.text.slice(i, o), c = Vs(r, n);
      c !== r && t.push(le.replace(
        new v(i, o),
        c
      ));
    }
    if (t.length === 0)
      return;
    const s = new S(t);
    return {
      edit: s,
      selection: fr(s, e.selection)
    };
  };
}
const Qo = (n) => {
  const e = S.replace(n.selection.range, `

`), t = n.selection.range.start + 2;
  return {
    edit: e,
    selection: k.collapsed(t)
  };
}, jo = (n) => {
  const e = S.replace(n.selection.range, `
`), t = n.selection.range.start + 1;
  return {
    edit: e,
    selection: k.collapsed(t)
  };
}, Zo = (n) => {
  const e = n.selection.range.start;
  let t = 0;
  for (; t < 2 && n.text[e - 1 - t] === " "; )
    t++;
  const i = " ".repeat(2 - t) + `
`, o = S.replace(n.selection.range, i), r = e + i.length;
  return {
    edit: o,
    selection: k.collapsed(r)
  };
};
function Ae(n) {
  const e = n.activeBlock;
  if (!n.selection.isCollapsed || !e)
    return;
  const t = Jt(n.document, e);
  if (t !== void 0)
    switch (e.kind) {
      case "paragraph":
      case "heading":
      case "thematicBreak":
        return n.selection.active >= Ze(e, t) ? gt(n, e, t) : void 0;
      case "frontMatter":
      case "codeBlock":
        return e.closeFence && n.selection.active >= Ze(e, t) ? gt(n, e, t) : void 0;
      case "blockQuote":
        return ir(n);
      case "unhandledBlock": {
        const s = e.htmlComment;
        if (s?.kind !== "complete")
          return;
        const i = t + s.leadingWhitespace.length + s.opening.length + s.body.length + s.closing.length;
        return n.selection.active >= i ? gt(n, e, t) : void 0;
      }
      default:
        return;
    }
}
const Jo = (n) => {
  const e = n.selection, t = n.activeBlock;
  if (!e.isCollapsed || !t)
    return ue(n);
  switch (t.kind) {
    case "paragraph":
    case "heading":
    case "thematicBreak":
      return er(n, t);
    case "frontMatter":
    case "codeBlock":
      return tr(n, t);
    case "blockQuote":
      return sr(n);
    case "list":
      return or(n);
    case "unhandledBlock":
      return nr(n, t);
    default:
      return ue(n);
  }
};
function er(n, e) {
  const t = n.selection, s = Jt(n.document, e);
  if (s === void 0)
    return ue(n);
  const i = Ze(e, s);
  return t.active < i ? {
    kind: "edit",
    edit: S.replace(t.range, `

`),
    selection: k.collapsed(t.range.start + 2)
  } : Ae(n) ?? ue(n);
}
function tr(n, e) {
  const t = n.selection, s = Ae(n);
  if (s)
    return s;
  const i = n.text.lastIndexOf(`
`, t.active - 1) + 1;
  let o = i;
  for (; o < t.active && (n.text[o] === " " || n.text[o] === "	"); )
    o++;
  const r = n.text.slice(i, o), c = `
` + r, a = jt(t, c);
  return a.kind !== "edit" || e.kind !== "codeBlock" || r.length === 0 ? a : {
    ...a,
    generatedIndentation: v.ofStartAndLength(t.active + 1, r.length)
  };
}
function gt(n, e, t) {
  const s = Ze(e, t), i = t + e.length;
  return {
    kind: "pending",
    anchorBlock: e,
    replaceRange: new v(s, i),
    separateFromPreviousBlock: !0,
    atEof: i >= n.text.length
  };
}
function nr(n, e) {
  return e.htmlComment?.kind !== "complete" ? ue(n) : Ae(n) ?? ue(n);
}
function Ze(n, e) {
  return e + n.length - gr(n);
}
function sr(n) {
  const e = n.selection, t = Bs(n.text, e.active), s = t.prefix ?? "> ";
  if (t.content.slice(s.length).trim() === "")
    return Ae(n) ?? As(n, t.start, t.endExclusive);
  const o = `
` + s.replace(/\s*$/, " ");
  return jt(e, o);
}
function ir(n) {
  const e = n.activeBlock;
  if (!n.selection.isCollapsed || e?.kind !== "blockQuote")
    return;
  const t = Bs(n.text, n.selection.active);
  if (!t.prefix || t.content.slice(t.prefix.length).trim() !== "" || n.selection.active < t.start + t.prefix.length)
    return;
  const s = Jt(n.document, e);
  if (s === void 0)
    return;
  const i = s + e.length;
  if (!/^[\r\n]*$/.test(n.text.slice(t.endExclusive, i)))
    return;
  const o = t.start > s ? n.text.lastIndexOf(`
`, t.start - 1) : -1, r = o >= s;
  return {
    kind: "pending",
    anchorBlock: e,
    replaceRange: new v(r ? o : s, i),
    separateFromPreviousBlock: r,
    atEof: i >= n.text.length
  };
}
function Bs(n, e) {
  const t = n.lastIndexOf(`
`, e - 1) + 1, s = ar(n, e), i = n.slice(t, s);
  return {
    start: t,
    endExclusive: s,
    content: i,
    prefix: /^(\s*(?:>\s*)+)/.exec(i)?.[1]
  };
}
function or(n) {
  const e = n.selection, t = Zt(n.document, n.text, e.active);
  if (!t)
    return ue(n);
  const { item: s, list: i } = t, o = U(n.document, s);
  if (o === void 0)
    return ue(n);
  if (cr(n, s, o)) {
    const c = Ps()(n);
    return c ? { kind: "edit", edit: c.edit, selection: c.selection } : As(n, o, o + s.length);
  }
  const r = `
` + rr(n, i, s);
  return jt(e, r);
}
function As(n, e, t) {
  const s = e > 0 ? n.text.lastIndexOf(`
`, e - 1) : -1;
  return s >= 0 ? {
    kind: "edit",
    edit: S.replace(new v(s, t), `

`),
    selection: k.collapsed(s + 2)
  } : {
    kind: "edit",
    edit: S.replace(new v(e, t), ""),
    selection: k.collapsed(e)
  };
}
function rr(n, e, t) {
  const s = U(n.document, t.marker), i = s === void 0 ? "" : n.text.slice(K(n.text, s), s), o = t.marker.content.trim();
  let r = `${o.charAt(0) || "-"} `;
  if (e.ordered) {
    const c = /^(\d+)([.)])/.exec(o);
    c && (r = `${Number(c[1]) + 1}${c[2]} `);
  }
  return `${i}${r}${t.checked !== void 0 ? "[ ] " : ""}`;
}
function cr(n, e, t) {
  const s = U(n.document, e.marker);
  if (s === void 0)
    return !1;
  const i = n.text.slice(
    s + e.marker.length,
    t + e.length
  );
  return i.trim().length === 0 || /^\[[ xX]\](?=[ \t\r\n])[ \t\r\n]*$/.test(i);
}
function jt(n, e) {
  return {
    kind: "edit",
    edit: S.replace(n.range, e),
    selection: k.collapsed(n.range.start + e.length)
  };
}
function ar(n, e) {
  const t = n.indexOf(`
`, e);
  return t === -1 ? n.length : t;
}
function K(n, e) {
  return n.lastIndexOf(`
`, Math.max(0, e - 1)) + 1;
}
function gn(n, e) {
  const t = n.indexOf(`
`, e);
  return t === -1 ? n.length : t;
}
function Ds(n, e) {
  const t = [K(n, e.start)], s = e.endExclusive > e.start && n[e.endExclusive - 1] === `
` ? e.endExclusive - 1 : e.endExclusive;
  let i = n.indexOf(`
`, t[0]) + 1;
  for (; i > 0 && i <= s; )
    t.push(i), i = n.indexOf(`
`, i) + 1;
  return t;
}
function Fs(n, e = Be) {
  if (at(e), !e.insertSpaces)
    return "	";
  const t = $s(n, e.tabSize);
  return " ".repeat(e.tabSize - t % e.tabSize);
}
function lr(n) {
  return n.insertSpaces ? " ".repeat(n.tabSize) : "	";
}
function Vs(n, e = Be) {
  at(e);
  const t = $s(n, e.tabSize);
  if (t === 0)
    return n;
  const s = t - (t % e.tabSize || e.tabSize);
  return dr(s, e);
}
function dr(n, e) {
  return e.insertSpaces ? " ".repeat(n) : "	".repeat(Math.floor(n / e.tabSize)) + " ".repeat(n % e.tabSize);
}
function $s(n, e) {
  let t = 0;
  for (const s of n)
    t = s === "	" ? t + e - t % e : t + 1;
  return t;
}
function hr(n, e) {
  let t = e;
  for (; n[t] === " " || n[t] === "	"; )
    t++;
  return t;
}
function Zt(n, e, t) {
  const s = (c, a, l, d) => {
    const u = c instanceof q && l !== void 0 && d !== void 0 ? { list: l, item: c, index: d } : void 0;
    let h = a, f;
    for (const m of c.children) {
      const g = h + m.length, _ = c instanceof z && m instanceof q ? c : l, p = c instanceof z && m instanceof q ? c.items.indexOf(m) : d;
      if (h <= t && t < g)
        return s(m, h, _, p) ?? u;
      g === t && (f = s(m, h, _, p) ?? u), h = g;
    }
    return f ?? u;
  }, i = s(n, 0, void 0, void 0);
  if (i) {
    const c = U(n, i.item.marker);
    if (c !== void 0 && K(e, c) === K(e, t))
      return i;
  }
  let o;
  const r = (c) => {
    if (c instanceof z)
      for (let a = 0; a < c.items.length; a++) {
        const l = c.items[a], d = U(n, l.marker);
        d !== void 0 && K(e, d) === K(e, t) && (o = { list: c, item: l, index: a });
      }
    for (const a of c.children)
      r(a);
  };
  return r(n), o ?? i;
}
function Ws(n, e, t, s) {
  const i = [];
  let o = K(n, e);
  for (; o < t; ) {
    i.push(ur(n, o, s));
    const r = n.indexOf(`
`, o);
    if (r === -1)
      break;
    o = r + 1;
  }
  return i;
}
function Hs(n, e, t) {
  let s = e, i = 0;
  for (; s < t; ) {
    let o = s;
    for (let r = 0; r < 3 && o < t && (n[o] === " " || n[o] === "	"); r++)
      o++;
    if (o >= t || n[o] !== ">")
      break;
    i++, s = o + 1, (n[s] === " " || n[s] === "	") && s++;
  }
  return i;
}
function ur(n, e, t) {
  let s = e;
  for (let i = 0; i < t; i++) {
    let o = s;
    for (let r = 0; r < 3 && (n[o] === " " || n[o] === "	"); r++)
      o++;
    if (n[o] !== ">")
      return e;
    s = o + 1, (n[s] === " " || n[s] === "	") && s++;
  }
  return s;
}
function fr(n, e) {
  return new k(n.mapOffset(e.anchor), n.mapOffset(e.active));
}
function mr(n, e, t) {
  const s = (i) => {
    if (!t.has(i))
      return n.mapOffset(i);
    let o = 0;
    for (const r of n.replacements) {
      if (r.replaceRange.start >= i)
        break;
      o += r.newText.length - r.replaceRange.length;
    }
    return i + o;
  };
  return new k(s(e.anchor), s(e.active));
}
function at(n) {
  if (!Number.isInteger(n.tabSize) || n.tabSize <= 0)
    throw new RangeError(`tabSize must be a positive integer, got ${n.tabSize}`);
}
function ue(n) {
  const e = jo(n);
  return { kind: "edit", edit: e.edit, selection: e.selection };
}
function Jt(n, e) {
  let t = 0;
  for (const s of n.children) {
    if (s === e)
      return t;
    t += s.length;
  }
}
function gr(n) {
  const e = n.children;
  let t = 0;
  for (let s = e.length - 1; s >= 0 && e[s] instanceof $; s--)
    t += e[s].length;
  return t;
}
const pr = (n) => new k(0, n.text.length), _r = (n, e) => {
  const t = xs(n.text, e, n.wordNavigationConfig);
  return new k(t.start, t.end);
};
function vr(n, e) {
  return new k(e.start, e.endExclusive);
}
const pn = /* @__PURE__ */ new WeakMap(), pt = /* @__PURE__ */ new WeakMap();
class oe extends H {
  constructor(e, t, s = wr) {
    super(), this.ast = e, this.dom = t, this._children = s, pn.set(t, this);
    for (const i of s)
      pt.set(i, this);
  }
  _children;
  /** This node's view children (a mirror of `ast.children`). */
  get children() {
    return this._children;
  }
  /**
   * Replace this node's children in place, disposing the old ones and
   * re-pointing the new ones' parent to this node. The node value is still
   * conceptually immutable with respect to its `ast`/`dom` *identity*; this
   * is used only when a node patches its own DOM subtree in place (a code
   * block re-tokenising on a highlighter recolour), where the source-mapping
   * leaves must follow the new DOM text nodes without rebuilding the node
   * itself.
   */
  _replaceChildren(e) {
    for (const t of this._children)
      t.dispose();
    this._children = e;
    for (const t of e)
      pt.set(t, this);
  }
  dispose() {
    for (const e of this._children)
      e.dispose();
  }
  /**
   * The number of source characters this node spans. Defaults to the length
   * of its {@link ast}; a synthetic leaf that subdivides one ast node (a
   * decorated-whitespace character, a code-block token span) shares that ast
   * for identity but overrides this with the length of its own slice, so the
   * renderer never has to fabricate an AST node just to carry a length.
   */
  get sourceLength() {
    return this.ast.length;
  }
  /**
   * The DOM node a parent mounts for this child. It is {@link dom} for almost
   * everything; a marker is the exception — its `dom` is the inner Text node
   * (so source ↔ DOM mapping lands on it) while the node it mounts is the
   * wrapping `<span>`.
   */
  get mountNode() {
    return this.dom;
  }
  /** The view node that rendered this node's parent, or `undefined` for a root. */
  get parent() {
    return pt.get(this);
  }
  /**
   * Closest view node owning `domNode`: the node itself if registered, else
   * the nearest registered ancestor. Returns `undefined` if the DOM node is
   * outside any view tree.
   */
  static forDom(e) {
    for (let t = e; t; t = t.parentNode) {
      const s = pn.get(t);
      if (s)
        return s;
    }
  }
  /**
   * This node's start offset within its parent's local source space: the sum
   * of the `ast.length` of the siblings before it. Polymorphic via
   * {@link _localOffsetOfChild} so a parent whose children do not map
   * linearly (e.g. it hides or reorders some) can override how its children
   * are placed.
   */
  localOffsetInParent() {
    const e = this.parent;
    return e ? e._localOffsetOfChild(this) : 0;
  }
  /** Start offset of `child` within this node's local source space. */
  _localOffsetOfChild(e) {
    let t = 0;
    for (const s of this.children) {
      if (s === e)
        return t;
      t += s.sourceLength;
    }
    return t;
  }
  /**
   * Map a DOM hit that lands on THIS node's own representation into a source
   * range in this node's local space `[0, ast.length)`. Polymorphic: a text
   * leaf maps the caret offset 1:1. For an element hit — an element-only node
   * (KaTeX math, `<hr>`, an image, a hidden marker) or a wrapper/container
   * element — the platform reports a child-index offset, not a text caret, so
   * there is no internal mapping to honour: it snaps to the node's nearer
   * edge, `offset 0` (the "before" side) → start, any `offset >= 1` (the
   * "after" side) → end. Subclasses may override for finer control.
   */
  getLocalSourceRange(e) {
    return this.dom === e.node && this.dom.nodeType === 3 ? v.emptyAt(Math.max(0, Math.min(e.offset, this.sourceLength))) : v.emptyAt(e.offset >= 1 ? this.sourceLength : 0);
  }
  /**
   * DOM hit (any node + offset within it) → source offset relative to THIS
   * node, or `undefined` when the hit is outside this node's subtree. Enters
   * the tree at the closest owning view node ({@link forDom}), maps the hit
   * into that node's local space ({@link getLocalSourceRange}), then lifts the
   * range up the parent chain — adding each node's {@link localOffsetInParent} —
   * until it reaches this node.
   */
  resolveSource(e) {
    let t = oe.forDom(e.node);
    if (!t)
      return;
    let s = t.getLocalSourceRange(e);
    for (; t !== this; ) {
      const i = t.parent;
      if (!i)
        return;
      s = s.delta(t.localOffsetInParent()), t = i;
    }
    return s.start;
  }
  /**
   * Source offset → DOM position. `nodeOffset` is the absolute source
   * offset of THIS node's start. Returns a position into a DOM Text node,
   * descending into children based on accumulated lengths.
   */
  sourceToDom(e, t = 0) {
    if (e < t || e > t + this.sourceLength)
      return;
    if (this.children.length === 0)
      return this.dom.nodeType === 3 ? { node: this.dom, offset: e - t } : void 0;
    let s = t;
    for (const i of this.children) {
      const o = s + i.sourceLength;
      if (e >= s && e <= o) {
        const r = i.sourceToDom(e, s);
        if (r)
          return r;
      }
      s = o;
    }
  }
  /** Visit every text-bearing leaf in this subtree with its absolute offset. */
  forEachTextLeaf(e, t) {
    if (this.children.length === 0) {
      this.dom.nodeType === 3 && t(this, e);
      return;
    }
    let s = e;
    for (const i of this.children)
      i.forEachTextLeaf(s, t), s += i.sourceLength;
  }
}
const wr = [];
function kr(n) {
  const e = document;
  if (e.caretPositionFromPoint) {
    const s = e.caretPositionFromPoint(n.x, n.y);
    return s ? { node: s.offsetNode, offset: s.offset } : void 0;
  }
  const t = e.caretRangeFromPoint?.(n.x, n.y);
  if (t)
    return { node: t.startContainer, offset: t.startOffset };
}
function Tt(n, e) {
  let t = n.firstChild, s = 0;
  for (; s < e.length && t === e[s]; s++)
    t = t.nextSibling;
  if (!(s === e.length && t === null)) {
    for (; s < e.length; s++) {
      const i = e[s];
      t === i ? t = i.nextSibling : n.insertBefore(i, t);
    }
    for (; t; ) {
      const i = t;
      t = t.nextSibling, n.removeChild(i);
    }
  }
}
function br(n) {
  const e = yr(n), t = xr(n), s = Math.max(e, n.length - t);
  return {
    text: n.slice(e, s),
    sourceOffset: e
  };
}
function yr(n) {
  return n.startsWith(`\r
`) ? 2 : n.startsWith("\r") || n.startsWith(`
`) ? 1 : 0;
}
function xr(n) {
  return n.endsWith(`\r
`) ? 2 : n.endsWith("\r") || n.endsWith(`
`) ? 1 : 0;
}
class Oe {
  static create(e) {
    const t = document.createElement("span");
    t.dataset.mdUrl = e.href, t.setAttribute("role", "link"), t.tabIndex = 0;
    const s = document.createElement("span");
    s.textContent = e.authoredLabel;
    const i = new Oe(t, s);
    return i.update(e.presentation), i;
  }
  static mount(e, t) {
    return new Oe(e, t);
  }
  static clear(e) {
    e.classList.remove("md-rich-link", "md-rich-link-unavailable"), delete e.dataset.mdRichLinkKind, delete e.dataset.mdRichLinkStatus, delete e.dataset.mdRichLinkSecondaryStatus, e.removeAttribute("aria-label"), e.removeAttribute("title");
  }
  element;
  authoredLabel;
  _icon;
  _title;
  _detail;
  _reference;
  _changes;
  _status;
  _secondaryStatus;
  constructor(e, t) {
    this.element = e, this.authoredLabel = t, this._icon = document.createElement("span"), this._icon.className = "md-rich-link-icon codicon", this._icon.setAttribute("aria-hidden", "true"), this._title = document.createElement("span"), this._title.className = "md-rich-link-title", this._detail = document.createElement("span"), this._detail.className = "md-rich-link-detail", this._reference = document.createElement("span"), this._reference.className = "md-rich-link-reference", this._changes = Cr(), this._status = _n("md-rich-link-primary-status"), this._secondaryStatus = _n("md-rich-link-secondary-status"), this.authoredLabel.className = "md-rich-link-label", this.element.classList.add("md-rich-link"), this._setDefaultOrder();
  }
  update(e) {
    if (!e) {
      this._renderUnavailable();
      return;
    }
    this.element.classList.remove("md-rich-link-unavailable"), this.element.dataset.mdRichLinkKind = e.kind, this._icon.className = `md-rich-link-icon codicon codicon-${Er[e.kind]}`, this.authoredLabel.hidden = !!e.title, this._title.textContent = e.title ?? "", this._title.hidden = !e.title, this._detail.textContent = e.detail ?? "", this._detail.hidden = !e.detail, this._reference.textContent = e.reference ?? "", this._reference.hidden = !e.reference, Sr(this._changes, e.changes), vn(this.element, e.kind, this._status, e.status, "mdRichLinkStatus"), vn(this.element, e.kind, this._secondaryStatus, e.secondaryStatus, "mdRichLinkSecondaryStatus"), Tt(this.element, Tr(e) ? [this._status.root, this.authoredLabel, this._title, this._detail, this._reference, this._changes.root, this._secondaryStatus.root] : [this._icon, this.authoredLabel, this._title, this._detail, this._reference, this._changes.root, this._status.root, this._secondaryStatus.root]), e.ariaLabel ? this.element.setAttribute("aria-label", e.ariaLabel) : this.element.removeAttribute("aria-label"), e.tooltip ? this.element.title = e.tooltip : this.element.removeAttribute("title");
  }
  _renderUnavailable() {
    this.element.classList.add("md-rich-link-unavailable"), delete this.element.dataset.mdRichLinkKind, delete this.element.dataset.mdRichLinkStatus, delete this.element.dataset.mdRichLinkSecondaryStatus, this._setDefaultOrder(), this._icon.className = "md-rich-link-icon codicon codicon-link", this.authoredLabel.hidden = !1, this._title.hidden = !0, this._detail.hidden = !0, this._reference.hidden = !0, Ks(this._changes), Ot(this._status), Ot(this._secondaryStatus), this.element.removeAttribute("aria-label"), this.element.removeAttribute("title");
  }
  _setDefaultOrder() {
    Tt(this.element, [
      this._icon,
      this.authoredLabel,
      this._title,
      this._detail,
      this._reference,
      this._changes.root,
      this._status.root,
      this._secondaryStatus.root
    ]);
  }
}
const Er = {
  resource: "link",
  issue: "issues",
  pullRequest: "git-pull-request",
  commit: "git-commit",
  file: "file",
  folder: "folder",
  session: "comment-discussion",
  repository: "repo",
  branch: "git-branch"
};
function _n(n) {
  const e = document.createElement("span");
  e.className = `md-rich-link-status ${n}`;
  const t = document.createElement("span");
  t.className = "md-rich-link-status-icon codicon", t.setAttribute("aria-hidden", "true");
  const s = document.createElement("span");
  return s.className = "md-rich-link-status-label", e.append(t, s), { root: e, icon: t, label: s };
}
function Cr() {
  const n = document.createElement("span");
  n.className = "md-rich-link-changes";
  const e = document.createElement("span");
  e.className = "md-rich-link-insertions";
  const t = document.createElement("span");
  return t.className = "md-rich-link-deletions", n.append(e, t), { root: n, insertions: e, deletions: t };
}
function Sr(n, e) {
  if (!e) {
    Ks(n);
    return;
  }
  n.insertions.textContent = `+${e.insertions}`, n.deletions.textContent = `-${e.deletions}`, n.root.hidden = !1;
}
function Ks(n) {
  n.insertions.textContent = "", n.deletions.textContent = "", n.root.hidden = !0;
}
function vn(n, e, t, s, i) {
  if (!s) {
    delete n.dataset[i], Ot(t);
    return;
  }
  n.dataset[i] = s.kind;
  const o = Mr(e, s.kind);
  t.icon.className = `md-rich-link-status-icon codicon codicon-${Or(e, s.kind)}`, t.icon.hidden = o !== void 0, o ? (t.pixelSpinner ??= Lr(t.label), t.pixelSpinner.classList.toggle("monaco-pixel-spinner-ring", o === "ring")) : (t.pixelSpinner?.remove(), t.pixelSpinner = void 0), t.label.textContent = s.label, t.root.hidden = !1;
}
function Ot(n) {
  n.icon.hidden = !1, n.pixelSpinner?.remove(), n.pixelSpinner = void 0, n.label.textContent = "", n.root.hidden = !0;
}
function Lr(n) {
  const e = document.createElement("span");
  e.className = "md-rich-link-status-icon monaco-pixel-spinner", e.setAttribute("aria-hidden", "true");
  for (let t = 0; t < 6; t++) {
    const s = document.createElement("span");
    s.className = "monaco-pixel-spinner-dot", e.appendChild(s);
  }
  return n.before(e), e;
}
function Mr(n, e) {
  if (n === "session")
    switch (e) {
      case "pending":
        return "grid";
      case "warning":
        return "ring";
      default:
        return;
    }
}
function Tr(n) {
  const e = n.status?.kind;
  switch (n.kind) {
    case "issue":
      return e === "open" || e === "closed" || e === "notPlanned";
    case "pullRequest":
      return e === "open" || e === "closed" || e === "merged" || e === "draft";
    case "session":
      return e !== void 0;
    default:
      return !1;
  }
}
function Or(n, e) {
  if (n === "session")
    switch (e) {
      case "pending":
      case "warning":
      case "success":
      case "neutral":
        return "comment-discussion";
      case "error":
        return "error";
    }
  switch (e) {
    case "open":
      return n === "pullRequest" ? "git-pull-request" : "issue-opened";
    case "closed":
      return n === "pullRequest" ? "git-pull-request-closed" : "issue-closed";
    case "merged":
      return "git-merge";
    case "draft":
      return "git-pull-request-draft";
    case "notPlanned":
      return "circle-slash";
    case "pending":
      return "circle-filled";
    case "success":
      return "pass-filled";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "neutral":
      return "circle-outline";
  }
}
class T extends oe {
  constructor(e, t, s) {
    super(e.ast, t, s), this.data = e;
  }
  get block() {
    return this.data.ast;
  }
  get element() {
    return this.dom;
  }
  /**
   * The horizontal scroll viewport for selection/caret clipping
   * ({@link blockViewportClip}). For most blocks the scroller *is*
   * {@link element} — a code / math / unhandled block's `element` is the very
   * `overflow-x: auto` box that scrolls. A table is the exception: its
   * `element` stays the inner `<table>` (so the active/markers classes and
   * `.md-table` theme styling are unaffected), but the box that actually
   * scrolls is the wrapping `.md-table-wrapper`, so {@link TableViewNode}
   * overrides this to return that wrapper.
   */
  get scrollElement() {
    return this.element;
  }
  /**
   * Whether this already-built node can stand in for `data` unchanged. The
   * builder preserves view-data identity for any subtree whose ast and
   * selection-derived flags are unchanged (see `buildDocumentViewData`), so a
   * single identity check captures "nothing in my subtree changed" — and its
   * whole subtree, and any session it owns, are kept as-is.
   */
  canReuse(e, t) {
    return this.data === e;
  }
  /**
   * Called by the view after this block is mounted and measured, with the
   * block's rendered height in px. The default is a no-op; subclasses whose
   * active/inactive renderings have different intrinsic heights (e.g. a math
   * block) override this to remember a height to reserve across the toggle.
   */
  recordMeasuredHeight(e) {
  }
}
function Y(n, e, t) {
  if (t instanceof T) {
    if (t.canReuse(n, e))
      return t;
  } else if (t?.ast === n.ast)
    return t;
  switch (n.kind) {
    case "text":
      return Ir(n, N(t, en));
    case "marker":
      return n.ast.markerKind === "hardBreak" ? new yn(n, N(t, yn)) : new bn(n, N(t, bn));
    case "glue":
      return new Je(n, N(t, Je));
    case "heading":
      return new En(n, e, N(t, En));
    case "paragraph": {
      /* gp-fork: renderCustomBlock — consulted only while inactive
       * (mirrors the codeBlock !e.showMarkup gate at the
       * renderCustomCodeBlock call site below), returning undefined falls
       * through to the unchanged upstream construction. */
      if (!n.showMarkup && e?.renderCustomBlock) {
        const gpR = e.renderCustomBlock(n.ast, Es(n.ast));
        if (gpR) {
          /* gp-fork: renderCustomBlock — mirror the renderCustomCodeBlock
           * call site's `d.classList.add("md-block", "md-code-block")`
           * (search this file for that exact string): the HOST applies the
           * block-level class, not the provider, exactly as it does for the
           * plain-dom custom-code-block case. Idempotent — harmless if the
           * provider's dom already carries it. See PATCHES.md Hunk 3. */
          gpR.dom.classList.add("md-block");
          return new T(n, gpR.dom, gpR.segments ? Zs(n.ast, gpR.segments, n.ast.length) : D);
        }
      }
      return new fe(n, "p", "md-block md-paragraph", e, we(t));
    }
    case "frontMatter":
      return new On(n, e, N(t, On));
    case "codeBlock":
      return new tn(n, e, t);
    case "mathBlock":
      return new Nn(n, e, N(t, Nn));
    case "thematicBreak":
      return new Cn(n, e, N(t, Cn));
    case "unhandledBlock": {
      /* gp-fork: renderCustomBlock — intercepts BEFORE the Ln (html
       * comment) / Sn (generic unhandled) choice, so the hook sees every
       * unhandledBlock kind (html comments are unhandledBlock too; see
       * PATCHES.md for why both are covered). Same !showMarkup gate and
       * fallback contract as the paragraph arm above. */
      if (!n.showMarkup && e?.renderCustomBlock) {
        const gpR = e.renderCustomBlock(n.ast, Es(n.ast));
        if (gpR) {
          /* gp-fork: renderCustomBlock — same host-applies-the-class mirror
           * as the paragraph arm above; see its comment and PATCHES.md
           * Hunk 3. */
          gpR.dom.classList.add("md-block");
          return new T(n, gpR.dom, gpR.segments ? Zs(n.ast, gpR.segments, n.ast.length) : D);
        }
      }
      const s = n.ast.htmlComment;
      return s ? new Ln(n, s, e, N(t, Ln)) : new Sn(n, e, N(t, Sn));
    }
    case "blockQuote":
      return new xn(n, e, N(t, xn));
    case "list":
      return new In(n, e, N(t, In));
    case "listItem":
      return new Pn(n, e, N(t, Pn));
    case "table":
      return new Bn(n, e, N(t, Bn));
    case "tableRow":
      return new An(n, e, N(t, An));
    case "tableCell":
      return new fe(n, "td", "", e, we(t));
    case "strong":
      return new fe(n, "strong", "", e, we(t));
    case "emphasis":
      return new fe(n, "em", "", e, we(t));
    case "strikethrough":
      return new fe(n, "del", "", e, we(t));
    case "inlineCode":
      return new Dn(n, e, N(t, Dn));
    case "inlineMath":
      return new Fn(n, e, N(t, Fn));
    case "link":
      return new Vn(n, e, N(t, Vn));
    case "image":
      return new $n(n, e, N(t, $n));
    case "document":
      return new fe(n, "div", "", e, we(t));
    case "diffHunk":
      return new Rt(n, e, N(t, Rt));
    case "diffDecoration":
      return new Nt(n, e, N(t, Nt));
  }
}
function N(n, e) {
  return n instanceof e ? n : void 0;
}
function we(n) {
  return n instanceof fe ? n : void 0;
}
function G(n, e, t, s) {
  const { paired: i, unused: o } = nn(e, t ?? D), r = e.map((c) => s(c, i.get(c)));
  for (const c of o)
    c.dispose();
  return Rr(n, r), r;
}
function Rr(n, e) {
  Q(n, e.map((t) => t.mountNode));
}
const Q = Tt;
function de(n) {
  return (e, t) => Y(e, n, t);
}
function zs(n) {
  return (e, t) => e.kind === "marker" && e.ast.markerKind === "content" ? new en(e, document.createTextNode(e.ast.content)) : Y(e, n, t);
}
const D = [];
class Rt extends T {
  _originalNode;
  _modifiedNode;
  constructor(e, t, s) {
    const i = s?.dom ?? document.createElement("div");
    i.className = "md-block md-diff-hunk";
    const o = [], r = [], c = e.original ? wn(e.original, "md-diff-original", t, s?._originalNode) : void 0, a = e.modified ? wn(e.modified, "md-diff-modified", t, s?._modifiedNode) : void 0;
    c && (o.push(c), r.push(c.mountNode)), a && (o.push(a), r.push(a.mountNode)), Q(i, r), super(e, i, o), this._originalNode = c, this._modifiedNode = a;
  }
  /** The mounted sides with their highlight ranges, for the diff highlighter. */
  get sides() {
    const e = [];
    return this._originalNode && this.data.original && e.push({ node: this._originalNode, ranges: this.data.original.ranges }), this._modifiedNode && this.data.modified && e.push({ node: this._modifiedNode, ranges: this.data.modified.ranges }), e;
  }
}
function wn(n, e, t, s) {
  const i = Y(n.view, t, s), o = i.element;
  return o.classList.add(e), o.classList.toggle("md-block-active", n.active), o.classList.toggle("md-markers-hidden", !n.active), i;
}
class Nt extends T {
  sideNode;
  constructor(e, t, s) {
    const i = s?.dom ?? document.createElement("div");
    i.className = "md-block md-diff-decoration", i.style.pointerEvents = "none";
    const o = Y(e.side, t, s?.sideNode), r = o.element, c = !e.whole;
    r.classList.add(e.whole ? "md-diff-removed" : "md-diff-original"), r.classList.toggle("md-block-active", c), r.classList.toggle("md-markers-hidden", !c), Q(i, [o.mountNode]), super(e, i, [o]), this.sideNode = o;
  }
  /** A decoration has no presence in the modified document's source space. */
  get sourceLength() {
    return 0;
  }
  /** True when the whole block was removed (solid band, no word-level rects). */
  get whole() {
    return this.data.whole;
  }
  /** Absolute offset of this block in the *original* document. */
  get originalStart() {
    return this.data.originalStart;
  }
  get deletedRanges() {
    return this.data.deletedRanges;
  }
}
function qs(n) {
  return "content" in n ? n.content : Nr;
}
const Nr = [];
function Ir(n, e) {
  const t = n.ast.content;
  if (n.hiddenPrefixLength > 0)
    return Pr(n, t, n.hiddenPrefixLength);
  const s = {
    leftBoundary: n.leftWordBoundary,
    rightBoundary: n.rightWordBoundary,
    decorateNewline: !0
  };
  if (n.showWhitespace && Xs(t, s)) {
    const r = document.createElement("span");
    r.className = "md-text";
    const c = lt(r, t, s, n.ast);
    return new T(n, r, c);
  }
  const i = e?.dom, o = i instanceof globalThis.Text && i.data === t ? i : document.createTextNode(t);
  return new en(n, o);
}
function Pr(n, e, t) {
  const s = document.createElement("span");
  s.className = "md-text";
  const i = document.createElement("span");
  i.className = "md-runner-marker", i.setAttribute("aria-hidden", "true");
  const o = document.createTextNode(e.slice(0, t));
  i.appendChild(o), s.appendChild(i);
  const r = document.createTextNode(e.slice(t));
  return s.appendChild(r), new T(n, s, [
    new W(n.ast, o, D, t),
    new W(n.ast, r, D, e.length - t)
  ]);
}
function kn(n) {
  return n === " " || n === "	" || n === `
` || n === "\r";
}
const Br = { leftBoundary: !1, rightBoundary: !1, decorateNewline: !1 }, Ar = { leftBoundary: !1, rightBoundary: !1, decorateNewline: !1 };
function Dr(n, e, t) {
  const s = e > 0 ? !kn(n[e - 1]) : t.leftBoundary, i = e < n.length - 1 ? !kn(n[e + 1]) : t.rightBoundary;
  return s && i;
}
function Us(n, e, t) {
  const s = n[e];
  if (s === "	")
    return "md-ws-tab";
  if (s === `
` || s === "\r")
    return t.decorateNewline ? "md-ws-newline" : void 0;
  if (s === " " && !Dr(n, e, t))
    return "md-ws-space";
}
function Xs(n, e) {
  for (let t = 0; t < n.length; t++) {
    const s = n[t];
    if (e.newlineGlyph && (s === `
` || s === "\r") || Us(n, t, e) !== void 0)
      return !0;
  }
  return !1;
}
function Fr(n, e) {
  const t = [];
  let s = -1;
  const i = (c) => {
    s >= 0 && (t.push({ text: n.slice(s, c), cls: void 0 }), s = -1);
  }, o = e.breakGlyphClass ? n.indexOf(`
`) : -1, r = e.newlineGlyph ? n.lastIndexOf(`
`) : -1;
  for (let c = 0; c < n.length; c++) {
    const a = n[c];
    if (e.newlineGlyph && (a === `
` || a === "\r")) {
      const d = c === o;
      if (c !== r || d) {
        i(c), t.push({ text: a, cls: d ? e.breakGlyphClass : "md-ws-newline-glyph", display: "↵" });
        continue;
      }
    }
    const l = e.newlineGlyph && (a === `
` || a === "\r") ? void 0 : Us(n, c, e);
    if (l === void 0) {
      s < 0 && (s = c);
      continue;
    }
    i(c), t.push({ text: a, cls: l });
  }
  return i(n.length), t;
}
function lt(n, e, t, s) {
  const i = [];
  for (const o of Fr(e, t)) {
    const r = document.createTextNode(o.display ?? o.text);
    if (o.cls) {
      const c = document.createElement("span");
      c.className = o.cls, c.appendChild(r), n.appendChild(c);
    } else
      n.appendChild(r);
    i.push(new W(s, r, D, o.text.length));
  }
  return i;
}
class en extends T {
  constructor(e, t) {
    super(e, t, D);
  }
}
class W extends oe {
  _sourceLength;
  constructor(e, t, s = D, i = e.length) {
    super(e, t, s), this._sourceLength = i;
  }
  get sourceLength() {
    return this._sourceLength;
  }
}
class Gs extends W {
  _span;
  constructor(e, t) {
    const s = document.createElement("span");
    t && (s.className = t), s.setAttribute("aria-hidden", "true"), s.style.userSelect = "none";
    const i = document.createTextNode("​");
    s.appendChild(i), super(e, i, D, 0), this._span = s;
  }
  get mountNode() {
    return this._span;
  }
}
class bn extends T {
  _span;
  constructor(e, t) {
    const s = e.ast, i = `md-marker md-marker-${s.markerKind}`, o = t && t.dom instanceof globalThis.Text && t.dom.data === s.content, r = o ? t._span : document.createElement("span");
    r.className = e.visible ? i : `${i} md-marker-hidden`;
    const c = o ? t.dom : document.createTextNode(s.content);
    o || r.appendChild(c), super(e, c, D), this._span = r;
  }
  get mountNode() {
    return this._span;
  }
}
class Je extends T {
  _span;
  constructor(e, t) {
    const s = Je._build(e, t);
    super(e, s.dom, s.children), this._span = s.span;
  }
  get mountNode() {
    return this._span;
  }
  static _build(e, t) {
    const s = e.ast, i = s.glueKind ? `md-glue md-glue-${s.glueKind}` : "md-glue", o = s.glueKind === "blockBreak", r = {
      leftBoundary: !1,
      rightBoundary: !1,
      decorateNewline: e.decorateNewline,
      newlineGlyph: s.glueKind === "blockGap" || o,
      breakGlyphClass: o ? "md-ws-blockbreak-glyph" : void 0
    };
    if (e.visible && Xs(s.content, r)) {
      const u = document.createElement("span");
      u.className = i;
      const h = lt(u, s.content, r, s);
      return { span: u, dom: u, children: h };
    }
    const a = t && t.dom instanceof globalThis.Text && t.dom.data === s.content && t.children.length === 0, l = a ? t._span : document.createElement("span");
    l.className = e.visible ? i : `${i} md-glue-hidden`;
    const d = a ? t.dom : document.createTextNode(s.content);
    return a || l.appendChild(d), { span: l, dom: d, children: D };
  }
}
class yn extends T {
  _span;
  constructor(e, t) {
    const s = e.ast.content, i = document.createElement("span");
    i.className = "md-hardbreak";
    const o = document.createElement("span");
    o.className = e.visible ? "md-hardbreak-src" : "md-hardbreak-src md-hardbreak-src-hidden";
    const r = e.visible ? lt(o, s, Br, e.ast) : Vr(o, s, e.ast);
    i.appendChild(o), i.appendChild(document.createElement("br")), super(e, i, r), this._span = i;
  }
  get mountNode() {
    return this._span;
  }
}
function Vr(n, e, t) {
  const s = document.createTextNode(e);
  return n.appendChild(s), [new W(t, s)];
}
class fe extends T {
  constructor(e, t, s, i, o) {
    const r = o?.element ?? document.createElement(t);
    !o && s && (r.className = s);
    const c = G(r, qs(e), o?.children, de(i));
    super(e, r, c);
  }
}
class xn extends T {
  _sourceChildren;
  _anchors;
  constructor(e, t, s) {
    const i = s?.element ?? document.createElement("blockquote");
    s || (i.className = "md-block md-blockquote");
    const o = G(i, e.content, s?._sourceChildren, de(t)), r = $r(e.ast), c = e.showFinalMarkerOnlyLine ? r : r.slice(0, -1);
    i.classList.toggle("md-blockquote-marker-only-line", c.length > 0);
    const a = new Map(s?._anchors.map((h) => [h.ast.id, h])), l = c.map(({ marker: h }) => {
      const f = a.get(h.id) ?? new Gs(h, "md-blockquote-line-anchor");
      return a.delete(h.id), f;
    });
    for (const h of a.values())
      h.dispose();
    const d = new Map(c.map(({ index: h }, f) => [h, l[f]])), u = [];
    for (let h = 0; h < o.length; h++) {
      u.push(o[h]);
      const f = d.get(h);
      f && u.push(f);
    }
    Q(i, u.map((h) => h.mountNode)), super(e, i, u), this._sourceChildren = o, this._anchors = l;
  }
}
function $r(n) {
  const e = [];
  for (let t = n.children.length - 1; t >= 0; t--) {
    const s = n.children[t];
    if (!(s instanceof $)) {
      if (s instanceof b && s.markerKind === "blockQuoteMarker") {
        e.push({ index: t, marker: s });
        continue;
      }
      break;
    }
  }
  return e.reverse();
}
class En extends T {
  constructor(e, t, s) {
    const i = s && s.element.tagName === `H${e.ast.level}`, o = i ? s.element : document.createElement(`h${e.ast.level}`);
    i || (o.className = "md-block md-heading");
    const r = G(o, e.content, s?.children, de(t));
    super(e, o, r);
  }
}
class Cn extends T {
  _contentEl;
  constructor(e, t, s) {
    if (e.showMarkup) {
      const r = s?.data.showMarkup ? s : void 0, c = r?.dom ?? document.createElement("div");
      r || (c.className = "md-block md-thematic-break-source");
      const a = G(c, e.content, r?.children, de(t));
      super(e, c, a), this._contentEl = c;
      return;
    }
    const i = document.createElement("div");
    i.className = "md-block md-thematic-break-wrapper";
    const o = document.createElement("hr");
    o.className = "md-block md-thematic-break", i.appendChild(o), super(e, i, D), this._contentEl = o;
  }
  get element() {
    return this._contentEl;
  }
}
class Sn extends T {
  _scroller;
  constructor(e, t, s) {
    const i = s && s.dom instanceof HTMLDivElement ? s : void 0, o = i?.dom ?? document.createElement("div");
    i || (o.className = "md-block md-unhandled-block");
    const r = i?._scroller ?? document.createElement("pre");
    i || (r.className = "md-code-block md-unhandled-scroll", o.appendChild(r));
    const c = (i ? r.querySelector("code") : null) ?? document.createElement("code");
    i || r.appendChild(c);
    const a = G(c, e.content, i?.children, (l, d) => {
      const u = l.ast;
      if (l.kind === "marker" && u.markerKind === "content") {
        const f = (d instanceof W && d.dom.nodeType === globalThis.Node.TEXT_NODE && d.dom.data === u.content ? d.dom : void 0) ?? document.createTextNode(u.content);
        return new W(u, f);
      }
      return Y(l, t, d);
    });
    super(e, o, a), this._scroller = r;
  }
  get element() {
    return this._scroller;
  }
}
class Ln extends T {
  constructor(e, t, s, i) {
    const o = i?.dom instanceof HTMLDivElement ? i.dom : document.createElement("div");
    o.className = `md-block md-html-comment md-html-comment-${t.kind}${e.showMarkup ? " md-html-comment-source" : ""}`;
    const r = G(o, e.content, i?.children, (c, a) => {
      const l = c.ast;
      return c.kind === "marker" && l.markerKind === "content" ? new Mn(l, t, N(a, Mn)) : Y(c, s, a);
    });
    super(e, o, r);
  }
}
class Mn extends oe {
  constructor(e, t, s) {
    const i = s?.dom instanceof HTMLSpanElement ? s.dom : document.createElement("span");
    i.className = "md-html-comment-content";
    const o = [
      { className: "md-html-comment-syntax", content: t.leadingWhitespace },
      { className: "md-html-comment-syntax", content: t.opening },
      { className: "md-html-comment-body", content: t.body }
    ];
    t.kind === "complete" && o.push(
      { className: "md-html-comment-syntax", content: t.closing },
      { className: "md-html-comment-syntax", content: t.trailingWhitespace }
    );
    const c = o.filter((a) => a.content.length > 0).map((a, l) => {
      const d = s?.children[l] instanceof Tn ? s.children[l] : void 0, u = d?.mountNode instanceof HTMLSpanElement ? d.mountNode : document.createElement("span");
      u.className = a.className;
      const h = d?.dom instanceof Text ? d.dom : void 0, f = h?.data === a.content ? h : document.createTextNode(a.content);
      return Q(u, [f]), new Tn(e, f, u, a.content.length);
    });
    Q(i, c.map((a) => a.mountNode)), super(e, i, c);
  }
}
class Tn extends W {
  constructor(e, t, s, i) {
    super(e, t, D, i), this._span = s;
  }
  get mountNode() {
    return this._span;
  }
}
class On extends T {
  _session;
  _snapshotSub;
  constructor(e, t, s) {
    const i = e.ast, o = i.value, r = o?.content ?? "", c = t?.syntaxHighlighter;
    let a;
    o && c && (s?._session && i === s.ast ? (a = s._session, s._session = void 0) : a = c.create("yaml", r)), s?._session?.dispose(), s && (s._session = void 0), s?._snapshotSub?.dispose(), s && (s._snapshotSub = void 0);
    const l = a ? a.snapshot.get().getTokens(v.ofLength(r.length)).tokens : void 0, d = Ys(
      e.content,
      o,
      r,
      t,
      "md-block md-code-block md-front-matter",
      "yaml",
      l
    );
    if (super(e, d.dom, d.children), this._session = a, a && d.contentNode) {
      const u = d.contentNode;
      this._snapshotSub = Vt(a.snapshot, () => {
        const h = a.snapshot.get();
        u.refresh(r, h.getTokens(v.ofLength(r.length)).tokens);
      });
    }
  }
  dispose() {
    this._snapshotSub?.dispose(), this._snapshotSub = void 0, this._session?.dispose(), this._session = void 0, super.dispose();
  }
}
class tn extends T {
  _session;
  /**
   * Subscription that re-tokenises the rendered `<code>` in place whenever the
   * session advances its {@link ISyntaxHighlighterDocument.snapshot} *without*
   * a source edit (an async grammar finishing, a live recolour). It is tied to
   * this node's lifetime, but like {@link _session} it must be disposed
   * manually: a node reused as `previous` for a rebuild is never `dispose`d
   * (see {@link reconcileDomChildren}), so the rebuilding constructor disposes
   * its predecessor's subscription explicitly.
   */
  _snapshotSub;
  /**
   * An in-place interactive editor (e.g. an iframe) mounted instead of the
   * rendered code. Like {@link _session} it is adopted from `previous` across
   * rebuilds so the underlying editor keeps its state, and must be disposed
   * manually (a node reused as `previous` is never {@link dispose}d).
   */
  _embeddedEditor;
  _embeddedEditorFactoryVersion;
  _embeddedEditorReadOnly;
  canReuse(e, t) {
    return super.canReuse(e, t) && Object.is(t?.embeddedCodeEditorFactoryVersion, this._embeddedEditorFactoryVersion) && (!this._embeddedEditor || (t?.embeddedCodeEditorReadOnly ?? !1) === this._embeddedEditorReadOnly);
  }
  constructor(e, t, s) {
    const i = e.ast, o = i.code?.content ?? "", r = s instanceof tn ? s : void 0, c = t?.embeddedCodeEditorReadOnly ?? !1, a = br(o);
    let l;
    !e.showMarkup && i.language && i.code && i.closeFence && a.sourceOffset > 0 && t?.embeddedCodeEditorFactory && (r?._embeddedEditor && Object.is(t.embeddedCodeEditorFactoryVersion, r._embeddedEditorFactoryVersion) && (i === r.ast || i.getDiff(r.ast)) ? (l = r._embeddedEditor, r._embeddedEditor = void 0) : l = t.embeddedCodeEditorFactory.create(i.language, i.infoString, a.text) ?? void 0), r?._embeddedEditor && (r._embeddedEditor.dispose(), r._embeddedEditor = void 0);
    const d = !l && !e.showMarkup && i.language && i.closeFence && t?.renderCustomCodeBlock ? Wr(t.renderCustomCodeBlock, i.language, o) : void 0, u = t?.syntaxHighlighter;
    let h;
    if (!l && !d && u && i.language) {
      if (r?._session && i === r.ast)
        h = r._session, r._session = void 0;
      else if (r?._session) {
        const p = i.getDiff(r.ast);
        p && (h = r._session, r._session = void 0, te((w) => h.update(p.stringEdit, w)));
      }
      h || (h = u.create(i.language, o));
    }
    r?._session && (r._session.dispose(), r._session = void 0), r?._snapshotSub?.dispose(), r && (r._snapshotSub = void 0);
    const f = h ? h.snapshot.get().getTokens(v.ofLength(o.length)).tokens : void 0;
    let m, g, _;
    if (l) {
      l.element.classList.add("md-block", "md-code-block");
      const p = l.estimateHeight?.(a.text);
      p !== void 0 && (l.element.style.boxSizing = "border-box", l.element.style.minHeight = `${p}px`), l.onEdit = (w) => {
        const E = a.sourceOffset === 0 ? w : new S(
          w.replacements.map((y) => le.replace(y.replaceRange.delta(a.sourceOffset), y.newText))
        );
        t?.onEmbeddedCodeEditorEdit?.(i, E);
      }, l.setReadOnly?.(t?.embeddedCodeEditorReadOnly ?? !1), l.setContent(a.text), m = l.element, g = D;
    } else if (d)
      d.classList.add("md-block", "md-code-block"), m = d, g = D;
    else if (i.openFence) {
      const p = Ys(
        e.content,
        i.code,
        o,
        t,
        "md-block md-code-block",
        i.language || void 0,
        f
      ), w = p.dom, E = p.children;
      if (_ = p.contentNode, !i.closeFence && i.code && o.endsWith(`
`)) {
        const y = new Gs(i.code);
        w.appendChild(y.mountNode), E.push(y);
      }
      m = w, g = E;
    } else {
      const p = document.createElement("pre");
      p.className = "md-block md-code-block";
      const w = document.createElement("code");
      p.appendChild(w);
      const E = [];
      for (const y of e.content) {
        const L = y.ast;
        if (y.kind === "marker" && L.markerKind === "content") {
          const R = document.createTextNode(L.content);
          w.appendChild(R), E.push(new W(L, R));
        } else if (y.kind === "marker" && L.markerKind === "codeIndent") {
          const R = L;
          if (y.visible) {
            const V = document.createElement("span");
            V.className = "md-marker md-marker-codeIndent";
            const ve = lt(V, R.content, Ar, R);
            w.appendChild(V), E.push(new W(R, V, ve));
          } else {
            const V = Y(y, t, void 0);
            w.appendChild(V.mountNode), E.push(V);
          }
        } else {
          const R = Y(y, t, void 0);
          p.appendChild(R.mountNode), E.push(R);
        }
      }
      m = p, g = E;
    }
    super(e, m, g), this._session = h, this._embeddedEditor = l, this._embeddedEditorFactoryVersion = t?.embeddedCodeEditorFactoryVersion, this._embeddedEditorReadOnly = c, h && _ && (this._snapshotSub = Vt(h.snapshot, () => {
      const p = h.snapshot.get();
      _.refresh(o, p.getTokens(v.ofLength(o.length)).tokens);
    }));
  }
  dispose() {
    this._snapshotSub?.dispose(), this._snapshotSub = void 0, this._session?.dispose(), this._session = void 0, this._embeddedEditor?.dispose(), this._embeddedEditor = void 0, super.dispose();
  }
}
function Wr(n, e, t) {
  try {
    return n(e, t);
  } catch (s) {
    console.error(`Custom code block renderer failed for ${e}.`, s);
    return;
  }
}
function Ys(n, e, t, s, i, o, r) {
  const c = document.createElement("pre");
  c.className = i;
  const a = [];
  let l;
  for (const d of n)
    if (e && d.ast === e) {
      const u = document.createElement("code");
      o && (u.className = `language-${CSS.escape(o)}`);
      const h = Hr(e, t, u, r);
      h instanceof Qs && (l = h), a.push(h), c.appendChild(u);
    } else {
      const u = Y(d, s, void 0);
      c.appendChild(u.mountNode), a.push(u);
    }
  return { dom: c, children: a, contentNode: l };
}
function Hr(n, e, t, s) {
  if (!s) {
    const i = document.createTextNode(e);
    return t.appendChild(i), new W(n, i);
  }
  return new Qs(n, t, e, s);
}
class Qs extends oe {
  constructor(e, t, s, i) {
    super(e, t, Rn(e, t, s, i));
  }
  /** Re-render the token spans for a new colouring, in place. */
  refresh(e, t) {
    const s = this.dom;
    s.replaceChildren(), this._replaceChildren(Rn(this.ast, s, e, t));
  }
}
function Rn(n, e, t, s) {
  const i = [];
  let o = 0;
  for (const r of s) {
    const c = t.slice(o, o + r.length);
    o += r.length;
    const a = document.createTextNode(c);
    if (r.className) {
      const l = document.createElement("span");
      for (const d of r.className.split("."))
        d && l.classList.add(`tok-${d}`);
      l.appendChild(a), e.appendChild(l);
    } else
      e.appendChild(a);
    i.push(new W(n, a, D, c.length));
  }
  return i;
}
function js(n) {
  let e = 0;
  for (const t of n) {
    if (t.kind === "marker" && t.markerKind === "content")
      return e;
    e += t.length;
  }
  return e;
}
function Zs(n, e, t) {
  const s = e.filter((c) => c.length > 0 && c.start >= 0 && c.start + c.length <= t).slice().sort((c, a) => c.start - a.start), i = [];
  let o = 0;
  const r = (c) => {
    c > 0 && i.push(new W(n, document.createTextNode(""), D, c));
  };
  for (const c of s)
    c.start < o || (r(c.start - o), i.push(new W(n, c.dom, D, c.length)), o = c.start + c.length);
  return r(t - o), i;
}
class Nn extends T {
  /**
   * The rendered (inactive, KaTeX) height in px, measured after mount and
   * carried forward across rebuilds via `previous`. When the block becomes
   * active (source markers shown) this height is reserved as a `min-height`
   * so the editor does not collapse below the rendered size, keeping the
   * surrounding layout stable as the caret enters and leaves the block.
   */
  _renderedHeight;
  constructor(e, t, s) {
    const i = e.ast, o = s?._renderedHeight;
    if (e.showMarkup) {
      const l = document.createElement("pre");
      l.className = "md-block md-math-block", o !== void 0 && (l.style.boxSizing = "border-box", l.style.minHeight = `${o}px`);
      const d = [];
      for (const u of e.content)
        if (u.ast === i.code) {
          const h = document.createElement("code"), f = document.createTextNode(i.code.content);
          h.appendChild(f), l.appendChild(h), d.push(new W(i.code, f));
        } else {
          const h = Y(u, t, void 0);
          l.appendChild(h.mountNode), d.push(h);
        }
      super(e, l, d), this._renderedHeight = o;
      return;
    }
    const r = i.code?.content ?? "", c = t?.renderMath?.({
      latex: r,
      displayMode: !0,
      className: "md-block md-math-block",
      nodeLength: i.length,
      contentStart: js(i.content)
    });
    if (c) {
      super(e, c.dom, Zs(i, c.segments, i.length)), this._renderedHeight = o;
      return;
    }
    const a = document.createElement("div");
    a.className = "md-block md-math-block";
    try {
      ys.render(r, a, { displayMode: !0, throwOnError: !1 });
    } catch {
      a.textContent = r;
    }
    super(e, a, D), this._renderedHeight = o;
  }
  recordMeasuredHeight(e) {
    this.data.showMarkup || (this._renderedHeight = e);
  }
}
class In extends T {
  constructor(e, t, s) {
    const i = e.ast.ordered ? "ol" : "ul", o = s && s.element.tagName === i.toUpperCase(), r = o ? s.element : document.createElement(i);
    o || (r.className = "md-block md-list");
    const c = G(r, e.content, s?.children, de(t));
    super(e, r, c);
  }
}
class Pn extends T {
  constructor(e, t, s) {
    const i = e.ast, o = document.createElement("li");
    e.isActive && o.classList.add("md-list-item-active"), i.checked !== void 0 && o.classList.add("md-task-list-item"), e.isActive || o.classList.add("md-markers-hidden"), e.isRunning && o.classList.add("md-task-list-item-running"), o.style.setProperty("--md-list-level", String(e.level));
    const r = Kr(o, e.content, s, t);
    if (!e.isActive && i.checked !== void 0) {
      const c = document.createElement("input");
      c.type = "checkbox", c.checked = i.checked, c.className = "md-checkbox", e.isRunning && (c.classList.add("md-checkbox-running"), c.indeterminate = !0, c.setAttribute("aria-busy", "true"), c.setAttribute("aria-label", "In progress"));
      const a = t?.onToggleCheckbox;
      if (a) {
        const l = i.checked;
        c.addEventListener("pointerdown", (d) => {
          d.stopPropagation();
        }), c.addEventListener("click", (d) => {
          d.stopPropagation(), d.preventDefault(), a(i, !l);
        });
      } else
        c.disabled = !0;
      o.insertBefore(c, o.firstChild);
    }
    super(e, o, r);
  }
}
function Kr(n, e, t, s) {
  const { paired: i, unused: o } = nn(e, t?.children ?? D), r = e.map((d) => Y(d, s, i.get(d)));
  for (const d of o)
    d.dispose();
  if (!(e.length >= 2 && e[0].kind === "glue" && e[0].ast.glueKind === "indent" && e[1].kind === "marker" && e[1].ast.markerKind === "listItemMarker"))
    return Q(n, r.map((d) => d.mountNode)), r;
  const a = n.firstElementChild, l = a && a.classList.contains("md-list-gutter") ? a : document.createElement("span");
  return l.className = "md-list-gutter", Q(l, [r[0].mountNode, r[1].mountNode]), Q(n, [l, ...r.slice(2).map((d) => d.mountNode)]), r;
}
class Bn extends T {
  _table;
  constructor(e, t, s) {
    const i = s?.dom ?? document.createElement("div"), o = s?._table ?? document.createElement("table");
    s || (i.className = "md-block md-table-wrapper", o.className = "md-block md-table", i.appendChild(o));
    const r = G(o, qs(e), s?.children, de(t));
    super(e, i, r), this._table = o;
  }
  get element() {
    return this._table;
  }
  get scrollElement() {
    return this.dom;
  }
}
class An extends T {
  constructor(e, t, s) {
    const i = s?.element ?? document.createElement("tr");
    e.isDelimiter && i.classList.add("md-table-delimiter-row");
    const o = G(i, e.content, s?.children, de(t));
    e.isDelimiter || e.content.forEach((r, c) => {
      r.kind === "tableCell" && o[c].element.classList.toggle("md-table-cell-active", r.isActive);
    }), super(e, i, o);
  }
}
class Dn extends T {
  constructor(e, t, s) {
    const i = s?.element ?? document.createElement("code"), o = G(i, e.content, s?.children, zs(t));
    super(e, i, o);
  }
}
class Fn extends T {
  constructor(e, t, s) {
    if (e.showMarkup) {
      const a = document.createElement("span");
      a.className = "md-inline-math";
      const l = G(a, e.content, s?.children, zs(t));
      super(e, a, l);
      return;
    }
    const o = e.content.find(
      (a) => a.kind === "marker" && a.ast.markerKind === "content"
    )?.ast.content ?? "", r = t?.renderMath?.({
      latex: o,
      displayMode: !1,
      className: "md-inline-math",
      nodeLength: e.ast.length,
      contentStart: js(e.ast.content)
    });
    if (r) {
      super(e, r.dom, Zs(e.ast, r.segments, e.ast.length));
      return;
    }
    const c = document.createElement("span");
    c.className = "md-inline-math";
    try {
      ys.render(o, c, { throwOnError: !1 });
    } catch {
      c.textContent = o;
    }
    super(e, c, D);
  }
}
class Vn extends T {
  _presentation;
  _presentationSubscription;
  constructor(e, t, s) {
    s?._presentationSubscription?.dispose(), s && (s._presentationSubscription = void 0), s?._presentation?.dispose(), s && (s._presentation = void 0);
    const i = !e.showMarkup && It(e.ast.url) ? t?.linkPresentationProvider?.createLinkPresentation(e.ast.url) : void 0, o = i ? "SPAN" : "A", r = s?.element.tagName === o ? s.element : document.createElement(o.toLowerCase());
    if (It(e.ast.url) ? (r.dataset.mdUrl = e.ast.url, r instanceof HTMLAnchorElement && (r.href = e.ast.url)) : (r.removeAttribute("href"), delete r.dataset.mdUrl), i ? (r.setAttribute("role", "link"), r.tabIndex = 0) : (r.removeAttribute("role"), r.removeAttribute("tabindex")), r !== s?.element) {
      const d = (m) => !r.dataset.mdUrl || m.button !== 0 && m.button !== 1 ? !1 : m.button === 1 ? !0 : !(r.closest(".md-block-active") !== null) || m.ctrlKey || m.metaKey, u = (m) => {
        const g = r.dataset.mdUrl;
        if (!g)
          return !0;
        const _ = t?.onOpenLink;
        return _ ? _(g, m) !== !1 : (window.open(g, "_blank", "noopener"), !0);
      };
      let h = !1;
      r.addEventListener("pointerdown", (m) => {
        h = !1, d(m) && (m.stopPropagation(), h = !0);
      });
      const f = (m) => {
        const g = h || d(m);
        h = !1, g && u(m) && (m.preventDefault(), m.stopPropagation());
      };
      r.addEventListener("click", f), r.addEventListener("auxclick", f), r.addEventListener("keydown", (m) => {
        r.getAttribute("role") !== "link" || m.key !== "Enter" && m.key !== " " || (m.preventDefault(), r.click());
      });
    }
    let c;
    const a = i ? r.querySelector(":scope > .md-rich-link-label") ?? document.createElement("span") : r, l = G(a, e.content, s?.children, de(t));
    if (i ? c = Oe.mount(r, a) : (Oe.clear(r), Q(r, l.map((d) => d.mountNode))), super(e, r, l), i && c) {
      this._presentation = i;
      const d = () => c.update(i.presentation.get());
      d(), this._presentationSubscription = Vt(i.presentation, d);
    }
  }
  dispose() {
    this._presentationSubscription?.dispose(), this._presentationSubscription = void 0, this._presentation?.dispose(), this._presentation = void 0, super.dispose();
  }
}
class $n extends T {
  constructor(e, t, s) {
    const i = e.ast;
    if (e.showMarkup) {
      const r = document.createElement("span");
      r.className = "md-image-source";
      const c = G(r, e.content, s?.children, de(t));
      super(e, r, c);
      return;
    }
    const o = document.createElement("img");
    It(i.url) && (o.src = i.url), o.alt = i.alt, super(e, o, D);
  }
}
function nn(n, e) {
  const t = /* @__PURE__ */ new Map();
  for (const i of e)
    t.set(i.ast.id, i);
  const s = /* @__PURE__ */ new Map();
  for (const i of n) {
    const o = t.get(i.ast.id);
    o && (s.set(i, o), t.delete(i.ast.id));
  }
  return { paired: s, unused: [...t.values()] };
}
function It(n) {
  return !n.trim().toLowerCase().startsWith("javascript:");
}
class sn extends oe {
  constructor(e, t, s, i, o) {
    super(e, t, i), this.blocks = s, this.pendingParagraph = o;
  }
  static create(e, t, s) {
    const i = s?.contentDomNode ?? document.createElement("div");
    i.classList.add("md-document");
    const o = new Map(
      e.children.filter((f) => f.kind === "block").map((f) => [f.view, f.isActive])
    ), r = s?.children, c = e.children.map((f) => f.view), { paired: a, unused: l } = nn(c, r ?? zr);
    let d;
    const u = c.map((f, m) => {
      const g = a.get(f);
      if (e.children[m].kind === "pendingParagraph") {
        const p = f, w = g instanceof Wn ? g : new Wn(p);
        return w.update(p.text), d = w, w;
      }
      const _ = Y(f, t, g);
      if (e.children[m].kind === "block") {
        const p = o.get(f);
        p !== void 0 && (_.element.classList.toggle("md-block-active", p), _.element.classList.toggle("md-markers-hidden", !p));
        /* gp-fork: decorateInactiveBlock — a freshly built, INACTIVE top-level
         * block view is offered to the host once, after its rendering is
         * complete, so the host can apply presentation derived from the
         * block's source (e.g. markdown-it-attrs `{#id .class}` trailers).
         * Never for an active block: its source is on screen verbatim. See
         * PATCHES.md Patch 4. */
        p === !1 && _ !== g && t?.decorateInactiveBlock?.(_.element, f.ast, Es(f.ast));
        const w = e.children[m].diffKind;
        _.element.classList.toggle("md-diff-added", w === "added"), _.element.classList.toggle("md-diff-modified", w === "modified");
      }
      return _;
    });
    for (const f of l)
      f.dispose();
    /* gp-fork: groupBlocks — wrap runs of top-level block views in
     * host-owned container elements (Gutterpress @section/@page/@spread/
     * @chapter scopes) before mounting. The block views, `u`, and the
     * `blocks` list below are untouched; only the DOM parent of a mounted
     * block changes. See PATCHES.md Patch 3. */
    let gpMountNodes = u.map((f) => f.mountNode), gpWrappers = s?._gpWrappers;
    if (t?.groupBlocks) {
      const gpCandidates = [];
      e.children.forEach((f, m) => {
        f.kind === "block" && gpCandidates.push({ index: m, ast: f.view.ast, sourceText: Es(f.view.ast), absoluteStart: f.absoluteStart });
      });
      const gpGroups = t.groupBlocks(gpCandidates) ?? [];
      if (gpGroups.length > 0) {
        const gpResult = gpMountGroups(u, gpCandidates, gpGroups, gpWrappers);
        gpMountNodes = gpResult.nodes, gpWrappers = gpResult.wrappers;
      } else
        gpWrappers = void 0;
    }
    Q(i, gpMountNodes);
    /* gp-fork: afterDocumentMount — the host may re-layout the mounted
     * document (Gutterpress paginates it into multicol strips) before the
     * view measures it. See PATCHES.md Patch 5. */
    t?.afterDocumentMount?.(i);
    const h = [];
    e.children.forEach((f, m) => {
      f.kind === "block" && h.push({ node: u[m], absoluteStart: f.absoluteStart });
    });
    const gpView = new sn(e.ast, i, h, u, d);
    return gpView._gpWrappers = gpWrappers, gpView;
  }
  /** The stable content element this document mounts its children into. */
  get contentDomNode() {
    return this.dom;
  }
}
/* gp-fork: groupBlocks — container mounting helper for sn.create above.
 * `groups` are indices into `candidates` (block-only positions, start
 * inclusive / end exclusive); `candidates[i].index` maps back into `u`.
 * Wrapper elements are reused across renders by `spec.key` so an unchanged
 * container keeps its DOM node (and the block views inside it keep theirs).
 * Groups must nest properly; a group that does not fit inside the range
 * being built is skipped rather than guessed. See PATCHES.md Patch 3. */
function gpMountGroups(u, candidates, groups, prevWrappers) {
  const wrappers = /* @__PURE__ */ new Map(), ranges = [];
  for (const g of groups) {
    const first = candidates[g.start], last = candidates[g.end - 1];
    !first || !last || g.end <= g.start || ranges.push({ spec: g, uStart: first.index, uEnd: last.index + 1 });
  }
  ranges.sort((a, b) => a.uStart - b.uStart || b.uEnd - a.uEnd);
  let next = 0;
  const build = (from, to) => {
    const nodes = [];
    let m = from;
    for (; m < to; ) {
      const r = ranges[next];
      if (r && r.uStart === m && r.uEnd <= to) {
        next++;
        const tag = (r.spec.tagName ?? "div").toLowerCase();
        let el = prevWrappers?.get(r.spec.key);
        (!el || el.tagName.toLowerCase() !== tag) && (el = document.createElement(tag));
        for (const a of Array.from(el.attributes))
          el.removeAttribute(a.name);
        r.spec.className && (el.className = r.spec.className);
        for (const [k, v] of Object.entries(r.spec.attributes ?? {}))
          k !== "class" && el.setAttribute(k, v);
        el.classList.add("md-block-group"), wrappers.set(r.spec.key, el), Q(el, build(m, r.uEnd)), nodes.push(el), m = r.uEnd;
      } else if (r && r.uStart === m)
        next++;
      else
        nodes.push(u[m].mountNode), m++;
    }
    return nodes;
  };
  return { nodes: build(0, u.length), wrappers };
}
class Wn extends oe {
  element;
  anchorBlock;
  cursorLine;
  _text = "";
  constructor(e) {
    const t = document.createElement("p");
    t.className = "md-block md-paragraph md-pending-paragraph", super(e.ast, t), this.element = t, this.anchorBlock = e.anchorBlock, this.cursorLine = e.cursorLine, this.update(e.text);
  }
  update(e) {
    if (!(e === this._text && this.element.childNodes.length > 0)) {
      if (this._text = e, e.length === 0) {
        this.element.replaceChildren(document.createElement("br"));
        return;
      }
      this.element.replaceChildren(...[...e].map((t) => {
        const s = document.createElement("span");
        return s.className = t === " " ? "md-ws-space" : "md-ws-tab", s.textContent = t, s;
      }));
    }
  }
  getCaretClientRect() {
    const e = this.element.getBoundingClientRect();
    if (this._text.length === 0)
      return new DOMRect(e.left, e.top, 0, e.height);
    const t = this.element.ownerDocument.createRange();
    t.selectNodeContents(this.element), t.collapse(!1);
    const s = t.getBoundingClientRect();
    if (s.height > 0)
      return s;
    const i = this.element.lastElementChild?.getBoundingClientRect();
    return new DOMRect(i?.right ?? e.left, e.top, 0, e.height);
  }
}
const zr = [], He = 1e-7;
class dt {
  constructor(e) {
    this._getLocalToClientMatrix = e;
  }
  static forSvgOverlay(e) {
    return new dt(() => {
      if (!e.isConnected)
        return new DOMMatrix();
      const t = e.getScreenCTM();
      if (!t)
        throw new Error("Cannot resolve editor coordinates before the overlay is mounted");
      return t;
    });
  }
  capture() {
    const e = this._getLocalToClientMatrix();
    if (e.is2D === !1 || Math.abs(e.b) > He || Math.abs(e.c) > He || e.a <= He || e.d <= He)
      throw new Error("Markdown editor geometry supports positive axis-aligned scale and translation only");
    return new qr(e);
  }
}
class qr {
  constructor(e) {
    this._localToClient = e, this._clientToLocal = e.inverse();
  }
  _clientToLocal;
  toLocalPoint(e) {
    const t = new DOMPoint(e.x, e.y).matrixTransform(this._clientToLocal);
    return new ne(t.x, t.y);
  }
  toClientPoint(e) {
    const t = new DOMPoint(e.x, e.y).matrixTransform(this._localToClient);
    return new ne(t.x, t.y);
  }
  toLocalRect(e) {
    return this._convertRect(e, this._clientToLocal);
  }
  toClientRect(e) {
    return this._convertRect(e, this._localToClient);
  }
  _convertRect(e, t) {
    const s = new DOMPoint(e.left, e.top).matrixTransform(t), i = new DOMPoint(e.left + e.width, e.top + e.height).matrixTransform(t);
    return C.fromPointPoint(s.x, s.y, i.x, i.y);
  }
}
class Js {
  constructor(e, t, s) {
    this.ast = e, this.blocks = t, this.children = s;
  }
  kind = "document";
}
class Ur {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "heading";
}
class Xr {
  /* gp-fork: renderCustomBlock — thread the build-time showMarkup context
   * (already computed by every caller of Se(), see the "paragraph" case
   * below) onto the ViewData itself, mirroring the SAME (ast, showMarkup,
   * content) shape codeBlock/mathBlock/frontMatter/unhandledBlock already
   * use. Upstream never stored it here because no upstream feature needed
   * a paragraph's active/inactive state at view-construction time; the
   * renderCustomBlock seam does. Additive: the sole construction site
   * (Se()'s "paragraph" case) is updated in the same hunk. */
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "paragraph";
}
class Gr {
  constructor(e, t, s, i) {
    this.ast = e, this.anchorBlock = t, this.cursorLine = s, this.text = i;
  }
  kind = "pendingParagraph";
}
class Yr {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "frontMatter";
}
class Qr {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "codeBlock";
}
class jr {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "mathBlock";
}
class Zr {
  constructor(e, t, s) {
    this.ast = e, this.content = t, this.showFinalMarkerOnlyLine = s;
  }
  kind = "blockQuote";
}
class Jr {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "list";
}
class ec {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "table";
}
class tc {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "strong";
}
class nc {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "emphasis";
}
class sc {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "strikethrough";
}
class ic {
  constructor(e, t) {
    this.ast = e, this.content = t;
  }
  kind = "inlineCode";
}
class oc {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "inlineMath";
}
class rc {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "link";
}
class cc {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "image";
}
class ac {
  constructor(e, t, s, i, o = !1) {
    this.ast = e, this.isActive = t, this.content = s, this.level = i, this.isRunning = o;
  }
  kind = "listItem";
}
class lc {
  constructor(e, t, s) {
    this.ast = e, this.isDelimiter = t, this.content = s;
  }
  kind = "tableRow";
}
class dc {
  constructor(e, t, s, i) {
    this.ast = e, this.isActive = t, this.showTableGlue = s, this.content = i;
  }
  kind = "tableCell";
}
class hc {
  /**
   * Whether non-obvious whitespace in this text is revealed (block is active).
   * `leftWordBoundary`/`rightWordBoundary` say whether the inline sibling on
   * that side ends/starts with visible word content (e.g. inline code, a link,
   * emphasis); a single space touching such a sibling is obvious and stays
   * undecorated, just like a space between two words within this leaf.
   */
  constructor(e, t, s = !1, i = !1, o = 0) {
    this.ast = e, this.showWhitespace = t, this.leftWordBoundary = s, this.rightWordBoundary = i, this.hiddenPrefixLength = o;
  }
  kind = "text";
}
class uc {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "thematicBreak";
}
class fc {
  constructor(e, t, s) {
    this.ast = e, this.showMarkup = t, this.content = s;
  }
  kind = "unhandledBlock";
}
class mc {
  constructor(e, t) {
    this.ast = e, this.visible = t;
  }
  kind = "marker";
}
class ei {
  constructor(e, t, s) {
    this.ast = e, this.visible = t, this.decorateNewline = s;
  }
  kind = "glue";
}
class gc {
  constructor(e, t, s, i, o) {
    this.ast = e, this.side = t, this.deletedRanges = s, this.whole = i, this.originalStart = o;
  }
  kind = "diffDecoration";
}
const ti = { showMarkup: !1, showTableGlue: !1, selectionInNode: void 0 };
function ee(n) {
  return n.inlineFlow ? n : { ...n, inlineFlow: !0 };
}
function ni(n, e, t, s, i) {
  const o = /* @__PURE__ */ new Map();
  if (s)
    for (const u of s.children)
      o.set(u.view.ast, u);
  const r = n.content, c = new Set(n.blocks), a = [], l = [];
  let d = 0;
  for (let u = 0; u < r.length; u++) {
    const h = r[u];
    if (c.has(h)) {
      const f = h, m = e.has(f), g = o.get(f), _ = i?.anchorBlock === f ? i.replaceRange.delta(-d) : void 0;
      let p;
      if (!m)
        p = g && !g.isActive && !_ ? g.view : Pt(f, {
          ...ti,
          pendingAnchorBlock: _ ? f : void 0,
          pendingReplacementInBlock: _
        }, g?.view);
      else {
        const w = t && t.endExclusive >= d && t.start <= d + f.length ? new v(
          Math.max(0, t.start - d),
          Math.min(f.length, t.endExclusive - d)
        ) : void 0;
        p = Pt(f, {
          showMarkup: !0,
          showTableGlue: !1,
          selectionInNode: w,
          pendingAnchorBlock: _ ? f : void 0,
          pendingReplacementInBlock: _
        }, g?.view);
      }
      a.push({ ast: f, absoluteStart: d, isActive: m, view: p }), l.push({ absoluteStart: d, isActive: m, view: p, kind: "block" }), i && i.anchorBlock === f && l.push({
        absoluteStart: d + f.length,
        isActive: !0,
        view: new Gr(i.ast, i.anchorBlock, i.cursorLine, i.text),
        kind: "pendingParagraph"
      });
    } else if (h instanceof $) {
      const f = o.get(h), m = M(f?.view, new ei(h, !1, !1));
      l.push({ absoluteStart: d, isActive: !1, view: m, kind: "glue" });
    }
    d += h.length;
  }
  return new Js(n, a, l);
}
function Pt(n, e, t) {
  return Se(n, e, t);
}
function pc(n, e, t) {
  return Pt(n, e ? { showMarkup: !0, showTableGlue: !1, selectionInNode: void 0 } : ti, t);
}
function _c(n, e, t = !1) {
  const s = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map();
  let o = [];
  for (const l of e) {
    if (l.kind === "removed") {
      o.push(l);
      continue;
    }
    const d = ii(l);
    d && (o.length && (i.set(d, o), o = []), s.set(d, l));
  }
  const r = o, c = [], a = [];
  for (const l of n.children) {
    if (l.kind !== "block") {
      c.push(l);
      continue;
    }
    const d = l.view;
    for (const g of i.get(d.ast) ?? [])
      c.push(_t(g.node, g.deletedLocal, l.absoluteStart, !0, g.originalStart, t));
    const u = s.get(d.ast);
    u && u.kind === "replaced" && u.deletedLocal.length > 0 && c.push(_t(u.original, u.deletedLocal, l.absoluteStart, !1, u.originalStart, t));
    const h = u && u.kind === "nested" ? si(d, u, t) : d, f = u?.kind === "added" ? "added" : u?.kind === "replaced" ? "modified" : void 0, m = f ? { ...l, diffKind: f } : h !== d ? { ...l, view: h } : l;
    c.push(m), a.push({ ast: d.ast, absoluteStart: l.absoluteStart, isActive: l.isActive, view: h });
  }
  for (const l of r)
    c.push(_t(l.node, l.deletedLocal, n.ast.length, !0, l.originalStart, t));
  return new Js(n.ast, a, c);
}
function _t(n, e, t, s, i, o) {
  return {
    absoluteStart: t,
    isActive: !1,
    view: Ge(n, e, s, i, o),
    kind: "diffDecoration"
  };
}
function Ge(n, e, t, s, i) {
  return new gc(n, pc(n, i || !t), e, t, s);
}
function si(n, e, t) {
  const s = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map();
  let o = [];
  for (const a of e.children) {
    if (a.kind === "removed") {
      o.push(a);
      continue;
    }
    const l = ii(a);
    l && (o.length && (i.set(l, o), o = []), s.set(l, a));
  }
  const r = n.content ?? [], c = [];
  for (const a of r) {
    for (const d of i.get(a.ast) ?? [])
      c.push(Ge(d.node, d.deletedLocal, !0, d.originalStart, t));
    const l = s.get(a.ast);
    l && l.kind === "replaced" && l.deletedLocal.length > 0 ? (c.push(Ge(l.original, l.deletedLocal, !1, l.originalStart, t)), c.push(a)) : l && l.kind === "nested" ? c.push(si(a, l, t)) : c.push(a);
  }
  for (const a of o)
    c.push(Ge(a.node, a.deletedLocal, !0, a.originalStart, t));
  return vc(n, c);
}
function vc(n, e) {
  return Object.assign(Object.create(Object.getPrototypeOf(n)), n, { content: e });
}
function ii(n) {
  switch (n.kind) {
    case "unchanged":
      return n.node;
    case "added":
      return n.node;
    case "replaced":
      return n.modified;
    case "nested":
      return n.modified;
    case "removed":
      return;
  }
}
function Se(n, e, t, s) {
  const i = n;
  switch (i.kind) {
    case "text":
      return M(t, new hc(
        i,
        e.showMarkup,
        s?.left ?? !1,
        s?.right ?? !1,
        i === e.hideRunnerMarkerNode ? e.hideRunnerMarkerLength ?? 0 : 0
      ));
    // The trailing gap is revealed as `↵` glyphs by virtue of its `blockGap`
    // kind (see `GlueViewNode`), so the break needs no inline-flow opt-in.
    case "thematicBreak":
      return M(t, new uc(i, e.showMarkup, F(i.children, e, t)));
    case "unhandledBlock":
      return M(t, new fc(i, e.showMarkup, F(i.children, e, t)));
    case "marker":
      return M(t, new mc(i, yc(i.markerKind, e)));
    case "glue":
      return M(t, new ei(i, xc(i.glueKind, e), e.inlineFlow ?? !1));
    case "heading":
      return M(t, new Ur(i, F(i.children, ee(e), t)));
    case "paragraph":
      /* gp-fork: renderCustomBlock — pass the build context's showMarkup
       * through to Xr (ParagraphViewData), see its constructor comment. */
      return M(t, new Xr(i, e.showMarkup, F(i.children, ee(e), t)));
    case "frontMatter":
      return M(t, new Yr(i, e.showMarkup, F(i.children, e, t)));
    case "codeBlock":
      return M(t, new Qr(i, e.showMarkup, F(i.children, e, t)));
    case "mathBlock":
      return M(t, new jr(i, e.showMarkup, F(i.children, e, t)));
    case "blockQuote": {
      const o = bc(i), r = e.pendingAnchorBlock ? U(e.pendingAnchorBlock, i) : void 0, c = o && r !== void 0 ? o.delta(r) : void 0, a = !c || !e.pendingReplacementInBlock?.containsRange(c);
      return M(t, new Zr(i, F(i.children, e, t), a));
    }
    case "list":
      return M(t, Cc(i, e, t));
    case "listItem":
      return M(t, oi(i, e, t));
    case "table":
      return M(t, Sc(i, e, t));
    case "tableRow":
      return M(t, ri(i, e, !1, t));
    case "tableCell":
      return M(t, ci(i, e.showMarkup, e.showTableGlue, e.selectionInNode, t));
    case "strong":
      return M(t, new tc(i, F(i.children, ee(e), t)));
    case "emphasis":
      return M(t, new nc(i, F(i.children, ee(e), t)));
    case "strikethrough":
      return M(t, new sc(i, F(i.children, ee(e), t)));
    case "inlineCode":
      return M(t, new ic(i, F(i.children, ee(e), t)));
    case "inlineMath":
      return M(t, new oc(i, e.showMarkup, F(i.children, ee(e), t)));
    case "link":
      return M(t, new rc(i, e.showMarkup, F(i.children, ee(e), t)));
    case "image":
      return M(t, new cc(i, e.showMarkup, F(i.children, ee(e), t)));
    case "document":
      return ni(i, /* @__PURE__ */ new Set(), v.ofLength(0), void 0);
  }
}
function Bt(n) {
  return n.kind === "document" ? n.blocks.map((e) => e.view) : "content" in n ? n.content : wc;
}
const wc = [];
function De(n) {
  if (!n)
    return;
  const e = /* @__PURE__ */ new Map();
  for (const t of Bt(n))
    e.set(t.ast, t);
  return e;
}
function M(n, e) {
  if (n && n.kind === e.kind && n.ast === e.ast && kc(n, e)) {
    const t = Bt(n), s = Bt(e);
    if (t.length === s.length && t.every((i, o) => i === s[o]))
      return n;
  }
  return e;
}
function kc(n, e) {
  switch (n.kind) {
    case "text":
      return n.showWhitespace === e.showWhitespace && n.leftWordBoundary === e.leftWordBoundary && n.rightWordBoundary === e.rightWordBoundary && n.hiddenPrefixLength === e.hiddenPrefixLength;
    case "marker":
      return n.visible === e.visible;
    case "glue":
      return n.visible === e.visible && n.decorateNewline === e.decorateNewline;
    case "thematicBreak":
      return n.showMarkup === e.showMarkup;
    case "frontMatter":
      return n.showMarkup === e.showMarkup;
    case "codeBlock":
      return n.showMarkup === e.showMarkup;
    case "mathBlock":
      return n.showMarkup === e.showMarkup;
    case "inlineMath":
      return n.showMarkup === e.showMarkup;
    case "image":
      return n.showMarkup === e.showMarkup;
    case "unhandledBlock":
      return n.showMarkup === e.showMarkup;
    case "listItem":
      return n.isActive === e.isActive && n.isRunning === e.isRunning;
    case "tableCell": {
      const t = e;
      return n.isActive === t.isActive && n.showTableGlue === t.showTableGlue;
    }
    case "tableRow":
      return n.isDelimiter === e.isDelimiter;
    case "blockQuote":
      return n.showFinalMarkerOnlyLine === e.showFinalMarkerOnlyLine;
    default:
      return !0;
  }
}
function bc(n) {
  let e = 0, t;
  for (const s of n.children)
    s instanceof $ || (t = s instanceof b && s.markerKind === "blockQuoteMarker" ? v.ofStartAndLength(e, s.length) : void 0), e += s.length;
  return t;
}
function F(n, e, t) {
  const s = De(t);
  return n.map((i, o) => {
    const r = i.kind === "text" ? {
      left: o > 0 && Hn(n[o - 1], "end"),
      right: o < n.length - 1 && Hn(n[o + 1], "start")
    } : void 0;
    return Se(i, e, s?.get(i), r);
  });
}
function Hn(n, e) {
  switch (n.kind) {
    case "text": {
      const t = n.content, s = e === "end" ? t[t.length - 1] : t[0];
      return s !== void 0 && s !== " " && s !== "	" && s !== `
` && s !== "\r";
    }
    case "inlineCode":
    case "inlineMath":
    case "link":
    case "image":
    case "strong":
    case "emphasis":
    case "strikethrough":
      return !0;
    default:
      return !1;
  }
}
function yc(n, e) {
  return e.showMarkup || n === "tableCellGlue" && e.showTableGlue;
}
function xc(n, e) {
  return e.showMarkup || n === "tableCellGlue" && e.showTableGlue;
}
const Kn = ":running:";
function Ec(n) {
  if (n.checked === void 0)
    return;
  const e = n.blocks[0];
  if (!e || e.kind !== "paragraph")
    return;
  const t = e.content[1];
  if (!t || t.kind !== "text")
    return;
  const s = t.content;
  let i = 0;
  for (; i < s.length && (s[i] === " " || s[i] === "	"); )
    i++;
  if (s.startsWith(Kn, i))
    return { text: t, hiddenLength: i + Kn.length };
}
function Cc(n, e, t) {
  const s = De(t), i = Lc(n, e), o = new Set(n.items), r = (e.listLevel ?? 0) + 1, c = [];
  let a = 0;
  for (const l of n.children) {
    if (o.has(l)) {
      const d = l, u = i.has(n.items.indexOf(d)), h = {
        showMarkup: u,
        showTableGlue: !1,
        selectionInNode: u && e.selectionInNode ? e.selectionInNode.delta(-a) : void 0,
        listLevel: r
      };
      c.push(M(s?.get(d), oi(d, h, s?.get(d))));
    } else
      c.push(Se(l, e, s?.get(l)));
    a += l.length;
  }
  return new Jr(n, c);
}
function oi(n, e, t) {
  const s = De(t), i = e.showMarkup ? void 0 : Ec(n), o = i !== void 0, r = o ? { ...e, hideRunnerMarkerNode: i.text, hideRunnerMarkerLength: i.hiddenLength } : e, c = [];
  let a = 0;
  for (const l of n.children) {
    const d = r.selectionInNode ? { ...r, selectionInNode: r.selectionInNode.delta(-a) } : r;
    c.push(Se(l, d, s?.get(l))), a += l.length;
  }
  return new ac(n, e.showMarkup, c, e.listLevel ?? 1, o);
}
function Sc(n, e, t) {
  const s = De(t), i = e.showMarkup, o = n.delimiterRow, r = new Set(
    [n.headerRow, n.delimiterRow, ...n.bodyRows].filter((l) => l !== void 0)
  ), c = [];
  let a = 0;
  for (const l of n.children) {
    if (r.has(l)) {
      const d = l, u = d === o, h = {
        showMarkup: i,
        showTableGlue: i,
        selectionInNode: !u && i && e.selectionInNode ? e.selectionInNode.delta(-a) : void 0
      };
      c.push(M(s?.get(d), ri(d, h, u, s?.get(d))));
    } else
      c.push(Se(l, e, s?.get(l)));
    a += l.length;
  }
  return new ec(n, c);
}
function ri(n, e, t, s) {
  const i = De(s), o = e.showMarkup, r = t ? void 0 : Mc(n, e), c = new Set(n.cells), a = [];
  let l = 0;
  for (const d of n.children) {
    if (c.has(d)) {
      const u = d, h = t ? o : r.has(n.cells.indexOf(u)), f = h && e.selectionInNode ? e.selectionInNode.delta(-l) : void 0;
      a.push(ci(u, h, o, f, i?.get(u)));
    } else
      a.push(Se(d, e, i?.get(d)));
    l += d.length;
  }
  return new lc(n, t, a);
}
function ci(n, e, t, s, i) {
  const o = { showMarkup: e, showTableGlue: t, selectionInNode: s };
  return new dc(n, e, t, F(n.children, ee(o), i));
}
const et = /* @__PURE__ */ new Set();
function Lc(n, e) {
  if (!e.showMarkup || !e.selectionInNode)
    return et;
  const t = e.selectionInNode;
  if (t.isEmpty) {
    const o = Yt(n, t.start);
    return o === void 0 ? et : /* @__PURE__ */ new Set([o]);
  }
  const s = /* @__PURE__ */ new Set();
  let i = 0;
  for (const o of n.children) {
    const r = n.items.indexOf(o);
    r >= 0 && i < t.endExclusive && i + o.length > t.start && s.add(r), i += o.length;
  }
  return s;
}
function Mc(n, e) {
  if (!e.showMarkup || !e.selectionInNode)
    return et;
  const t = e.selectionInNode;
  if (t.isEmpty) {
    const o = Tc(n, t.start);
    return o === void 0 ? et : /* @__PURE__ */ new Set([o]);
  }
  const s = /* @__PURE__ */ new Set();
  let i = 0;
  for (const o of n.children) {
    const r = n.cells.indexOf(o);
    r >= 0 && i < t.endExclusive && i + o.length > t.start && s.add(r), i += o.length;
  }
  return s;
}
function Tc(n, e) {
  let t = 0;
  for (const s of n.children) {
    const i = t + s.length, o = n.cells.indexOf(s);
    if (o >= 0 && (t <= e && e < i || i === e))
      return o;
    t = i;
  }
}
function Oc(n) {
  const e = [], t = (s, i) => {
    const o = s.children;
    if (o.length === 0) {
      if (s.dom.nodeType === 3) {
        const c = s.dom, a = Math.min(c.data.length, s.sourceLength);
        a > 0 && e.push({ text: c, start: i, len: a });
      }
      return;
    }
    let r = i;
    for (const c of o)
      c.sourceLength !== 0 && (t(c, r), r += c.sourceLength);
  };
  return t(n, 0), e;
}
function zn(n, e) {
  const t = document.createRange();
  return t.setStart(n.text, e.start - n.start), t.setEnd(n.text, e.endExclusive - n.start), t;
}
function ht(n, e, t = Number.POSITIVE_INFINITY) {
  if (t <= 0)
    return [];
  const s = Oc(n), i = e.slice().sort((c, a) => c.start - a.start || c.endExclusive - a.endExclusive), o = [];
  let r = 0;
  for (const c of i) {
    if (c.isEmpty) {
      const a = Rc(s, c.start);
      if (a && (o.push({ range: zn(a, c), sourceRange: c }), o.length >= t))
        return o;
      continue;
    }
    for (; r < s.length && s[r].start + s[r].len <= c.start; )
      r++;
    for (let a = r; a < s.length; a++) {
      const l = s[a];
      if (l.start >= c.endExclusive)
        break;
      const d = c.intersect(
        v.ofStartAndLength(l.start, l.len)
      );
      if (!(!d || d.isEmpty) && (o.push({ range: zn(l, d), sourceRange: d }), o.length >= t))
        return o;
    }
  }
  return o;
}
function vt(n, e) {
  return ht(n, e).map((t) => t.range);
}
function Rc(n, e) {
  return n.find((t) => t.start <= e && e <= t.start + t.len);
}
class Nc extends H {
  constructor(e, t) {
    super(), this._parent = e, this.element = document.createElement("div"), this.element.className = "md-diff-highlight-layer", t ? (this._coordinateSpace = t, this._coordinateProbe = void 0) : (this._coordinateProbe = document.createElementNS("http://www.w3.org/2000/svg", "svg"), this._coordinateProbe.setAttribute("aria-hidden", "true"), this._coordinateProbe.style.position = "absolute", this._coordinateProbe.style.inset = "0", this._coordinateProbe.style.width = "100%", this._coordinateProbe.style.height = "100%", this._coordinateProbe.style.visibility = "hidden", this._coordinateProbe.style.pointerEvents = "none", this.element.appendChild(this._coordinateProbe), this._coordinateSpace = dt.forSvgOverlay(this._coordinateProbe)), this._resizeObserver = new ResizeObserver(() => {
      this._last && this._repaint(this._last);
    }), this._resizeObserver.observe(this._parent), this._register({ dispose: () => {
      this._resizeObserver.disconnect(), this.element.remove();
    } });
  }
  element;
  _last;
  _resizeObserver;
  _coordinateSpace;
  _coordinateProbe;
  clear() {
    this._last = void 0, this._replaceHighlights();
  }
  /**
   * Repaint the highlights for the given view-node tree. `insertedRanges`
   * (modified-document offsets) are painted green when supplied (editor diff
   * mode); a {@link DiffHunkViewNode}'s own sides supply both colours (the
   * standalone read-only diff). Deleted ranges from {@link DiffDecorationViewNode}s
   * are always painted red.
   */
  render(e, t) {
    this._last = { node: e, inserted: t }, this._repaint(this._last);
  }
  _repaint(e) {
    const t = [], s = [];
    e.inserted && t.push(...vt(e.node, e.inserted));
    const i = (o) => {
      if (o instanceof Nt)
        o.whole || s.push(...vt(o.sideNode, o.deletedRanges.map((r) => r.range)));
      else if (o instanceof Rt)
        for (const r of o.sides)
          for (const c of r.ranges) {
            const a = vt(r.node, [c.range]);
            (c.kind === "inserted" ? t : s).push(...a);
          }
      for (const r of o.children)
        i(r);
    };
    i(e.node), this._paint(t, s);
  }
  _paint(e, t) {
    const s = this._coordinateSpace.capture(), i = document.createDocumentFragment(), o = (r, c) => {
      for (const a of r)
        for (const l of a.getClientRects()) {
          if (l.width === 0 || l.height === 0)
            continue;
          const d = s.toLocalRect(l), u = document.createElement("div");
          u.className = c, u.style.left = `${d.left}px`, u.style.top = `${d.top}px`, u.style.width = `${d.width}px`, u.style.height = `${d.height}px`, i.appendChild(u);
        }
    };
    o(e, "md-diff-ins-rect"), o(t, "md-diff-del-rect"), this._replaceHighlights(i);
  }
  _replaceHighlights(...e) {
    const t = this._coordinateProbe ? [this._coordinateProbe, ...e] : e;
    this.element.replaceChildren(...t);
  }
}
class Ic extends H {
  element;
  rendering;
  _path;
  constructor(e) {
    super(), this.element = document.createElementNS("http://www.w3.org/2000/svg", "svg"), this.element.setAttribute("class", "md-selection-layer"), this._path = document.createElementNS("http://www.w3.org/2000/svg", "path"), this._path.setAttribute("class", "md-selection-path"), this.element.appendChild(this._path), this.rendering = I(this, (t) => {
      const s = t.readObservable(e.selection), i = t.readObservable(e.visualLineMap), o = t.readObservable(e.blocks);
      return Pc(this._path, s, i, o);
    }), this._register(P((t) => {
      t.readObservable(this.rendering);
    }));
  }
}
class qn {
  constructor(e) {
    this.rects = e;
  }
}
function Pc(n, e, t, s) {
  if (!e || e.isCollapsed)
    return n.setAttribute("d", ""), new qn([]);
  const i = ai(e.range, t, s);
  return n.setAttribute("d", Fc(i, 4)), new qn(i);
}
const Bc = 0.4;
function ai(n, e, t) {
  if (n.isEmpty)
    return [];
  const s = n, i = (h, f, m, g) => C.fromPointPoint(h, f, Math.max(h, m), Math.max(f, g)), o = e.sourceLines, r = [];
  for (let h = 0; h < o.length; h++) {
    const f = o[h], m = tt(f);
    if (!m)
      continue;
    const g = h + 1 < o.length ? tt(o[h + 1]) : void 0, _ = !g || g.start > m.endExclusive, p = s.intersects(m), w = _ && s.start <= m.endExclusive && s.endExclusive > m.endExclusive;
    if (!p && !w)
      continue;
    const E = t.find((y) => v.ofStartAndLength(y.absoluteStart, y.block.length).containsRange(m));
    r.push({ line: f, lineRange: m, block: E, hardBreak: _ });
  }
  const c = [], a = [];
  for (const { line: h, lineRange: f, hardBreak: m, block: g } of r) {
    const _ = f.start, p = f.endExclusive;
    let w = s.start <= _ ? h.rect.left : h.xAtOffset(s.start), E;
    if (s.endExclusive < p)
      E = h.xAtOffset(s.endExclusive);
    else {
      const L = s.endExclusive > p;
      E = h.rect.right + (L && m ? h.rect.height * Bc : 0);
    }
    const y = li(g);
    y && (w = Math.max(w, y.left), E = Math.min(E, y.right)), c.push(i(w, h.rect.top, E, h.rect.bottom)), a.push({ left: w, right: E, top: h.rect.top, bottom: h.rect.top + h.rect.height });
  }
  for (let h = 0; h < a.length - 1; h++) {
    const f = a[h], m = a[h + 1];
    if (m.top <= f.bottom)
      continue;
    const g = Math.max(f.left, m.left), _ = Math.min(f.right, m.right);
    _ <= g || c.push(i(g, f.bottom, _, m.top));
  }
  const l = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map();
  for (let h = 0; h < r.length; h++) {
    const f = r[h].block;
    f && (l.has(f) || l.set(f, h), d.set(f, h));
  }
  const u = t.map(
    (h) => s.intersects(v.ofStartAndLength(h.absoluteStart, h.block.length))
  );
  for (let h = 0; h < t.length - 1; h++) {
    const f = t[h], m = t[h + 1], g = f.absoluteStart + f.block.length, _ = m.absoluteStart;
    if (g < _ && !s.containsRange(v.fromTo(g, _)) || g >= _ && !(u[h] && u[h + 1]))
      continue;
    const p = f.rect, w = m.rect, E = Dc(e, m, w.top), y = p.bottom;
    if (E <= y)
      continue;
    const L = d.get(f), R = l.get(m);
    if (L === void 0 && wt(e, f) || R === void 0 && wt(e, m))
      continue;
    const V = L !== void 0 ? a[L] : { left: p.left, right: p.right }, ve = R !== void 0 ? a[R] : { left: w.left, right: w.right }, on = Math.max(V.left, ve.left), rn = Math.min(V.right, ve.right);
    rn <= on || c.push(i(on, y, rn, E));
  }
  for (const h of t) {
    const f = v.ofStartAndLength(h.absoluteStart, h.block.length);
    s.intersects(f) && (wt(e, h) || c.push(h.rect));
  }
  return c;
}
function tt(n) {
  if (n.runs.length === 0)
    return;
  let e = 1 / 0, t = -1 / 0;
  for (const s of n.runs)
    s.sourceStart < e && (e = s.sourceStart), s.sourceEndExclusive > t && (t = s.sourceEndExclusive);
  return v.fromTo(e, t);
}
function wt(n, e) {
  const t = v.ofStartAndLength(e.absoluteStart, e.block.length);
  for (const s of n.sourceLines) {
    const i = tt(s);
    if (i && t.containsRange(i))
      return !0;
  }
  return !1;
}
function li(n) {
  return n?.viewportClip;
}
function Ac(n, e) {
  return n.find((t) => e >= t.absoluteStart && e <= t.absoluteStart + t.block.length);
}
function Dc(n, e, t) {
  const s = v.ofStartAndLength(e.absoluteStart, e.block.length);
  for (const i of n.sourceLines) {
    const o = tt(i);
    if (o && s.containsRange(o))
      return i.rect.top;
  }
  return t;
}
function Fc(n, e) {
  if (n.length === 0)
    return "";
  const t = n.slice().sort((o, r) => o.y - r.y || o.x - r.x), s = [];
  let i = [];
  for (const o of t) {
    const r = i[i.length - 1], c = r !== void 0 && o.y <= r.y + r.height + 0.5, a = r !== void 0 && Math.max(r.x, o.x) < Math.min(r.x + r.width, o.x + o.width);
    c && a ? i.push(o) : (i.length > 0 && s.push(i), i = [o]);
  }
  return i.length > 0 && s.push(i), s.map((o) => Vc(o, e)).filter(Boolean).join(" ");
}
function Vc(n, e) {
  const t = [];
  t.push({ x: n[0].x + n[0].width, y: n[0].y, convex: !0 });
  for (let i = 0; i < n.length - 1; i++) {
    const o = n[i], r = n[i + 1], c = o.x + o.width, a = r.x + r.width;
    if (Math.abs(c - a) > 0.5) {
      const l = o.y + o.height, d = c > a;
      t.push({ x: c, y: l, convex: d }), t.push({ x: a, y: l, convex: !d });
    }
  }
  const s = n[n.length - 1];
  t.push({ x: s.x + s.width, y: s.y + s.height, convex: !0 }), t.push({ x: s.x, y: s.y + s.height, convex: !0 });
  for (let i = n.length - 1; i > 0; i--) {
    const o = n[i], r = n[i - 1];
    if (Math.abs(o.x - r.x) > 0.5) {
      const c = o.y, a = o.x < r.x;
      t.push({ x: o.x, y: c, convex: a }), t.push({ x: r.x, y: c, convex: !a });
    }
  }
  return t.push({ x: n[0].x, y: n[0].y, convex: !0 }), $c(t, e);
}
function $c(n, e) {
  const t = n.length;
  if (t < 3)
    return "";
  const s = new Array(t);
  for (let r = 0; r < t; r++) {
    const c = n[(r + t - 1) % t], a = n[(r + 1) % t], l = Ke(n[r], c), d = Ke(n[r], a);
    s[r] = Math.min(e, l / 2, d / 2);
  }
  const i = kt(n[t - 1], n[0], Ke(n[t - 1], n[0]) - s[0]), o = [`M${J(i.x)},${J(i.y)}`];
  for (let r = 0; r < t; r++) {
    const c = n[r], a = n[(r + 1) % t], l = s[r], d = kt(c, a, l);
    l > 0 ? o.push(`A${J(l)},${J(l)} 0 0 ${c.convex ? 1 : 0} ${J(d.x)},${J(d.y)}`) : o.push(`L${J(d.x)},${J(d.y)}`);
    const u = s[(r + 1) % t], h = kt(c, a, Ke(c, a) - u);
    o.push(`L${J(h.x)},${J(h.y)}`);
  }
  return o.push("Z"), o.join(" ");
}
function Ke(n, e) {
  return Math.hypot(n.x - e.x, n.y - e.y);
}
function kt(n, e, t) {
  const s = e.x - n.x, i = e.y - n.y, o = Math.hypot(s, i);
  if (o === 0)
    return { x: n.x, y: n.y };
  const r = t / o;
  return { x: n.x + s * r, y: n.y + i * r };
}
function J(n) {
  return n.toFixed(2);
}
class Wc extends H {
  element;
  rendering;
  constructor(e) {
    super(), this.element = document.createElement("div"), this.element.className = "md-cursor", this.rendering = I(this, (t) => {
      const s = t.readObservable(e.position), i = t.readObservable(e.visualLineMap);
      if (s === void 0 || i.isEmpty)
        return this.element.style.display = "none", new ze(s ?? O.source(0), !1, C.EMPTY);
      const o = i.lineIndexOfPosition(s);
      if (o === void 0)
        return this.element.style.display = "none", new ze(s, !1, C.EMPTY);
      const r = i.lineRect(o).withZeroWidthAt(i.xAtPosition(s)), c = e.blocks ? t.readObservable(e.blocks) : void 0, a = c && s.kind === "source" ? li(Ac(c, s.offset)) : void 0;
      return a && (r.x < a.left - 0.5 || r.x > a.right + 0.5) ? (this.element.style.display = "none", new ze(s, !1, C.EMPTY)) : (this.element.style.left = `${r.x}px`, this.element.style.top = `${r.y}px`, this.element.style.height = `${r.height}px`, this.element.style.display = "", new ze(s, !0, r));
    }), this._register(P((t) => {
      t.readObservable(this.rendering);
    })), this._register(P((t) => {
      t.readObservable(e.position), this.element.style.animation = "none", this.element.offsetWidth, this.element.style.animation = "";
    }));
  }
}
class ze {
  constructor(e, t, s) {
    this.position = e, this.visible = t, this.rect = s;
  }
}
class Hc extends H {
  element;
  rendering;
  constructor(e) {
    super(), this.element = document.createElement("div"), this.element.className = "md-gutter-layer", this.rendering = I(this, (t) => {
      const s = t.readObservable(e.markers), i = t.readObservable(e.visualLineMap);
      return this._render(s, i);
    }), this._register(P((t) => {
      t.readObservable(this.rendering);
    }));
  }
  _render(e, t) {
    if (this.element.replaceChildren(), t.isEmpty)
      return new Un([]);
    const s = [];
    for (const i of e) {
      const o = i.type === "deleted" || i.range.isEmpty ? zc(i, t) : Kc(i, t);
      if (!o)
        continue;
      const r = document.createElement("div");
      r.className = `md-gutter-marker md-gutter-marker-${o.type}`, r.style.top = `${o.y}px`, o.height > 0 && (r.style.height = `${o.height}px`), this.element.appendChild(r), s.push(o);
    }
    return new Un(s);
  }
}
class Un {
  constructor(e) {
    this.rects = e;
  }
}
function Kc(n, e) {
  let t = 1 / 0, s = -1 / 0;
  for (const i of e.sourceLines) {
    const o = qc(i);
    !o || !n.range.intersects(o) || (t = Math.min(t, i.rect.top), s = Math.max(s, i.rect.top + i.rect.height));
  }
  if (!(s <= t))
    return { type: n.type, y: t, height: s - t };
}
function zc(n, e) {
  const t = e.lineIndexOfOffset(n.range.start);
  return { type: "deleted", y: e.lineRect(t).top, height: 0 };
}
function qc(n) {
  if (n.runs.length === 0)
    return;
  let e = 1 / 0, t = -1 / 0;
  for (const s of n.runs)
    s.sourceStart < e && (e = s.sourceStart), s.sourceEndExclusive > t && (t = s.sourceEndExclusive);
  return v.fromTo(e, t);
}
function Xn(n) {
  return n.windowHasFocus && n.focusIsUnclaimed;
}
function Uc(n) {
  return !n.windowHasFocus;
}
function di(n) {
  const e = n.ownerDocument, t = e.defaultView ?? window;
  let s = C.fromPointSize(
    0,
    0,
    e.documentElement.clientWidth || t.innerWidth,
    e.documentElement.clientHeight || t.innerHeight
  );
  for (let i = n.parentElement; i; i = i.parentElement) {
    const o = t.getComputedStyle(i), r = Yn(o.overflowX), c = Yn(o.overflowY);
    if (!r && !c)
      continue;
    const a = hi(i), l = r ? Math.max(s.left, a.left) : s.left, d = r ? Math.min(s.right, a.right) : s.right, u = c ? Math.max(s.top, a.top) : s.top, h = c ? Math.min(s.bottom, a.bottom) : s.bottom;
    if (d <= l || h <= u)
      return C.fromPointSize(l, u, 0, 0);
    s = C.fromPointPoint(
      l,
      u,
      d,
      h
    );
  }
  return s;
}
function hi(n) {
  const e = n.getBoundingClientRect(), t = n.offsetWidth > 0 ? e.width / n.offsetWidth : 1, s = n.offsetHeight > 0 ? e.height / n.offsetHeight : 1;
  return C.fromPointSize(
    e.left + n.clientLeft * t,
    e.top + n.clientTop * s,
    n.clientWidth * t,
    n.clientHeight * s
  );
}
function Xc(n, e, t) {
  const s = n.getBoundingClientRect(), i = n.offsetWidth > 0 ? s.width / n.offsetWidth : 1, o = n.offsetHeight > 0 ? s.height / n.offsetHeight : 1;
  return {
    x: e / i,
    y: t / o
  };
}
function Gc(n) {
  const t = n.ownerDocument.defaultView ?? window, s = [];
  for (let i = n.parentElement; i; i = i.parentElement) {
    const o = t.getComputedStyle(i), r = Qn(o.overflowX) && i.scrollWidth > i.clientWidth, c = Qn(o.overflowY) && i.scrollHeight > i.clientHeight;
    (r || c) && s.push(i);
  }
  return s;
}
function Gn(n, e) {
  return n.left <= e.left && e.right <= n.right && n.top <= e.top && e.bottom <= n.bottom;
}
function Yn(n) {
  return n === "auto" || n === "scroll" || n === "hidden" || n === "clip";
}
function Qn(n) {
  return n === "auto" || n === "scroll" || n === "hidden";
}
const Yc = 900, qe = 2, ui = 5;
class gl extends H {
  constructor(e, t) {
    super(), this._model = e, this._options = t, this.element = document.createElement("div"), this.element.className = "md-editor", this._options?.classNames && this.element.classList.add(...this._options.classNames), this.element.tabIndex = 0, this._contentContainer = document.createElement("div"), this._contentContainer.className = "md-editor-content", this.element.appendChild(this._contentContainer);
    const s = this._options?.limitedWidth ?? _i(Yc);
    this._register(P((l) => {
      const d = s.read(l);
      this._contentContainer.style.maxWidth = d === void 0 ? "" : `${d}px`;
    })), this.measuredLayout = new wo();
    let i = -1, o = -1, r = -1;
    this._resizeObserver = new ResizeObserver(() => {
      this.element.classList.toggle("md-editor-narrow", this.element.clientWidth <= 320);
      const l = getComputedStyle(this._contentContainer), d = this._contentContainer.clientWidth - parseFloat(l.paddingLeft) - parseFloat(l.paddingRight);
      this.element.classList.toggle("md-find-compact", d <= 400);
      const u = this._document.get();
      if (!u)
        return;
      const h = this._contentContainer.clientWidth, f = this._contentContainer.clientHeight, m = u.contentDomNode.getBoundingClientRect().height;
      Math.abs(h - i) < 0.5 && Math.abs(f - o) < 0.5 && Math.abs(m - r) < 0.5 || (i = h, o = f, r = m, this._publishMeasurements(u), this._revealCaretAfterActiveBlockResize());
    }), this._resizeObserver.observe(this.element), this._resizeObserver.observe(this._contentContainer), this._register({ dispose: () => this._resizeObserver.disconnect() });
    let c = 0;
    const a = () => {
      c || (c = requestAnimationFrame(() => {
        c = 0;
        const l = this._document.get();
        l && this._publishMeasurements(l);
      }));
    };
    this._contentContainer.addEventListener("scroll", a, { capture: !0, passive: !0 }), this._register({
      dispose: () => {
        this._contentContainer.removeEventListener("scroll", a, { capture: !0 }), c && cancelAnimationFrame(c);
      }
    }), this._selectionView = this._register(new Ic({
      selection: this._model.selection,
      visualLineMap: this.measuredLayout.visualLineMap,
      blocks: this._selectionBlocksObs
    })), this._contentContainer.appendChild(this._selectionView.element), this.coordinateSpace = dt.forSvgOverlay(this._selectionView.element), this._cursorView = this._register(new Wc({
      position: this._model.cursorPosition,
      visualLineMap: this.measuredLayout.visualLineMap,
      blocks: this._selectionBlocksObs
    })), this._contentContainer.appendChild(this._cursorView.element), this._gutterMarkersView = this._register(new Hc({
      markers: this._model.gutterMarkers,
      visualLineMap: this.measuredLayout.visualLineMap
    })), this._contentContainer.appendChild(this._gutterMarkersView.element), this._diffHighlightsView = this._register(new Nc(this._contentContainer, this.coordinateSpace)), this._contentContainer.appendChild(this._diffHighlightsView.element), this._register(P((l) => {
      const d = this._model.readonlyMode.read(l);
      this.element.classList.toggle("md-readonly", d), d || this.element.classList.remove("md-readonly-editing-attempt");
    })), this._options?.showReadonlyToggle !== !1 && this._setupReadonlyToggle(), this.editContext = new EditContext({
      text: this._model.sourceText.get().value,
      selectionStart: 0,
      selectionEnd: 0
    }), this.element.editContext = this.editContext, this._register(P(this._renderAutorun)), this._setupModifierTracking(), this._setupFocusTracking(), this._setupCaretScrollPadding(), this._register(P((l) => {
      const d = l.readObservable(this._model.selection)?.range;
      this.editContext.updateSelection(d?.start ?? 0, d?.endExclusive ?? 0);
    })), this._register({
      dispose: () => {
        this._stopFollowingCaret(), this._document.get()?.dispose(), this._clearDiff();
      }
    });
  }
  element;
  editContext;
  measuredLayout;
  coordinateSpace;
  forcedMarkerVisibleBlocks = x(this, /* @__PURE__ */ new Set());
  /**
   * Inner container that holds the rendered document and the cursor/selection
   * overlays. The outer {@link element} spans the full width; this container
   * is what limited-width mode caps and centers, so the overlays (which anchor
   * to their parent's box) stay aligned with the content.
   */
  _contentContainer;
  _resizeObserver;
  _cursorView;
  _selectionView;
  _gutterMarkersView;
  _diffHighlightsView;
  _readonlyToggleButton;
  _editContextSuspensions = /* @__PURE__ */ new Set();
  _revealOcclusions = /* @__PURE__ */ new Set();
  _caretRevealRaf;
  _followedCaretBlock;
  _followCaretAfterEdit = !1;
  /**
   * The mounted block sequence, in source order. Rebuilt (not mutated) each
   * frame by {@link DocumentViewNode.create}; the view just swaps one
   * immutable node for the next. Never used for source-of-truth lookups
   * (those go through the measured-layout model).
   */
  _document = x(this, void 0);
  _embeddedCodeEditorFactoryVersion = x(this, 0);
  /** The current view-node tree (AST overlaid with rendered DOM), for debugging. */
  get documentViewNode() {
    return this._document;
  }
  /** Re-resolves embedded code editors while preserving the surrounding editor view. */
  refreshEmbeddedCodeEditors() {
    this._embeddedCodeEditorFactoryVersion.set(this._embeddedCodeEditorFactoryVersion.get() + 1, void 0);
  }
  /**
   * Last frame's view-data overlay, threaded back into
   * {@link buildDocumentViewData} so any subtree whose ast and selection flags
   * are unchanged keeps its view-data object — which lets the renderer reuse
   * its DOM by identity.
   */
  _previousViewData;
  /** The current view-data tree (AST overlaid with selection flags), for debugging. */
  _viewData = x(this, void 0);
  get viewData() {
    return this._viewData;
  }
  /**
   * Whether the editor is genuinely focused: focus rests somewhere inside the
   * editor subtree *and* its window is focused. Mirrored onto the root as
   * `.md-focused`, which gates the painted caret — the blinking cursor is only
   * shown while this is `true`, so it never blinks in an unfocused editor or
   * after the window loses focus. Only the caret's visibility is affected; the
   * logical selection and caret geometry ({@link caretRect}) are unchanged.
   */
  _focused = x(this, !1);
  get focused() {
    return this._focused;
  }
  /**
   * The block cache projected for views (selection painting) that need to
   * react to mount/unmount. Derived from {@link _document}, so it stays in
   * lock-step without any manual bookkeeping.
   */
  _selectionBlocksObs = I(this, (e) => this.measuredLayout.measurements.read(e).flatMap((s) => !s.rect || !s.viewNode ? [] : [{
    block: s.block,
    absoluteStart: s.absoluteStart,
    rect: s.rect,
    viewportClip: s.viewportClip
  }]));
  /**
   * The caret rect (zero width) at the selection's active end, in
   * {@link overlayContainer}-local coordinates, or `undefined` when there is no
   * caret. This is the same geometry the editor paints its cursor from, so
   * contributions (e.g. comment mode) can anchor an overlay to the active end of
   * the selection — where the user's cursor is — without re-deriving geometry.
   */
  _caretRect = I(this, (e) => {
    const t = this._cursorView.rendering.read(e);
    return t.visible ? t.rect : void 0;
  });
  get caretRect() {
    return this._caretRect;
  }
  /**
   * The container that establishes the positioning context for the editor's
   * overlays (cursor, selection, gutter). Contributions mount their own
   * absolutely-positioned overlays here so they share the coordinate space of
   * {@link caretRect}.
   */
  get overlayContainer() {
    return this._contentContainer;
  }
  /**
   * Selection-style rectangles covering `range`, in {@link overlayContainer}-
   * local coordinates — the same geometry the live selection paints. Exposed so
   * contributions (e.g. persistent comments) can highlight arbitrary ranges and
   * anchor overlays to them. Recomputes when the measured layout changes.
   */
  rangeRects(e) {
    return I(this, (t) => {
      const s = this.measuredLayout.visualLineMap.read(t), i = this._selectionBlocksObs.read(t);
      return ai(e, s, i);
    });
  }
  /**
   * Mirrors the model's live Ctrl/Cmd state onto the editor root as
   * `.md-mod-down` so CSS can show the link-open underline and pointer cursor
   * only while a click would actually open the link: an inactive link opens on
   * a plain click, but an active link only opens with the modifier held.
   */
  _setupModifierTracking() {
    this._register(P((e) => {
      this.element.classList.toggle("md-mod-down", this._model.ctrlOrMetaDown.read(e));
    }));
  }
  /**
   * Tracks whether the editor is genuinely focused and mirrors it onto the
   * root as `.md-focused` so CSS can gate the painted caret. "Focused" means
   * focus rests somewhere inside the editor subtree *and* the window itself is
   * focused; either condition failing (focus moving elsewhere, or the window
   * losing focus) hides the blinking caret while leaving the logical selection
   * and caret geometry intact.
   */
  _setupFocusTracking() {
    const e = this.element, t = e.ownerDocument.defaultView ?? window, s = () => {
      const l = e.ownerDocument.activeElement;
      return l !== null && e.contains(l);
    }, i = (l) => this._focused.set(l, void 0), o = () => i(!0), r = (l) => {
      const d = l.relatedTarget;
      i(d instanceof Node && e.contains(d));
    }, c = () => i(!1), a = () => i(s());
    e.addEventListener("focusin", o), e.addEventListener("focusout", r), t.addEventListener("blur", c), t.addEventListener("focus", a), this._register({
      dispose: () => {
        e.removeEventListener("focusin", o), e.removeEventListener("focusout", r), t.removeEventListener("blur", c), t.removeEventListener("focus", a);
      }
    }), this._register(P((l) => {
      this.element.classList.toggle("md-focused", this._focused.read(l));
    }));
  }
  _setupCaretScrollPadding() {
    this._register(P((e) => {
      const t = this._model.cursorPosition.read(e), s = this._model.sourceText.read(e).value.length, i = this._model.pendingParagraph.read(e), o = t?.kind === "source" ? t.offset === s : i?.atEof === !0;
      this._contentContainer.style.paddingBlockEnd = this._focused.read(e) && o ? `${ui}lh` : "";
    }));
  }
  /**
   * Renders the edit/read-only mode toggle. It flips the model's
   * {@link EditorModel.readonlyMode}: when locked (read-only) every block stays
   * in its clean rendered form (no markdown markers revealed) and edits are
   * ignored, while text selection still works. The control lives in a
   * zero-height *sticky* host inside the centered content container, so the
   * lock follows the content's right edge and remains pinned as the document
   * scrolls. The current mode is also mirrored onto the root as `.md-readonly`
   * for any CSS hooks.
   */
  _setupReadonlyToggle() {
    const e = document.createElement("div");
    e.className = "md-readonly-toggle-host", this._contentContainer.classList.add("md-editor-content-with-readonly-toggle");
    const t = document.createElement("button");
    t.type = "button", t.className = "md-readonly-toggle", this._readonlyToggleButton = t;
    const s = document.createElement("span");
    s.className = "md-readonly-toggle-indicator", s.setAttribute("aria-hidden", "true");
    const i = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    i.classList.add("md-readonly-toggle-icon", "md-readonly-toggle-icon-locked"), i.setAttribute("viewBox", "0 0 16 16"), i.setAttribute("fill", "currentColor"), i.setAttribute("aria-hidden", "true");
    const o = document.createElementNS("http://www.w3.org/2000/svg", "path");
    o.setAttribute("d", "M8 9C8.55228 9 9 9.44771 9 10C9 10.5523 8.55228 11 8 11C7.44772 11 7 10.5523 7 10C7 9.44771 7.44772 9 8 9Z");
    const r = document.createElementNS("http://www.w3.org/2000/svg", "path");
    r.setAttribute("fill-rule", "evenodd"), r.setAttribute("clip-rule", "evenodd"), r.setAttribute("d", "M8 1C9.654 1 11 2.346 11 4V6H12C13.103 6 14 6.897 14 8V13C14 14.103 13.103 15 12 15H4C2.897 15 2 14.103 2 13V8C2 6.897 2.897 6 4 6H5V4C5 2.346 6.346 1 8 1ZM4 7C3.449 7 3 7.449 3 8V13C3 13.551 3.449 14 4 14H12C12.551 14 13 13.551 13 13V8C13 7.449 12.551 7 12 7H4ZM8 2C6.897 2 6 2.897 6 4V6H10V4C10 2.897 9.103 2 8 2Z"), i.append(o, r);
    const c = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    c.classList.add("md-readonly-toggle-icon", "md-readonly-toggle-icon-editing"), c.setAttribute("viewBox", "0 0 16 16"), c.setAttribute("fill", "currentColor"), c.setAttribute("aria-hidden", "true");
    const a = document.createElementNS("http://www.w3.org/2000/svg", "path");
    a.setAttribute("d", "M14.236 1.76386C13.2123 0.740172 11.5525 0.740171 10.5289 1.76386L2.65722 9.63549C2.28304 10.0097 2.01623 10.4775 1.88467 10.99L1.01571 14.3755C0.971767 14.5467 1.02148 14.7284 1.14646 14.8534C1.27144 14.9783 1.45312 15.028 1.62432 14.9841L5.00978 14.1151C5.52234 13.9836 5.99015 13.7168 6.36433 13.3426L14.236 5.47097C15.2596 4.44728 15.2596 2.78755 14.236 1.76386ZM11.236 2.47097C11.8691 1.8378 12.8957 1.8378 13.5288 2.47097C14.162 3.10413 14.162 4.1307 13.5288 4.76386L12.75 5.54269L10.4571 3.24979L11.236 2.47097ZM9.75002 3.9569L12.0429 6.24979L5.65722 12.6355C5.40969 12.883 5.10023 13.0595 4.76117 13.1465L2.19447 13.8053L2.85327 11.2386C2.9403 10.8996 3.1168 10.5901 3.36433 10.3426L9.75002 3.9569Z"), c.appendChild(a), t.append(s, i, c), e.appendChild(t);
    const l = () => {
      this._model.readonlyMode.set(!this._model.readonlyMode.get(), void 0);
    }, d = (f) => {
      f.button === 0 && (f.preventDefault(), f.stopPropagation(), this.focus());
    }, u = (f) => {
      f.stopPropagation();
    }, h = (f) => {
      f.animationName === "md-readonly-toggle-shine" && t.classList.remove("md-readonly-toggle-shine");
    };
    t.addEventListener("pointerdown", d), t.addEventListener("keydown", u), t.addEventListener("animationend", h), t.addEventListener("click", l), this._register(this.suspendEditContextWhileFocused(t)), this._register({
      dispose: () => {
        t.removeEventListener("pointerdown", d), t.removeEventListener("keydown", u), t.removeEventListener("animationend", h), t.removeEventListener("click", l), this._readonlyToggleButton === t && (this._readonlyToggleButton = void 0);
      }
    }), this._register(P((f) => {
      const m = this._model.readonlyMode.read(f);
      t.classList.toggle("md-readonly-toggle-locked", m), t.setAttribute("aria-pressed", String(m)), t.setAttribute("aria-label", m ? "Locked; switch to editing" : "Editing; switch to locked mode"), t.title = m ? "Read-only: markers hidden, editing disabled. Click to edit." : "Editing: click to lock (hide markers, disable editing).", m || t.classList.remove("md-readonly-toggle-shine");
    })), this._contentContainer.insertBefore(e, this._contentContainer.firstChild);
  }
  /** Draws attention to the mode toggle after text input is attempted while locked. */
  showReadonlyEditingAttempt() {
    const e = this._readonlyToggleButton;
    if (e) {
      e.classList.contains("md-readonly-toggle-shine") || e.classList.add("md-readonly-toggle-shine");
      return;
    }
    this.element.classList.remove("md-readonly-editing-attempt"), requestAnimationFrame(() => {
      this._model.readonlyMode.get() && this.element.classList.add("md-readonly-editing-attempt");
    });
  }
  focus() {
    this.element.focus({ preventScroll: !0 });
  }
  mountOverlay(e, t) {
    return t === "top-chrome" ? this._contentContainer.insertBefore(e, this._contentContainer.firstChild) : t === "below-selection" ? this._contentContainer.insertBefore(e, this._selectionView.element) : this._contentContainer.appendChild(e), { dispose: () => e.remove() };
  }
  /** Registers floating editor chrome that should count as covering a range during reveal. */
  registerRevealOcclusion(e) {
    return this._revealOcclusions.add(e), { dispose: () => this._revealOcclusions.delete(e) };
  }
  /**
   * Temporarily detaches the root {@link EditContext} while focus is inside
   * nested editor chrome. Chromium otherwise reclaims focus from non-text
   * controls inside the EditContext host, breaking keyboard access to controls
   * such as the find actions and read-only toggle.
   */
  suspendEditContextWhileFocused(e) {
    const t = () => {
      this._editContextSuspensions.add(e), this._syncEditContextAttachment();
    }, s = (i) => {
      const o = i.relatedTarget;
      o instanceof Node && e.contains(o) || (this._editContextSuspensions.delete(e), this._syncEditContextAttachment());
    };
    return e.addEventListener("focusin", t), e.addEventListener("focusout", s), {
      dispose: () => {
        e.removeEventListener("focusin", t), e.removeEventListener("focusout", s), this._editContextSuspensions.delete(e), this._syncEditContextAttachment();
      }
    };
  }
  revealRangeInCenterIfOutsideViewport(e, t = "smooth") {
    let s = !1;
    const i = requestAnimationFrame(() => {
      s || this._revealRange(e, t);
    }), o = {
      dispose: () => {
        s || (s = !0, cancelAnimationFrame(i));
      }
    };
    return this._register(o);
  }
  /**
   * Keeps the caret visible after an editor-driven text edit. The reveal is
   * deferred until the rebuilt document has been laid out and uses nearest-edge
   * scrolling so ordinary typing only moves the containing viewport as far as
   * needed. While this mode is active, a later resize of the same active block
   * also re-reveals the caret (for asynchronous code, math, or diagram layout).
   */
  revealCaretAfterEdit() {
    this._model.selection.get() && (this._followCaretAfterEdit = !0, this._scheduleCaretReveal());
  }
  /** Keeps a keyboard-moved caret visible without enabling edit-resize following. */
  revealCaretAfterKeyboardNavigation() {
    this._scheduleCaretReveal();
  }
  /** Stops edit-driven caret following before pointer-based selection begins. */
  stopFollowingCaret() {
    this._stopFollowingCaret();
  }
  /**
   * Samples the ambient focus state that decides whether taking focus on open
   * would steal it from an explicit user target: whether the window is focused
   * and whether focus is still unclaimed (no active element, or the `<body>`
   * fallback).
   */
  _sampleAutoFocusEnvironment() {
    const e = this.element.ownerDocument, t = e.activeElement;
    return {
      windowHasFocus: e.hasFocus(),
      focusIsUnclaimed: t === null || t === e.body
    };
  }
  /**
   * One-shot guarded focus attempt: focuses the editor only if doing so will
   * not steal focus from an explicit user target — the window must already be
   * focused and no other element may have claimed focus yet. Returns whether
   * focus was taken. A no-op for a background window or when the user has
   * already focused something else. {@link autoFocusOnOpen} builds the
   * open-time behavior on top of this primitive.
   */
  tryAutoFocus() {
    return Xn(this._sampleAutoFocusEnvironment()) ? (this.focus(), !0) : !1;
  }
  /**
   * Focuses the editor when it opens without ever stealing focus from an
   * explicit user target. Tries once immediately; if the window is not focused
   * yet — a common open-time race where the editor is mounted before the host
   * routes focus to its window — the guarded attempt is deferred to the next
   * time the window gains focus and re-evaluated then. The deferral is
   * one-shot, so a later, unrelated window refocus never grabs focus, and the
   * re-check still respects any target the user has claimed in the meantime.
   */
  autoFocusOnOpen() {
    const e = this._sampleAutoFocusEnvironment();
    if (Xn(e)) {
      this.focus();
      return;
    }
    if (!Uc(e))
      return;
    const t = this.element.ownerDocument.defaultView ?? window, s = () => {
      t.removeEventListener("focus", s), this.tryAutoFocus();
    };
    t.addEventListener("focus", s), this._register({ dispose: () => t.removeEventListener("focus", s) });
  }
  /**
   * Own point→offset resolution. When `true` (the default),
   * {@link resolveOffsetFromPoint} ignores the platform DOM hit-test
   * (`caretPositionFromPoint`) and snaps the point to the nearest offset purely
   * from the rendered {@link VisualLineMap} geometry — picking the nearest
   * visual line by `y`, then the nearest offset on it by `x`. Because a table
   * row's cells share one horizontal line band, this makes the whole width of a
   * row resolve into that row (rather than only the cell boxes), with no visible
   * layout change. It also lets a drag keep extending toward off-viewport points
   * (e.g. the pointer leaving the window), which the platform hit-test cannot
   * resolve. Set to `false` to fall back to the platform DOM hit-test.
   */
  geometricHitTest = x(this, !0);
  /**
   * Client coordinates → absolute source offset (any block). Used during
   * drag to keep extending the selection even when the pointer leaves the
   * original block. Honours {@link geometricHitTest}.
   */
  resolveOffsetFromPoint(e) {
    const t = this._resolveTableCellOffset(e);
    if (t !== void 0)
      return t;
    if (this.geometricHitTest.get()) {
      const i = this.measuredLayout.visualLineMap.get();
      return i.isEmpty ? void 0 : i.offsetAtPoint(this.coordinateSpace.capture().toLocalPoint(e));
    }
    const s = kr(e);
    if (s)
      return this._document.get()?.resolveSource(s);
  }
  /**
   * Resolve table-cell hits that have no measurable text run. Empty cells map
   * from their own box instead of snapping to a neighboring cell; element-only
   * content (for example an inactive image) maps through the hit element's view
   * node. Text-bearing cells keep the normal pixel-precise line-map/DOM path.
   */
  _resolveTableCellOffset(e) {
    const t = document.elementFromPoint(e.x, e.y), s = t?.closest("td");
    if (!(s instanceof HTMLTableCellElement) || !this._contentContainer.contains(s))
      return;
    const i = this._document.get();
    if (!i)
      return;
    const o = oe.forDom(s);
    if (o?.ast.kind !== "tableCell" || o.dom !== s)
      return;
    const r = i.resolveSource({ node: s, offset: 0 }), c = i.resolveSource({ node: s, offset: 1 });
    if (r === void 0 || c === void 0)
      return;
    const a = (u) => {
      const h = u.getBoundingClientRect();
      return (getComputedStyle(u).direction === "rtl" ? e.x >= h.left + h.width / 2 : e.x < h.left + h.width / 2) ? 0 : 1;
    }, l = (u, h) => this.measuredLayout.visualLineMap.get().lines.some(
      (f) => f.runs.some(
        (m) => m.source !== void 0 && m.sourceStart < h && m.sourceEndExclusive > u
      )
    ), d = t ? oe.forDom(t) : void 0;
    if (d && d !== o && d.dom instanceof Element) {
      const u = i.resolveSource({ node: d.dom, offset: 0 }), h = i.resolveSource({ node: d.dom, offset: 1 });
      if (u !== void 0 && h !== void 0 && !l(u, h))
        return h - u <= 1 ? h : a(d.dom) === 0 ? u + 1 : h - 1;
    }
    if (!l(r, c))
      return c - r <= 1 ? c : a(s) === 0 ? r + 1 : c - 1;
  }
  /**
   * Whether a client point falls on the rendered document content, as
   * opposed to the surrounding editor padding (the green area). Uses DOM
   * containment rather than the content node's bounding box so that markers
   * which overflow into the padding (e.g. a heading's `##`, which renders in
   * the left margin) still count as content. Overlays (cursor, selection)
   * have `pointer-events: none`, so the hit-test sees through them.
   */
  isPointInContent(e) {
    const t = this._document.get()?.contentDomNode;
    if (!t)
      return !1;
    const s = document.elementFromPoint(e.x, e.y);
    return s !== null && t.contains(s);
  }
  /**
   * Whether `range` intersects the rendered source text — the region whose
   * selection this editor paints itself from `model.selection`. This also
   * catches select-all ranges whose endpoints surround the rendered content.
   * Overlays anchored beside the text (comment widgets and the like) are *not*
   * part of it and keep their own native selection behaviour.
   */
  intersectsRenderedContent(e) {
    const t = this._document.get()?.contentDomNode;
    return !!t && e.intersectsNode(t);
  }
  // ----- render autorun ------------------------------------------------
  _renderAutorun = (e) => {
    const t = e.readObservable(this._model.document), s = e.readObservable(this._model.sourceText).value, i = e.readObservable(this._model.markerVisibleBlocks), o = e.readObservable(this.forcedMarkerVisibleBlocks), r = o.size === 0 ? i : /* @__PURE__ */ new Set([...i, ...o]), c = e.readObservable(this._model.selection), a = e.readObservable(this._model.pendingParagraph), l = e.readObservable(this._model.diff), d = e.readObservable(this._model.readonlyMode), u = e.readObservable(this._embeddedCodeEditorFactoryVersion);
    this.editContext.text !== s && this.editContext.updateText(0, this.editContext.text.length, s);
    const h = c?.range;
    this.editContext.updateSelection(h?.start ?? 0, h?.endExclusive ?? 0);
    const f = this._document.get(), m = ni(
      t,
      r,
      c?.range,
      this._previousViewData,
      a ? {
        anchorBlock: a.anchorBlock,
        ast: a.syntheticAst,
        replaceRange: a.replaceRange,
        cursorLine: a.cursorLine,
        text: a.text
      } : void 0
    );
    this._previousViewData = m;
    const g = l ? _c(m, l.items, this._options?.diffDecorationsActive) : m;
    this._viewData.set(g, void 0);
    const _ = this._options?.embeddedCodeEditorFactory ? { ...this._options, embeddedCodeEditorReadOnly: d, embeddedCodeEditorFactoryVersion: u } : this._options, p = sn.create(g, _, f);
    if (f) {
      if (p.contentDomNode !== f.contentDomNode)
        throw new Error("DocumentViewNode.contentDomNode must be stable across rebuilds");
    } else
      this._contentContainer.insertBefore(p.contentDomNode, this._selectionView.element), this._resizeObserver.observe(p.contentDomNode);
    this._document.set(p, void 0), this._publishMeasurements(p, !0), l ? this._paintDiff(p, l.insertedRanges) : this._clearDiff();
  };
  /** Current mounted blocks, or empty before the first render. */
  get _blocks() {
    return this._document.get()?.blocks ?? [];
  }
  /**
   * Measure each mounted block's rect and per-block visual line map, then
   * publish the result into the {@link MeasuredLayoutModel}. The model
   * is not read here, so there is no feedback loop into the render autorun.
   *
   * gp-fork: measurement (SFE-P3f — the D13 fix). `n` (new, optional):
   * true ONLY from the per-keystroke _renderAutorun call site below. The
   * two other call sites in this class — the ResizeObserver callback and
   * the scroll listener, both above in this constructor — keep calling
   * this with a single argument, so `n` is `undefined` there and every
   * block is always fully remeasured on those paths, byte-for-byte as
   * before this patch: a container resize or a scroll can move or rewrap
   * ANY block without touching a single view node's identity, so neither
   * path is safe to shortcut this way, and neither is on the D13 budget's
   * per-keystroke path this patch targets. See PATCHES.md for the full
   * consumer trace and why gating on `n` this way is sound.
   */
  _publishMeasurements(e, n) {
    const t = this.coordinateSpace.capture(), s = [];
    for (const r of e.blocks) {
      const c = t.toLocalRect(r.node.element.getBoundingClientRect());
      r.node.recordMeasuredHeight(c.height);
      const a = r.node.scrollElement;
      let l;
      const d = getComputedStyle(a).overflowX;
      if ((d === "auto" || d === "scroll" || d === "hidden" || d === "clip") && a.scrollWidth > a.clientWidth + 1) {
        const m = t.toLocalRect(a.getBoundingClientRect()).left + a.clientLeft;
        l = { left: m, right: m + a.clientWidth };
      }
      /* gp-fork: measurement — r.node is the exact same object as the
       * entry this loop measured last render at this position iff Y()
       * (the view-node factory) reused it by identity, which happens only
       * when nothing in its ast/showMarkup/active-state subtree differs —
       * i.e. only when its rendered DOM, and therefore its INTERNAL
       * geometry (line wraps, run positions relative to the block's own
       * top-left), is provably unchanged since __gpCache below was
       * recorded (see PATCHES.md's consumer-map rationale). That identity
       * says nothing about the block's ABSOLUTE source offsets, which are
       * baked into every cached run via `sourceRange` (see mo()/gpTranslate
       * VisualLineMap above) and shift whenever an edit lands earlier in
       * the document without touching this block's own DOM at all. So the
       * cache is reusable only when BOTH hold: (1) className is unchanged
       * — a cheap, generic guard against any block-level presentation
       * state this reasoning did not otherwise anticipate — and (2) this
       * block's absoluteStart is byte-identical to the absoluteStart the
       * cache was recorded under, which is the ONLY thing that proves no
       * edit shifted this block since. When (2) fails, the cached
       * sourceRanges are stale by the shift amount and MUST NOT be reused
       * even via translation — translating rect geometry does not, and
       * cannot, correct a stale sourceRange, so this falls through to a
       * full Pe.measure() instead. When both hold, the expensive
       * per-text-leaf walk (Pe.measure() -> mo(): one DOM Range +
       * getClientRects() per text leaf) is skipped and replaced by
       * translating the cached map's RECT geometry only by this block's
       * freshly (and cheaply) remeasured position delta — exact, not
       * approximate, under that same identity invariant, since translate()
       * only ever moves rects by the block's OWN observed shift and never
       * touches sourceRange, which is guaranteed unchanged by (2). */
      const gpCache = n ? r.node.__gpCache : void 0, gpReusable = gpCache !== void 0 && gpCache.className === r.node.element.className && gpCache.absoluteStart === r.absoluteStart;
      const h = gpReusable
        ? gpTranslateVisualLineMap(gpCache.visualLineMap, c.x - gpCache.rect.x, c.y - gpCache.rect.y)
        : Pe.measure([{
          absoluteStart: r.absoluteStart,
          viewNode: r.node
        }], this.coordinateSpace, t);
      r.node.__gpCache = { rect: c, visualLineMap: h, className: r.node.element.className, absoluteStart: r.absoluteStart };
      s.push({
        block: r.node.block,
        absoluteStart: r.absoluteStart,
        height: c.height,
        rect: c,
        viewportClip: l,
        isMeasured: !0,
        visualLineMap: h,
        viewNode: r.node
      });
    }
    const i = e.pendingParagraph, o = [];
    if (i) {
      const r = t.toLocalRect(i.element.getBoundingClientRect()), c = t.toLocalRect(i.getCaretClientRect());
      o.push({
        afterBlock: i.anchorBlock,
        line: ot.virtual(
          i.cursorLine,
          C.fromPointSize(c.left, r.top, 0, r.height)
        )
      });
    }
    this.measuredLayout.setMeasurements(s, o);
  }
  /**
   * Paint the diff highlights via the CSS Custom Highlight API: green over the
   * inserted/changed modified ranges (mapped on the document's own DOM), and
   * red over each {@link DiffDecorationViewNode}'s deleted ranges (mapped on
   * the decoration's own subtree). No DOM is mutated, so reconciliation and
   * editing are unaffected.
   */
  _paintDiff(e, t) {
    this._diffHighlightsView.render(e, t);
  }
  _clearDiff() {
    this._diffHighlightsView.clear();
  }
  _syncEditContextAttachment() {
    this.element.editContext = this._editContextSuspensions.size > 0 ? null : this.editContext;
  }
  _revealRange(e, t, s = "center", i) {
    const o = this._document.get();
    if (!o)
      return;
    const r = ht(o, [e]);
    if (r.length === 0 && !e.isEmpty)
      return;
    const c = this.measuredLayout.measurements.get().find(
      (u) => u.absoluteStart <= e.start && e.start <= u.absoluteStart + u.block.length
    ), a = r[0]?.range.startContainer ?? c?.viewNode?.dom, l = a instanceof Element ? a : a?.parentElement;
    if (!l)
      return;
    const d = () => {
      const u = jc(r.flatMap((f) => Array.from(f.range.getClientRects())));
      if (u || !e.isEmpty)
        return u;
      const h = this.measuredLayout.visualLineMap.get();
      if (!h.isEmpty) {
        const f = h.lineIndexOfOffset(e.start), m = h.lineRect(f), g = C.fromPointSize(
          h.xAtOffset(e.start),
          m.top,
          2,
          m.height
        );
        return this.coordinateSpace.capture().toClientRect(g);
      }
      if (c?.rect)
        return this.coordinateSpace.capture().toClientRect(
          C.fromPointSize(c.rect.left, c.rect.top, 2, c.rect.height)
        );
    };
    this._revealTarget(l, d, t, s, i);
  }
  _revealTarget(e, t, s, i, o) {
    let r = t();
    if (!r)
      return;
    const c = di(e);
    let a = this._isRevealOccluded(r);
    if (Gn(c, bt(r, c, o)) && !a)
      return;
    const l = Gc(e);
    for (let m = 0; m < l.length; m++) {
      const g = l[m];
      r = t() ?? r, a = this._isRevealOccluded(r);
      const _ = hi(g), p = bt(r, _, o), w = g.scrollWidth > g.clientWidth, E = g.scrollHeight > g.clientHeight, y = jn(p, _, i), L = Xc(g, y.x, y.y), R = w && (r.left < _.left || r.right > _.right) ? g.scrollLeft + L.x : g.scrollLeft, V = E && (p.top < _.top || p.bottom > _.bottom || a) ? g.scrollTop + L.y : g.scrollTop, ve = V !== g.scrollTop;
      (R !== g.scrollLeft || ve) && g.scrollTo({
        left: R,
        top: V,
        behavior: "auto"
      });
    }
    r = t() ?? r, a = this._isRevealOccluded(r);
    const d = this.element.ownerDocument, u = d.defaultView ?? window, h = C.fromPointSize(
      0,
      0,
      d.documentElement.clientWidth || u.innerWidth,
      d.documentElement.clientHeight || u.innerHeight
    ), f = bt(r, h, o);
    if (!Gn(h, f) || a) {
      const m = jn(f, h, i);
      u.scrollBy({
        left: r.left < h.left || r.right > h.right ? m.x : 0,
        top: m.y,
        behavior: s
      });
    }
  }
  _scheduleCaretReveal() {
    this._caretRevealRaf !== void 0 && cancelAnimationFrame(this._caretRevealRaf), this._caretRevealRaf = requestAnimationFrame(() => {
      this._caretRevealRaf = requestAnimationFrame(() => {
        this._caretRevealRaf = void 0;
        const e = this._model.selection.get();
        !e || !this._focused.get() || (this._revealCaretNearest(), this._followedCaretBlock = this._caretBlockAt(e.active));
      });
    });
  }
  _revealCaretNearest() {
    const e = this._model.cursorPosition.get();
    if (!e)
      return;
    const t = this.measuredLayout.visualLineMap.get(), s = t.lineIndexOfPosition(e), i = s === void 0 ? void 0 : t.lineRect(s).height;
    if (e.kind === "source") {
      this._revealRange(v.emptyAt(e.offset), "auto", "nearest", i);
      return;
    }
    const o = this._cursorView.rendering.get(), r = this._model.selection.get(), a = (r ? this._measurementAt(r.active) : void 0)?.viewNode?.dom, l = a instanceof Element ? a : a?.parentElement;
    !o.visible || !l || this._revealTarget(
      l,
      () => {
        const d = this._cursorView.rendering.get();
        return d.visible ? this.coordinateSpace.capture().toClientRect(d.rect) : void 0;
      },
      "auto",
      "nearest",
      i
    );
  }
  _revealCaretAfterActiveBlockResize() {
    if (!this._followCaretAfterEdit)
      return;
    const e = this._model.selection.get();
    if (!e)
      return;
    const t = this._caretBlockAt(e.active), s = this._followedCaretBlock;
    if (!t) {
      this._followedCaretBlock = void 0;
      return;
    }
    s && (s.element !== t.element || Math.abs(s.height - t.height) >= 0.5) && this._scheduleCaretReveal(), this._followedCaretBlock = t;
  }
  _caretBlockAt(e) {
    const t = this._measurementAt(e);
    return t?.viewNode ? { element: t.viewNode.element, height: t.height } : void 0;
  }
  _measurementAt(e) {
    return this.measuredLayout.measurements.get().find(
      (t) => t.absoluteStart <= e && e <= t.absoluteStart + t.block.length && t.viewNode !== void 0
    );
  }
  _stopFollowingCaret() {
    this._followCaretAfterEdit = !1, this._followedCaretBlock = void 0, this._caretRevealRaf !== void 0 && (cancelAnimationFrame(this._caretRevealRaf), this._caretRevealRaf = void 0);
  }
  _isRevealOccluded(e) {
    for (const t of this._revealOcclusions) {
      const i = t.ownerDocument.defaultView?.getComputedStyle(t).visibility;
      if (t.isConnected && t.getClientRects().length > 0 && i !== "hidden" && i !== "collapse" && Qc(e, Zc(t.getBoundingClientRect())))
        return !0;
    }
    return !1;
  }
}
function Qc(n, e) {
  const t = n.width === 0 ? e.containsX(n.left) : Math.max(n.left, e.left) < Math.min(n.right, e.right), s = n.height === 0 ? e.containsY(n.top) : Math.max(n.top, e.top) < Math.min(n.bottom, e.bottom);
  return t && s;
}
function jc(n) {
  if (n.length === 0)
    return;
  let e = Number.POSITIVE_INFINITY, t = Number.POSITIVE_INFINITY, s = Number.NEGATIVE_INFINITY, i = Number.NEGATIVE_INFINITY;
  for (const o of n)
    e = Math.min(e, o.left), t = Math.min(t, o.top), s = Math.max(s, o.right), i = Math.max(i, o.bottom);
  return C.fromPointPoint(e, t, s, i);
}
function Zc(n) {
  return C.fromPointPoint(n.left, n.top, n.right, n.bottom);
}
function jn(n, e, t) {
  if (t === "center")
    return new ne(
      n.left + n.width / 2 - (e.left + e.width / 2),
      n.top + n.height / 2 - (e.top + e.height / 2)
    );
  const s = n.height > e.height ? n.top - e.top : n.top < e.top ? n.top - e.top - qe : n.bottom > e.bottom ? n.bottom - e.bottom + qe : 0;
  return new ne(
    n.left < e.left ? n.left - e.left - qe : n.right > e.right ? n.right - e.right + qe : 0,
    s
  );
}
function bt(n, e, t) {
  if (t === void 0 || t <= 0)
    return n;
  const s = e.height / t, o = Math.min(s / 2, ui) * t;
  return C.fromPointPoint(
    n.left,
    n.top - o,
    n.right,
    n.bottom + o
  );
}
const Jc = 1e3, ea = "md-editor-find-match", ta = "md-editor-find-current", Zn = /* @__PURE__ */ new WeakMap();
class na {
  constructor(e) {
    this._registry = e;
  }
  _entries = /* @__PURE__ */ new Set();
  add() {
    const e = { matches: [], current: [] };
    return this._entries.add(e), this._refresh(), {
      update: (t, s) => {
        e.matches = t, e.current = s, this._refresh();
      },
      dispose: () => {
        this._entries.delete(e), this._refresh();
      }
    };
  }
  _refresh() {
    const e = [...this._entries].flatMap((s) => s.matches), t = [...this._entries].flatMap((s) => s.current);
    this._set(ea, e), this._set(ta, t);
  }
  _set(e, t) {
    t.length === 0 ? this._registry.delete(e) : this._registry.set(e, new Highlight(...t));
  }
}
function sa(n) {
  const e = n.defaultView?.CSS.highlights;
  if (!e)
    return { update: () => {
    }, dispose: () => {
    } };
  let t = Zn.get(n);
  return t || (t = new na(e), Zn.set(n, t)), t.add();
}
class ia extends H {
  constructor(e, t) {
    super(), this._view = e, this._matchesLayer = es("md-find-matches-layer"), this._currentLayer = es("md-find-current-layer"), this._highlightRegistration = this._register(sa(this._view.element.ownerDocument)), this._register(this._view.mountOverlay(this._matchesLayer, "below-selection")), this._register(this._view.mountOverlay(this._currentLayer, "above-decorations")), this._register(P((r) => {
      const c = t.isRevealed.read(r);
      if (!c) {
        this._snapshot = void 0, this._schedulePaint();
        return;
      }
      this._snapshot = {
        isRevealed: c,
        result: t.searchResult.read(r),
        currentMatch: t.currentMatch.read(r),
        document: this._view.documentViewNode.read(r),
        measurements: this._view.measuredLayout.measurements.read(r)
      }, this._schedulePaint();
    }));
    const s = () => this._schedulePaint(), i = this._view.element.ownerDocument, o = i.defaultView ?? window;
    i.addEventListener("scroll", s, !0), o.addEventListener("scroll", s), this._register({
      dispose: () => {
        i.removeEventListener("scroll", s, !0), o.removeEventListener("scroll", s);
      }
    }), this._resizeObserver = new ResizeObserver(() => this._schedulePaint()), this._observeResizeAncestors(), o.addEventListener("resize", s), this._register({
      dispose: () => {
        o.removeEventListener("resize", s), this._resizeObserver.disconnect();
      }
    }), this._register({
      dispose: () => {
        this._paintRaf && cancelAnimationFrame(this._paintRaf);
      }
    });
  }
  _matchesLayer;
  _currentLayer;
  _highlightRegistration;
  _resizeObserver;
  _resizeObservedElements = /* @__PURE__ */ new Set();
  _snapshot;
  _paintRaf = 0;
  _schedulePaint() {
    this._paintRaf || (this._paintRaf = requestAnimationFrame(() => {
      this._paintRaf = 0, this._paint();
    }));
  }
  _paint() {
    this._observeResizeAncestors();
    const e = this._snapshot;
    if (!e || !e.isRevealed || e.result.kind === "invalid" || !e.document) {
      this._matchesLayer.replaceChildren(), this._currentLayer.replaceChildren(), this._highlightRegistration.update([], []);
      return;
    }
    const t = this._view.coordinateSpace.capture(), s = di(this._view.overlayContainer), i = t.toLocalRect(s), o = oa(
      this._view.measuredLayout.visualLineMap.get().sourceLines.flatMap((u) => Math.max(u.rect.top, i.top) >= Math.min(u.rect.bottom, i.bottom) ? [] : u.runs.flatMap((h) => {
        const f = ra(h, u.rect, i);
        return f ? [f] : [];
      }))
    ), r = ts(
      e.result.matches.filter((u) => !e.currentMatch?.equals(u)),
      o
    ), c = e.currentMatch ? [e.currentMatch] : [], a = ts(c, o), l = this._paintRanges(
      this._matchesLayer,
      e.document,
      r,
      e.measurements,
      i,
      "md-find-match-rect",
      Jc
    ), d = this._paintRanges(
      this._currentLayer,
      e.document,
      a,
      e.measurements,
      i,
      "md-find-current-rect",
      Number.POSITIVE_INFINITY
    );
    this._highlightRegistration.update(l, d);
  }
  _observeResizeAncestors() {
    for (let e = this._view.element; e; e = e.parentElement)
      this._resizeObservedElements.has(e) || (this._resizeObservedElements.add(e), this._resizeObserver.observe(e));
  }
  _paintRanges(e, t, s, i, o, r, c) {
    const a = this._view.coordinateSpace.capture(), l = document.createDocumentFragment(), d = [];
    let u = 0;
    for (const f of s.filter((m) => m.isEmpty)) {
      const m = this._view.measuredLayout.visualLineMap.get();
      if (m.isEmpty)
        continue;
      const g = m.lineIndexOfOffset(f.start), _ = m.lineRect(g), p = is(
        C.fromPointSize(
          m.xAtOffset(f.start),
          _.top,
          2,
          _.height
        ),
        o,
        ns(i, f.start)?.viewportClip
      );
      if (p && (l.appendChild(Jn(`${r} md-find-zero-width-rect`, p)), u++, u >= c))
        return e.replaceChildren(l), d;
    }
    const h = Number.isFinite(c) ? Math.max(0, c - u) : Number.POSITIVE_INFINITY;
    for (const f of ht(
      t,
      s.filter((m) => !m.isEmpty),
      h
    )) {
      const m = ns(i, f.sourceRange.start);
      let g = !1;
      for (const _ of f.range.getClientRects()) {
        const p = is(
          a.toLocalRect(_),
          o,
          m?.viewportClip
        );
        if (!(!p || p.width === 0 || p.height === 0) && (g = !0, l.appendChild(Jn(r, p)), u++, u >= c))
          return g && d.push(f.range), e.replaceChildren(l), d;
      }
      g && d.push(f.range);
    }
    return e.replaceChildren(l), d;
  }
}
function Jn(n, e) {
  const t = document.createElement("div");
  return t.className = n, t.style.left = `${e.left}px`, t.style.top = `${e.top}px`, t.style.width = `${e.width}px`, t.style.height = `${e.height}px`, t;
}
function es(n) {
  const e = document.createElement("div");
  return e.className = `md-find-highlight-layer ${n}`, e.setAttribute("aria-hidden", "true"), e;
}
function ts(n, e) {
  if (e.length === 0)
    return [];
  const t = [];
  let s = 0;
  for (const i of n) {
    if (i.isEmpty) {
      for (; s < e.length && e[s].endExclusive < i.start; )
        s++;
      const o = e[s];
      o && o.start <= i.start && i.start <= o.endExclusive && t.push(i);
      continue;
    }
    for (; s < e.length && e[s].endExclusive <= i.start; )
      s++;
    for (let o = s; o < e.length; o++) {
      const r = e[o];
      if (r.start >= i.endExclusive)
        break;
      const c = r.intersect(i);
      c && !c.isEmpty && t.push(c);
    }
  }
  return t;
}
function ns(n, e) {
  let t = 0, s = n.length;
  for (; t < s; ) {
    const i = t + s >>> 1, o = n[i];
    if (e < o.absoluteStart)
      s = i;
    else if (e >= o.absoluteStart + o.block.length)
      t = i + 1;
    else
      return o;
  }
}
function oa(n) {
  const e = n.slice().sort((s, i) => s.start - i.start || s.endExclusive - i.endExclusive), t = [];
  for (const s of e) {
    const i = t[t.length - 1];
    i?.intersectsOrTouches(s) ? t[t.length - 1] = i.join(s) : t.push(s);
  }
  return t;
}
function ra(n, e, t) {
  if (n.sourceRange.isEmpty)
    return t.left <= n.rect.left && n.rect.left <= t.right ? n.sourceRange : void 0;
  let s = n.sourceStart;
  const i = n.sourceEndExclusive;
  if (s >= i)
    return;
  const o = n.xAtOffset(i), r = n.xAtOffset(s + 1), c = o >= r, a = n.rect.width > 0 ? n.rect : e, l = c ? a.left : a.right, d = (_) => _ === s ? l : n.xAtOffset(_), u = (_) => c ? _ : -_, h = u(c ? t.left : t.right), f = u(c ? t.right : t.left);
  if (u(o) < h || u(l) > f)
    return;
  const m = ss(
    s,
    i,
    (_) => u(d(_)) >= h
  );
  if (m > i)
    return;
  const g = Math.min(i, ss(
    m,
    i,
    (_) => u(d(_)) > f
  ));
  if (!(m >= g))
    return new v(m, g);
}
function ss(n, e, t) {
  let s = n, i = e + 1;
  for (; s < i; ) {
    const o = s + i >>> 1;
    o <= e && t(o) ? i = o : s = o + 1;
  }
  return s;
}
function is(n, e, t) {
  const s = Math.max(n.left, e.left, t?.left ?? Number.NEGATIVE_INFINITY), i = Math.min(n.right, e.right, t?.right ?? Number.POSITIVE_INFINITY), o = Math.max(n.top, e.top), r = Math.min(n.bottom, e.bottom);
  return s < i && o < r ? C.fromPointPoint(s, o, i, r) : void 0;
}
const ca = 19999;
class nt {
  constructor(e, t, s, i, o) {
    this._source = e, this._flags = t, this._wholeWord = s, this._wordSeparators = i, this.isEmpty = o;
  }
  static create(e) {
    if (e.searchString.length === 0)
      return {
        kind: "valid",
        pattern: new nt("", "gmu", e.wholeWord, e.wordSeparators, !0)
      };
    const t = e.isRegex ? e.searchString : aa(e.searchString), s = `gmu${e.matchCase ? "" : "i"}`;
    try {
      new RegExp(t, s);
    } catch (i) {
      return {
        kind: "invalid",
        error: i instanceof Error ? i : new Error(String(i))
      };
    }
    return {
      kind: "valid",
      pattern: new nt(t, s, e.wholeWord, e.wordSeparators, !1)
    };
  }
  findMatches(e, t, s = ca) {
    if (this.isEmpty || s <= 0)
      return { matches: [], isCapped: !1 };
    const i = [];
    let o = !1;
    return this._forEachMatch(e, t, (r) => i.length === s ? (o = !0, !1) : (i.push(r), !0)), { matches: i, isCapped: o };
  }
  findNextMatch(e, t, s, i = !0, o) {
    if (this.isEmpty)
      return;
    const r = st(t, 0, e.length);
    let c, a, l = !1;
    return this._forEachMatch(e, s, (d) => o?.equals(d) ? (l = !0, !0) : (c ??= d, d.start >= r ? (a = d, !1) : !0)), a ?? (i ? c : void 0) ?? (l ? o : void 0);
  }
  findPreviousMatch(e, t, s, i = !0, o) {
    if (this.isEmpty)
      return;
    const r = st(t, 0, e.length);
    let c, a, l = !1;
    return this._forEachMatch(e, s, (d) => o?.equals(d) ? (l = !0, !0) : (a = d, d.endExclusive <= r && (c = d), !0)), c ?? (i ? a : void 0) ?? (l ? o : void 0);
  }
  _forEachMatch(e, t, s) {
    const i = la(t, e.length);
    if (i?.isEmpty)
      return;
    const o = new RegExp(this._source, this._flags);
    for (; ; ) {
      const r = o.exec(e);
      if (!r)
        return;
      const c = v.ofStartAndLength(r.index, r[0].length);
      if ((!i || i.containsRange(c)) && (!this._wholeWord || da(e, c, this._wordSeparators)) && !s(c))
        return;
      r[0].length === 0 && (o.lastIndex = ha(e, o.lastIndex));
    }
  }
}
function fi(n) {
  return n.replace(/[\\{}()[\]^$+*?.|]/g, "\\$&");
}
function aa(n) {
  return n.split(/\r\n|\r|\n/).map(fi).join("(?:\\r\\n|[\\r\\n])");
}
function la(n, e) {
  if (!n)
    return;
  const t = st(n.start, 0, e), s = st(n.endExclusive, 0, e);
  return t <= s ? new v(t, s) : v.emptyAt(t);
}
function da(n, e, t) {
  const s = n[e.start - 1], i = n[e.start], o = n[e.endExclusive - 1], r = n[e.endExclusive], c = e.start === 0 || !Fe(s, t) || e.length > 0 && !Fe(i, t), a = e.endExclusive === n.length || !Fe(r, t) || e.length > 0 && !Fe(o, t);
  return c && a;
}
function ha(n, e) {
  if (e >= n.length)
    return n.length + 1;
  const t = n.charCodeAt(e);
  if (t < 55296 || t > 56319 || e + 1 >= n.length)
    return e + 1;
  const s = n.charCodeAt(e + 1);
  return s >= 56320 && s <= 57343 ? e + 2 : e + 1;
}
function st(n, e, t) {
  return Math.min(Math.max(n, e), t);
}
class mi {
  constructor(e) {
    this._editorModel = e, this._observedSourceTextId = this._editorModel.getSourceTextId(this._editorModel.sourceText.get());
  }
  _observedSourceTextId;
  _pending;
  record(e) {
    const t = this._pending;
    this._pending = t ? {
      baseSourceTextId: t.baseSourceTextId,
      resultSourceTextId: e.resultSourceTextId,
      isContinuous: t.isContinuous && t.resultSourceTextId === e.baseSourceTextId
    } : {
      baseSourceTextId: e.baseSourceTextId,
      resultSourceTextId: e.resultSourceTextId,
      isContinuous: !0
    };
  }
  consume(e) {
    const t = this._editorModel.getSourceTextId(e), s = this._pending;
    this._pending = void 0;
    const i = t !== this._observedSourceTextId, o = s !== void 0 && s.isContinuous && s.baseSourceTextId === this._observedSourceTextId && s.resultSourceTextId === t;
    return this._observedSourceTextId = t, { sourceIdentityChanged: i, isExpected: o };
  }
}
class ua extends H {
  constructor(e) {
    super(), this._editorModel = e, this._sourceEditTracker = new mi(this._editorModel);
    let t = this._inputSnapshot();
    this._register(this._editorModel.onWillApplySourceEdit((s) => {
      this._mapStateThroughEdit(s), this._sourceEditTracker.record(s);
    })), this._register(P((s) => {
      const i = this._editorModel.sourceText.read(s), o = i.value, r = this._readInputSnapshot(s), c = this._sourceEditTracker.consume(i), a = c.sourceIdentityChanged, l = a && c.isExpected;
      if (a && !l) {
        this._searchOrigin = yt(this._searchOrigin, 0, o.length), t = { ...r, scope: void 0 }, te((f) => {
          this.searchScope.set(void 0, f), this.currentMatch.set(void 0, f);
        });
        return;
      }
      const d = r.isRevealed && !t.isRevealed, u = !ma(r, t), h = !ga(r.scope, t.scope) && !a;
      if (!r.isRevealed)
        t.isRevealed && this.currentMatch.set(void 0, void 0);
      else {
        const f = this.searchResult.read(s);
        if (f.kind === "invalid" || f.pattern.isEmpty || f.matches.length === 0)
          this.currentMatch.set(void 0, void 0);
        else if (d || u || h)
          this._selectFromOrigin(f, this._pendingInitialDirection ?? "next");
        else if (a) {
          const m = this.currentMatch.get();
          m && !fa(f, o, r.scope, m) && this.currentMatch.set(void 0, void 0);
        }
      }
      this._pendingInitialDirection = void 0, this._pendingInitialDirection = void 0, t = r;
    }));
  }
  isRevealed = x(this, !1);
  searchString = x(this, "");
  isRegex = x(this, !1);
  matchCase = x(this, !1);
  wholeWord = x(this, !1);
  searchScope = x(this, void 0);
  currentMatch = x(this, void 0);
  loop = x(this, !0);
  searchResult = I(this, (e) => {
    const t = this._editorModel.sourceText.read(e).value, s = nt.create({
      searchString: this.searchString.read(e),
      isRegex: this.isRegex.read(e),
      matchCase: this.matchCase.read(e),
      wholeWord: this.wholeWord.read(e),
      wordSeparators: this._editorModel.wordNavigationConfig.read(e).wordSeparators
    });
    if (s.kind === "invalid")
      return { kind: "invalid", error: s.error };
    const i = s.pattern.findMatches(t, this.searchScope.read(e));
    return {
      kind: "valid",
      pattern: s.pattern,
      matches: i.matches,
      isCapped: i.isCapped
    };
  });
  matchesCount = I(this, (e) => {
    const t = this.searchResult.read(e);
    return t.kind === "valid" ? t.matches.length : 0;
  });
  isCapped = I(this, (e) => {
    const t = this.searchResult.read(e);
    return t.kind === "valid" && t.isCapped;
  });
  currentMatchPosition = I(this, (e) => {
    const t = this.currentMatch.read(e);
    if (!t)
      return 0;
    const s = this.searchResult.read(e);
    if (s.kind === "invalid")
      return 0;
    const i = s.matches.findIndex((o) => o.equals(t));
    return i < 0 ? 0 : i + 1;
  });
  _searchOrigin = 0;
  _sourceEditTracker;
  _pendingInitialDirection;
  reveal(e) {
    this._searchOrigin = yt(e.origin, 0, this._editorModel.sourceText.get().value.length), this._pendingInitialDirection = e.direction ?? "next", te((t) => {
      e.searchString !== void 0 && this.searchString.set(e.searchString, t), this.isRevealed.set(!0, t);
    });
  }
  hide() {
    te((e) => {
      this.isRevealed.set(!1, e), this.searchScope.set(void 0, e), this.currentMatch.set(void 0, e);
    });
  }
  setSearchOrigin(e) {
    this._searchOrigin = yt(e, 0, this._editorModel.sourceText.get().value.length);
  }
  setSearchScope(e) {
    this.searchScope.set(e, void 0);
  }
  moveToNextMatch() {
    return this._move("next");
  }
  moveToPreviousMatch() {
    return this._move("previous");
  }
  _move(e) {
    const t = this.searchResult.get();
    if (t.kind === "invalid" || t.pattern.isEmpty) {
      this.currentMatch.set(void 0, void 0);
      return;
    }
    const s = this._editorModel.sourceText.get().value, i = this.currentMatch.get(), o = this.searchScope.get(), r = e === "next" ? t.pattern.findNextMatch(
      s,
      i?.endExclusive ?? this._searchOrigin,
      o,
      this.loop.get(),
      i
    ) : t.pattern.findPreviousMatch(
      s,
      i?.start ?? this._searchOrigin,
      o,
      this.loop.get(),
      i
    );
    return this.currentMatch.set(r, void 0), r;
  }
  _selectFromOrigin(e, t) {
    const s = this._editorModel.sourceText.get().value, i = this.searchScope.get(), o = t === "next" ? e.pattern.findNextMatch(s, this._searchOrigin, i, this.loop.get()) : e.pattern.findPreviousMatch(s, this._searchOrigin, i, this.loop.get());
    this.currentMatch.set(o, void 0);
  }
  _mapStateThroughEdit(e) {
    this._searchOrigin = At(e.edit, this._searchOrigin, "after");
    const t = this.searchScope.get();
    t && this.searchScope.set(os(e.edit, t), e.transaction);
    const s = this.currentMatch.get();
    s && this.currentMatch.set(
      pa(e.edit, s) ? void 0 : os(e.edit, s),
      e.transaction
    );
  }
  _inputSnapshot() {
    return {
      isRevealed: this.isRevealed.get(),
      searchString: this.searchString.get(),
      isRegex: this.isRegex.get(),
      matchCase: this.matchCase.get(),
      wholeWord: this.wholeWord.get(),
      scope: this.searchScope.get()
    };
  }
  _readInputSnapshot(e) {
    return {
      isRevealed: this.isRevealed.read(e),
      searchString: this.searchString.read(e),
      isRegex: this.isRegex.read(e),
      matchCase: this.matchCase.read(e),
      wholeWord: this.wholeWord.read(e),
      scope: this.searchScope.read(e)
    };
  }
}
function fa(n, e, t, s) {
  return n.pattern.findNextMatch(e, s.start, t, !1)?.equals(s) ?? !1;
}
function ma(n, e) {
  return n.searchString === e.searchString && n.isRegex === e.isRegex && n.matchCase === e.matchCase && n.wholeWord === e.wholeWord;
}
function ga(n, e) {
  return n === e || !!n && !!e && n.equals(e);
}
function os(n, e) {
  const t = At(n, e.start, "after"), s = At(n, e.endExclusive, "before");
  return new v(Math.min(t, s), Math.max(t, s));
}
function At(n, e, t) {
  let s = 0;
  for (const i of n.replacements) {
    const o = i.replaceRange;
    if (e < o.start)
      break;
    if (e > o.endExclusive) {
      s += i.newText.length - o.length;
      continue;
    }
    return o.isEmpty ? o.start + s + (t === "after" ? i.newText.length : 0) : e === o.start && t === "before" ? o.start + s : o.start + s + i.newText.length;
  }
  return e + s;
}
function pa(n, e) {
  return n.replacements.some((t) => {
    const s = t.replaceRange;
    return s.isEmpty ? e.start < s.start && s.start < e.endExclusive : e.isEmpty ? s.contains(e.start) : s.intersects(e);
  });
}
function yt(n, e, t) {
  return Math.min(Math.max(n, e), t);
}
class _a extends H {
  constructor(e, t) {
    super(), this._view = e, this._options = t, this.element = document.createElement("div"), this.element.className = "md-find-widget-host", this.element.hidden = !0, this.panelElement = document.createElement("div"), this.panelElement.className = "md-find-widget", this.panelElement.setAttribute("role", "dialog"), this.panelElement.setAttribute("aria-label", "Find"), this.element.appendChild(this.panelElement);
    const s = document.createElement("div");
    s.className = "md-find-row", this.panelElement.appendChild(s), this._inputShell = document.createElement("div"), this._inputShell.className = "md-find-input-shell", s.appendChild(this._inputShell), this._input = document.createElement("textarea"), this._input.className = "md-find-input", this._input.rows = 1, this._input.spellcheck = !1, this._input.setAttribute("aria-label", "Find"), this._input.placeholder = "Find", this._inputShell.appendChild(this._input);
    const i = document.createElement("div");
    i.className = "md-find-options", this._inputShell.appendChild(i), this._caseButton = xt("Aa", "Match Case"), this._wholeWordButton = xt("ab", "Match Whole Word", "md-find-option-whole-word"), this._regexButton = xt(".*", "Use Regular Expression"), i.append(this._caseButton, this._wholeWordButton, this._regexButton), this._matchesCount = document.createElement("div"), this._matchesCount.className = "md-find-count", this._matchesCount.setAttribute("role", "status"), this._matchesCount.setAttribute("aria-live", "polite"), s.appendChild(this._matchesCount), this._previousButton = Ue("arrow-up", "Previous Match"), this._nextButton = Ue("arrow-down", "Next Match"), this._selectionButton = Ue("selection", "Find in Selection");
    const o = Ue("close", "Close");
    s.append(this._previousButton, this._nextButton, this._selectionButton, o), this._error = document.createElement("div"), this._error.className = "md-find-error", this._error.setAttribute("role", "alert"), this.panelElement.appendChild(this._error);
    const r = () => this._options.findModel.searchString.set(this._input.value, void 0), c = (h) => {
      h.isComposing || h.key === "Enter" && !h.ctrlKey && !h.metaKey && !h.altKey && (h.preventDefault(), h.stopPropagation(), h.shiftKey ? this._options.onPrevious() : this._options.onNext());
    }, a = (h) => {
      h.key === "Escape" && !h.isComposing && (h.preventDefault(), h.stopPropagation(), this._options.onClose());
    }, l = (h) => h.stopPropagation(), d = () => this.focused.set(!0, void 0), u = (h) => {
      const f = h.relatedTarget;
      f instanceof Node && this.panelElement.contains(f) || this.focused.set(!1, void 0);
    };
    this._input.addEventListener("input", r), this._input.addEventListener("keydown", c), this.panelElement.addEventListener("keydown", a), this.panelElement.addEventListener("pointerdown", l), this.panelElement.addEventListener("focusin", d), this.panelElement.addEventListener("focusout", u), this._register({
      dispose: () => {
        this._input.removeEventListener("input", r), this._input.removeEventListener("keydown", c), this.panelElement.removeEventListener("keydown", a), this.panelElement.removeEventListener("pointerdown", l), this.panelElement.removeEventListener("focusin", d), this.panelElement.removeEventListener("focusout", u);
      }
    }), this._registerButton(this._caseButton, () => this._options.findModel.matchCase.set(!this._options.findModel.matchCase.get(), void 0)), this._registerButton(this._wholeWordButton, () => this._options.findModel.wholeWord.set(!this._options.findModel.wholeWord.get(), void 0)), this._registerButton(this._regexButton, () => this._options.findModel.isRegex.set(!this._options.findModel.isRegex.get(), void 0)), this._registerButton(this._previousButton, this._options.onPrevious), this._registerButton(this._nextButton, this._options.onNext), this._registerButton(this._selectionButton, this._options.onToggleFindInSelection), this._registerButton(o, this._options.onClose), this._register(this._view.mountOverlay(this.element, "top-chrome")), this._register(this._view.registerRevealOcclusion(this.panelElement)), this._register(this._view.suspendEditContextWhileFocused(this.panelElement)), this._register(P((h) => this._render(h)));
  }
  element;
  panelElement;
  focused = x(this, !1);
  _inputShell;
  _input;
  _matchesCount;
  _previousButton;
  _nextButton;
  _selectionButton;
  _caseButton;
  _wholeWordButton;
  _regexButton;
  _error;
  focusAndSelect() {
    this._input.focus({ preventScroll: !0 }), this._input.select();
  }
  _registerButton(e, t) {
    e.addEventListener("click", t), this._register({ dispose: () => e.removeEventListener("click", t) });
  }
  _render(e) {
    const t = this._options.findModel, s = t.isRevealed.read(e);
    if (!s && this.panelElement.contains(this.panelElement.ownerDocument.activeElement) && this._view.focus(), this.element.hidden = !s, this._view.element.classList.toggle("md-find-visible", s), !s)
      return;
    const i = t.searchString.read(e), o = t.matchCase.read(e), r = t.wholeWord.read(e), c = t.isRegex.read(e), a = t.searchScope.read(e), l = t.searchResult.read(e), d = t.currentMatchPosition.read(e), u = this._options.canFindInSelection.read(e) || a !== void 0;
    this._input.value !== i && (this._input.value = i), Xe(this._caseButton, o), Xe(this._wholeWordButton, r), Xe(this._regexButton, c), Xe(this._selectionButton, a !== void 0), this._selectionButton.disabled = !s || !u;
    const h = l.kind === "valid" ? l.matches.length : 0, f = h > 0, m = i.length > 0;
    if (this._previousButton.disabled = !s || !f, this._nextButton.disabled = !s || !f, this.panelElement.classList.toggle("md-find-no-results", m && !f && l.kind === "valid"), !f)
      this._matchesCount.textContent = "No results";
    else {
      const _ = l.kind === "valid" && l.isCapped ? `${h}+` : String(h);
      this._matchesCount.textContent = `${d || "?"} of ${_}`;
    }
    const g = l.kind === "invalid" ? l.error.message : "";
    this._input.setAttribute("aria-invalid", String(g.length > 0)), this._inputShell.classList.toggle("md-find-input-invalid", g.length > 0), this._input.title = g, this._error.textContent = g, this._error.hidden = g.length === 0;
  }
}
function xt(n, e, t) {
  const s = document.createElement("button");
  return s.type = "button", s.className = "md-find-button md-find-option", t && s.classList.add(t), s.textContent = n, s.setAttribute("aria-label", e), s.title = e, s.setAttribute("aria-pressed", "false"), s;
}
function Ue(n, e) {
  const t = document.createElement("button");
  t.type = "button", t.className = "md-find-button", t.setAttribute("aria-label", e), t.title = e;
  const s = document.createElement("span");
  return s.className = `codicon codicon-${n}`, s.setAttribute("aria-hidden", "true"), t.appendChild(s), t;
}
function Xe(n, e) {
  n.setAttribute("aria-pressed", String(e)), n.classList.toggle("md-find-option-active", e);
}
class va extends H {
  constructor(e, t, s) {
    super(), this._editorModel = e, this._view = t, this._options = s, this._observedSourceTextId = this._editorModel.getSourceTextId(this._editorModel.sourceText.get()), this._sourceEditTracker = new mi(this._editorModel), this.model = this._register(new ua(this._editorModel)), this._register(this._editorModel.onWillApplySourceEdit((c) => {
      this._sourceEditTracker.record(c);
    }));
    const i = I(this, (c) => {
      const a = this._selectionForScope.read(c);
      return !!a && !a.isCollapsed;
    });
    this.widget = this._register(new _a(this._view, {
      findModel: this.model,
      canFindInSelection: i,
      onNext: () => {
        this.model.moveToNextMatch();
      },
      onPrevious: () => {
        this.model.moveToPreviousMatch();
      },
      onToggleFindInSelection: () => this._toggleFindInSelection(),
      onClose: () => this.close()
    })), this._register(new ia(this._view, this.model));
    const o = (c) => this._handleKeyDown(c);
    this._view.element.addEventListener("keydown", o, !0), this._register({
      dispose: () => this._view.element.removeEventListener("keydown", o, !0)
    }), this._register(P((c) => {
      const a = this.widget.focused.read(c);
      this._view.element.classList.toggle("md-find-widget-focused", a);
    }));
    let r = this._editorModel.selection.get();
    this._register(P((c) => {
      const a = this._editorModel.sourceText.read(c), l = this._editorModel.selection.read(c), d = this._sourceEditTracker.consume(a), u = l !== r;
      if (r = l, !u)
        return;
      const h = this.model.currentMatch.get();
      !l || h && l.range.equals(h) || (this._selectionForScope.set(l, void 0), this.model.setSearchOrigin(l.active), d.isExpected || this.model.currentMatch.set(void 0, void 0));
    })), this._register(P((c) => {
      const a = this._editorModel.sourceText.read(c), l = this._editorModel.getSourceTextId(a), d = l !== this._observedSourceTextId, u = this.model.isRevealed.read(c), h = this.model.currentMatch.read(c);
      this._view.element.classList.toggle("md-find-has-current-match", u && h !== void 0);
      const f = this._editorModel.document.read(c), m = this._view.documentViewNode.read(c);
      if (!u || !h) {
        this._forcedMatch = void 0, this._selectedMatch = void 0, this._observedSourceTextId = l, this._cancelRevealRequest(), this._setForcedMarkerVisibleBlocks(/* @__PURE__ */ new Set());
        return;
      }
      const g = !this._selectedMatch?.equals(h);
      let _ = /* @__PURE__ */ new Set();
      this._forcedMatch?.equals(h) ? _ = new Set(St(f, h.start, h.endExclusive)) : (m ? ka(m, h) : !1) ? this._forcedMatch = void 0 : (_ = new Set(St(f, h.start, h.endExclusive)), this._forcedMatch = h), te((p) => {
        rs(this._view.forcedMarkerVisibleBlocks.get(), _) || this._view.forcedMarkerVisibleBlocks.set(_, p);
        const w = this._editorModel.selection.get();
        g && !d && (!w || !w.range.equals(h)) && (this._editorModel.pendingParagraph.set(void 0, p), this._editorModel.selectionSource.set("find", p), this._editorModel.selection.set(new k(h.start, h.endExclusive), p));
      }), this._selectedMatch = h, this._observedSourceTextId = l, g && !d && (this._cancelRevealRequest(), this._revealRequest = this._view.revealRangeInCenterIfOutsideViewport(h, "auto"));
    })), this._register({
      dispose: () => {
        this._cancelRevealRequest(), this._view.element.classList.remove("md-find-visible", "md-find-widget-focused", "md-find-has-current-match"), this._view.forcedMarkerVisibleBlocks.set(/* @__PURE__ */ new Set(), void 0);
      }
    });
  }
  model;
  widget;
  _selectionForScope = x(this, void 0);
  _forcedMatch;
  _selectedMatch;
  _observedSourceTextId;
  _sourceEditTracker;
  _revealRequest;
  _setForcedMarkerVisibleBlocks(e) {
    rs(this._view.forcedMarkerVisibleBlocks.get(), e) || this._view.forcedMarkerVisibleBlocks.set(e, void 0);
  }
  openAndFocus() {
    if (this.model.isRevealed.get()) {
      this.widget.focusAndSelect();
      return;
    }
    const e = this._editorModel.selection.get() ?? k.collapsed(0);
    this._selectionForScope.set(e, void 0);
    const { searchString: t, origin: s } = this._querySeed(e, this.model.searchString.get());
    this.model.reveal({
      origin: s,
      searchString: t,
      direction: "next"
    }), this.widget.focusAndSelect();
  }
  close() {
    this.model.isRevealed.get() && (this._cancelRevealRequest(), this.model.hide(), this._view.focus());
  }
  _handleKeyDown(e) {
    if (e.isComposing || e.getModifierState("AltGraph"))
      return;
    const t = e.target, s = t instanceof Node && this.widget.panelElement.contains(t);
    if (!(t !== this._view.element && !s)) {
      if (wa(e, this._options.keyboardPlatform)) {
        Et(e), this.openAndFocus();
        return;
      }
      if (e.key === "F3" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        Et(e), this._findByKeyboard(e.shiftKey ? "previous" : "next");
        return;
      }
      e.key === "Escape" && this.model.isRevealed.get() && (Et(e), this.close());
    }
  }
  _cancelRevealRequest() {
    this._revealRequest?.dispose(), this._revealRequest = void 0;
  }
  _findByKeyboard(e) {
    if (this.model.isRevealed.get()) {
      e === "next" ? this.model.moveToNextMatch() : this.model.moveToPreviousMatch();
      return;
    }
    const t = this._editorModel.selection.get() ?? k.collapsed(0);
    this._selectionForScope.set(t, void 0);
    const s = this.model.searchString.get() || this._querySeed(t).searchString, i = e === "next" ? t.range.endExclusive : t.range.start;
    this.model.reveal({ origin: i, searchString: s, direction: e });
  }
  _querySeed(e, t) {
    const s = this._selectedSingleLineText(e);
    if (s)
      return {
        searchString: this._prepareSeed(s),
        origin: e.range.start
      };
    if (t)
      return { searchString: t, origin: e.active };
    const i = this._editorModel.sourceText.get().value, o = xs(i, e.active, this._editorModel.wordNavigationConfig.get()), r = i.slice(o.start, o.end);
    return {
      searchString: /\S/u.test(r) ? this._prepareSeed(r) : "",
      origin: o.start
    };
  }
  _prepareSeed(e) {
    return this.model.isRegex.get() ? fi(e) : e;
  }
  _selectedSingleLineText(e) {
    if (e.isCollapsed)
      return;
    const t = e.range.substring(this._editorModel.sourceText.get().value);
    return t.includes(`
`) || t.length === 0 ? void 0 : t;
  }
  _toggleFindInSelection() {
    if (this.model.searchScope.get()) {
      this.model.setSearchScope(void 0);
      return;
    }
    const e = this._selectionForScope.get();
    !e || e.isCollapsed || (this.model.setSearchOrigin(e.range.start), this.model.setSearchScope(e.range));
  }
}
function wa(n, e) {
  return n.key.toLowerCase() === "f" && !n.shiftKey && !n.altKey && (e === "macos" ? n.metaKey && !n.ctrlKey : n.ctrlKey && !n.metaKey);
}
function Et(n) {
  n.preventDefault(), n.stopPropagation();
}
function rs(n, e) {
  return n.size === e.size && Array.from(n).every((t) => e.has(t));
}
function ka(n, e) {
  const t = ht(n, [e]);
  return e.isEmpty ? t.some((i) => cs(i.range)) : t.reduce((i, o) => {
    const r = Array.from(o.range.getClientRects()).some((c) => c.width > 0 && c.height > 0) && cs(o.range);
    return i + (r ? o.sourceRange.length : 0);
  }, 0) === e.length;
}
function cs(n) {
  const e = n.startContainer.ownerDocument;
  if (!e)
    return !1;
  const t = e.defaultView ?? window;
  for (let s = n.startContainer instanceof Element ? n.startContainer : n.startContainer.parentElement; s; s = s.parentElement) {
    const i = t.getComputedStyle(s);
    if (i.display === "none" || i.visibility === "hidden" || i.visibility === "collapse")
      return !1;
  }
  return !0;
}
class ba {
  connect(e) {
    const t = (r) => {
      if (Ye(r.target, e.element))
        return;
      const c = e.getSelectedText();
      c !== void 0 && (r.preventDefault(), r.clipboardData?.setData("text/plain", c));
    }, s = (r) => {
      if (Ye(r.target, e.element))
        return;
      const c = e.getSelectedText();
      c !== void 0 && (r.preventDefault(), r.clipboardData?.setData("text/plain", c), e.deleteSelection());
    }, i = (r) => {
      if (Ye(r.target, e.element))
        return;
      r.preventDefault();
      const c = r.clipboardData?.getData("text/plain");
      c && e.insertText(c);
    }, o = e.element;
    return o.addEventListener("copy", t), o.addEventListener("cut", s), o.addEventListener("paste", i), {
      dispose: () => {
        o.removeEventListener("copy", t), o.removeEventListener("cut", s), o.removeEventListener("paste", i);
      }
    };
  }
}
class pl {
  constructor(e = navigator.clipboard) {
    this._clipboard = e;
  }
  connect(e) {
    const t = (i) => {
      if (!(i.ctrlKey || i.metaKey) || i.altKey)
        return;
      const r = Ye(i.target, e.element);
      if (r) {
        ya(i, r, this._clipboard);
        return;
      }
      switch (i.key.toLowerCase()) {
        case "c": {
          const c = e.getSelectedText();
          if (c === void 0)
            return;
          i.preventDefault(), this._clipboard.writeText(c);
          break;
        }
        case "x": {
          const c = e.getSelectedText();
          if (c === void 0)
            return;
          i.preventDefault(), this._clipboard.writeText(c), e.deleteSelection();
          break;
        }
        case "v": {
          i.preventDefault(), this._clipboard.readText().then((c) => {
            c && e.insertText(c);
          });
          break;
        }
      }
    }, s = e.element;
    return s.addEventListener("keydown", t), { dispose: () => s.removeEventListener("keydown", t) };
  }
}
function Ye(n, e) {
  if (!(n instanceof Node) || n === e)
    return;
  const s = (n instanceof Element ? n : n.parentElement)?.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  return s instanceof HTMLElement && e.contains(s) ? s : void 0;
}
function ya(n, e, t) {
  switch (n.key.toLowerCase()) {
    case "c": {
      const s = as(e);
      if (s === void 0)
        return;
      n.preventDefault(), t.writeText(s);
      return;
    }
    case "x": {
      const s = as(e);
      if (s === void 0)
        return;
      n.preventDefault(), t.writeText(s), ls(e, "");
      return;
    }
    case "v":
      n.preventDefault(), t.readText().then((s) => {
        s.length > 0 && ls(e, s);
      });
  }
}
function as(n) {
  if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
    const t = n.selectionStart, s = n.selectionEnd;
    return t === null || s === null || t === s ? void 0 : n.value.slice(t, s);
  }
  const e = n.ownerDocument.getSelection();
  if (!(!e || e.isCollapsed || e.rangeCount === 0 || !n.contains(e.getRangeAt(0).commonAncestorContainer)))
    return e.toString();
}
function ls(n, e) {
  if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
    const o = n.selectionStart ?? n.value.length, r = n.selectionEnd ?? o;
    n.setRangeText(e, o, r, "end"), n.dispatchEvent(new InputEvent("input", {
      bubbles: !0,
      inputType: e.length === 0 ? "deleteByCut" : "insertFromPaste",
      data: e
    }));
    return;
  }
  const t = n.ownerDocument.getSelection();
  if (!t || t.rangeCount === 0 || !n.contains(t.getRangeAt(0).commonAncestorContainer))
    return;
  const s = t.getRangeAt(0);
  s.deleteContents();
  const i = n.ownerDocument.createTextNode(e);
  s.insertNode(i), s.setStartAfter(i), s.collapse(!0), t.removeAllRanges(), t.addRange(s), n.dispatchEvent(new InputEvent("input", {
    bubbles: !0,
    inputType: e.length === 0 ? "deleteByCut" : "insertFromPaste",
    data: e
  }));
}
const Dt = {
  bindings: Ft.flatMap((n) => n.keybindings.map((e) => ({
    ...e,
    action: n.action
  })))
}, _l = {
  bindings: Ft.filter((n) => n.routing === "local").flatMap((n) => n.keybindings.map((e) => ({
    ...e,
    action: n.action
  })))
}, vl = {
  bindings: Ft.filter((n) => n.routing !== "local").flatMap((n) => n.keybindings.map((e) => ({
    ...e,
    action: n.action
  })))
}, xa = /* @__PURE__ */ new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End"
]);
function Ea(n) {
  return xa.has(n);
}
function Ca(n) {
  return n.includes("Macintosh") || n.includes("Mac OS X") ? "macos" : n.includes("Windows") ? "windows" : "linux";
}
function ds(n) {
  return {
    key: n.key,
    code: n.code,
    shiftKey: n.shiftKey,
    altKey: n.altKey,
    ctrlKey: n.ctrlKey,
    metaKey: n.metaKey,
    altGraphKey: n.getModifierState("AltGraph")
  };
}
function hs(n, e, t = Dt) {
  if (n.altGraphKey)
    return;
  const s = n.key.length === 1 ? n.key.toLowerCase() : n.key, i = /^[a-z]$/.test(s) ? void 0 : Sa(n.code);
  for (const o of t.bindings)
    if ((o.key === s || o.key === i) && (!o.platforms || o.platforms.includes(e)) && La(n, o.modifiers))
      return o.action;
}
function Sa(n) {
  return /^Key([A-Z])$/.exec(n)?.[1].toLowerCase();
}
function La(n, e = {}) {
  return n.shiftKey === !!e.shift && n.altKey === !!e.alt && n.ctrlKey === !!e.ctrl && n.metaKey === !!e.meta;
}
const Ma = 500, us = 5;
class wl extends H {
  constructor(e, t, s) {
    super(), this._model = e, this._view = t;
    const i = this._view.element, o = i.ownerDocument.defaultView ?? window;
    this._keyboardPlatform = s?.keyboardPlatform ?? Ca(o.navigator.userAgent), this._keyboardProfile = s?.keyboardProfile ?? Dt, this._forwardedKeyboardProfile = s?.forwardedKeyboardProfile, this._historyStrategy = s?.historyStrategy, this._indentation = s?.indentation ?? Be, this._tabFocusStatus = this._keyboardProfile === Dt ? this._registerTabFocusAccessibility(i) : void 0, i.addEventListener("pointerdown", this._handlePointerDown), i.addEventListener("keydown", this._handleKeyDown), this._register({
      dispose: () => {
        i.removeEventListener("pointerdown", this._handlePointerDown), i.removeEventListener("keydown", this._handleKeyDown);
      }
    }), o.addEventListener("keydown", this._updateModifierState), o.addEventListener("keyup", this._updateModifierState), o.addEventListener("blur", this._clearModifierState), i.ownerDocument.addEventListener("selectionchange", this._discardNativeSelection), this._register({
      dispose: () => {
        o.removeEventListener("keydown", this._updateModifierState), o.removeEventListener("keyup", this._updateModifierState), o.removeEventListener("blur", this._clearModifierState), i.ownerDocument.removeEventListener("selectionchange", this._discardNativeSelection);
      }
    });
    const r = s?.clipboardStrategy ?? new ba();
    this._register(r.connect({
      element: i,
      getSelectedText: () => this._selectedText(),
      deleteSelection: () => {
        this._generatedIndentation = void 0, this._executeEditCommand(mn);
      },
      insertText: (a) => {
        this._handlePendingInput(a) || this._insertText(a);
      }
    }));
    const c = this._view.editContext;
    c.addEventListener("textupdate", this._handleTextUpdate), this._register({
      dispose: () => c.removeEventListener("textupdate", this._handleTextUpdate)
    }), this.findController = s?.find === !1 ? void 0 : this._register(new va(this._model, this._view, {
      keyboardPlatform: this._keyboardPlatform
    }));
  }
  findController;
  _desiredColumn;
  _keyboardPlatform;
  _keyboardProfile;
  _forwardedKeyboardProfile;
  _historyStrategy;
  _indentation;
  _tabFocusStatus;
  _tabMovesFocus = !1;
  /** Indentation copied by the most recent fenced-code Enter, while still untouched. */
  _generatedIndentation;
  /** Running click count for the current multi-click sequence (1, 2, 3, …). */
  _clickCount = 0;
  /** Timestamp and position of the previous pointer-down, for multi-click detection. */
  _lastPointerDown;
  _handleTextUpdate = (e) => {
    if (this._model.readonlyMode.get()) {
      e.text.length > 0 && this._view.showReadonlyEditingAttempt();
      return;
    }
    if (this._model.pendingParagraph.get() !== void 0) {
      this._generatedIndentation = void 0, e.text.length > 0 ? this._handlePendingInput(e.text) : this._model.cancelPendingParagraph();
      return;
    }
    this._insertText(e.text, new k(e.updateRangeStart, e.updateRangeEnd));
  };
  _insertText(e, t) {
    const s = this._generatedIndentation;
    this._executeEditCommand(Xo(e, s), t), this._generatedIndentation = this._remainingGeneratedIndentation(s, e);
  }
  _remainingGeneratedIndentation(e, t) {
    if (!e || t.length === 0)
      return;
    const s = this._model.sourceText.get().value, i = this._model.selection.get();
    if (!i?.isCollapsed || e.endExclusive > i.active)
      return;
    const o = s.lastIndexOf(`
`, i.active - 1) + 1;
    if (e.start !== o || !/^[ \t]+$/.test(e.substring(s)))
      return;
    const r = s.slice(e.endExclusive, i.active);
    return /^`{1,2}$|^~{1,2}$/.test(r) ? e : void 0;
  }
  /** Handle typed, pasted, or command-generated text while a paragraph is pending. */
  _handlePendingInput(e) {
    const t = this._model.pendingParagraph.get();
    return t ? (e.length === 0 || (/^[ \t]+$/.test(e) ? this._model.setPendingParagraphText(t.text + e) : this._runUndoableEdit(() => this._model.materializePendingParagraph(e))), !0) : !1;
  }
  _deletePendingText(e) {
    const t = this._model.pendingParagraph.get();
    if (t) {
      if (t.text.length === 0) {
        this._model.cancelPendingParagraph();
        return;
      }
      this._model.setPendingParagraphText(e === "deleteLeft" ? t.text.slice(0, -1) : "");
    }
  }
  _handlePointerDown = (e) => {
    if (this._generatedIndentation = void 0, e.button !== 0)
      return;
    e.preventDefault(), this._view.stopFollowingCaret(), this._model.cancelPendingParagraph(), this._view.focus(), this._desiredColumn = void 0;
    const t = new ne(e.clientX, e.clientY), s = this._lastPointerDown, i = s !== void 0 && e.timeStamp - s.time < Ma && Math.abs(t.x - s.point.x) < us && Math.abs(t.y - s.point.y) < us;
    if (this._clickCount = i ? this._clickCount + 1 : 1, this._lastPointerDown = { time: e.timeStamp, point: t }, !this._view.isPointInContent(t)) {
      this._setUserSelection(void 0);
      return;
    }
    const o = this._view.resolveOffsetFromPoint(t) ?? this._model.sourceText.get().value.length;
    if (this._clickCount === 2) {
      const u = this._makeCursorContext();
      this._setUserSelection(_r(u, o));
      return;
    }
    if (this._clickCount === 3) {
      const u = Oa(this._model.document.get(), o);
      u && this._setUserSelection(vr(this._makeCursorContext(), u));
      return;
    }
    const r = this._clickCount === 1 && !e.shiftKey && this._model.readonlyMode.get();
    if (e.shiftKey) {
      const u = this._model.selection.get() ?? k.collapsed(o);
      this._setUserSelection(u.withActive(o));
    } else
      this._setUserSelection(k.collapsed(o));
    const c = this._view.element, a = e.pointerId;
    c.setPointerCapture(a), this._model.isSelecting.set(!0, void 0);
    const l = (u) => {
      const h = this._model.selection.get() ?? k.collapsed(o), f = this._view.resolveOffsetFromPoint(new ne(u.clientX, u.clientY)) ?? h.active;
      this._setUserSelection(new k(h.anchor, f));
    }, d = () => {
      this._model.isSelecting.set(!1, void 0), r && (this._model.selection.get()?.isCollapsed ?? !0) && this._view.showReadonlyEditingAttempt(), c.removeEventListener("pointermove", l), c.removeEventListener("pointerup", d), c.removeEventListener("pointercancel", d), c.removeEventListener("lostpointercapture", d);
    };
    c.addEventListener("pointermove", l), c.addEventListener("pointerup", d), c.addEventListener("pointercancel", d), c.addEventListener("lostpointercapture", d);
  };
  _makeCursorContext(e) {
    const t = this._model.document.get(), s = e ?? this._model.selection.get() ?? k.collapsed(0), i = e ? Gt(t, s.active) : this._model.activeBlock.get();
    return {
      text: this._model.sourceText.get().value,
      selection: s,
      document: t,
      activeBlock: i,
      markerVisibleBlocks: this._model.markerVisibleBlocks.get(),
      wordNavigationConfig: this._model.wordNavigationConfig.get(),
      cursorPosition: e ? O.source(s.active) : this._model.cursorPosition.get() ?? O.source(s.active)
    };
  }
  _makeVisualCursorContext() {
    return {
      ...this._makeCursorContext(),
      desiredColumn: this._desiredColumn,
      lineMap: this._view.measuredLayout.visualLineMap.get()
    };
  }
  _executeCursorCommand(e, t) {
    const s = this._makeCursorContext();
    this._applyCursorPosition(s.selection, e(s), t), this._desiredColumn = void 0;
  }
  _executeEditCommand(e, t) {
    if (this._model.readonlyMode.get()) {
      this._view.showReadonlyEditingAttempt();
      return;
    }
    const s = this._makeCursorContext(t), i = e(s);
    i && (this._runUndoableEdit(() => this._model.applyEdit(i.edit, i.selection), i.edit), this._desiredColumn = void 0);
  }
  _runUndoableEdit(e, t) {
    const s = this._historyStrategy;
    s?.record ? s.record(e, t) : e(), this._view.revealCaretAfterEdit();
  }
  _executeVisualCursorCommand(e, t) {
    const s = this._makeVisualCursorContext(), i = e(s);
    this._applyCursorPosition(s.selection, i.position, t), this._desiredColumn = i.desiredColumn;
  }
  _cursorDown(e) {
    const t = this._makeVisualCursorContext(), s = Do(t);
    if (!e && !this._model.readonlyMode.get() && !t.lineMap.isEmpty && t.cursorPosition.kind === "source" && s.position.kind === "source" && s.position.offset === t.selection.active) {
      const i = Ae(t);
      if (i) {
        this._model.armPendingParagraph(i), this._view.revealCaretAfterKeyboardNavigation(), this._desiredColumn = void 0;
        return;
      }
    }
    this._applyCursorPosition(t.selection, s.position, e), this._desiredColumn = s.desiredColumn;
  }
  _setUserSelection(e) {
    te((t) => {
      this._model.pendingParagraph.set(void 0, t), this._model.selectionSource.set("user", t), this._model.selection.set(e, t);
    });
  }
  _applyCursorPosition(e, t, s) {
    if (t.kind === "virtual") {
      if (this._model.pendingParagraph.get()?.cursorLine !== t.line) {
        const o = t.line.sourceOffsetBefore;
        this._setUserSelection(s ? e.withActive(o) : k.collapsed(o)), this._view.revealCaretAfterKeyboardNavigation();
      }
      return;
    }
    this._setUserSelection(
      s ? e.withActive(t.offset) : k.collapsed(t.offset)
    ), this._view.revealCaretAfterKeyboardNavigation();
  }
  /** Move the cursor down one visual line (Arrow Down). */
  cursorDown(e = !1) {
    this._cursorDown(e);
  }
  /** Move the cursor up one visual line (Arrow Up). */
  cursorUp(e = !1) {
    this._executeVisualCursorCommand(fn, e);
  }
  _selectedText() {
    const e = this._model.selection.get();
    if (!(!e || e.isCollapsed))
      return this._model.sourceText.get().value.slice(e.range.start, e.range.endExclusive);
  }
  _updateModifierState = (e) => {
    this._model.ctrlOrMetaDown.set(e.ctrlKey || e.metaKey, void 0);
  };
  _clearModifierState = () => {
    this._model.ctrlOrMetaDown.set(!1, void 0);
  };
  /**
   * Drop any native DOM selection over the rendered text.
   *
   * The editor paints selection from `model.selection`, so a browser
   * selection there is always spurious: nothing reads it (copy/cut read the
   * model, hit-testing uses the measured layout) and nothing clears it, so it
   * lingers as a second highlight even after the caret moves away.
   * {@link isCaretMotionKey} stops the common source synchronously; this is
   * the backstop for the rest of the browser's editing commands, which are
   * platform- and version-specific and cannot be enumerated (Shift+PageDown
   * and macOS Shift+Ctrl+B both reach one today).
   *
   * Scoped twice so it only ever discards selections the editor owns: the
   * range must touch the rendered text (overlays such as comment widgets sit
   * beside it and stay selectable), and input focus must still be inside this
   * editor (so a host find-in-page, which selects while its own input is
   * focused, is left alone).
   */
  _discardNativeSelection = () => {
    const e = this._view.element.ownerDocument;
    if (!this._view.element.contains(e.activeElement))
      return;
    const t = e.getSelection();
    if (!(!t || t.rangeCount === 0 || t.isCollapsed)) {
      for (let s = 0; s < t.rangeCount; s++)
        if (this._view.intersectsRenderedContent(t.getRangeAt(s))) {
          t.removeAllRanges();
          return;
        }
    }
  };
  _handleKeyDown = (e) => {
    if (e.isComposing || Ta(e, this._view.element) || (this._updateModifierState(e), e.key === "Tab" && (this._model.readonlyMode.get() || this._tabMovesFocus)))
      return;
    if (this._model.pendingParagraph.get() !== void 0 && e.key === "Escape") {
      fs(e), this._model.cancelPendingParagraph();
      return;
    }
    const t = hs(
      ds(e),
      this._keyboardPlatform,
      this._keyboardProfile
    );
    if (!t) {
      if (this._forwardedKeyboardProfile ? hs(
        ds(e),
        this._keyboardPlatform,
        this._forwardedKeyboardProfile
      ) : void 0) {
        e.preventDefault();
        return;
      }
      Ea(e.key) && e.preventDefault();
      return;
    }
    const s = this._model.pendingParagraph.get() !== void 0;
    t.kind === "history" && !s && !this._historyStrategy || (fs(e), this._executeKeyboardAction(t));
  };
  executeCommand(e) {
    this._executeKeyboardAction(e.action);
  }
  _executeKeyboardAction(e) {
    switch (this._generatedIndentation = void 0, e.kind) {
      case "cursor": {
        const t = e.command;
        switch (t) {
          case "left":
            this._executeCursorCommand(e.extend ? Oo : Mo, e.extend);
            return;
          case "right":
            this._executeCursorCommand(e.extend ? To : Lo, e.extend);
            return;
          case "up":
            this._executeVisualCursorCommand(fn, e.extend);
            return;
          case "down":
            this._cursorDown(e.extend);
            return;
          case "wordLeft":
            this._executeCursorCommand(No, e.extend);
            return;
          case "wordRight":
            this._executeCursorCommand(Ro, e.extend);
            return;
          case "visualLineStart":
            this._executeVisualCursorCommand(Bo, e.extend);
            return;
          case "visualLineEnd":
            this._executeVisualCursorCommand(Ao, e.extend);
            return;
          case "logicalLineStart":
            this._executeCursorCommand(Lt, e.extend);
            return;
          case "logicalLineEnd":
            this._executeCursorCommand(Mt, e.extend);
            return;
          case "documentStart":
            this._executeCursorCommand(Io, e.extend);
            return;
          case "documentEnd":
            this._executeCursorCommand(Po, e.extend);
            return;
          default:
            return ke(t);
        }
      }
      case "edit": {
        const t = e.command;
        if (this._model.pendingParagraph.get() !== void 0) {
          if (t === "deleteLeft" || t === "deleteWordLeft" || t === "deleteLineLeft") {
            this._deletePendingText(t);
            return;
          }
          this._model.cancelPendingParagraph();
          return;
        }
        switch (t) {
          case "deleteLeft":
            this._executeEditCommand(mn);
            return;
          case "deleteRight":
            this._executeEditCommand(Ho);
            return;
          case "deleteWordLeft":
            this._executeEditCommand(Ko);
            return;
          case "deleteWordRight":
            this._executeEditCommand(zo);
            return;
          case "deleteLineLeft":
            this._executeEditCommand(qo);
            return;
          case "deleteLineRight":
            this._executeEditCommand(Uo);
            return;
          default:
            return ke(t);
        }
      }
      case "selectAll": {
        const t = this._makeCursorContext();
        this._setUserSelection(pr(t));
        return;
      }
      case "history": {
        if (this._model.pendingParagraph.get() !== void 0) {
          e.command === "undo" && this._model.cancelPendingParagraph();
          return;
        }
        if (this._model.readonlyMode.get())
          return;
        const t = this._historyStrategy;
        if (!t)
          return;
        const s = e.command;
        switch (s) {
          case "undo":
            t.undo();
            return;
          case "redo":
            t.redo();
            return;
          default:
            return ke(s);
        }
      }
      case "tab": {
        const t = this._model.pendingParagraph.get();
        if (t !== void 0) {
          e.command === "insert" ? this._model.setPendingParagraphText(
            t.text + Fs(t.text, this._indentation)
          ) : this._model.setPendingParagraphText(
            Vs(t.text, this._indentation)
          );
          return;
        }
        const s = e.command;
        switch (s) {
          case "insert":
            this._executeEditCommand(Yo(this._indentation));
            return;
          case "outdent":
            this._executeEditCommand(Ps(this._indentation));
            return;
          default:
            return ke(s);
        }
      }
      case "toggleTabFocus": {
        if (this._model.cancelPendingParagraph(), this._model.readonlyMode.get()) {
          this._tabFocusStatus && (this._tabFocusStatus.textContent = "Tab always moves focus while the document is locked.");
          return;
        }
        this._tabMovesFocus = !this._tabMovesFocus, this._tabFocusStatus && (this._tabFocusStatus.textContent = this._tabMovesFocus ? "Tab now moves focus. Press Control+M to make Tab insert indentation." : "Tab now inserts indentation. Press Control+M to make Tab move focus.");
        return;
      }
      case "enter": {
        if (this._model.pendingParagraph.get() !== void 0) {
          this._model.readonlyMode.get() && this._view.showReadonlyEditingAttempt(), this._desiredColumn = void 0;
          return;
        }
        const t = e.command;
        switch (t) {
          case "smartEnter":
            this._smartEnter();
            return;
          case "insertParagraph":
            this._executeEditCommand(Qo);
            return;
          case "insertHardLineBreak":
            this._executeEditCommand(Zo);
            return;
          default:
            return ke(t);
        }
      }
      default:
        return ke(e);
    }
  }
  /**
   * Context-aware Enter: splits / line-breaks via {@link insertSmartEnter}, or
   * arms a transient empty paragraph when at the end of a paragraph.
   */
  _smartEnter() {
    if (this._model.readonlyMode.get()) {
      this._view.showReadonlyEditingAttempt();
      return;
    }
    const e = this._makeCursorContext(), t = Jo(e);
    t.kind === "edit" ? (this._runUndoableEdit(() => this._model.applyEdit(t.edit, t.selection), t.edit), this._generatedIndentation = t.generatedIndentation) : (this._model.armPendingParagraph({
      anchorBlock: t.anchorBlock,
      replaceRange: t.replaceRange,
      separateFromPreviousBlock: t.separateFromPreviousBlock,
      atEof: t.atEof
    }), this._view.revealCaretAfterEdit()), this._desiredColumn = void 0;
  }
  _registerTabFocusAccessibility(e) {
    const t = e.getAttribute("aria-description"), s = e.getAttribute("aria-keyshortcuts");
    e.setAttribute("aria-description", "Press Control+M to toggle whether Tab inserts indentation or moves focus. While locked, Tab always moves focus."), e.setAttribute("aria-keyshortcuts", "Control+M");
    const i = e.ownerDocument.createElement("span");
    return i.className = "md-editor-a11y-status", i.setAttribute("aria-live", "polite"), e.ownerDocument.body.appendChild(i), this._register({
      dispose: () => {
        i.remove(), ms(e, "aria-description", t), ms(e, "aria-keyshortcuts", s);
      }
    }), i;
  }
}
function ke(n) {
  throw new Error(`Unhandled keyboard action: ${JSON.stringify(n)}`);
}
function fs(n) {
  n.preventDefault(), n.stopPropagation();
}
function Ta(n, e) {
  return n.target !== e;
}
function Oa(n, e) {
  const t = new Set(n.blocks);
  let s = 0;
  for (const i of n.children) {
    if (t.has(i)) {
      const o = v.ofStartAndLength(s, i.length);
      if (o.contains(e) || o.endExclusive === e)
        return o;
    }
    s += i.length;
  }
}
function ms(n, e, t) {
  t === null ? n.removeAttribute(e) : n.setAttribute(e, t);
}
const Ra = 200;
class kl {
  constructor(e) {
    this._model = e, this._lastKnownText = e.sourceText.get().value;
  }
  _past = [];
  _future = [];
  /**
   * The source text as of the last change this strategy recorded or applied.
   * Any other value means the document was replaced behind its back, so the
   * stored edits no longer line up and must be discarded rather than applied.
   */
  _lastKnownText;
  record(e, t) {
    const s = this._model.sourceText.get().value;
    s !== this._lastKnownText && this._clear(s);
    const i = this._model.selection.get();
    e();
    const o = this._model.sourceText.get().value, r = this._model.selection.get();
    if (this._lastKnownText = o, s === o)
      return;
    const c = t?.apply(s) === o ? t : bs(s, o);
    this._past.push({
      undoEdit: c.inverse(s),
      redoEdit: c,
      beforeSelection: i,
      afterSelection: r
    }), this._past.length > Ra && this._past.shift(), this._future.length = 0;
  }
  undo() {
    const e = this._peekApplicable(this._past);
    e && this._apply(e.undoEdit, e.beforeSelection) && (this._past.pop(), this._future.push(e));
  }
  redo() {
    const e = this._peekApplicable(this._future);
    e && this._apply(e.redoEdit, e.afterSelection) && (this._future.pop(), this._past.push(e));
  }
  /** The entry on top of `stack`, or `undefined` when it cannot be applied. */
  _peekApplicable(e) {
    if (this._model.readonlyMode.get())
      return;
    const t = e.at(-1);
    if (!t)
      return;
    const s = this._model.sourceText.get().value;
    if (s !== this._lastKnownText) {
      this._clear(s);
      return;
    }
    return t;
  }
  _apply(e, t) {
    const s = e.apply(this._lastKnownText);
    return this._model.applyEdit(e, t), this._model.sourceText.get().value !== s ? !1 : (t === void 0 && this._model.selection.set(void 0, void 0), this._lastKnownText = s, !0);
  }
  _clear(e) {
    this._past.length = 0, this._future.length = 0, this._lastKnownText = e;
  }
}
const gs = "md-debug-show-line-rects";
function Na(n, e) {
  try {
    const t = localStorage.getItem(n);
    return t === null ? e : t === "true";
  } catch {
    return e;
  }
}
function Ia(n, e) {
  try {
    localStorage.setItem(n, String(e));
  } catch {
  }
}
class bl extends H {
  overlayElement;
  infoElement;
  rendering;
  /** Absolute source offsets that map to a rendered DOM character. */
  mappedOffsets;
  /** Whether the dashed line-bands and run boxes are drawn (persisted). */
  _showLineRects = x(this, Na(gs, !0));
  constructor(e, t) {
    super(), this.overlayElement = document.createElement("div"), this.overlayElement.className = "md-debug-layout-overlay", Object.assign(this.overlayElement.style, {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      pointerEvents: "none"
    }), this.infoElement = document.createElement("div"), this.infoElement.className = "md-debug-layout-info", Object.assign(this.infoElement.style, {
      fontFamily: "monospace",
      fontSize: "11px",
      padding: "8px 12px",
      background: "#111",
      color: "#fff",
      borderRadius: "4px",
      lineHeight: "1.4"
    });
    const s = document.createElement("label");
    Object.assign(s.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      marginBottom: "6px",
      cursor: "pointer",
      userSelect: "none"
    });
    const i = document.createElement("input");
    i.type = "checkbox", i.checked = this._showLineRects.get(), i.addEventListener("change", () => {
      this._showLineRects.set(i.checked, void 0), Ia(gs, i.checked);
    }), s.appendChild(i), s.appendChild(document.createTextNode("show line rects")), this.infoElement.appendChild(s);
    const o = document.createElement("pre");
    o.style.margin = "0", o.style.whiteSpace = "pre", this.infoElement.appendChild(o), this.rendering = I(this, (r) => {
      const c = r.readObservable(t.model.measurements), a = r.readObservable(this._showLineRects);
      return Ba(
        this.overlayElement,
        o,
        c,
        t.coordinateSpace,
        a,
        t.colorForOffset,
        t.hoveredOffset
      );
    }), this.mappedOffsets = I(this, (r) => r.readObservable(this.rendering).mappedOffsets), this._register(P((r) => {
      r.readObservable(this.rendering);
      const c = t.hoveredOffset ? r.readObservable(t.hoveredOffset) : void 0;
      t.hoveredOffset && Da(this.overlayElement, c);
    }));
  }
}
class Pa {
  constructor(e, t, s, i) {
    this.blockCount = e, this.mountedCount = t, this.lineCount = s, this.mappedOffsets = i;
  }
}
function Ba(n, e, t, s, i, o, r) {
  n.textContent = "";
  const c = s.capture();
  let a = 0, l = 0, d = 0;
  const u = /* @__PURE__ */ new Set();
  for (let m = 0; m < t.length; m++) {
    const g = t[m], _ = g.visualLineMap?.lines ?? [];
    if (g.isMeasured && a++, l += _.length, i)
      for (let p = 0; p < _.length; p++) {
        const w = _[p], E = w.rect, y = document.createElement("div");
        Object.assign(y.style, {
          position: "absolute",
          left: "0",
          right: "0",
          top: `${E.y}px`,
          height: `${E.height}px`,
          border: "1px dashed rgba(180, 0, 200, 0.45)",
          boxSizing: "border-box"
        }), n.appendChild(y);
        for (const L of w.runs) {
          const R = document.createElement("div");
          Object.assign(R.style, {
            position: "absolute",
            left: `${L.rect.x}px`,
            top: `${L.rect.y}px`,
            width: `${L.rect.width}px`,
            height: `${L.rect.height}px`,
            outline: "1px solid rgba(255, 100, 0, 0.45)",
            boxSizing: "border-box"
          }), n.appendChild(R);
        }
      }
    g.viewNode && (d += Aa(n, c, g.viewNode, g.absoluteStart, u, o, r));
  }
  const h = `blocks: ${t.length}   mounted: ${a}   lines: ${l}   chars: ${d}`, f = t.map((m, g) => {
    const _ = m.isMeasured ? "M" : "e", p = m.visualLineMap?.lines.length ?? 0;
    return `${String(g).padStart(2)} ${_} start=${String(m.absoluteStart).padStart(4)} h=${m.height.toFixed(1).padStart(6)} lines=${p} kind=${m.block.kind}`;
  });
  return e.textContent = [h, ...f].join(`
`), new Pa(t.length, a, l, u);
}
function Aa(n, e, t, s, i, o, r) {
  let c = 0;
  const a = document.createRange(), l = s + t.sourceLength, d = [];
  t.forEachTextLeaf(s, (h, f) => {
    d.push({ start: f, end: f + h.sourceLength });
  });
  const u = (h) => d.some((f) => h >= f.start && h < f.end);
  for (let h = s; h < l; h++) {
    if (!u(h))
      continue;
    const f = t.sourceToDom(h + 1, s);
    if (!f || f.offset < 1)
      continue;
    a.setStart(f.node, f.offset - 1), a.setEnd(f.node, f.offset);
    const m = a.getBoundingClientRect();
    if (m.height === 0)
      continue;
    const g = e.toLocalRect(m), _ = g.width === 0 ? 2 : g.width, p = document.createElement("div");
    Object.assign(p.style, {
      position: "absolute",
      left: `${g.x}px`,
      top: `${g.y}px`,
      width: `${_}px`,
      height: `${g.height}px`,
      background: o?.(h) ?? "rgba(0, 120, 220, 0.30)",
      boxSizing: "border-box",
      pointerEvents: "auto"
    });
    const w = f.node.data?.[f.offset - 1] ?? "";
    p.title = `offset ${h}: ${JSON.stringify(w)}`, p.dataset.offset = String(h), r ? (p.addEventListener("mouseenter", () => r.set(h, void 0)), p.addEventListener("mouseleave", () => r.set(void 0, void 0))) : (p.addEventListener("mouseenter", () => ps(n, p, !0)), p.addEventListener("mouseleave", () => ps(n, p, !1))), n.appendChild(p), i.add(h), c++;
  }
  return c;
}
function Da(n, e) {
  for (const t of Array.from(n.children)) {
    if (!t.style)
      continue;
    const s = t.dataset.offset, i = s !== void 0 && Number(s) === e;
    t.style.visibility = e === void 0 || i ? "" : "hidden";
  }
}
function ps(n, e, t) {
  for (const s of Array.from(n.children))
    s.style.visibility = t && s !== e ? "hidden" : "";
}
class Re {
  constructor(e, t) {
    this.length = e, this.className = t;
  }
}
class Fa {
  /**
   * @param _monaco The Monarch runtime ({@link IMonarchApi}), injected so this
   * package depends on `monaco-editor` for types only.
   * @param _grammars Maps a language id to its Monarch language definition.
   */
  constructor(e, t) {
    this._monaco = e, this._grammars = t;
  }
  _tokenizers = /* @__PURE__ */ new Map();
  create(e, t) {
    return new Va(this._tokenizerFor(e), t);
  }
  dispose() {
    for (const e of this._tokenizers.values())
      e.dispose();
    this._tokenizers.clear();
  }
  _tokenizerFor(e) {
    const t = this._grammars.get(e);
    if (t === void 0)
      return;
    let s = this._tokenizers.get(e);
    return s || (s = new this._monaco.MonarchTokenizer(Ka, za, e, this._monaco.compile(e, t), qa), this._tokenizers.set(e, s)), s;
  }
}
class Va {
  constructor(e, t) {
    this._tokenizer = e, this._initialState = e?.getInitialState(), this._text = t, this._lines = this._tokenizeFrom(0, [], this._initialState, t.split(`
`)), this._lineStarts = this._computeLineStarts(), this._snapshotObs = x("syntaxSnapshot", new _s(this, this._version));
  }
  _text;
  _lines;
  /** Source offset of each line's first char; `length === _lines.length`. */
  _lineStarts;
  _version = 1;
  _disposed = !1;
  _initialState;
  _snapshotObs;
  get snapshot() {
    return this._snapshotObs;
  }
  update(e, t) {
    if (this._disposed)
      throw new Error("document is disposed");
    if (e.isEmpty)
      return;
    const s = vs(this._lines), i = e.apply(this._text), o = e.replacements[0].replaceRange.start, r = this._lineIndexAt(o), c = this._lines.slice(0, r), a = r === 0 ? this._initialState : this._lines[r - 1].endState;
    this._text = i, this._lines = this._tokenizeFrom(r, c, a, i.split(`
`)), this._lineStarts = this._computeLineStarts(), this._version++;
    const l = Ha(s, vs(this._lines));
    this._snapshotObs.set(new _s(this, this._version), t, l);
  }
  dispose() {
    this._disposed = !0;
  }
  /**
   * Tokenize `allLines[fromLine..]`, keeping `reusedPrefix` (already tokenized
   * lines `[0, fromLine)`) verbatim. `startState` is the state entering
   * `fromLine`.
   */
  _tokenizeFrom(e, t, s, i) {
    const o = t.slice();
    let r = s;
    for (let c = e; c < i.length; c++) {
      const a = i[c], l = c < i.length - 1;
      if (this._tokenizer && r) {
        const d = this._tokenizer.tokenize(a, l, r);
        o.push({ text: a, tokens: Wa(d.tokens, a.length), endState: d.endState }), r = d.endState;
      } else
        o.push({ text: a, tokens: a.length === 0 ? [] : [new Re(a.length, void 0)], endState: r });
    }
    return o;
  }
  _computeLineStarts() {
    const e = [];
    let t = 0;
    for (const s of this._lines)
      e.push(t), t += s.text.length + 1;
    return e;
  }
  _lineIndexAt(e) {
    for (let t = this._lineStarts.length - 1; t >= 0; t--)
      if (e >= this._lineStarts[t])
        return t;
    return 0;
  }
  /** @internal Called by {@link MonacoHighlightedSnapshot}. */
  _getTokens(e, t) {
    if (e !== this._version)
      throw new Error("stale snapshot");
    const s = this._text.length, i = Math.max(0, Math.min(t.start, s)), o = Math.max(i, Math.min(t.endExclusive, s)), r = [];
    let c = i, a = i, l = !1, d = 0;
    const u = (h, f) => {
      const m = d, g = d + h;
      d = g, h !== 0 && m < o && g > i && (l || (c = m, l = !0), r.push(new Re(h, f)), a = g);
    };
    for (let h = 0; h < this._lines.length && d < o; h++) {
      for (const f of this._lines[h].tokens)
        u(f.length, f.className);
      h < this._lines.length - 1 && u(1, void 0);
    }
    return { range: new v(c, l ? a : i), tokens: r };
  }
}
class _s {
  constructor(e, t) {
    this._doc = e, this._version = t;
  }
  getTokens(e) {
    return this._doc._getTokens(this._version, e);
  }
}
function $a(n) {
  return n === "" ? void 0 : n;
}
function Wa(n, e) {
  if (n.length === 0)
    return e === 0 ? [] : [new Re(e, void 0)];
  const t = [];
  for (let s = 0; s < n.length; s++) {
    const i = n[s].offset, o = s + 1 < n.length ? n[s + 1].offset : e;
    o > i && t.push(new Re(o - i, $a(n[s].type)));
  }
  return t;
}
function vs(n) {
  const e = [];
  for (let t = 0; t < n.length; t++) {
    for (const s of n[t].tokens)
      e.push(s);
    t < n.length - 1 && e.push(new Re(1, void 0));
  }
  return e;
}
function ws(n, e) {
  return n.length === e.length && n.className === e.className;
}
function ks(n) {
  let e = 0;
  for (const t of n)
    e += t.length;
  return e;
}
function Ha(n, e) {
  const t = n.length, s = e.length;
  let i = 0, o = 0;
  for (; i < t && i < s && ws(n[i], e[i]); )
    o += n[i].length, i++;
  let r = 0, c = 0;
  for (; r < t - i && r < s - i && ws(n[t - 1 - r], e[s - 1 - r]); )
    c += n[t - 1 - r].length, r++;
  const a = ks(n), l = ks(e), d = new v(o, a - c), u = l - c - o;
  return d.isEmpty && u === 0 ? be.empty : be.replace(d, u);
}
const Ka = {
  languageIdCodec: { encodeLanguageId: () => 0, decodeLanguageId: () => "" },
  isRegisteredLanguageId: () => !1,
  getLanguageIdByLanguageName: () => null,
  getLanguageIdByMimeType: () => null,
  requestBasicLanguageFeatures: () => {
  }
}, za = {
  getColorTheme: () => ({ tokenTheme: {} })
}, qa = {
  getValue: () => 2e4,
  onDidChangeConfiguration: () => ({ dispose() {
  } })
};
function yl(n, e) {
  const t = /* @__PURE__ */ new Map([
    ["typescript", e.typescript],
    ["ts", e.typescript],
    ["javascript", e.javascript],
    ["js", e.javascript],
    ["css", e.css],
    ["html", e.html],
    ["python", e.python],
    ["py", e.python],
    ["rust", e.rust],
    ["rs", e.rust],
    ["shell", e.shell],
    ["sh", e.shell],
    ["bash", e.shell],
    ["yaml", e.yaml],
    ["yml", e.yaml]
  ]);
  return new Fa(n, t);
}
function gi(n) {
  const e = document.createElement("span");
  return e.className = `codicon codicon-${n}`, e.setAttribute("aria-hidden", "true"), e;
}
const Ua = 165, Xa = 400, Ga = 33;
class Ya extends H {
  constructor(e) {
    super(), this._options = e, this.element = document.createElement("div"), this.element.className = "md-comment-input", this._textarea = document.createElement("textarea"), this._textarea.className = "md-comment-input-textarea", this._textarea.rows = 1, this._textarea.placeholder = e?.placeholder ?? "Add comment", this._textarea.setAttribute("aria-label", this._textarea.placeholder), this.element.appendChild(this._textarea), this._measure = document.createElement("span"), this._measure.className = "md-comment-input-measure", this._measure.setAttribute("aria-hidden", "true"), this.element.appendChild(this._measure), this._submitButton = document.createElement("button"), this._submitButton.type = "button", this._submitButton.className = "md-comment-input-submit", this._submitButton.title = "Add comment", this._submitButton.setAttribute("aria-label", "Add comment"), this._submitButton.appendChild(gi("add")), this.element.appendChild(this._submitButton);
    const t = (r) => {
      r.stopPropagation(), !(r.target === this._textarea || this._submitButton.contains(r.target)) && (r.preventDefault(), this._textarea.focus());
    };
    this.element.addEventListener("pointerdown", t), this._register({ dispose: () => this.element.removeEventListener("pointerdown", t) });
    const s = () => {
      this._value.set(this._textarea.value, void 0), this._autoSize();
    };
    this._textarea.addEventListener("input", s), this._register({ dispose: () => this._textarea.removeEventListener("input", s) });
    const i = (r) => {
      if (r.stopPropagation(), r.key === "Escape") {
        r.preventDefault(), this._options?.onCancel?.();
        return;
      }
      r.key === "Enter" && !r.shiftKey && (r.preventDefault(), this._submit());
    };
    this._textarea.addEventListener("keydown", i), this._register({ dispose: () => this._textarea.removeEventListener("keydown", i) });
    const o = () => this._submit();
    this._submitButton.addEventListener("click", o), this._register({ dispose: () => this._submitButton.removeEventListener("click", o) }), this._register(P((r) => {
      const c = this._value.read(r).trim().length > 0;
      this._submitButton.disabled = !c, this.element.classList.toggle("md-comment-input-empty", !c);
    })), this._autoSize();
  }
  element;
  _textarea;
  _measure;
  _submitButton;
  _value = x(this, "");
  /** Live, untrimmed textarea content. */
  get value() {
    return this._value;
  }
  /** The raw textarea, exposed so a host can move focus into it. */
  get inputElement() {
    return this._textarea;
  }
  focus() {
    this._textarea.focus();
    const e = this._textarea.value.length;
    this._textarea.setSelectionRange(e, e);
  }
  setText(e) {
    this._textarea.value = e, this._value.set(e, void 0), this._autoSize();
  }
  clear() {
    this.setText("");
  }
  _submit() {
    const e = this._textarea.value.trim();
    e && this._options?.onSubmit?.(e);
  }
  _autoSize() {
    this._measure.textContent = this._textarea.value || this._textarea.placeholder;
    const e = this._measure.scrollWidth + Ga;
    this.element.style.width = `${Math.min(Math.max(Ua, e), Xa)}px`, this._textarea.style.height = "auto";
    const t = this._textarea.scrollHeight;
    t > 0 && (this._textarea.style.height = `${Math.min(t, 160)}px`, this._textarea.style.overflowY = t > 160 ? "auto" : "hidden"), this._options?.onDidChangeSize?.();
  }
}
class pi extends H {
  constructor(e, t, s) {
    super(), this._model = e, this._view = t, this._options = s, this._gap = s?.gap ?? 8, this._widget = this._register(new Ya({
      onDidChangeSize: () => {
        this._visible && this._layoutHorizontally();
      },
      onSubmit: (d) => this._submit(d),
      onCancel: () => this._hideAndRefocus()
    }));
    const i = this._widget.element;
    i.style.position = "absolute", i.style.zIndex = "20", i.style.display = "none", this._view.overlayContainer.appendChild(i), this._register({ dispose: () => i.remove() }), this._register({ dispose: () => this._view.element.classList.remove("md-comment-active") });
    const o = new ResizeObserver(() => {
      this._visible && this._layoutHorizontally();
    });
    o.observe(i), o.observe(this._view.overlayContainer), this._register({ dispose: () => o.disconnect() }), this._register(P((d) => this._update(d)));
    const r = this._view.element.ownerDocument, c = () => {
      this._view.element.classList.add("md-comment-active");
    };
    this._widget.inputElement.addEventListener("focus", c), this._register({ dispose: () => this._widget.inputElement.removeEventListener("focus", c) });
    const a = () => {
      this._view.element.classList.remove("md-comment-active"), r.defaultView?.setTimeout(() => this._autoHide(), 0);
    };
    this._widget.inputElement.addEventListener("blur", a), this._register({ dispose: () => this._widget.inputElement.removeEventListener("blur", a) });
    const l = (d) => {
      d.key !== "Tab" || d.shiftKey || d.ctrlKey || d.metaKey || d.altKey || !this._visible || this._widgetHasFocus() || (d.preventDefault(), this._widget.focus());
    };
    this._view.element.addEventListener("keydown", l), this._register({ dispose: () => this._view.element.removeEventListener("keydown", l) });
  }
  static _isCommentableSelectionSource(e) {
    switch (e) {
      case "user":
        return !0;
      case "find":
        return !1;
      default:
        return Qa(e);
    }
  }
  _widget;
  _gap;
  _visible = !1;
  _anchorX = 0;
  _pinnedRange;
  /**
   * The range a comment was just submitted for. The box stays hidden for it
   * until the selection changes, so submitting doesn't immediately re-summon an
   * empty box on the still-selected text.
   */
  _submittedRange;
  _update(e) {
    const t = this._model.readonlyMode.read(e), s = this._model.selection.read(e), i = this._model.selectionSource.read(e), o = this._view.caretRect.read(e), r = this._model.isSelecting.read(e), c = this._widget.value.read(e).trim().length > 0;
    if (!t) {
      this._hide();
      return;
    }
    if (!pi._isCommentableSelectionSource(i)) {
      this._autoHide();
      return;
    }
    if (!(this._visible && (c || this._widgetHasFocus()))) {
      if (r) {
        this._autoHide();
        return;
      }
      if (!s || s.isCollapsed || !o) {
        this._autoHide();
        return;
      }
      if (this._submittedRange?.equals(s.range)) {
        this._autoHide();
        return;
      }
      this._submittedRange = void 0, this._pinnedRange = s.range, this._show(
        o,
        /* preferAbove */
        !s.isForward
      );
    }
  }
  _show(e, t) {
    const s = this._widget.element;
    s.style.display = "", this._visible = !0;
    const i = s.offsetHeight, o = this._getViewportRect(), r = this._view.coordinateSpace.capture(), c = r.toClientRect(e), a = r.toClientRect(C.fromPointSize(0, 0, 0, i)).height, l = r.toClientRect(C.fromPointSize(0, 0, 0, this._gap)).height, d = c.top, h = c.bottom + l + a <= o.bottom, f = d - l - a >= o.top, g = (t ? f || !h : !h && f) ? e.y - this._gap - i : e.y + e.height + this._gap;
    this._anchorX = e.x, this._layoutHorizontally(), s.style.top = `${g}px`;
  }
  _layoutHorizontally() {
    const e = this._widget.element, t = this._view.overlayContainer.clientWidth;
    e.style.maxWidth = `${Math.max(0, t - this._gap)}px`;
    const s = Math.max(0, t - e.offsetWidth - this._gap);
    e.style.left = `${Math.min(Math.max(0, this._anchorX), s)}px`;
  }
  /** Force-hide and clear the box (used by Escape and submit). */
  _hide() {
    this._visible && (this._visible = !1, this._pinnedRange = void 0, this._widget.clear(), this._widget.element.style.display = "none", this._view.element.classList.remove("md-comment-active"));
  }
  /**
   * Hide unless the user is engaged with the box: it has focus or holds a
   * non-empty draft. This preserves in-progress text and keeps a focused box
   * open (it is dismissed explicitly via Escape/submit, or by blurring it).
   */
  _autoHide() {
    this._widgetHasFocus() || this._widget.value.get().trim().length > 0 || this._hide();
  }
  _widgetHasFocus() {
    const e = this._view.element.ownerDocument.activeElement;
    return e !== null && this._widget.element.contains(e);
  }
  /**
   * The visible viewport (client coords) used for the flip-above decision: the
   * nearest scrollable ancestor of the editor. `.md-editor` itself spans the
   * full document height and never clips, so measuring against it would always
   * report room below. Falls back to the window when nothing scrolls.
   */
  _getViewportRect() {
    const e = this._view.element.ownerDocument.defaultView;
    let t = this._view.element;
    for (; t; ) {
      const s = e?.getComputedStyle(t).overflowY;
      if ((s === "auto" || s === "scroll") && t.scrollHeight > t.clientHeight) {
        const i = t.getBoundingClientRect();
        return { top: i.top, bottom: i.bottom };
      }
      t = t.parentElement;
    }
    return { top: 0, bottom: e?.innerHeight ?? 0 };
  }
  _hideAndRefocus() {
    this._hide(), this._view.focus();
  }
  _submit(e) {
    const t = this._pinnedRange;
    this._submittedRange = t, this._hideAndRefocus(), t && this._options?.onSubmit?.({ text: e, range: t });
  }
}
function Qa(n) {
  throw new Error(`Unhandled selection source: ${JSON.stringify(n)}`);
}
class ja {
  _domNode;
  _disposables = [];
  get element() {
    return this._domNode;
  }
  constructor(e) {
    this._domNode = document.createElement("div"), this._domNode.className = "md-comment-widget";
    const t = document.createElement("span");
    if (t.className = "md-comment-widget-text", t.textContent = e.body, this._domNode.appendChild(t), e.onDelete) {
      const s = document.createElement("button");
      s.type = "button", s.className = "md-comment-widget-delete", s.title = "Delete comment", s.setAttribute("aria-label", "Delete comment"), s.appendChild(gi("trash"));
      const i = (o) => {
        o.preventDefault(), o.stopPropagation(), e.onDelete?.();
      };
      s.addEventListener("click", i), this._disposables.push(() => s.removeEventListener("click", i)), this._domNode.appendChild(s);
    }
  }
  dispose() {
    for (const e of this._disposables)
      e();
    this._domNode.remove();
  }
}
class xl {
  _comments = x(this, []);
  /** Monotonic counter for ids of comments created via {@link create}. */
  _sequence = 0;
  /** The current comments, in insertion order. */
  get comments() {
    return this._comments;
  }
  /** Replace the whole comment set. */
  set(e) {
    this._comments.set(e, void 0);
  }
  /**
   * Create a comment from a user submission and append it, generating its `id`
   * and `createdAt` here so id/time allocation stays the store's concern (the
   * UI only supplies the range and text). Returns the created comment.
   */
  create(e) {
    const t = {
      id: `comment-${++this._sequence}`,
      range: e.range,
      body: e.body,
      author: e.author,
      createdAt: Date.now()
    };
    return this.add(t), t;
  }
  /** Append a comment. */
  add(e) {
    this._comments.set([...this._comments.get(), e], void 0);
  }
  /** Remove a comment by id. */
  remove(e) {
    this._comments.set(this._comments.get().filter((t) => t.id !== e), void 0);
  }
}
const Za = 12, Ja = 8;
function el(n, e) {
  const t = n.element, s = n.overlayContainer, i = t.clientWidth - Ja - s.offsetLeft, o = [];
  for (const c of e) {
    if (c.element.style.setProperty("--md-comment-available-width", `${Math.max(0, i)}px`), c.rects.length === 0) {
      c.element.style.visibility = "hidden";
      continue;
    }
    c.element.style.visibility = "", o.push({ element: c.element, y: Math.min(...c.rects.map((a) => a.y)) });
  }
  o.sort((c, a) => c.y - a.y);
  let r = -1 / 0;
  for (const c of o) {
    const a = Math.max(c.y, r + Za), l = i - c.element.offsetWidth;
    c.element.style.left = `${l}px`, c.element.style.top = `${a}px`, r = a + c.element.offsetHeight;
  }
}
class El extends H {
  constructor(e, t) {
    super(), this._model = e, this._view = t, this._layer = document.createElement("div"), this._layer.className = "md-comments-layer", this._layer.style.position = "absolute", this._layer.style.inset = "0", this._layer.style.pointerEvents = "none", this._layer.style.overflow = "visible", this._layer.style.background = "transparent", this._view.overlayContainer.appendChild(this._layer), this._register({
      dispose: () => {
        for (const i of this._entries.values())
          i.widget.dispose();
        this._entries.clear(), this._layer.remove();
      }
    }), this._register(P((i) => {
      const o = this._model.comments.read(i);
      this._reconcile(o);
      for (const r of o)
        this._entries.get(r.id).rects.read(i);
      this._relayout();
    }));
    const s = new ResizeObserver(() => this._relayout());
    s.observe(this._view.element), this._register({ dispose: () => s.disconnect() });
  }
  _layer;
  _entries = /* @__PURE__ */ new Map();
  _order = [];
  _pendingRevealCommentId;
  revealComment(e) {
    this._pendingRevealCommentId = e, this._revealPendingComment();
  }
  _reconcile(e) {
    this._order = e.map((s) => s.id);
    const t = new Set(this._order);
    for (const s of e) {
      if (this._entries.has(s.id))
        continue;
      const i = new ja({
        body: s.body,
        onDelete: () => this._model.remove(s.id)
      });
      i.element.style.position = "absolute", i.element.style.pointerEvents = "auto", this._layer.appendChild(i.element), this._entries.set(s.id, {
        widget: i,
        rects: this._view.rangeRects(s.range)
      });
    }
    for (const [s, i] of this._entries)
      t.has(s) || (i.widget.dispose(), this._entries.delete(s));
  }
  _relayout() {
    const e = this._order.map((t) => this._entries.get(t)).filter((t) => t !== void 0).map((t) => ({ element: t.widget.element, rects: t.rects.get() }));
    el(this._view, e), this._revealPendingComment();
  }
  _revealPendingComment() {
    const e = this._pendingRevealCommentId;
    if (!e)
      return;
    const t = this._entries.get(e)?.widget.element;
    !t || t.style.visibility === "hidden" || (this._pendingRevealCommentId = void 0, t.scrollIntoView({ block: "center", inline: "nearest" }));
  }
}
export {
  X as AstNode,
  pl as AsyncClipboardStrategy,
  xe as BlockQuoteAstNode,
  T as BlockViewNode,
  j as CodeBlockAstNode,
  tn as CodeBlockViewNode,
  Ya as CommentInputWidget,
  pi as CommentModeController,
  ja as CommentWidget,
  xl as CommentsModel,
  El as CommentsView,
  O as CursorPosition,
  Wc as CursorView,
  ze as CursorViewRendering,
  Be as DEFAULT_INDENTATION_CONFIG,
  vi as DEFAULT_WORD_NAVIGATION_CONFIG,
  Ll as DEFAULT_WORD_SEPARATORS,
  Ut as DocumentAstNode,
  sn as DocumentViewNode,
  wl as EditorController,
  dt as EditorCoordinateSpace,
  qr as EditorCoordinateTransform,
  ml as EditorModel,
  gl as EditorView,
  Ht as EmphasisAstNode,
  ca as FIND_MATCH_LIMIT,
  va as FindController,
  ia as FindHighlightsView,
  ua as FindModel,
  nt as FindPattern,
  _a as FindWidget,
  ye as FrontMatterAstNode,
  $ as GlueAstNode,
  he as HeadingAstNode,
  Ie as ImageAstNode,
  zt as InlineCodeAstNode,
  qt as InlineMathAstNode,
  be as LengthEdit,
  $t as LengthReplacement,
  Ne as LinkAstNode,
  z as ListAstNode,
  q as ListItemAstNode,
  kl as LocalHistoryStrategy,
  Yi as MarkdownParser,
  b as MarkerAstNode,
  _e as MathBlockAstNode,
  Pa as MeasuredLayoutDebugRendering,
  bl as MeasuredLayoutDebugView,
  wo as MeasuredLayoutModel,
  Fa as MonacoSyntaxHighlighter,
  ba as NativeClipboardStrategy,
  v as OffsetRange,
  ie as ParagraphAstNode,
  ne as Point2D,
  C as Rect2D,
  Oe as RichLink,
  k as Selection,
  Ic as SelectionView,
  qn as SelectionViewRendering,
  Kt as StrikethroughAstNode,
  S as StringEdit,
  le as StringReplacement,
  cn as StringValue,
  Wt as StrongAstNode,
  Ee as TableAstNode,
  Te as TableCellAstNode,
  Me as TableRowAstNode,
  Qe as TextAstNode,
  ge as ThematicBreakAstNode,
  Re as Token,
  oe as ViewNode,
  Ni as VirtualCursorLine,
  ot as VisualLine,
  Pe as VisualLineMap,
  me as VisualRun,
  St as blocksIntersecting,
  Ft as commands,
  yl as createDefaultMonacoSyntaxHighlighter,
  Po as cursorDocumentEnd,
  Io as cursorDocumentStart,
  Do as cursorDown,
  Mo as cursorLeft,
  Mt as cursorLineEnd,
  Lt as cursorLineStart,
  Oo as cursorMoveLeft,
  To as cursorMoveRight,
  Lo as cursorRight,
  fn as cursorUp,
  Ao as cursorVisualLineEnd,
  Bo as cursorVisualLineStart,
  No as cursorWordLeft,
  Ro as cursorWordRight,
  mn as deleteLeft,
  qo as deleteLineLeft,
  Uo as deleteLineRight,
  Ho as deleteRight,
  Ko as deleteWordLeft,
  zo as deleteWordRight,
  fi as escapeFindRegex,
  Gt as findBlockAtOffset,
  U as findNodeOffsetById,
  xs as findWordAt,
  wi as findWordBoundaryLeft,
  ki as findWordBoundaryRight,
  bi as findWordDeleteBoundaryLeft,
  yi as findWordDeleteBoundaryRight,
  Qi as getAnnotatedSource,
  Ns as hiddenCursorRanges,
  Zo as insertHardLineBreak,
  jo as insertLineBreak,
  Qo as insertParagraph,
  Jo as insertSmartEnter,
  Yo as insertTab,
  Xo as insertText,
  Ce as nextCursorPosition,
  ce as normalizeCursorPosition,
  Ps as outdent,
  pr as selectAll,
  vr as selectBlock,
  _r as selectWord,
  Ai as taskCheckboxRange,
  fl as visualizeAst,
  vl as vscodeHostKeyboardProfile,
  Dt as vscodeKeyboardProfile,
  _l as vscodeLocalKeyboardProfile
};
//# sourceMappingURL=index.js.map
