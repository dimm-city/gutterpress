import { S as Ur, O as Jr } from "./stringEdit-CVDbCUBY.js";
var Lt;
function S(e, t, n) {
  function r(c, a) {
    if (c._zod || Object.defineProperty(c, "_zod", {
      value: {
        def: a,
        constr: i,
        traits: /* @__PURE__ */ new Set()
      },
      enumerable: !1
    }), c._zod.traits.has(e))
      return;
    c._zod.traits.add(e), t(c, a);
    const u = i.prototype, d = Object.keys(u);
    for (let l = 0; l < d.length; l++) {
      const f = d[l];
      f in c || (c[f] = u[f].bind(c));
    }
  }
  const o = n?.Parent ?? Object;
  class s extends o {
  }
  Object.defineProperty(s, "name", { value: e });
  function i(c) {
    var a;
    const u = n?.Parent ? new s() : this;
    r(u, c), (a = u._zod).deferred ?? (a.deferred = []);
    for (const d of u._zod.deferred)
      d();
    return u;
  }
  return Object.defineProperty(i, "init", { value: r }), Object.defineProperty(i, Symbol.hasInstance, {
    value: (c) => n?.Parent && c instanceof n.Parent ? !0 : c?._zod?.traits?.has(e)
  }), Object.defineProperty(i, "name", { value: e }), i;
}
let Ze = class extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
};
(Lt = globalThis).__zod_globalConfig ?? (Lt.__zod_globalConfig = {});
const qr = globalThis.__zod_globalConfig;
function le(e) {
  return qr;
}
function Mn(e) {
  const t = Object.values(e).filter((r) => typeof r == "number");
  return Object.entries(e).filter(([r, o]) => t.indexOf(+r) === -1).map(([r, o]) => o);
}
function Vr(e, t) {
  return typeof t == "bigint" ? t.toString() : t;
}
function Wr(e) {
  return {
    get value() {
      {
        const t = e();
        return Object.defineProperty(this, "value", { value: t }), t;
      }
    }
  };
}
function xn(e) {
  const t = e.startsWith("^") ? 1 : 0, n = e.endsWith("$") ? e.length - 1 : e.length;
  return e.slice(t, n);
}
const Ut = /* @__PURE__ */ Symbol("evaluating");
function Q(e, t, n) {
  let r;
  Object.defineProperty(e, t, {
    get() {
      if (r !== Ut)
        return r === void 0 && (r = Ut, r = n()), r;
    },
    set(o) {
      Object.defineProperty(e, t, {
        value: o
        // configurable: true,
      });
    },
    configurable: !0
  });
}
const Dn = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {
};
function mt(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
function Hr(e) {
  if (mt(e) === !1)
    return !1;
  const t = e.constructor;
  if (t === void 0 || typeof t != "function")
    return !0;
  const n = t.prototype;
  return !(mt(n) === !1 || Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") === !1);
}
const Kr = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function _t(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Br(e, t, n) {
  const r = new e._zod.constr(t ?? e._zod.def);
  return (!t || n?.parent) && (r._zod.parent = e), r;
}
function L(e) {
  const t = e;
  if (!t)
    return {};
  if (typeof t == "string")
    return { error: () => t };
  if (t?.message !== void 0) {
    if (t?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    t.error = t.message;
  }
  return delete t.message, typeof t.error == "string" ? { ...t, error: () => t.error } : t;
}
function Gr(e) {
  return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
const Yr = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function Ee(e, t = 0) {
  if (e.aborted === !0)
    return !0;
  for (let n = t; n < e.issues.length; n++)
    if (e.issues[n]?.continue !== !0)
      return !0;
  return !1;
}
function Xr(e, t = 0) {
  if (e.aborted === !0)
    return !0;
  for (let n = t; n < e.issues.length; n++)
    if (e.issues[n]?.continue === !1)
      return !0;
  return !1;
}
function ge(e, t) {
  return t.map((n) => {
    var r;
    return (r = n).path ?? (r.path = []), n.path.unshift(e), n;
  });
}
function Me(e) {
  return typeof e == "string" ? e : e?.message;
}
function fe(e, t, n) {
  const r = e.message ? e.message : Me(e.inst?._zod.def?.error?.(e)) ?? Me(t?.error?.(e)) ?? Me(n.customError?.(e)) ?? Me(n.localeError?.(e)) ?? "Invalid input", { inst: o, continue: s, input: i, ...c } = e;
  return c.path ?? (c.path = []), c.message = r, t?.reportInput && (c.input = i), c;
}
const Fn = (e, t) => {
  e.name = "$ZodError", Object.defineProperty(e, "_zod", {
    value: e._zod,
    enumerable: !1
  }), Object.defineProperty(e, "issues", {
    value: t,
    enumerable: !1
  }), e.message = JSON.stringify(t, Vr, 2), Object.defineProperty(e, "toString", {
    value: () => e.message,
    enumerable: !1
  });
}, Qr = S("$ZodError", Fn), Qe = S("$ZodError", Fn, { Parent: Error }), eo = (e) => (t, n, r, o) => {
  const s = r ? { ...r, async: !1 } : { async: !1 }, i = t._zod.run({ value: n, issues: [] }, s);
  if (i instanceof Promise)
    throw new Ze();
  if (i.issues.length) {
    const c = new (o?.Err ?? e)(i.issues.map((a) => fe(a, s, le())));
    throw Dn(c, o?.callee), c;
  }
  return i.value;
}, to = /* @__PURE__ */ eo(Qe), no = (e) => async (t, n, r, o) => {
  const s = r ? { ...r, async: !0 } : { async: !0 };
  let i = t._zod.run({ value: n, issues: [] }, s);
  if (i instanceof Promise && (i = await i), i.issues.length) {
    const c = new (o?.Err ?? e)(i.issues.map((a) => fe(a, s, le())));
    throw Dn(c, o?.callee), c;
  }
  return i.value;
}, ro = /* @__PURE__ */ no(Qe), oo = (e) => (t, n, r) => {
  const o = r ? { ...r, async: !1 } : { async: !1 }, s = t._zod.run({ value: n, issues: [] }, o);
  if (s instanceof Promise)
    throw new Ze();
  return s.issues.length ? {
    success: !1,
    error: new (e ?? Qr)(s.issues.map((i) => fe(i, o, le())))
  } : { success: !0, data: s.value };
}, Y = /* @__PURE__ */ oo(Qe), io = (e) => async (t, n, r) => {
  const o = r ? { ...r, async: !0 } : { async: !0 };
  let s = t._zod.run({ value: n, issues: [] }, o);
  return s instanceof Promise && (s = await s), s.issues.length ? {
    success: !1,
    error: new e(s.issues.map((i) => fe(i, o, le())))
  } : { success: !0, data: s.value };
}, Ln = /* @__PURE__ */ io(Qe), so = (e) => {
  const t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
  return new RegExp(`^${t}$`);
}, co = /^-?\d+$/, Un = /^-?\d+(?:\.\d+)?$/, ao = /^(?:true|false)$/i, Jn = /* @__PURE__ */ S("$ZodCheck", (e, t) => {
  var n;
  e._zod ?? (e._zod = {}), e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), uo = {
  number: "number",
  bigint: "bigint",
  object: "date"
}, qn = /* @__PURE__ */ S("$ZodCheckGreaterThan", (e, t) => {
  Jn.init(e, t);
  const n = uo[typeof t.value];
  e._zod.onattach.push((r) => {
    const o = r._zod.bag, s = (t.inclusive ? o.minimum : o.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    t.value > s && (t.inclusive ? o.minimum = t.value : o.exclusiveMinimum = t.value);
  }), e._zod.check = (r) => {
    (t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
      origin: n,
      code: "too_small",
      minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
      input: r.value,
      inclusive: t.inclusive,
      inst: e,
      continue: !t.abort
    });
  };
}), lo = /* @__PURE__ */ S("$ZodCheckNumberFormat", (e, t) => {
  Jn.init(e, t), t.format = t.format || "float64";
  const n = t.format?.includes("int"), r = n ? "int" : "number", [o, s] = Yr[t.format];
  e._zod.onattach.push((i) => {
    const c = i._zod.bag;
    c.format = t.format, c.minimum = o, c.maximum = s, n && (c.pattern = co);
  }), e._zod.check = (i) => {
    const c = i.value;
    if (n) {
      if (!Number.isInteger(c)) {
        i.issues.push({
          expected: r,
          format: t.format,
          code: "invalid_type",
          continue: !1,
          input: c,
          inst: e
        });
        return;
      }
      if (!Number.isSafeInteger(c)) {
        c > 0 ? i.issues.push({
          input: c,
          code: "too_big",
          maximum: Number.MAX_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          inclusive: !0,
          continue: !t.abort
        }) : i.issues.push({
          input: c,
          code: "too_small",
          minimum: Number.MIN_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          inclusive: !0,
          continue: !t.abort
        });
        return;
      }
    }
    c < o && i.issues.push({
      origin: "number",
      input: c,
      code: "too_small",
      minimum: o,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    }), c > s && i.issues.push({
      origin: "number",
      input: c,
      code: "too_big",
      maximum: s,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    });
  };
}), fo = {
  major: 4,
  minor: 4,
  patch: 3
}, V = /* @__PURE__ */ S("$ZodType", (e, t) => {
  var n;
  e ?? (e = {}), e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = fo;
  const r = [...e._zod.def.checks ?? []];
  e._zod.traits.has("$ZodCheck") && r.unshift(e);
  for (const o of r)
    for (const s of o._zod.onattach)
      s(e);
  if (r.length === 0)
    (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
      e._zod.run = e._zod.parse;
    });
  else {
    const o = (i, c, a) => {
      let u = Ee(i), d;
      for (const l of c) {
        if (l._zod.def.when) {
          if (Xr(i) || !l._zod.def.when(i))
            continue;
        } else if (u)
          continue;
        const f = i.issues.length, p = l._zod.check(i);
        if (p instanceof Promise && a?.async === !1)
          throw new Ze();
        if (d || p instanceof Promise)
          d = (d ?? Promise.resolve()).then(async () => {
            await p, i.issues.length !== f && (u || (u = Ee(i, f)));
          });
        else {
          if (i.issues.length === f)
            continue;
          u || (u = Ee(i, f));
        }
      }
      return d ? d.then(() => i) : i;
    }, s = (i, c, a) => {
      if (Ee(i))
        return i.aborted = !0, i;
      const u = o(c, r, a);
      if (u instanceof Promise) {
        if (a.async === !1)
          throw new Ze();
        return u.then((d) => e._zod.parse(d, a));
      }
      return e._zod.parse(u, a);
    };
    e._zod.run = (i, c) => {
      if (c.skipChecks)
        return e._zod.parse(i, c);
      if (c.direction === "backward") {
        const u = e._zod.parse({ value: i.value, issues: [] }, { ...c, skipChecks: !0 });
        return u instanceof Promise ? u.then((d) => s(d, i, c)) : s(u, i, c);
      }
      const a = e._zod.parse(i, c);
      if (a instanceof Promise) {
        if (c.async === !1)
          throw new Ze();
        return a.then((u) => o(u, r, c));
      }
      return o(a, r, c);
    };
  }
  Q(e, "~standard", () => ({
    validate: (o) => {
      try {
        const s = Y(e, o);
        return s.success ? { value: s.data } : { issues: s.error?.issues };
      } catch {
        return Ln(e, o).then((i) => i.success ? { value: i.data } : { issues: i.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
}), ho = /* @__PURE__ */ S("$ZodString", (e, t) => {
  V.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? so(e._zod.bag), e._zod.parse = (n, r) => {
    if (t.coerce)
      try {
        n.value = String(n.value);
      } catch {
      }
    return typeof n.value == "string" || n.issues.push({
      expected: "string",
      code: "invalid_type",
      input: n.value,
      inst: e
    }), n;
  };
}), Vn = /* @__PURE__ */ S("$ZodNumber", (e, t) => {
  V.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? Un, e._zod.parse = (n, r) => {
    if (t.coerce)
      try {
        n.value = Number(n.value);
      } catch {
      }
    const o = n.value;
    if (typeof o == "number" && !Number.isNaN(o) && Number.isFinite(o))
      return n;
    const s = typeof o == "number" ? Number.isNaN(o) ? "NaN" : Number.isFinite(o) ? void 0 : "Infinity" : void 0;
    return n.issues.push({
      expected: "number",
      code: "invalid_type",
      input: o,
      inst: e,
      ...s ? { received: s } : {}
    }), n;
  };
}), po = /* @__PURE__ */ S("$ZodNumberFormat", (e, t) => {
  lo.init(e, t), Vn.init(e, t);
}), mo = /* @__PURE__ */ S("$ZodBoolean", (e, t) => {
  V.init(e, t), e._zod.pattern = ao, e._zod.parse = (n, r) => {
    if (t.coerce)
      try {
        n.value = !!n.value;
      } catch {
      }
    const o = n.value;
    return typeof o == "boolean" || n.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input: o,
      inst: e
    }), n;
  };
}), _o = /* @__PURE__ */ S("$ZodUnknown", (e, t) => {
  V.init(e, t), e._zod.parse = (n) => n;
}), go = /* @__PURE__ */ S("$ZodVoid", (e, t) => {
  V.init(e, t), e._zod.parse = (n, r) => {
    const o = n.value;
    return typeof o > "u" || n.issues.push({
      expected: "void",
      code: "invalid_type",
      input: o,
      inst: e
    }), n;
  };
});
function Jt(e, t, n) {
  e.issues.length && t.issues.push(...ge(n, e.issues)), t.value[n] = e.value;
}
const vo = /* @__PURE__ */ S("$ZodArray", (e, t) => {
  V.init(e, t), e._zod.parse = (n, r) => {
    const o = n.value;
    if (!Array.isArray(o))
      return n.issues.push({
        expected: "array",
        code: "invalid_type",
        input: o,
        inst: e
      }), n;
    n.value = Array(o.length);
    const s = [];
    for (let i = 0; i < o.length; i++) {
      const c = o[i], a = t.element._zod.run({
        value: c,
        issues: []
      }, r);
      a instanceof Promise ? s.push(a.then((u) => Jt(u, n, i))) : Jt(a, n, i);
    }
    return s.length ? Promise.all(s).then(() => n) : n;
  };
});
function Ve(e, t, n, r, o, s) {
  const i = n in r;
  if (e.issues.length) {
    if (o && s && !i)
      return;
    t.issues.push(...ge(n, e.issues));
  }
  if (!i && !o) {
    e.issues.length || t.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: void 0,
      path: [n]
    });
    return;
  }
  e.value === void 0 ? i && (t.value[n] = void 0) : t.value[n] = e.value;
}
function yo(e) {
  const t = Object.keys(e.shape);
  for (const r of t)
    if (!e.shape?.[r]?._zod?.traits?.has("$ZodType"))
      throw new Error(`Invalid element at key "${r}": expected a Zod schema`);
  const n = Gr(e.shape);
  return {
    ...e,
    keys: t,
    keySet: new Set(t),
    numKeys: t.length,
    optionalKeys: new Set(n)
  };
}
function bo(e, t, n, r, o, s) {
  const i = [], c = o.keySet, a = o.catchall._zod, u = a.def.type, d = a.optin === "optional", l = a.optout === "optional";
  for (const f in t) {
    if (f === "__proto__" || c.has(f))
      continue;
    if (u === "never") {
      i.push(f);
      continue;
    }
    const p = a.run({ value: t[f], issues: [] }, r);
    p instanceof Promise ? e.push(p.then((v) => Ve(v, n, f, t, d, l))) : Ve(p, n, f, t, d, l);
  }
  return i.length && n.issues.push({
    code: "unrecognized_keys",
    keys: i,
    input: t,
    inst: s
  }), e.length ? Promise.all(e).then(() => n) : n;
}
const wo = /* @__PURE__ */ S("$ZodObject", (e, t) => {
  if (V.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
    const c = t.shape;
    Object.defineProperty(t, "shape", {
      get: () => {
        const a = { ...c };
        return Object.defineProperty(t, "shape", {
          value: a
        }), a;
      }
    });
  }
  const r = Wr(() => yo(t));
  Q(e._zod, "propValues", () => {
    const c = t.shape, a = {};
    for (const u in c) {
      const d = c[u]._zod;
      if (d.values) {
        a[u] ?? (a[u] = /* @__PURE__ */ new Set());
        for (const l of d.values)
          a[u].add(l);
      }
    }
    return a;
  });
  const o = mt, s = t.catchall;
  let i;
  e._zod.parse = (c, a) => {
    i ?? (i = r.value);
    const u = c.value;
    if (!o(u))
      return c.issues.push({
        expected: "object",
        code: "invalid_type",
        input: u,
        inst: e
      }), c;
    c.value = {};
    const d = [], l = i.shape;
    for (const f of i.keys) {
      const p = l[f], v = p._zod.optin === "optional", w = p._zod.optout === "optional", $ = p._zod.run({ value: u[f], issues: [] }, a);
      $ instanceof Promise ? d.push($.then((E) => Ve(E, c, f, u, v, w))) : Ve($, c, f, u, v, w);
    }
    return s ? bo(d, u, c, a, r.value, e) : d.length ? Promise.all(d).then(() => c) : c;
  };
});
function qt(e, t, n, r) {
  for (const s of e)
    if (s.issues.length === 0)
      return t.value = s.value, t;
  const o = e.filter((s) => !Ee(s));
  return o.length === 1 ? (t.value = o[0].value, o[0]) : (t.issues.push({
    code: "invalid_union",
    input: t.value,
    inst: n,
    errors: e.map((s) => s.issues.map((i) => fe(i, r, le())))
  }), t);
}
const zo = /* @__PURE__ */ S("$ZodUnion", (e, t) => {
  V.init(e, t), Q(e._zod, "optin", () => t.options.some((r) => r._zod.optin === "optional") ? "optional" : void 0), Q(e._zod, "optout", () => t.options.some((r) => r._zod.optout === "optional") ? "optional" : void 0), Q(e._zod, "values", () => {
    if (t.options.every((r) => r._zod.values))
      return new Set(t.options.flatMap((r) => Array.from(r._zod.values)));
  }), Q(e._zod, "pattern", () => {
    if (t.options.every((r) => r._zod.pattern)) {
      const r = t.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${r.map((o) => xn(o.source)).join("|")})$`);
    }
  });
  const n = t.options.length === 1 ? t.options[0]._zod.run : null;
  e._zod.parse = (r, o) => {
    if (n)
      return n(r, o);
    let s = !1;
    const i = [];
    for (const c of t.options) {
      const a = c._zod.run({
        value: r.value,
        issues: []
      }, o);
      if (a instanceof Promise)
        i.push(a), s = !0;
      else {
        if (a.issues.length === 0)
          return a;
        i.push(a);
      }
    }
    return s ? Promise.all(i).then((c) => qt(c, r, e, o)) : qt(i, r, e, o);
  };
}), $o = /* @__PURE__ */ S("$ZodRecord", (e, t) => {
  V.init(e, t), e._zod.parse = (n, r) => {
    const o = n.value;
    if (!Hr(o))
      return n.issues.push({
        expected: "record",
        code: "invalid_type",
        input: o,
        inst: e
      }), n;
    const s = [], i = t.keyType._zod.values;
    if (i) {
      n.value = {};
      const c = /* @__PURE__ */ new Set();
      for (const u of i)
        if (typeof u == "string" || typeof u == "number" || typeof u == "symbol") {
          c.add(typeof u == "number" ? u.toString() : u);
          const d = t.keyType._zod.run({ value: u, issues: [] }, r);
          if (d instanceof Promise)
            throw new Error("Async schemas not supported in object keys currently");
          if (d.issues.length) {
            n.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: d.issues.map((p) => fe(p, r, le())),
              input: u,
              path: [u],
              inst: e
            });
            continue;
          }
          const l = d.value, f = t.valueType._zod.run({ value: o[u], issues: [] }, r);
          f instanceof Promise ? s.push(f.then((p) => {
            p.issues.length && n.issues.push(...ge(u, p.issues)), n.value[l] = p.value;
          })) : (f.issues.length && n.issues.push(...ge(u, f.issues)), n.value[l] = f.value);
        }
      let a;
      for (const u in o)
        c.has(u) || (a = a ?? [], a.push(u));
      a && a.length > 0 && n.issues.push({
        code: "unrecognized_keys",
        input: o,
        inst: e,
        keys: a
      });
    } else {
      n.value = {};
      for (const c of Reflect.ownKeys(o)) {
        if (c === "__proto__" || !Object.prototype.propertyIsEnumerable.call(o, c))
          continue;
        let a = t.keyType._zod.run({ value: c, issues: [] }, r);
        if (a instanceof Promise)
          throw new Error("Async schemas not supported in object keys currently");
        if (typeof c == "string" && Un.test(c) && a.issues.length) {
          const l = t.keyType._zod.run({ value: Number(c), issues: [] }, r);
          if (l instanceof Promise)
            throw new Error("Async schemas not supported in object keys currently");
          l.issues.length === 0 && (a = l);
        }
        if (a.issues.length) {
          t.mode === "loose" ? n.value[c] = o[c] : n.issues.push({
            code: "invalid_key",
            origin: "record",
            issues: a.issues.map((l) => fe(l, r, le())),
            input: c,
            path: [c],
            inst: e
          });
          continue;
        }
        const d = t.valueType._zod.run({ value: o[c], issues: [] }, r);
        d instanceof Promise ? s.push(d.then((l) => {
          l.issues.length && n.issues.push(...ge(c, l.issues)), n.value[a.value] = l.value;
        })) : (d.issues.length && n.issues.push(...ge(c, d.issues)), n.value[a.value] = d.value);
      }
    }
    return s.length ? Promise.all(s).then(() => n) : n;
  };
}), So = /* @__PURE__ */ S("$ZodEnum", (e, t) => {
  V.init(e, t);
  const n = Mn(t.entries), r = new Set(n);
  e._zod.values = r, e._zod.pattern = new RegExp(`^(${n.filter((o) => Kr.has(typeof o)).map((o) => typeof o == "string" ? _t(o) : o.toString()).join("|")})$`), e._zod.parse = (o, s) => {
    const i = o.value;
    return r.has(i) || o.issues.push({
      code: "invalid_value",
      values: n,
      input: i,
      inst: e
    }), o;
  };
}), ko = /* @__PURE__ */ S("$ZodLiteral", (e, t) => {
  if (V.init(e, t), t.values.length === 0)
    throw new Error("Cannot create literal schema with no valid values");
  const n = new Set(t.values);
  e._zod.values = n, e._zod.pattern = new RegExp(`^(${t.values.map((r) => typeof r == "string" ? _t(r) : r ? _t(r.toString()) : String(r)).join("|")})$`), e._zod.parse = (r, o) => {
    const s = r.value;
    return n.has(s) || r.issues.push({
      code: "invalid_value",
      values: t.values,
      input: s,
      inst: e
    }), r;
  };
});
function Vt(e, t) {
  return t === void 0 && (e.issues.length || e.fallback) ? { issues: [], value: void 0 } : e;
}
const Io = /* @__PURE__ */ S("$ZodOptional", (e, t) => {
  V.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", Q(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, void 0]) : void 0), Q(e._zod, "pattern", () => {
    const n = t.innerType._zod.pattern;
    return n ? new RegExp(`^(${xn(n.source)})?$`) : void 0;
  }), e._zod.parse = (n, r) => {
    if (t.innerType._zod.optin === "optional") {
      const o = n.value, s = t.innerType._zod.run(n, r);
      return s instanceof Promise ? s.then((i) => Vt(i, o)) : Vt(s, o);
    }
    return n.value === void 0 ? n : t.innerType._zod.run(n, r);
  };
});
var Wt;
let Eo = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
  }
  add(t, ...n) {
    const r = n[0];
    return this._map.set(t, r), r && typeof r == "object" && "id" in r && this._idmap.set(r.id, t), this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
  }
  remove(t) {
    const n = this._map.get(t);
    return n && typeof n == "object" && "id" in n && this._idmap.delete(n.id), this._map.delete(t), this;
  }
  get(t) {
    const n = t._zod.parent;
    if (n) {
      const r = { ...this.get(n) ?? {} };
      delete r.id;
      const o = { ...r, ...this._map.get(t) };
      return Object.keys(o).length ? o : void 0;
    }
    return this._map.get(t);
  }
  has(t) {
    return this._map.has(t);
  }
};
function Oo() {
  return new Eo();
}
(Wt = globalThis).__zod_globalRegistry ?? (Wt.__zod_globalRegistry = Oo());
const Po = globalThis.__zod_globalRegistry;
// @__NO_SIDE_EFFECTS__
function Zo(e, t) {
  return new e({
    type: "string",
    ...L(t)
  });
}
// @__NO_SIDE_EFFECTS__
function To(e, t) {
  return new e({
    type: "number",
    checks: [],
    ...L(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ro(e, t) {
  return new e({
    type: "number",
    check: "number_format",
    abort: !1,
    format: "safeint",
    ...L(t)
  });
}
// @__NO_SIDE_EFFECTS__
function No(e, t) {
  return new e({
    type: "boolean",
    ...L(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Co(e) {
  return new e({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function Ao(e, t) {
  return new e({
    type: "void",
    ...L(t)
  });
}
// @__NO_SIDE_EFFECTS__
function jo(e, t) {
  return new qn({
    check: "greater_than",
    ...L(t),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function Mo(e, t) {
  return new qn({
    check: "greater_than",
    ...L(t),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function xo(e) {
  return /* @__PURE__ */ jo(0, e);
}
// @__NO_SIDE_EFFECTS__
function Te(e) {
  return /* @__PURE__ */ Mo(0, e);
}
function gt(e) {
  let t = e?.target ?? "draft-2020-12";
  return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
    processors: e.processors ?? {},
    metadataRegistry: e?.metadata ?? Po,
    target: t,
    unrepresentable: e?.unrepresentable ?? "throw",
    override: e?.override ?? (() => {
    }),
    io: e?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: e?.cycles ?? "ref",
    reused: e?.reused ?? "inline",
    external: e?.external ?? void 0
  };
}
function P(e, t, n = { path: [], schemaPath: [] }) {
  var r;
  const o = e._zod.def, s = t.seen.get(e);
  if (s)
    return s.count++, n.schemaPath.includes(e) && (s.cycle = n.path), s.schema;
  const i = { schema: {}, count: 1, cycle: void 0, path: n.path };
  t.seen.set(e, i);
  const c = e._zod.toJSONSchema?.();
  if (c)
    i.schema = c;
  else {
    const d = {
      ...n,
      schemaPath: [...n.schemaPath, e],
      path: n.path
    };
    if (e._zod.processJSONSchema)
      e._zod.processJSONSchema(t, i.schema, d);
    else {
      const f = i.schema, p = t.processors[o.type];
      if (!p)
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${o.type}`);
      p(e, t, f, d);
    }
    const l = e._zod.parent;
    l && (i.ref || (i.ref = l), P(l, t, d), t.seen.get(l).isParent = !0);
  }
  const a = t.metadataRegistry.get(e);
  return a && Object.assign(i.schema, a), t.io === "input" && j(e) && (delete i.schema.examples, delete i.schema.default), t.io === "input" && "_prefault" in i.schema && ((r = i.schema).default ?? (r.default = i.schema._prefault)), delete i.schema._prefault, t.seen.get(e).schema;
}
function vt(e, t) {
  const n = e.seen.get(t);
  if (!n)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = /* @__PURE__ */ new Map();
  for (const i of e.seen.entries()) {
    const c = e.metadataRegistry.get(i[0])?.id;
    if (c) {
      const a = r.get(c);
      if (a && a !== i[0])
        throw new Error(`Duplicate schema id "${c}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      r.set(c, i[0]);
    }
  }
  const o = (i) => {
    const c = e.target === "draft-2020-12" ? "$defs" : "definitions";
    if (e.external) {
      const l = e.external.registry.get(i[0])?.id, f = e.external.uri ?? ((v) => v);
      if (l)
        return { ref: f(l) };
      const p = i[1].defId ?? i[1].schema.id ?? `schema${e.counter++}`;
      return i[1].defId = p, { defId: p, ref: `${f("__shared")}#/${c}/${p}` };
    }
    if (i[1] === n)
      return { ref: "#" };
    const u = `#/${c}/`, d = i[1].schema.id ?? `__schema${e.counter++}`;
    return { defId: d, ref: u + d };
  }, s = (i) => {
    if (i[1].schema.$ref)
      return;
    const c = i[1], { ref: a, defId: u } = o(i);
    c.def = { ...c.schema }, u && (c.defId = u);
    const d = c.schema;
    for (const l in d)
      delete d[l];
    d.$ref = a;
  };
  if (e.cycles === "throw")
    for (const i of e.seen.entries()) {
      const c = i[1];
      if (c.cycle)
        throw new Error(`Cycle detected: #/${c.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (const i of e.seen.entries()) {
    const c = i[1];
    if (t === i[0]) {
      s(i);
      continue;
    }
    if (e.external) {
      const u = e.external.registry.get(i[0])?.id;
      if (t !== i[0] && u) {
        s(i);
        continue;
      }
    }
    if (e.metadataRegistry.get(i[0])?.id) {
      s(i);
      continue;
    }
    if (c.cycle) {
      s(i);
      continue;
    }
    if (c.count > 1 && e.reused === "ref") {
      s(i);
      continue;
    }
  }
}
function yt(e, t) {
  const n = e.seen.get(t);
  if (!n)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = (c) => {
    const a = e.seen.get(c);
    if (a.ref === null)
      return;
    const u = a.def ?? a.schema, d = { ...u }, l = a.ref;
    if (a.ref = null, l) {
      r(l);
      const p = e.seen.get(l), v = p.schema;
      if (v.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (u.allOf = u.allOf ?? [], u.allOf.push(v)) : Object.assign(u, v), Object.assign(u, d), c._zod.parent === l)
        for (const $ in u)
          $ === "$ref" || $ === "allOf" || $ in d || delete u[$];
      if (v.$ref && p.def)
        for (const $ in u)
          $ === "$ref" || $ === "allOf" || $ in p.def && JSON.stringify(u[$]) === JSON.stringify(p.def[$]) && delete u[$];
    }
    const f = c._zod.parent;
    if (f && f !== l) {
      r(f);
      const p = e.seen.get(f);
      if (p?.schema.$ref && (u.$ref = p.schema.$ref, p.def))
        for (const v in u)
          v === "$ref" || v === "allOf" || v in p.def && JSON.stringify(u[v]) === JSON.stringify(p.def[v]) && delete u[v];
    }
    e.override({
      zodSchema: c,
      jsonSchema: u,
      path: a.path ?? []
    });
  };
  for (const c of [...e.seen.entries()].reverse())
    r(c[0]);
  const o = {};
  if (e.target === "draft-2020-12" ? o.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? o.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? o.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
    const c = e.external.registry.get(t)?.id;
    if (!c)
      throw new Error("Schema is missing an `id` property");
    o.$id = e.external.uri(c);
  }
  Object.assign(o, n.def ?? n.schema);
  const s = e.metadataRegistry.get(t)?.id;
  s !== void 0 && o.id === s && delete o.id;
  const i = e.external?.defs ?? {};
  for (const c of e.seen.entries()) {
    const a = c[1];
    a.def && a.defId && (a.def.id === a.defId && delete a.def.id, i[a.defId] = a.def);
  }
  e.external || Object.keys(i).length > 0 && (e.target === "draft-2020-12" ? o.$defs = i : o.definitions = i);
  try {
    const c = JSON.parse(JSON.stringify(o));
    return Object.defineProperty(c, "~standard", {
      value: {
        ...t["~standard"],
        jsonSchema: {
          input: Ht(t, "input", e.processors),
          output: Ht(t, "output", e.processors)
        }
      },
      enumerable: !1,
      writable: !1
    }), c;
  } catch {
    throw new Error("Error converting schema to JSON.");
  }
}
function j(e, t) {
  const n = t ?? { seen: /* @__PURE__ */ new Set() };
  if (n.seen.has(e))
    return !1;
  n.seen.add(e);
  const r = e._zod.def;
  if (r.type === "transform")
    return !0;
  if (r.type === "array")
    return j(r.element, n);
  if (r.type === "set")
    return j(r.valueType, n);
  if (r.type === "lazy")
    return j(r.getter(), n);
  if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault")
    return j(r.innerType, n);
  if (r.type === "intersection")
    return j(r.left, n) || j(r.right, n);
  if (r.type === "record" || r.type === "map")
    return j(r.keyType, n) || j(r.valueType, n);
  if (r.type === "pipe")
    return e._zod.traits.has("$ZodCodec") ? !0 : j(r.in, n) || j(r.out, n);
  if (r.type === "object") {
    for (const o in r.shape)
      if (j(r.shape[o], n))
        return !0;
    return !1;
  }
  if (r.type === "union") {
    for (const o of r.options)
      if (j(o, n))
        return !0;
    return !1;
  }
  if (r.type === "tuple") {
    for (const o of r.items)
      if (j(o, n))
        return !0;
    return !!(r.rest && j(r.rest, n));
  }
  return !1;
}
const Ht = (e, t, n = {}) => (r) => {
  const { libraryOptions: o, target: s } = r ?? {}, i = gt({ ...o ?? {}, target: s, io: t, processors: n });
  return P(e, i), vt(i, e), yt(i, e);
}, Do = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
}, Fo = (e, t, n, r) => {
  const o = n;
  o.type = "string";
  const { minimum: s, maximum: i, format: c, patterns: a, contentEncoding: u } = e._zod.bag;
  if (typeof s == "number" && (o.minLength = s), typeof i == "number" && (o.maxLength = i), c && (o.format = Do[c] ?? c, o.format === "" && delete o.format, c === "time" && delete o.format), u && (o.contentEncoding = u), a && a.size > 0) {
    const d = [...a];
    d.length === 1 ? o.pattern = d[0].source : d.length > 1 && (o.allOf = [
      ...d.map((l) => ({
        ...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
        pattern: l.source
      }))
    ]);
  }
}, Lo = (e, t, n, r) => {
  const o = n, { minimum: s, maximum: i, format: c, multipleOf: a, exclusiveMaximum: u, exclusiveMinimum: d } = e._zod.bag;
  typeof c == "string" && c.includes("int") ? o.type = "integer" : o.type = "number";
  const l = typeof d == "number" && d >= (s ?? Number.NEGATIVE_INFINITY), f = typeof u == "number" && u <= (i ?? Number.POSITIVE_INFINITY), p = t.target === "draft-04" || t.target === "openapi-3.0";
  l ? p ? (o.minimum = d, o.exclusiveMinimum = !0) : o.exclusiveMinimum = d : typeof s == "number" && (o.minimum = s), f ? p ? (o.maximum = u, o.exclusiveMaximum = !0) : o.exclusiveMaximum = u : typeof i == "number" && (o.maximum = i), typeof a == "number" && (o.multipleOf = a);
}, Uo = (e, t, n, r) => {
  n.type = "boolean";
}, Jo = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("BigInt cannot be represented in JSON Schema");
}, qo = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Symbols cannot be represented in JSON Schema");
}, Vo = (e, t, n, r) => {
  t.target === "openapi-3.0" ? (n.type = "string", n.nullable = !0, n.enum = [null]) : n.type = "null";
}, Wo = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Undefined cannot be represented in JSON Schema");
}, Ho = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Void cannot be represented in JSON Schema");
}, Ko = (e, t, n, r) => {
  n.not = {};
}, Bo = (e, t, n, r) => {
}, Go = (e, t, n, r) => {
}, Yo = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Date cannot be represented in JSON Schema");
}, Xo = (e, t, n, r) => {
  const o = e._zod.def, s = Mn(o.entries);
  s.every((i) => typeof i == "number") && (n.type = "number"), s.every((i) => typeof i == "string") && (n.type = "string"), n.enum = s;
}, Qo = (e, t, n, r) => {
  const o = e._zod.def, s = [];
  for (const i of o.values)
    if (i === void 0) {
      if (t.unrepresentable === "throw")
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
    } else if (typeof i == "bigint") {
      if (t.unrepresentable === "throw")
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      s.push(Number(i));
    } else
      s.push(i);
  if (s.length !== 0) if (s.length === 1) {
    const i = s[0];
    n.type = i === null ? "null" : typeof i, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [i] : n.const = i;
  } else
    s.every((i) => typeof i == "number") && (n.type = "number"), s.every((i) => typeof i == "string") && (n.type = "string"), s.every((i) => typeof i == "boolean") && (n.type = "boolean"), s.every((i) => i === null) && (n.type = "null"), n.enum = s;
}, ei = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("NaN cannot be represented in JSON Schema");
}, ti = (e, t, n, r) => {
  const o = n, s = e._zod.pattern;
  if (!s)
    throw new Error("Pattern not found in template literal");
  o.type = "string", o.pattern = s.source;
}, ni = (e, t, n, r) => {
  const o = n, s = {
    type: "string",
    format: "binary",
    contentEncoding: "binary"
  }, { minimum: i, maximum: c, mime: a } = e._zod.bag;
  i !== void 0 && (s.minLength = i), c !== void 0 && (s.maxLength = c), a ? a.length === 1 ? (s.contentMediaType = a[0], Object.assign(o, s)) : (Object.assign(o, s), o.anyOf = a.map((u) => ({ contentMediaType: u }))) : Object.assign(o, s);
}, ri = (e, t, n, r) => {
  n.type = "boolean";
}, oi = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Custom types cannot be represented in JSON Schema");
}, ii = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Function types cannot be represented in JSON Schema");
}, si = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Transforms cannot be represented in JSON Schema");
}, ci = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Map cannot be represented in JSON Schema");
}, ai = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Set cannot be represented in JSON Schema");
}, ui = (e, t, n, r) => {
  const o = n, s = e._zod.def, { minimum: i, maximum: c } = e._zod.bag;
  typeof i == "number" && (o.minItems = i), typeof c == "number" && (o.maxItems = c), o.type = "array", o.items = P(s.element, t, {
    ...r,
    path: [...r.path, "items"]
  });
}, di = (e, t, n, r) => {
  const o = n, s = e._zod.def;
  o.type = "object", o.properties = {};
  const i = s.shape;
  for (const u in i)
    o.properties[u] = P(i[u], t, {
      ...r,
      path: [...r.path, "properties", u]
    });
  const c = new Set(Object.keys(i)), a = new Set([...c].filter((u) => {
    const d = s.shape[u]._zod;
    return t.io === "input" ? d.optin === void 0 : d.optout === void 0;
  }));
  a.size > 0 && (o.required = Array.from(a)), s.catchall?._zod.def.type === "never" ? o.additionalProperties = !1 : s.catchall ? s.catchall && (o.additionalProperties = P(s.catchall, t, {
    ...r,
    path: [...r.path, "additionalProperties"]
  })) : t.io === "output" && (o.additionalProperties = !1);
}, li = (e, t, n, r) => {
  const o = e._zod.def, s = o.inclusive === !1, i = o.options.map((c, a) => P(c, t, {
    ...r,
    path: [...r.path, s ? "oneOf" : "anyOf", a]
  }));
  s ? n.oneOf = i : n.anyOf = i;
}, fi = (e, t, n, r) => {
  const o = e._zod.def, s = P(o.left, t, {
    ...r,
    path: [...r.path, "allOf", 0]
  }), i = P(o.right, t, {
    ...r,
    path: [...r.path, "allOf", 1]
  }), c = (u) => "allOf" in u && Object.keys(u).length === 1, a = [
    ...c(s) ? s.allOf : [s],
    ...c(i) ? i.allOf : [i]
  ];
  n.allOf = a;
}, hi = (e, t, n, r) => {
  const o = n, s = e._zod.def;
  o.type = "array";
  const i = t.target === "draft-2020-12" ? "prefixItems" : "items", c = t.target === "draft-2020-12" || t.target === "openapi-3.0" ? "items" : "additionalItems", a = s.items.map((f, p) => P(f, t, {
    ...r,
    path: [...r.path, i, p]
  })), u = s.rest ? P(s.rest, t, {
    ...r,
    path: [...r.path, c, ...t.target === "openapi-3.0" ? [s.items.length] : []]
  }) : null;
  t.target === "draft-2020-12" ? (o.prefixItems = a, u && (o.items = u)) : t.target === "openapi-3.0" ? (o.items = {
    anyOf: a
  }, u && o.items.anyOf.push(u), o.minItems = a.length, u || (o.maxItems = a.length)) : (o.items = a, u && (o.additionalItems = u));
  const { minimum: d, maximum: l } = e._zod.bag;
  typeof d == "number" && (o.minItems = d), typeof l == "number" && (o.maxItems = l);
}, pi = (e, t, n, r) => {
  const o = n, s = e._zod.def;
  o.type = "object";
  const i = s.keyType, a = i._zod.bag?.patterns;
  if (s.mode === "loose" && a && a.size > 0) {
    const d = P(s.valueType, t, {
      ...r,
      path: [...r.path, "patternProperties", "*"]
    });
    o.patternProperties = {};
    for (const l of a)
      o.patternProperties[l.source] = d;
  } else
    (t.target === "draft-07" || t.target === "draft-2020-12") && (o.propertyNames = P(s.keyType, t, {
      ...r,
      path: [...r.path, "propertyNames"]
    })), o.additionalProperties = P(s.valueType, t, {
      ...r,
      path: [...r.path, "additionalProperties"]
    });
  const u = i._zod.values;
  if (u) {
    const d = [...u].filter((l) => typeof l == "string" || typeof l == "number");
    d.length > 0 && (o.required = d);
  }
}, mi = (e, t, n, r) => {
  const o = e._zod.def, s = P(o.innerType, t, r), i = t.seen.get(e);
  t.target === "openapi-3.0" ? (i.ref = o.innerType, n.nullable = !0) : n.anyOf = [s, { type: "null" }];
}, _i = (e, t, n, r) => {
  const o = e._zod.def;
  P(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType;
}, gi = (e, t, n, r) => {
  const o = e._zod.def;
  P(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType, n.default = JSON.parse(JSON.stringify(o.defaultValue));
}, vi = (e, t, n, r) => {
  const o = e._zod.def;
  P(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(o.defaultValue)));
}, yi = (e, t, n, r) => {
  const o = e._zod.def;
  P(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType;
  let i;
  try {
    i = o.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  n.default = i;
}, bi = (e, t, n, r) => {
  const o = e._zod.def, s = o.in._zod.traits.has("$ZodTransform"), i = t.io === "input" ? s ? o.out : o.in : o.out;
  P(i, t, r);
  const c = t.seen.get(e);
  c.ref = i;
}, wi = (e, t, n, r) => {
  const o = e._zod.def;
  P(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType, n.readOnly = !0;
}, zi = (e, t, n, r) => {
  const o = e._zod.def;
  P(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType;
}, $i = (e, t, n, r) => {
  const o = e._zod.def;
  P(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType;
}, Si = (e, t, n, r) => {
  const o = e._zod.innerType;
  P(o, t, r);
  const s = t.seen.get(e);
  s.ref = o;
}, Kt = {
  string: Fo,
  number: Lo,
  boolean: Uo,
  bigint: Jo,
  symbol: qo,
  null: Vo,
  undefined: Wo,
  void: Ho,
  never: Ko,
  any: Bo,
  unknown: Go,
  date: Yo,
  enum: Xo,
  literal: Qo,
  nan: ei,
  template_literal: ti,
  file: ni,
  success: ri,
  custom: oi,
  function: ii,
  transform: si,
  map: ci,
  set: ai,
  array: ui,
  object: di,
  union: li,
  intersection: fi,
  tuple: hi,
  record: pi,
  nullable: mi,
  nonoptional: _i,
  default: gi,
  prefault: vi,
  catch: yi,
  pipe: bi,
  readonly: wi,
  promise: zi,
  optional: $i,
  lazy: Si
};
function ki(e, t) {
  if ("_idmap" in e) {
    const r = e, o = gt({ ...t, processors: Kt }), s = {};
    for (const a of r._idmap.entries()) {
      const [u, d] = a;
      P(d, o);
    }
    const i = {}, c = {
      registry: r,
      uri: t?.uri,
      defs: s
    };
    o.external = c;
    for (const a of r._idmap.entries()) {
      const [u, d] = a;
      vt(o, d), i[u] = yt(o, d);
    }
    if (Object.keys(s).length > 0) {
      const a = o.target === "draft-2020-12" ? "$defs" : "definitions";
      i.__shared = {
        [a]: s
      };
    }
    return { schemas: i };
  }
  const n = gt({ ...t, processors: Kt });
  return P(e, n), vt(n, e), yt(n, e);
}
const K = /* @__PURE__ */ S("ZodMiniType", (e, t) => {
  if (!e._zod)
    throw new Error("Uninitialized schema in ZodMiniType.");
  V.init(e, t), e.def = t, e.type = t.type, e.parse = (n, r) => to(e, n, r, { callee: e.parse }), e.safeParse = (n, r) => Y(e, n, r), e.parseAsync = async (n, r) => ro(e, n, r, { callee: e.parseAsync }), e.safeParseAsync = async (n, r) => Ln(e, n, r), e.check = (...n) => e.clone({
    ...t,
    checks: [
      ...t.checks ?? [],
      ...n.map((r) => typeof r == "function" ? {
        _zod: { check: r, def: { check: "custom" }, onattach: [] }
      } : r)
    ]
  }, { parent: !0 }), e.with = e.check, e.clone = (n, r) => Br(e, n, r), e.brand = () => e, e.register = ((n, r) => (n.add(e, r), e)), e.apply = (n) => n(e);
}), Ii = /* @__PURE__ */ S("ZodMiniString", (e, t) => {
  ho.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function m(e) {
  return /* @__PURE__ */ Zo(Ii, e);
}
const Wn = /* @__PURE__ */ S("ZodMiniNumber", (e, t) => {
  Vn.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function H(e) {
  return /* @__PURE__ */ To(Wn, e);
}
const Ei = /* @__PURE__ */ S("ZodMiniNumberFormat", (e, t) => {
  po.init(e, t), Wn.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function ze(e) {
  return /* @__PURE__ */ Ro(Ei, e);
}
const Oi = /* @__PURE__ */ S("ZodMiniBoolean", (e, t) => {
  mo.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function et(e) {
  return /* @__PURE__ */ No(Oi, e);
}
const Pi = /* @__PURE__ */ S("ZodMiniUnknown", (e, t) => {
  _o.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function de() {
  return /* @__PURE__ */ Co(Pi);
}
const Zi = /* @__PURE__ */ S("ZodMiniVoid", (e, t) => {
  go.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function Bt(e) {
  return /* @__PURE__ */ Ao(Zi, e);
}
const Ti = /* @__PURE__ */ S("ZodMiniArray", (e, t) => {
  vo.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function q(e, t) {
  return new Ti({
    type: "array",
    element: e,
    ...L(t)
  });
}
const Ri = /* @__PURE__ */ S("ZodMiniObject", (e, t) => {
  wo.init(e, t), K.init(e, t), Q(e, "shape", () => t.shape);
});
// @__NO_SIDE_EFFECTS__
function g(e, t) {
  const n = {
    type: "object",
    shape: e ?? {},
    ...L(t)
  };
  return new Ri(n);
}
const Ni = /* @__PURE__ */ S("ZodMiniUnion", (e, t) => {
  zo.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function Ae(e, t) {
  return new Ni({
    type: "union",
    options: e,
    ...L(t)
  });
}
const Gt = /* @__PURE__ */ S("ZodMiniRecord", (e, t) => {
  $o.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function Ci(e, t, n) {
  return !t || !t._zod ? new Gt({
    type: "record",
    keyType: /* @__PURE__ */ m(),
    valueType: e,
    ...L(t)
  }) : new Gt({
    type: "record",
    keyType: e,
    valueType: t,
    ...L(n)
  });
}
const Ai = /* @__PURE__ */ S("ZodMiniEnum", (e, t) => {
  So.init(e, t), K.init(e, t), e.options = Object.values(t.entries);
});
// @__NO_SIDE_EFFECTS__
function oe(e, t) {
  const n = Array.isArray(e) ? Object.fromEntries(e.map((r) => [r, r])) : e;
  return new Ai({
    type: "enum",
    entries: n,
    ...L(t)
  });
}
const ji = /* @__PURE__ */ S("ZodMiniLiteral", (e, t) => {
  ko.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function Hn(e, t) {
  return new ji({
    type: "literal",
    values: Array.isArray(e) ? e : [e],
    ...L(t)
  });
}
const Mi = /* @__PURE__ */ S("ZodMiniOptional", (e, t) => {
  Io.init(e, t), K.init(e, t);
});
// @__NO_SIDE_EFFECTS__
function y(e) {
  return new Mi({
    type: "optional",
    innerType: e
  });
}
const xi = /* @__PURE__ */ new Set([
  "type",
  "format",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "const",
  "enum",
  "anyOf",
  "oneOf",
  "discriminator",
  "$ref",
  "title",
  "description"
]);
function ne(e) {
  if (e === !0 || e === !1) return e;
  if (e === null || typeof e != "object") throw new Error(`normalizeJsonSchema: expected object, got ${typeof e}`);
  if (Array.isArray(e)) throw new Error("normalizeJsonSchema: expected object, got array");
  const t = e;
  if ("not" in t && Fi(t.not)) return !1;
  const n = {};
  for (const [r, o] of Object.entries(t)) {
    if (!xi.has(r)) continue;
    const s = Di(r, o);
    s !== void 0 && (n[r] = s);
  }
  if (n.type === "object" && !("additionalProperties" in n) && (n.additionalProperties = !1), Array.isArray(n.oneOf) && !("discriminator" in n)) {
    const r = Li(n.oneOf);
    r !== void 0 && (n.discriminator = r);
  }
  return "discriminator" in n && !Array.isArray(n.oneOf) && delete n.discriminator, Object.keys(n).length === 0 ? !0 : n;
}
function Di(e, t) {
  switch (e) {
    case "properties": {
      if (!bt(t)) return {};
      const n = {};
      for (const [r, o] of Object.entries(t)) n[r] = ne(o);
      return n;
    }
    case "items":
    case "additionalProperties":
      return t === !1 ? !1 : ne(t);
    case "prefixItems":
    case "anyOf":
    case "oneOf":
      return Array.isArray(t) ? t.map((n) => ne(n)) : [];
    case "discriminator": {
      if (!bt(t)) return;
      const n = t.propertyName;
      return typeof n != "string" || n.length === 0 ? void 0 : { propertyName: n };
    }
    case "enum":
      return Array.isArray(t) ? t.slice() : [];
    case "required":
      return Array.isArray(t) ? t.slice().sort() : [];
    default:
      return t;
  }
}
function Fi(e) {
  return bt(e) && Object.keys(e).length === 0;
}
function bt(e) {
  return e !== null && typeof e == "object" && !Array.isArray(e);
}
function Li(e) {
  if (e.length < 2) return;
  const t = [];
  for (const r of e) {
    if (r === !0 || r === !1 || r.type !== "object") return;
    const o = r.properties;
    if (!o) return;
    t.push(o);
  }
  let n = Yt(t[0]);
  for (let r = 1; r < t.length; r++)
    if (n = n.filter((o) => Yt(t[r]).includes(o)), n.length === 0) return;
  for (const r of n) {
    const o = /* @__PURE__ */ new Set();
    let s = !0;
    for (const i of t) {
      const c = i[r], a = JSON.stringify(c.const);
      if (o.has(a)) {
        s = !1;
        break;
      }
      o.add(a);
    }
    if (s) return { propertyName: r };
  }
}
function Yt(e) {
  const t = [];
  for (const [n, r] of Object.entries(e))
    r === !0 || r === !1 || "const" in r && t.push(n);
  return t;
}
var Kn = class Bn {
  paramsSchema;
  resultSchema;
  errorSchema;
  docs;
  clientStreamSchema;
  serverStreamSchema;
  kind = "request";
  constructor(t, n, r, o = {}, s, i) {
    this.paramsSchema = t, this.resultSchema = n, this.errorSchema = r, this.docs = o, this.clientStreamSchema = s, this.serverStreamSchema = i;
  }
  /**
  * Return a copy of this request type with stream payload schemas
  * attached. Pass `undefined` for either direction to leave it
  * closed.
  */
  withStream(t) {
    return new Bn(this.paramsSchema, this.resultSchema, this.errorSchema, this.docs, t.client, t.server);
  }
}, Gn = class {
  paramsSchema;
  docs;
  kind = "notification";
  constructor(e, t = {}) {
    this.paramsSchema = e, this.docs = t;
  }
};
function O(e, t, n, r) {
  const o = {};
  return new Kn(e, t ?? /* @__PURE__ */ Bt(), /* @__PURE__ */ Bt(), o);
}
function ie(e, t = {}) {
  return new Gn(e, t);
}
function Ui(e, t) {
  const n = e._zod?.def?.type;
  return n === "void" || n === "undefined" ? !0 : Ji(ki(e), t);
}
function Ji(e, t) {
  if (!We(e)) return ne(e);
  const n = We(e.$defs) ? e.$defs : {}, r = wt(e);
  if (Object.keys(n).length === 0 && r.size === 0) return ne(e);
  if (t === void 0) throw new Error("zodToSvcJsonSchema: local references require a component destination");
  const o = `method=${it(t.methodName)}&schema=${it(t.schemaPosition)}`, s = /* @__PURE__ */ new Map();
  for (const u of Object.keys(n)) s.set(u, `${o}&def=${it(u)}`);
  const i = r.has("#") ? `${o}&root` : void 0, c = (u) => zt(u, s, i);
  for (const [u, d] of Object.entries(n)) {
    const l = s.get(u);
    if (l === void 0) throw new Error(`zodToSvcJsonSchema: missing component for "${u}"`);
    Xt(t.components, l, ne(c(d)));
  }
  const a = c(e);
  return i !== void 0 ? (Xt(t.components, i, ne(a)), { $ref: $t(i) }) : ne(a);
}
function wt(e, t = /* @__PURE__ */ new Set()) {
  if (Array.isArray(e)) {
    for (const n of e) wt(n, t);
    return t;
  }
  if (!We(e)) return t;
  typeof e.$ref == "string" && e.$ref.startsWith("#") && t.add(e.$ref);
  for (const n of Object.values(e)) wt(n, t);
  return t;
}
function zt(e, t, n) {
  if (Array.isArray(e)) return e.map((o) => zt(o, t, n));
  if (!We(e)) return e;
  const r = {};
  for (const [o, s] of Object.entries(e))
    o !== "$defs" && (o === "$ref" && typeof s == "string" ? r[o] = qi(s, t, n) : r[o] = zt(s, t, n));
  return r;
}
function qi(e, t, n) {
  if (e === "#") {
    if (n === void 0) throw new Error("zodToSvcJsonSchema: root reference has no component destination");
    return $t(n);
  }
  if (e.startsWith("#/$defs/")) {
    const r = e.slice(8), o = [...t.keys()].find((i) => Yn(i) === r), s = o === void 0 ? void 0 : t.get(o);
    if (s === void 0) throw new Error(`zodToSvcJsonSchema: dangling local reference "${e}"`);
    return $t(s);
  }
  if (e.startsWith("#") && !e.startsWith("#/components/schemas/")) throw new Error(`zodToSvcJsonSchema: unsupported local reference "${e}"`);
  return e;
}
function Xt(e, t, n) {
  if (Object.hasOwn(e, t)) throw new Error(`zodToSvcJsonSchema: duplicate component name "${t}"`);
  e[t] = n;
}
function $t(e) {
  return `#/components/schemas/${Yn(e)}`;
}
function Yn(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
function it(e) {
  return encodeURIComponent(e).replace(/~/g, "%7E");
}
function We(e) {
  return e !== null && typeof e == "object" && !Array.isArray(e);
}
function Vi(e) {
  const t = Je(e);
  if (t === void 0) throw new Error("jcsCanonicalize: value is not JSON-representable");
  return t;
}
new TextEncoder();
function Je(e, t = /* @__PURE__ */ new Set()) {
  if (typeof e == "number" && Number.isNaN(e)) throw new Error("NaN is not allowed");
  if (typeof e == "number" && !Number.isFinite(e)) throw new Error("Infinity is not allowed");
  if (e === null || typeof e != "object") return JSON.stringify(e);
  const n = e;
  if (typeof n.toJSON == "function") {
    if (t.has(n)) throw new Error("Circular reference detected");
    t.add(n);
    const o = Je(n.toJSON(), t);
    return t.delete(n), o;
  }
  if (t.has(n)) throw new Error("Circular reference detected");
  t.add(n);
  let r;
  if (Array.isArray(n)) r = `[${n.map((o) => Je(o === void 0 || typeof o == "symbol" ? null : o, t)).join(",")}]`;
  else {
    const o = [];
    for (const s of Object.keys(n).sort()) {
      const i = n[s];
      i === void 0 || typeof i == "symbol" || o.push(`${JSON.stringify(s)}:${Je(i, t)}`);
    }
    r = `{${o.join(",")}}`;
  }
  return t.delete(n), r;
}
const Wi = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function G(e, t) {
  return e >>> t | e << 32 - t;
}
function Hi(e) {
  const t = e.length, n = t * 8, r = t + 9 + 63 & -64, o = new Uint8Array(r);
  o.set(e), o[t] = 128;
  const s = new DataView(o.buffer);
  s.setUint32(r - 8, Math.floor(n / 4294967296), !1), s.setUint32(r - 4, n >>> 0, !1);
  const i = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]), c = /* @__PURE__ */ new Uint32Array(64);
  for (let d = 0; d < r; d += 64) {
    for (let b = 0; b < 16; b++) c[b] = s.getUint32(d + b * 4, !1);
    for (let b = 16; b < 64; b++) {
      const z = c[b - 15], x = c[b - 2], ae = G(z, 7) ^ G(z, 18) ^ z >>> 3, ke = G(x, 17) ^ G(x, 19) ^ x >>> 10;
      c[b] = c[b - 16] + ae + c[b - 7] + ke >>> 0;
    }
    let l = i[0], f = i[1], p = i[2], v = i[3], w = i[4], $ = i[5], E = i[6], C = i[7];
    for (let b = 0; b < 64; b++) {
      const z = G(w, 6) ^ G(w, 11) ^ G(w, 25), x = w & $ ^ ~w & E, ae = C + z + x + Wi[b] + c[b] >>> 0, ke = (G(l, 2) ^ G(l, 13) ^ G(l, 22)) + (l & f ^ l & p ^ f & p) >>> 0;
      C = E, E = $, $ = w, w = v + ae >>> 0, v = p, p = f, f = l, l = ae + ke >>> 0;
    }
    i[0] = i[0] + l >>> 0, i[1] = i[1] + f >>> 0, i[2] = i[2] + p >>> 0, i[3] = i[3] + v >>> 0, i[4] = i[4] + w >>> 0, i[5] = i[5] + $ >>> 0, i[6] = i[6] + E >>> 0, i[7] = i[7] + C >>> 0;
  }
  const a = /* @__PURE__ */ new Uint8Array(32), u = new DataView(a.buffer);
  for (let d = 0; d < 8; d++) u.setUint32(d * 4, i[d], !1);
  return a;
}
function Ki(e) {
  const t = Vi(St(e, !0)), n = Hi(new TextEncoder().encode(t));
  return Array.from(n.subarray(0, 8), (r) => r.toString(16).padStart(2, "0")).join("");
}
function St(e, t = !1) {
  if (e === null || typeof e != "object") return e;
  if (Array.isArray(e)) return e.map((r) => St(r));
  const n = {};
  for (const r of Object.keys(e)) {
    if (r === "comment" || t && r === "hash") continue;
    const o = e[r];
    o !== void 0 && (n[r] = St(o));
  }
  return n;
}
const st = /* @__PURE__ */ new WeakMap();
var Bi = class {
  info;
  members;
  constructor(e, t, n = {}) {
    if (this.info = e, this.members = t, st.set(this, {
      frozenSchema: n.frozenSchema,
      schemaCache: void 0,
      hashCache: void 0
    }), e.hash !== void 0 && this.schemaHash !== e.hash) throw new Error(`Interface hash mismatch for "${e.id}": expected "${e.hash}", got "${this.schemaHash}". The interface's wire contract changed — update the pinned hash to "${this.schemaHash}" after reviewing the change.`);
  }
  /** Content hash of this interface (see `computeInterfaceHash`). */
  get schemaHash() {
    const e = st.get(this);
    return e.hashCache === void 0 && (e.hashCache = Ki(e.frozenSchema ?? Qt(this.info, this.members, ""))), e.hashCache;
  }
  /** Lower the definition to a wire-format `HubRpcInterfaceSchema`, hash filled in. */
  toSchema() {
    const e = st.get(this);
    return e.schemaCache === void 0 && (e.schemaCache = e.frozenSchema !== void 0 ? {
      ...e.frozenSchema,
      hash: this.schemaHash
    } : Qt(this.info, this.members, this.schemaHash)), e.schemaCache;
  }
};
function Qt(e, t, n) {
  const r = {}, o = {};
  for (const [i, c] of Object.entries(t)) r[i] = Gi(i, c, o);
  const s = {
    id: e.id,
    hash: n,
    methods: r
  };
  return Object.keys(o).length > 0 && (s.components = { schemas: o }), e.description !== void 0 && (s.description = e.description), e.comment !== void 0 && (s.comment = e.comment), s;
}
function Gi(e, t, n) {
  const r = t.docs;
  if (t.kind === "request") {
    const s = {
      params: Ie(e, "params", t.paramsSchema, n),
      result: Ie(e, "result", t.resultSchema, n)
    };
    return t.clientStreamSchema !== void 0 && (s.clientStream = Ie(e, "clientStream", t.clientStreamSchema, n)), t.serverStreamSchema !== void 0 && (s.serverStream = Ie(e, "serverStream", t.serverStreamSchema, n)), r.description !== void 0 && (s.description = r.description), r.comment !== void 0 && (s.comment = r.comment), r.annotations !== void 0 && (s.annotations = r.annotations), s;
  }
  const o = { params: Ie(e, "params", t.paramsSchema, n) };
  return r.description !== void 0 && (o.description = r.description), r.comment !== void 0 && (o.comment = r.comment), r.annotations !== void 0 && (o.annotations = r.annotations), o;
}
function Ie(e, t, n, r) {
  return Ui(n, {
    methodName: e,
    schemaPosition: t,
    components: r
  });
}
function W(e, t) {
  return new Bi(e, t);
}
const en = W({
  id: "hubrpc.defaults",
  description: "Reflection: preset default service / interface on this connection."
}, { get: O(/* @__PURE__ */ g({}), /* @__PURE__ */ g({
  serviceId: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  interfaceId: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  /** Hash of the preset interface, if known. */
  interfaceHash: /* @__PURE__ */ y(/* @__PURE__ */ m())
})) }), Yi = /* @__PURE__ */ q(/* @__PURE__ */ g({
  principal: /* @__PURE__ */ m(),
  transitive: /* @__PURE__ */ y(/* @__PURE__ */ et())
})), kt = /* @__PURE__ */ Ae([/* @__PURE__ */ g({ exact: /* @__PURE__ */ m() }), /* @__PURE__ */ g({ prefix: /* @__PURE__ */ m() })]), Xi = /* @__PURE__ */ g({
  serviceId: /* @__PURE__ */ m(),
  interfaceId: /* @__PURE__ */ m(),
  /** Hash of the interface as implemented by this service. */
  interfaceHash: /* @__PURE__ */ m(),
  /** Optional non-normative description of the owning service. */
  serviceDescription: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  /**
  * Root principals required to access this service, in CNF: the caller must
  * satisfy **every** set (AND), and a set is satisfied by **any one** of its
  * principals (OR). Omitted/empty => no root-principal requirement.
  */
  rootPrincipalSets: /* @__PURE__ */ y(/* @__PURE__ */ q(Yi)),
  /**
  * Service-id regions reachable through this referral. Meaningful only for
  * `hubrpc.directory` entries; omission defaults to the referral service-id
  * subtree.
  */
  reachableServiceIds: /* @__PURE__ */ y(/* @__PURE__ */ q(kt))
}), tn = W({
  id: "hubrpc.directory",
  description: "Reflection: list services exposed by this endpoint. Can also list other directory services that can be explored."
}, {
  list: O(/* @__PURE__ */ g({
    /** Filter: only return services implementing this interface id. */
    interfaceId: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** Filter: only return services whose interface id starts with this prefix. */
    interfaceIdPrefix: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** Filter: only return entries for this service id. */
    serviceId: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** Union filter used to constrain a transitive directory walk. */
    serviceIdScopes: /* @__PURE__ */ y(/* @__PURE__ */ q(kt)),
    /** Paging: opaque continuation token from a previous response. */
    cursor: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** Paging: max items in this page. Server MAY return fewer. */
    limit: /* @__PURE__ */ y((/* @__PURE__ */ H()).check(/* @__PURE__ */ ze(), /* @__PURE__ */ xo())),
    /** Soft cap on time the server spends gathering this page, in ms. */
    timeoutMs: /* @__PURE__ */ y((/* @__PURE__ */ H()).check(/* @__PURE__ */ ze(), /* @__PURE__ */ Te()))
  }), /* @__PURE__ */ g({
    items: /* @__PURE__ */ q(Xi),
    /** Omitted => no more pages. */
    nextCursor: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** True if `timeoutMs` cut the page short before exhausting results. */
    truncated: /* @__PURE__ */ y(/* @__PURE__ */ et())
  })),
  /**
  * Coarse change tap on the directory.
  *
  * `watch` is a long-lived streaming request that emits an **empty tick**
  * whenever the (optionally filtered) directory *might* have changed. The
  * tick carries no delta and no payload — its only meaning is "re-`list`
  * now". The consumer reconciles against its own last snapshot.
  *
  * This keeps the server stateless: it never computes or replays
  * per-item deltas, never does an initial-sync replay. Over-emission is
  * allowed (the consumer re-lists and finds nothing new); under-emission
  * is not. Ticks are coalesced. The `interfaceId` / `serviceId` filters
  * mirror `list` and are a relevance hint, not a guarantee.
  *
  * The request resolves when the caller cancels (or the connection
  * drops); the runtime auto-detaches the stream when it settles.
  */
  watch: O(/* @__PURE__ */ g({
    /** Relevance hint: changes touching this interface id. */
    interfaceId: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** Relevance hint: changes touching an interface id with this prefix. */
    interfaceIdPrefix: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** Relevance hint: changes touching this service id. */
    serviceId: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /** Relevance hint: changes within any of these service-id regions. */
    serviceIdScopes: /* @__PURE__ */ y(/* @__PURE__ */ q(kt))
  }), /* @__PURE__ */ g({})).withStream({
    /** Empty tick: "the directory may have changed; re-list." */
    server: /* @__PURE__ */ g({})
  })
}), nn = W({
  id: "hubrpc.schemas",
  description: "Reflection: fetch interface schemas by id (+ optional hash). Must serve the interfaces advertised in this endpoint's directory."
}, { get: O(/* @__PURE__ */ g({
  interfaceId: /* @__PURE__ */ m(),
  /** Omit => server picks the version it exposes. */
  hash: /* @__PURE__ */ y(/* @__PURE__ */ m())
}), /* @__PURE__ */ g({
  /** A full `SvcInterfaceSchema`. */
  schema: /* @__PURE__ */ de()
})) }), Qi = /* @__PURE__ */ g({
  portId: /* @__PURE__ */ m(),
  label: /* @__PURE__ */ y(/* @__PURE__ */ m())
}), es = /* @__PURE__ */ g({
  type: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  label: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  processId: /* @__PURE__ */ y(/* @__PURE__ */ H()),
  processType: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  nodeStatusServiceId: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  metadata: /* @__PURE__ */ y(/* @__PURE__ */ Ci(/* @__PURE__ */ m(), /* @__PURE__ */ Ae([
    /* @__PURE__ */ m(),
    /* @__PURE__ */ H(),
    /* @__PURE__ */ et()
  ])))
}), Xn = /* @__PURE__ */ g({
  source: /* @__PURE__ */ oe(["self", "attacher"]),
  descriptor: es
}), ts = /* @__PURE__ */ g({
  nodeId: /* @__PURE__ */ m(),
  kind: /* @__PURE__ */ y(/* @__PURE__ */ oe(["endpoint", "hub"])),
  label: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  descriptors: /* @__PURE__ */ y(/* @__PURE__ */ q(Xn)),
  ports: /* @__PURE__ */ q(Qi)
}), rn = /* @__PURE__ */ g({
  nodeId: /* @__PURE__ */ m(),
  portId: /* @__PURE__ */ m()
}), ns = /* @__PURE__ */ g({
  from: rn,
  to: rn,
  label: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  peerState: /* @__PURE__ */ y(/* @__PURE__ */ oe([
    "identified",
    "pending",
    "unsupported",
    "error"
  ]))
}), rs = /* @__PURE__ */ g({
  serviceId: /* @__PURE__ */ m(),
  nodeId: /* @__PURE__ */ m(),
  portId: /* @__PURE__ */ m(),
  match: /* @__PURE__ */ oe(["exact", "prefix"])
}), os = /* @__PURE__ */ g({
  observerServiceId: /* @__PURE__ */ m(),
  entryNodeId: /* @__PURE__ */ m(),
  nodes: /* @__PURE__ */ q(ts),
  links: /* @__PURE__ */ q(ns),
  routes: /* @__PURE__ */ q(rs)
}), Qn = W({
  id: "hubrpc.topology",
  description: "Inspect the transport graph visible from a service. A watch emits invalidation ticks; consumers re-fetch getGraph after each tick."
}, {
  getGraph: O(/* @__PURE__ */ g({}), os),
  watchGraph: O(/* @__PURE__ */ g({}), /* @__PURE__ */ g({})).withStream({ server: /* @__PURE__ */ g({}) })
}), on = /* @__PURE__ */ g({
  edgeId: /* @__PURE__ */ m(),
  portId: /* @__PURE__ */ m(),
  requestId: /* @__PURE__ */ y(/* @__PURE__ */ Ae([/* @__PURE__ */ H(), /* @__PURE__ */ m()]))
}), is = /* @__PURE__ */ g({
  type: /* @__PURE__ */ Hn("transit"),
  ts: /* @__PURE__ */ H(),
  nodeId: /* @__PURE__ */ m(),
  in: /* @__PURE__ */ y(on),
  out: /* @__PURE__ */ y(on),
  disposition: /* @__PURE__ */ oe([
    "forwarded",
    "consumed",
    "dropped",
    "unroutable"
  ]),
  kind: /* @__PURE__ */ oe([
    "request",
    "notification",
    "response",
    "stream"
  ]),
  method: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  params: /* @__PURE__ */ y(/* @__PURE__ */ de()),
  result: /* @__PURE__ */ y(/* @__PURE__ */ de()),
  error: /* @__PURE__ */ y(/* @__PURE__ */ g({
    code: /* @__PURE__ */ H(),
    message: /* @__PURE__ */ m(),
    data: /* @__PURE__ */ y(/* @__PURE__ */ de())
  }))
}), ss = /* @__PURE__ */ g({
  type: /* @__PURE__ */ Hn("overflow"),
  dropped: (/* @__PURE__ */ H()).check(/* @__PURE__ */ ze(), /* @__PURE__ */ Te())
}), sn = /* @__PURE__ */ Ae([is, ss]), cn = /* @__PURE__ */ g({
  delivered: (/* @__PURE__ */ H()).check(/* @__PURE__ */ ze(), /* @__PURE__ */ Te()),
  dropped: (/* @__PURE__ */ H()).check(/* @__PURE__ */ ze(), /* @__PURE__ */ Te())
}), cs = /* @__PURE__ */ g({ methodPrefix: /* @__PURE__ */ y(/* @__PURE__ */ m()) }), as = /* @__PURE__ */ g({
  methodPrefix: /* @__PURE__ */ y(/* @__PURE__ */ m()),
  maxPayloadBytes: (/* @__PURE__ */ H()).check(/* @__PURE__ */ ze(), /* @__PURE__ */ Te())
}), er = W({
  id: "hubrpc.traffic",
  description: "Stream raw message transits for the entire node hosting the addressed service. Payload-free and explicitly payload-bearing variants keep disclosure opt-in."
}, {
  watch: O(cs, cn).withStream({ server: sn }),
  watchWithPayloads: O(as, cn).withStream({ server: sn })
}), us = /* @__PURE__ */ g({
  /**
  * Random identity of this connection's node. It is a topology-correlation
  * label only and must not be used for authentication or authorization.
  */
  nodeId: /* @__PURE__ */ m(),
  /** Random identity of this connection's port on its node. */
  portId: /* @__PURE__ */ m(),
  /** Optional diagnostic descriptors; never used for authorization. */
  descriptors: /* @__PURE__ */ y(/* @__PURE__ */ q(Xn))
}), It = W({
  id: "hubrpc.node",
  description: "Topology bootstrap: identify the node and port at this end of the direct connection."
}, { getNodeId: O(/* @__PURE__ */ g({}), us) }), _e = {
  /** callee → caller: progress, partial results. Routes like a response. */
  toCaller: "toCaller",
  /** caller → callee: input, cancellation, keepalive ping. */
  toCallee: "toCallee"
}, te = {
  /**
  * Ask the callee to abort the in-flight request. Always {@link
  * StreamDir.toCallee}. The callee surfaces this as an `AbortSignal`
  * and is expected to settle the request (typically with a
  * `cancelled` error response).
  */
  cancel: "cancel",
  /**
  * Keepalive / liveness probe. Resets the hub's per-request idle timer
  * so a long-running call is not reaped, and lets either side actively
  * probe the peer. Carries a `nonce` the peer echoes in its {@link
  * StreamControlType.pong}. May travel in either direction. Emitted
  * automatically (without awaiting a pong) by the channel for streaming
  * calls; see {@link STREAM_METHOD}.
  */
  ping: "ping",
  /**
  * Reply to a {@link StreamControlType.ping}, echoing the ping's
  * `nonce` so the prober can correlate it. Travels opposite the ping.
  * Carries no app effect — purely a liveness acknowledgement.
  */
  pong: "pong"
}, ds = W({
  id: "$stream",
  description: "Reserved sub-protocol for in-flight stream messages correlated to a request by `requestId`."
}, { send: ie(/* @__PURE__ */ g({
  /**
  * Id of the in-flight request the message belongs to.
  * The hub rewrites this across the forwarding boundary
  * in the same way it rewrites response ids.
  */
  requestId: /* @__PURE__ */ Ae([/* @__PURE__ */ H(), /* @__PURE__ */ m()]),
  /**
  * Which way this message travels relative to the request.
  * Explicit so the hub can author messages (e.g. cancel on
  * disconnect) without inferring direction from arrival.
  */
  dir: /* @__PURE__ */ oe(["toCaller", "toCallee"]),
  /**
  * Reserved control verb (cancel / ping / pong). Mutually
  * exclusive with `payload` in practice: a control message
  * is interpreted by the runtime, not the application.
  */
  control: /* @__PURE__ */ y(/* @__PURE__ */ g({
    type: /* @__PURE__ */ oe([
      "cancel",
      "ping",
      "pong"
    ]),
    /** Open-set human/diagnostic reason; see {@link StreamControlReason}. */
    reason: /* @__PURE__ */ y(/* @__PURE__ */ m()),
    /**
    * Correlation token. A `ping` carries a fresh nonce;
    * the matching `pong` echoes it back so the prober
    * can resolve the right outstanding probe.
    */
    nonce: /* @__PURE__ */ y(/* @__PURE__ */ m())
  })),
  /** Opaque app payload — typed per call by the request's stream schema. */
  payload: /* @__PURE__ */ y(/* @__PURE__ */ de())
}), { description: "Emit a stream message tied to the request `requestId`." }) }), ve = `${ds.info.id}::send`, J = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Caller is authenticated but lacks a capability covering the call. */
  permissionRequired: -32401,
  /** The peer a request was routed to detached before it could respond. */
  peerDisconnected: -32402,
  /** The request exceeded the hub's idle timeout with no stream activity. */
  requestTimeout: -32403,
  /** The request was cancelled (by the caller, or by the hub on disconnect). */
  cancelled: -32800
};
function Oe(e) {
  return typeof e.method == "string" && e.id !== void 0;
}
function tr(e) {
  return typeof e.method == "string" && e.id === void 0;
}
function qe(e) {
  return typeof e.method != "string";
}
const X = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function ls(e) {
  let t = "", n = 0;
  for (; n + 3 <= e.length; n += 3) {
    const o = e[n] << 16 | e[n + 1] << 8 | e[n + 2];
    t += X[o >> 18 & 63] + X[o >> 12 & 63] + X[o >> 6 & 63] + X[o & 63];
  }
  const r = e.length - n;
  if (r === 1) {
    const o = e[n] << 16;
    t += X[o >> 18 & 63] + X[o >> 12 & 63];
  } else if (r === 2) {
    const o = e[n] << 16 | e[n + 1] << 8;
    t += X[o >> 18 & 63] + X[o >> 12 & 63] + X[o >> 6 & 63];
  }
  return t;
}
function fs(e) {
  const t = e.split("::");
  if (t.length === 3 && t[0].length === 0 && t[1].length > 0 && t[2].length > 0) return {
    kind: "interface",
    interfaceId: t[1],
    member: t[2]
  };
  if (!t.some((n) => n.length === 0)) {
    if (t.length === 1) return {
      kind: "bare",
      member: t[0]
    };
    if (t.length === 2) return {
      kind: "interface",
      interfaceId: t[0],
      member: t[1]
    };
    if (t.length === 3) return {
      kind: "full",
      serviceId: t[0],
      interfaceId: t[1],
      member: t[2]
    };
  }
}
const nr = Symbol.for("@vscode/hubrpc.localMessageContext");
function hs(e, t) {
  return Object.defineProperties(e, {
    context: {
      configurable: !0,
      enumerable: !1,
      value: t
    },
    [nr]: {
      configurable: !0,
      enumerable: !1,
      value: !0
    }
  }), e;
}
function ps(e) {
  const t = e;
  return e[nr] === !0 ? t.context : void 0;
}
var ms = class rr {
  sender;
  _setHandler;
  _setWireObserver;
  constructor(t, n, r) {
    this.sender = t, this._setHandler = n, this._setWireObserver = r;
  }
  /** Bind the inbound request/notification handler. May be called before or after construction of {@link HubRpcConnection}. */
  setRequestHandler(t) {
    this._setHandler(t);
  }
  /**
  * Install the endpoint inspection observer at the JSON-RPC wire boundary.
  * Intended for {@link HubRpcConnection}; ordinary consumers should use the
  * public `hubrpc.traffic` service instead.
  */
  setWireMessageObserver(t, n) {
    this._setWireObserver?.(t, n);
  }
  /**
  * Compose this channel with a sender-side decorator (typically the
  * signing layer). The decorator wraps {@link sender} only; the
  * {@link setRequestHandler} binding is shared with the original channel
  * so the receive side is bound exactly once regardless of decoration depth.
  */
  withSender(t) {
    return new rr(t(this.sender), this._setHandler, this._setWireObserver);
  }
};
const or = Symbol("hubrpc.inspectionCall");
function ct(e) {
  return Object.defineProperty(e, or, { value: !0 }), e;
}
function at(e) {
  return e?.[or] === !0;
}
var re = class extends Error {
  code;
  data;
  constructor(e, t, n) {
    super(e), this.code = t, this.data = n, this.name = "RpcError";
  }
};
function _s(e, t) {
  return "exact" in t ? e === t.exact : t.prefix === "" || e === t.prefix || e.startsWith(`${t.prefix}/`);
}
function ir(e, t) {
  return t === void 0 || t.some((n) => _s(e, n));
}
const gs = 10 * 6e4;
var sr = class cr {
  _transport;
  /**
  * Wrap a transport in a {@link Channel}. The channel's sender is live
  * immediately; call {@link Channel.setRequestHandler} (or pass the channel
  * to {@link HubRpcConnection}) to bind the inbound handler.
  */
  static create(t) {
    return this.createWithClose(t).channel;
  }
  /** Wrap a transport and retain an explicit lifecycle hook for its owner. */
  static createWithClose(t) {
    const n = new cr(t);
    return {
      channel: new ms(n, (r) => n.setRequestHandler(r), (r, o) => n.setWireMessageObserver(r, o)),
      close: () => n.close()
    };
  }
  _nextId = 1;
  _pending = /* @__PURE__ */ new Map();
  /**
  * Per-request callbacks invoked when a {@link STREAM_METHOD}
  * notification arrives with a matching `requestId`. Used in both
  * directions: outgoing-request callers register here keyed by the
  * id they sent; per-call incoming-request stream handles register
  * keyed by the id they observed. Entries are removed when the
  * corresponding request completes (response received for outgoing,
  * response sent for incoming).
  */
  _streamListeners = /* @__PURE__ */ new Map();
  /**
  * Per-incoming-request handlers for reserved `control` messages
  * (cancel / ping / pong) arriving as stream notifications. Keyed
  * by the id observed; removed when the request settles.
  */
  _streamControl = /* @__PURE__ */ new Map();
  _incomingAborts = /* @__PURE__ */ new Map();
  _handler;
  _wireObserver;
  _isInspectionMethod;
  _outboundInspectionRequests = /* @__PURE__ */ new Set();
  _inboundInspectionRequests = /* @__PURE__ */ new Set();
  _closeError;
  setRequestHandler(t) {
    this._handler = t;
  }
  setWireMessageObserver(t, n) {
    this._wireObserver = t, this._isInspectionMethod = t === void 0 ? void 0 : n, t === void 0 && (this._outboundInspectionRequests.clear(), this._inboundInspectionRequests.clear());
  }
  constructor(t) {
    this._transport = t, this._transport.setListener((n) => this._onMessage(n));
  }
  async sendRequest(t, n, r) {
    this._throwIfClosed();
    const o = this._nextId++, s = {
      jsonrpc: "2.0",
      id: o,
      method: t
    };
    n !== void 0 && (s.params = n);
    const i = new Promise((c, a) => {
      this._pending.set(String(o), {
        resolve: c,
        reject: a
      });
    });
    this._observeOutbound(s, r);
    try {
      await this._transport.send(s);
    } catch (c) {
      throw this._pending.delete(String(o)), this._observeSendFailure(o, c), c;
    }
    return i;
  }
  async sendNotification(t, n, r) {
    this._throwIfClosed();
    const o = {
      jsonrpc: "2.0",
      method: t
    };
    n !== void 0 && (o.params = n), this._observeOutbound(o, r), await this._transport.send(o);
  }
  sendRequestWithStream(t, n, r) {
    this._throwIfClosed();
    const o = this._nextId++, s = String(o);
    let i, c;
    const a = new Promise((f, p) => {
      i = f, c = p;
    });
    this._pending.set(s, {
      resolve: i,
      reject: c
    }), r?.onStreamMessage && this._streamListeners.set(s, r.onStreamMessage);
    const u = this._makePinger(o, _e.toCallee);
    this._streamControl.set(s, u.onControl);
    const d = setInterval(() => {
      this._sendStream(o, _e.toCallee, { control: { type: te.ping } });
    }, gs);
    d.unref?.();
    const l = () => {
      clearInterval(d), u.dispose(), this._streamControl.delete(s);
    };
    return a.then(l, l), (async () => {
      const f = {
        jsonrpc: "2.0",
        id: o,
        method: t
      };
      n !== void 0 && (f.params = n), this._observeOutbound(f, r), await this._transport.send(f);
    })().catch((f) => {
      this._pending.delete(s), this._streamListeners.delete(s), this._observeSendFailure(o, f), l(), c(f instanceof Error ? f : new Error(String(f)));
    }), {
      result: a,
      send: (f) => this._sendStream(o, _e.toCallee, { payload: f }),
      cancel: (f) => this._sendStream(o, _e.toCallee, { control: f !== void 0 ? {
        type: te.cancel,
        reason: f
      } : { type: te.cancel } }),
      ping: u.ping
    };
  }
  /**
  * Build the symmetric ping/pong machinery for one in-flight request.
  *
  * `outboundDir` is the direction *this* side emits controls in
  * (`toCallee` for the caller, `toCaller` for the callee). A received
  * ping is answered with a pong in that same direction, echoing the
  * ping's nonce; a received pong resolves the matching outstanding
  * {@link ping} probe.
  */
  _makePinger(t, n) {
    const r = /* @__PURE__ */ new Map();
    let o = 1;
    return {
      ping: () => {
        const a = `${t}:${o++}`, u = new Promise((d, l) => r.set(a, {
          resolve: d,
          reject: l
        }));
        return this._sendStream(t, n, { control: {
          type: te.ping,
          nonce: a
        } }), u;
      },
      onControl: (a) => {
        if (a.type === te.ping) this._sendStream(t, n, { control: {
          type: te.pong,
          nonce: a.nonce
        } });
        else if (a.type === te.pong && a.nonce !== void 0) {
          const u = r.get(a.nonce);
          u && (r.delete(a.nonce), u.resolve());
        }
      },
      dispose: () => {
        const a = new re("Request settled before pong", J.cancelled);
        for (const u of r.values()) u.reject(a);
        r.clear();
      }
    };
  }
  /**
  * Emit a stream notification ({@link STREAM_METHOD}) associated with
  * an in-flight request. Internal: outgoing-side callers reach this
  * via {@link RawStreamingCall.send} / `cancel`; incoming-side handlers
  * reach it via {@link IncomingStream.send}.
  */
  async _sendStream(t, n, r) {
    this._throwIfClosed();
    const o = {
      jsonrpc: "2.0",
      method: ve,
      params: {
        requestId: t,
        dir: n,
        ...r
      }
    };
    this._observeOutbound(o), await this._transport.send(o);
  }
  close() {
    if (this._closeError) return;
    const t = new re("Connection closed", J.peerDisconnected);
    this._closeError = t;
    for (const n of this._incomingAborts.values()) n.abort(t);
    this._incomingAborts.clear(), this._transport.dispose();
    for (const n of this._pending.values()) n.reject(t);
    this._pending.clear(), this._streamListeners.clear(), this._streamControl.clear();
  }
  _throwIfClosed() {
    if (this._closeError) throw this._closeError;
  }
  _onMessage(t) {
    const n = t.context;
    if (this._observeInbound(t), qe(t)) {
      if (t.id === null) return;
      const r = String(t.id), o = this._pending.get(r);
      if (!o) return;
      if (this._pending.delete(r), this._streamListeners.delete(r), "error" in t) {
        const s = t.error, i = new re(s.message, s.code, s.data);
        o.reject(i);
      } else o.resolve(t.result);
      return;
    }
    if (Oe(t)) {
      this._handleRequest(t, n).catch(() => {
      });
      return;
    }
    if (tr(t)) {
      if (t.method === ve) {
        this._handleStreamNotification(t);
        return;
      }
      this._handleNotification(t, n);
      return;
    }
  }
  _handleStreamNotification(t) {
    const n = t.params;
    if (!n) return;
    const r = n.requestId;
    if (r === void 0) return;
    const o = String(r);
    if (n.control) {
      this._streamControl.get(o)?.(n.control);
      return;
    }
    const s = this._streamListeners.get(o);
    s && s(n.payload);
  }
  async _handleRequest(t, n) {
    const r = String(t.id), o = this._makePinger(t.id, _e.toCaller), s = {
      send: (a) => this._sendStream(t.id, _e.toCaller, { payload: a }),
      onMessage: (a) => {
        a ? this._streamListeners.set(r, a) : this._streamListeners.delete(r);
      },
      ping: o.ping,
      markInspectionLifecycle: () => {
        this._wireObserver !== void 0 && this._inboundInspectionRequests.add(r);
      }
    }, i = new AbortController();
    this._incomingAborts.set(r, i), this._streamControl.set(r, (a) => {
      a.type === te.cancel ? i.abort(new re(a.reason ?? "cancelled", J.cancelled)) : o.onControl(a);
    });
    let c;
    try {
      if (!this._handler) c = { error: {
        code: J.methodNotFound,
        message: `No handler registered on this endpoint (method: ${t.method}).`
      } };
      else try {
        c = await this._handler.handleRequest({
          method: t.method,
          params: t.params,
          context: n,
          stream: s,
          signal: i.signal
        });
      } catch (a) {
        c = { error: {
          code: J.internalError,
          message: a instanceof Error ? a.message : String(a)
        } };
      }
    } finally {
      this._streamListeners.delete(r), this._streamControl.delete(r), this._incomingAborts.delete(r), o.dispose();
    }
    if ("result" in c) {
      const a = {
        jsonrpc: "2.0",
        id: t.id,
        result: c.result
      };
      this._observeOutbound(a), await this._transport.send(a);
    } else {
      const a = {
        jsonrpc: "2.0",
        id: t.id,
        error: c.error
      };
      this._observeOutbound(a), await this._transport.send(a);
    }
  }
  _handleNotification(t, n) {
    if (this._handler)
      try {
        this._handler.handleNotification({
          method: t.method,
          params: t.params,
          context: n,
          stream: vs,
          signal: ys
        });
      } catch {
      }
  }
  _observeInbound(t) {
    const n = this._wireObserver;
    if (n === void 0) return;
    let r = !1;
    if (Oe(t))
      r = this._isInspectionMethod?.(t.method) === !0, r && this._inboundInspectionRequests.add(String(t.id));
    else if (qe(t)) {
      if (t.id !== null) {
        const o = String(t.id);
        r = this._outboundInspectionRequests.delete(o);
      }
    } else t.method === ve ? r = this._isInspectionStream(t) : r = this._isInspectionMethod?.(t.method) === !0;
    r || n("inbound", t);
  }
  _observeOutbound(t, n) {
    Oe(t) && at(n) && hs(t, {
      ...ps(t),
      inspection: !0
    });
    const r = this._wireObserver;
    if (r === void 0) return;
    let o = !1;
    if (Oe(t))
      o = at(n), o && this._outboundInspectionRequests.add(String(t.id));
    else if (qe(t)) {
      if (t.id !== null) {
        const s = String(t.id);
        o = this._inboundInspectionRequests.delete(s);
      }
    } else t.method === ve ? o = this._isInspectionStream(t) : o = at(n);
    o || r("outbound", t);
  }
  _observeSendFailure(t, n) {
    if (this._wireObserver === void 0) {
      this._outboundInspectionRequests.delete(String(t));
      return;
    }
    this._observeInbound({
      jsonrpc: "2.0",
      id: t,
      error: {
        code: J.peerDisconnected,
        message: n instanceof Error ? n.message : String(n)
      }
    });
  }
  _isInspectionStream(t) {
    const n = t.params;
    if (n?.requestId === void 0) return !1;
    const r = String(n.requestId);
    return this._outboundInspectionRequests.has(r) || this._inboundInspectionRequests.has(r);
  }
};
const vs = {
  send: () => Promise.resolve(),
  onMessage: () => {
  },
  ping: () => Promise.resolve(),
  markInspectionLifecycle: () => {
  }
}, ys = new AbortController().signal, bs = 256;
var ws = class {
  _options;
  _send;
  _onDispose;
  _queueLimit;
  _queue = [];
  _active = !0;
  _pumping = !1;
  _overflowPending = 0;
  _delivered = 0;
  _dropped = 0;
  _resolveClosed;
  closed;
  constructor(e, t, n, r = bs) {
    this._options = e, this._send = t, this._onDispose = n, this._queueLimit = r;
    let o;
    this.closed = new Promise((s) => o = s), this._resolveClosed = o;
  }
  enqueue(e) {
    if (!this._active || this._options.methodPrefix !== void 0 && !e.method?.startsWith(this._options.methodPrefix)) return;
    const t = this._options.maxPayloadBytes === void 0 ? zs(e) : $s(e, this._options.maxPayloadBytes);
    this._queue.length >= this._queueLimit && (this._queue.shift(), this._dropped++, this._overflowPending++), this._queue.push(t), this._pumping || (this._pumping = !0, queueMicrotask(() => void this._pump()));
  }
  dispose() {
    this._active && (this._active = !1, this._dropped += this._queue.length, this._queue.length = 0, this._overflowPending = 0, this._onDispose(), this._pumping || this._complete());
  }
  async _pump() {
    try {
      for (; this._active; ) {
        if (this._overflowPending > 0) {
          const t = this._overflowPending;
          this._overflowPending = 0, await this._send({
            type: "overflow",
            dropped: t
          });
          continue;
        }
        const e = this._queue.shift();
        if (e === void 0) break;
        await this._send(e), this._delivered++;
      }
    } catch {
      this.dispose();
    } finally {
      this._pumping = !1, this._active ? (this._queue.length > 0 || this._overflowPending > 0) && (this._pumping = !0, queueMicrotask(() => void this._pump())) : this._complete();
    }
  }
  _complete() {
    this._resolveClosed({
      delivered: this._delivered,
      dropped: this._dropped
    });
  }
};
function zs(e) {
  const { params: t, result: n, error: r, ...o } = e;
  return r === void 0 ? o : {
    ...o,
    error: {
      code: r.code,
      message: r.message
    }
  };
}
function $s(e, t) {
  return {
    ...e,
    params: ut(e.params, t),
    result: ut(e.result, t),
    error: e.error === void 0 ? void 0 : {
      ...e.error,
      data: ut(e.error.data, t)
    }
  };
}
function ut(e, t) {
  if (e === void 0) return;
  if (t === Number.POSITIVE_INFINITY) return e;
  const n = JSON.stringify(e);
  if (n === void 0) return;
  const r = new TextEncoder().encode(n);
  if (r.byteLength <= t) return e;
  const o = new TextEncoder();
  let s = new TextDecoder().decode(r.slice(0, t));
  for (; o.encode(s).byteLength > t; ) s = s.slice(0, -1);
  return s;
}
var Ss = class {
  _nodeId;
  _portId;
  _setActive;
  _subscribers = /* @__PURE__ */ new Set();
  _observers = /* @__PURE__ */ new Set();
  _outboundRequests = /* @__PURE__ */ new Map();
  _inboundRequests = /* @__PURE__ */ new Map();
  observe = (e, t) => {
    this._onMessage(e, t);
  };
  constructor(e, t, n) {
    this._nodeId = e, this._portId = t, this._setActive = n;
  }
  get observerCount() {
    return this._subscribers.size + this._observers.size;
  }
  subscribe(e, t) {
    const n = new ws(e, t, () => {
      this._subscribers.delete(n), this._deactivateIfUnused();
    });
    return this._activateIfUnused(), this._subscribers.add(n), n;
  }
  observeTransits(e) {
    this._activateIfUnused(), this._observers.add(e);
    let t = !1;
    return { dispose: () => {
      t || (t = !0, this._observers.delete(e), this._deactivateIfUnused());
    } };
  }
  dispose() {
    for (const e of [...this._subscribers]) e.dispose();
    this._subscribers.clear(), this._observers.clear(), this._outboundRequests.clear(), this._inboundRequests.clear(), this._setActive(!1);
  }
  _onMessage(e, t) {
    if (this._subscribers.size === 0 && this._observers.size === 0) return;
    const n = Date.now();
    let r;
    const o = this._endpoint("id" in t ? t.id ?? void 0 : void 0), s = {
      type: "transit",
      ts: n,
      nodeId: this._nodeId,
      ...e === "inbound" ? { in: o } : { out: o },
      disposition: e === "inbound" ? "consumed" : "forwarded"
    };
    if (Oe(t)) {
      const i = { method: t.method };
      this._requestMap(e).set(String(t.id), i), r = {
        ...s,
        kind: "request",
        method: t.method,
        params: t.params
      };
    } else if (qe(t)) {
      const i = e === "inbound" ? this._outboundRequests : this._inboundRequests, c = String(t.id), a = i.get(c);
      i.delete(c), r = {
        ...s,
        kind: "response",
        method: a?.method,
        result: "result" in t ? t.result : void 0,
        error: "error" in t ? t.error : void 0
      };
    } else if (tr(t) && t.method === ve) {
      const i = t.params, c = this._endpoint(i?.requestId);
      r = {
        ...s,
        ...e === "inbound" ? { in: c } : { out: c },
        kind: "stream",
        method: ve,
        params: t.params
      };
    } else r = {
      ...s,
      kind: "notification",
      method: t.method,
      params: t.params
    };
    for (const i of [...this._observers]) try {
      i(r);
    } catch {
    }
    for (const i of this._subscribers) i.enqueue(r);
  }
  _requestMap(e) {
    return e === "outbound" ? this._outboundRequests : this._inboundRequests;
  }
  _endpoint(e) {
    return {
      edgeId: this._portId,
      portId: this._portId,
      ...e !== void 0 ? { requestId: e } : {}
    };
  }
  _activateIfUnused() {
    this._subscribers.size === 0 && this._observers.size === 0 && this._setActive(!0);
  }
  _deactivateIfUnused() {
    this._subscribers.size !== 0 || this._observers.size !== 0 || (this._outboundRequests.clear(), this._inboundRequests.clear(), this._setActive(!1));
  }
}, ks = class ar {
  /**
  * Convenience: build a {@link JsonRpcChannel} `Channel` from the
  * given transport and wrap it in an `HubRpcConnection`. Use this
  * when you have a transport at hand and don't need a decorator
  * stack (e.g. signing).
  */
  static fromTransport(t) {
    return new ar(sr.create(t));
  }
  /** Underlying JSON-RPC sender — useful for callers that need raw access (e.g. to call hub-served methods that bypass the interface registry). */
  channel;
  /** key = `${serviceId ?? ""}::${interfaceId}` */
  _registry = /* @__PURE__ */ new Map();
  /** Descriptions for services that have been registered with a `serviceDescription`. */
  _serviceDescriptions = /* @__PURE__ */ new Map();
  /** Root-node-id requirement sets recorded per serviceId. */
  _serviceRootPrincipalSets = /* @__PURE__ */ new Map();
  _directoryWatchers = /* @__PURE__ */ new Set();
  _directoryListeners = /* @__PURE__ */ new Set();
  _inspection;
  _trafficInspector;
  _serviceInspectionRegistrations = /* @__PURE__ */ new Map();
  _wireChannel;
  _preset;
  /**
  * Construct from a {@link Channel} (binds the inbound handler and uses
  * `channel.sender` for outbound calls) or from a bare
  * {@link IRequestSender} (send-only — no inbound handler is registered,
  * useful for bootstrap flows like `createManagedIdentity`).
  */
  constructor(t) {
    "sender" in t ? (this._wireChannel = t, this.channel = t.sender, t.setRequestHandler({
      handleRequest: (n) => this._handleRequest(n),
      handleNotification: (n) => this._handleNotification(n)
    })) : (this._wireChannel = void 0, this.channel = t);
  }
  /** Get a typed client for `iface`, routed to the implicit (root) service. */
  get(t, n = {}) {
    return this._buildClient(t, n);
  }
  /** Get a service-scoped handle; all interfaces obtained from it route via `serviceId` (form 3). */
  service(t) {
    return new Es(this, t);
  }
  /** Register handlers for an interface on this connection's server side. */
  register(t, n, r = {}) {
    return this._register(t, n, r, !1);
  }
  _register(t, n, r, o) {
    const s = r.serviceId, i = `${s ?? ""}::${t.info.id}`;
    if (this._registry.has(i)) throw new Error(`Interface "${t.info.id}" already registered${s ? ` under service "${s}"` : ""}.`);
    let c = !1;
    if (r.serviceDescription !== void 0) {
      if (s === void 0) throw new Error("register: `serviceDescription` requires `serviceId`.");
      const d = this._serviceDescriptions.get(s);
      if (d !== void 0 && d !== r.serviceDescription) throw new Error(`register: conflicting descriptions for service "${s}".`);
      this._serviceDescriptions.set(s, r.serviceDescription), c = d === void 0;
    }
    if (r.rootPrincipalSets !== void 0) {
      if (s === void 0) throw new Error("register: `rootPrincipalSets` requires `serviceId`.");
      const d = this._serviceRootPrincipalSets.get(s);
      if (d !== void 0 && !Is(d, r.rootPrincipalSets)) throw new Error(`register: conflicting rootPrincipalSets for service "${s}".`);
      this._serviceRootPrincipalSets.set(s, r.rootPrincipalSets), c ||= d === void 0;
    }
    const a = {
      iface: t,
      handlers: n,
      serviceId: s,
      internalInspection: o
    };
    if (this._registry.set(i, a), this._notifyDirectoryWatchers(a, c), !o && s !== void 0 && this._inspection !== void 0 && !this._serviceInspectionRegistrations.has(s)) try {
      this._installServiceInspection(s);
    } catch (d) {
      throw this._registry.delete(i), this._notifyDirectoryWatchers(a), d;
    }
    let u = !1;
    return { dispose: () => {
      u || (u = !0, this._registry.get(i) === a && (this._registry.delete(i), this._notifyDirectoryWatchers(a), s === void 0 && this._preset?.interfaceId === t.info.id && (this._preset = void 0), s !== void 0 && !this._hasBusinessServiceRegistration(s) && (this._removeServiceInspection(s), this._serviceDescriptions.delete(s), this._serviceRootPrincipalSets.delete(s))));
    } };
  }
  /**
  * Declare the preset interface for form-1 (bare-method) dispatch. The
  * interface must already be registered under the root (no serviceId).
  * Surfaced via `hubrpc.defaults::get`.
  */
  setPreset(t) {
    const n = `::${t.info.id}`;
    if (!this._registry.has(n)) throw new Error(`setPreset: interface "${t.info.id}" is not registered under the root service.`);
    this._preset = {
      serviceId: void 0,
      interfaceId: t.info.id,
      hash: t.schemaHash
    };
  }
  /** Snapshot of every interface currently registered on this connection. */
  listRegisteredInterfaces() {
    return Array.from(this._registry.values()).map((t) => {
      const n = t.serviceId ?? "", r = {
        serviceId: n,
        interfaceId: t.iface.info.id,
        interfaceHash: t.iface.schemaHash
      }, o = n === "" ? void 0 : this._serviceDescriptions.get(n);
      o !== void 0 && (r.serviceDescription = o);
      const s = n === "" ? void 0 : this._serviceRootPrincipalSets.get(n);
      return s !== void 0 && (r.rootPrincipalSets = s), r;
    });
  }
  /** Subscribe to coarse local directory changes; listeners must re-list. */
  onDidChangeDirectory(t) {
    return this._directoryListeners.add(t), () => this._directoryListeners.delete(t);
  }
  /**
  * Look up a registered interface definition by id (and optional content
  * hash). Returns `undefined` if no registered interface matches.
  */
  findRegisteredInterface(t, n) {
    for (const r of this._registry.values())
      if (r.iface.info.id === t && !(n !== void 0 && r.iface.schemaHash !== n))
        return r.iface;
  }
  /**
  * Register the three hubrpc reflection interfaces (`defaults`,
  * `directory`, `schemas`), backed by this connection's live registry.
  *
  * By default they live under the root service (form-2 reachable as
  * `hubrpc.directory::list`). Pass `serviceId` to additionally mount
  * them under a specific service — useful for participants that live
  * behind a hub, so callers can reach reflection via form-3
  * `<serviceId>::hubrpc.directory::list`.
  *
  * Idempotent: re-registering the same `(serviceId, interfaceId)` pair
  * is a no-op.
  */
  enableReflection(t = {}) {
    const n = `${t.serviceId ?? ""}::${en.info.id}`;
    if (this._registry.has(n)) return { dispose() {
    } };
    const r = `${t.serviceId ?? ""}::`;
    for (const c of [tn, nn]) if (this._registry.has(`${r}${c.info.id}`)) throw new Error(`enableReflection: partial reflection registration for service "${t.serviceId ?? ""}".`);
    const o = t.serviceId !== void 0 ? { serviceId: t.serviceId } : {}, s = [];
    if (s.push(this.register(en, { get: () => this._preset ? {
      serviceId: this._preset.serviceId,
      interfaceId: this._preset.interfaceId,
      interfaceHash: this._preset.hash
    } : {} }, o)), s.push(this.register(tn, {
      list: ({ interfaceId: c, interfaceIdPrefix: a, serviceId: u, serviceIdScopes: d, cursor: l, limit: f }) => {
        const p = this.listRegisteredInterfaces().filter((E) => t.serviceId === void 0 || E.serviceId === t.serviceId).filter((E) => c === void 0 || E.interfaceId === c).filter((E) => a === void 0 || E.interfaceId.startsWith(a)).filter((E) => u === void 0 || E.serviceId === u).filter((E) => ir(E.serviceId, d)), v = l === void 0 ? 0 : Number.parseInt(l, 10) || 0, w = f === void 0 ? p.length : Math.min(p.length, v + f), $ = p.slice(v, w).map((E) => ({
          serviceId: E.serviceId,
          interfaceId: E.interfaceId,
          interfaceHash: E.interfaceHash,
          serviceDescription: E.serviceDescription,
          rootPrincipalSets: E.rootPrincipalSets?.map((C) => C.map((b) => ({ ...b })))
        }));
        return w < p.length ? {
          items: $,
          nextCursor: String(w)
        } : { items: $ };
      },
      watch: (c, a, u) => new Promise((d) => {
        const l = {
          interfaceId: c.interfaceId,
          interfaceIdPrefix: c.interfaceIdPrefix,
          serviceId: c.serviceId,
          serviceIdScopes: c.serviceIdScopes,
          send: () => u.send({})
        };
        this._directoryWatchers.add(l);
        const f = () => {
          this._directoryWatchers.delete(l), d({});
        };
        if (u.signal.aborted) {
          f();
          return;
        }
        u.signal.addEventListener("abort", f, { once: !0 });
      })
    }, o)), s.push(this.register(nn, { get: ({ interfaceId: c, hash: a }) => {
      const u = this.findRegisteredInterface(c, a);
      if (!u) throw new re("Interface not found", J.methodNotFound, {
        reason: "unknown-interface",
        interfaceId: c,
        hash: a
      });
      return { schema: u.toSchema() };
    } }, o)), t.serviceId !== void 0) try {
      this.enableReflection();
    } catch (c) {
      for (const a of s.reverse()) a.dispose();
      throw c;
    }
    let i = !1;
    return { dispose: () => {
      if (!i) {
        i = !0;
        for (const c of s.reverse()) c.dispose();
      }
    } };
  }
  _notifyDirectoryWatchers(t, n = !1) {
    for (const r of this._directoryListeners) try {
      r();
    } catch {
    }
    for (const r of this._directoryWatchers) {
      if (r.pending) continue;
      const o = un(r, t), s = n && t.serviceId !== void 0 && [...this._registry.values()].some((i) => i.serviceId === t.serviceId && un(r, i));
      !o && !s || (r.pending = !0, queueMicrotask(() => {
        r.pending = !1, this._directoryWatchers.has(r) && r.send();
      }));
    }
  }
  /**
  * Enable the root `hubrpc.node::getNodeId` topology-bootstrap service.
  *
  * The generated ids are stable while this registration is active. They are
  * unauthenticated correlation labels only; callers must not use them for
  * identity, capability, or authorization decisions.
  */
  enableInspection(t) {
    if (this._inspection !== void 0) return this._inspection;
    const n = {
      nodeId: an("node"),
      portId: an("port"),
      ...t !== void 0 ? { descriptors: [...t] } : {}
    }, r = this._register(It, { getNodeId: () => n }, {}, !0), o = new Ss(n.nodeId, n.portId, (c) => this._wireChannel?.setWireMessageObserver(c ? o.observe : void 0, c ? (a) => this._isInspectionMethod(a) : void 0));
    this._trafficInspector = o;
    let s = !1;
    const i = {
      ...n,
      observeTraffic: (c) => o.observeTransits(c),
      dispose: () => {
        if (!s) {
          s = !0;
          for (const c of [...this._serviceInspectionRegistrations.keys()]) this._removeServiceInspection(c);
          o.dispose(), this._trafficInspector === o && (this._trafficInspector = void 0), r.dispose(), this._inspection === i && (this._inspection = void 0);
        }
      }
    };
    this._inspection = i;
    try {
      const c = new Set(Array.from(this._registry.values()).filter((a) => a.serviceId !== void 0 && !a.internalInspection).map((a) => a.serviceId));
      for (const a of c) this._installServiceInspection(a);
    } catch (c) {
      throw i.dispose(), c;
    }
    return i;
  }
  /** Number of active endpoint traffic stream subscribers. */
  get trafficObserverCount() {
    return this._trafficInspector?.observerCount ?? 0;
  }
  close() {
    this.channel.close();
  }
  _buildClient(t, n) {
    const { serviceId: r, ...o } = n, s = o, i = t.schemaHash, c = dt(t), a = {};
    for (const [u, d] of Object.entries(t.members)) {
      const l = r ? `${r}::${t.info.id}::${u}` : `${t.info.id}::${u}`;
      if (d.kind === "request") if (d.clientStreamSchema !== void 0 || d.serverStreamSchema !== void 0) {
        const f = d.serverStreamSchema;
        a[u] = (p, v) => {
          const w = v?.onMessage, $ = w !== void 0 ? (z) => {
            if (f !== void 0) {
              const x = Y(f, z);
              if (!x.success) return;
              w(x.data);
              return;
            }
            w(z);
          } : void 0, E = $ !== void 0 ? {
            ctx: s,
            interfaceHash: i,
            onStreamMessage: $
          } : {
            ctx: s,
            interfaceHash: i
          };
          c && ct(E);
          const C = this.channel.sendRequestWithStream(l, p, E), b = C.result.then((z) => {
            const x = Y(d.resultSchema, z === null ? void 0 : z);
            if (!x.success) throw new re(J.internalError, `Invalid result for ${l}`, { issues: x.error.issues });
            return z;
          });
          return Object.assign(b, {
            send: (z) => C.send(z),
            cancel: (z) => C.cancel(z),
            ping: () => C.ping()
          });
        };
      } else {
        const f = d.resultSchema;
        a[u] = async (p) => {
          const v = {
            ctx: s,
            interfaceHash: i
          };
          c && ct(v);
          const w = await this.channel.sendRequest(l, p, v), $ = Y(f, w === null ? void 0 : w);
          if (!$.success) throw new re(J.internalError, `Invalid result for ${l}`, { issues: $.error.issues });
          return w;
        };
      }
      else a[u] = async (f) => {
        const p = {
          ctx: s,
          interfaceHash: i
        };
        c && ct(p), this.channel.sendNotification(l, f, p);
      };
    }
    return a;
  }
  async _handleRequest(t) {
    const n = this._parseRouted(t.method);
    if (!n.ok) return xe(n.reason, t.method);
    const { entry: r, memberName: o } = n, s = r.iface.members[o];
    if (!s) return xe("unknown-method", t.method);
    const i = r.handlers[o];
    if (!i) return xe("unknown-method", t.method);
    const c = Y(s.paramsSchema, t.params);
    if (!c.success) return { error: {
      code: J.invalidParams,
      message: "Invalid params",
      data: { issues: c.error.issues }
    } };
    if (!(s instanceof Kn)) return xe("unknown-method", t.method);
    const a = this._buildStreamApi(t.stream, t.signal, s);
    try {
      const u = i(c.data, t.context, a);
      dt(r.iface) && t.stream.markInspectionLifecycle();
      const d = await u, l = Y(s.resultSchema, d);
      return l.success ? { result: d === void 0 ? null : d } : { error: {
        code: J.internalError,
        message: `Invalid result for ${t.method}`,
        data: { issues: l.error.issues }
      } };
    } catch (u) {
      return u instanceof re ? { error: {
        code: u.code,
        message: u.message,
        data: u.data
      } } : { error: {
        code: J.internalError,
        message: u instanceof Error ? u.message : String(u)
      } };
    }
  }
  _buildStreamApi(t, n, r) {
    return {
      send: (o) => {
        if (r.serverStreamSchema) {
          const s = Y(r.serverStreamSchema, o);
          if (!s.success) throw new Error(`Server stream payload failed schema validation: ${s.error.message}`);
        }
        return t.send(o);
      },
      onMessage: (o) => {
        t.onMessage((s) => {
          if (r.clientStreamSchema) {
            const i = Y(r.clientStreamSchema, s);
            if (!i.success) return;
            o(i.data);
            return;
          }
        });
      },
      ping: () => t.ping(),
      signal: n
    };
  }
  _handleNotification(t) {
    const n = this._parseRouted(t.method);
    if (!n.ok) return;
    const { entry: r, memberName: o } = n, s = r.iface.members[o];
    if (!(s instanceof Gn)) return;
    const i = r.handlers[o];
    if (!i) return;
    const c = Y(s.paramsSchema, t.params);
    c.success && i(c.data, t.context);
  }
  _parseRouted(t) {
    const n = fs(t);
    if (!n) return {
      ok: !1,
      reason: "bad-method-grammar"
    };
    if (n.kind === "bare") {
      if (!this._preset) return {
        ok: !1,
        reason: "no-preset"
      };
      const i = this._registry.get(`::${this._preset.interfaceId}`);
      return i ? {
        ok: !0,
        entry: i,
        memberName: n.member
      } : {
        ok: !1,
        reason: "no-preset"
      };
    }
    const r = n.kind === "full" ? n.serviceId : void 0, o = `${r ?? ""}::${n.interfaceId}`, s = this._registry.get(o);
    return s ? {
      ok: !0,
      entry: s,
      memberName: n.member
    } : {
      ok: !1,
      reason: r ? "unknown-service" : "unknown-interface"
    };
  }
  _installServiceInspection(t) {
    if (this._serviceInspectionRegistrations.has(t)) return;
    const n = this._inspection, r = this._trafficInspector;
    if (n === void 0 || r === void 0) return;
    const o = [], s = { serviceId: t };
    try {
      o.push(this._register(It, { getNodeId: () => ({
        nodeId: n.nodeId,
        portId: n.portId
      }) }, s, !0)), o.push(this._register(Qn, {
        getGraph: () => this._endpointGraph(t, n),
        watchGraph: async (i, c, a) => (await Os(a.signal), {})
      }, s, !0)), o.push(this._register(er, {
        watch: ({ methodPrefix: i }, c, a) => this._watchTraffic(r, { methodPrefix: i }, a),
        watchWithPayloads: ({ methodPrefix: i, maxPayloadBytes: c }, a, u) => this._watchTraffic(r, {
          methodPrefix: i,
          maxPayloadBytes: c
        }, u)
      }, s, !0));
    } catch (i) {
      for (const c of o.reverse()) c.dispose();
      throw i;
    }
    this._serviceInspectionRegistrations.set(t, o);
  }
  _removeServiceInspection(t) {
    const n = this._serviceInspectionRegistrations.get(t);
    if (n !== void 0) {
      this._serviceInspectionRegistrations.delete(t);
      for (const r of n.reverse()) r.dispose();
    }
  }
  _hasBusinessServiceRegistration(t) {
    return Array.from(this._registry.values()).some((n) => n.serviceId === t && !n.internalInspection);
  }
  _isInspectionMethod(t) {
    const n = this._parseRouted(t);
    return n.ok && dt(n.entry.iface);
  }
  _endpointGraph(t, n) {
    return {
      observerServiceId: t,
      entryNodeId: n.nodeId,
      nodes: [{
        nodeId: n.nodeId,
        kind: "endpoint",
        ...n.descriptors !== void 0 ? { descriptors: n.descriptors } : {},
        ports: [{ portId: n.portId }]
      }],
      links: [],
      routes: [{
        serviceId: t,
        nodeId: n.nodeId,
        portId: n.portId,
        match: "exact"
      }]
    };
  }
  async _watchTraffic(t, n, r) {
    const o = t.subscribe(n, (i) => r.send(i)), s = () => o.dispose();
    r.signal.aborted ? s() : r.signal.addEventListener("abort", s, { once: !0 });
    try {
      return await o.closed;
    } finally {
      r.signal.removeEventListener("abort", s), o.dispose();
    }
  }
};
function an(e) {
  const t = /* @__PURE__ */ new Uint8Array(16);
  return globalThis.crypto.getRandomValues(t), `${e}:${ls(t)}`;
}
function Is(e, t) {
  if (e.length !== t.length) return !1;
  for (let n = 0; n < e.length; n++) {
    const r = e[n], o = t[n];
    if (r.length !== o.length) return !1;
    for (let s = 0; s < r.length; s++)
      if (r[s].principal !== o[s].principal || r[s].transitive === !0 != (o[s].transitive === !0)) return !1;
  }
  return !0;
}
function un(e, t) {
  const n = t.serviceId ?? "";
  return (e.interfaceId === void 0 || e.interfaceId === t.iface.info.id) && (e.interfaceIdPrefix === void 0 || t.iface.info.id.startsWith(e.interfaceIdPrefix)) && (e.serviceId === void 0 || e.serviceId === n) && ir(n, e.serviceIdScopes);
}
var Es = class {
  _connection;
  _serviceId;
  constructor(e, t) {
    this._connection = e, this._serviceId = t;
  }
  get(e, t = {}) {
    return this._connection.get(e, {
      ...t,
      serviceId: this._serviceId
    });
  }
  register(e, t, n = {}) {
    return this._connection.register(e, t, {
      ...n,
      serviceId: this._serviceId
    });
  }
};
function xe(e, t) {
  return { error: {
    code: J.methodNotFound,
    message: `Method not found: ${t}`,
    data: {
      reason: e,
      method: t
    }
  } };
}
function dt(e) {
  return e === It || e === Qn || e === er;
}
function Os(e) {
  return e.aborted ? Promise.resolve() : new Promise((t) => {
    e.addEventListener("abort", () => t(), { once: !0 });
  });
}
Ps(globalThis, {});
function Ps(e, t) {
  return new Proxy(e, {
    get(n, r, o) {
      return r in t ? t[r] : e[r];
    },
    set(n, r, o) {
      return r in t && delete t[r], e[r] = o, !0;
    },
    deleteProperty(n, r) {
      let o = !1;
      return r in t && (delete t[r], o = !0), r in e && (delete e[r], o = !0), o;
    },
    ownKeys(n) {
      const r = Reflect.ownKeys(e), o = Reflect.ownKeys(t), s = new Set(o);
      return [...r.filter((i) => !s.has(i)), ...o];
    },
    defineProperty(n, r, o) {
      return r in t && delete t[r], Reflect.defineProperty(e, r, o), !0;
    },
    getOwnPropertyDescriptor(n, r) {
      return r in t ? Reflect.getOwnPropertyDescriptor(t, r) : Reflect.getOwnPropertyDescriptor(e, r);
    },
    has(n, r) {
      return r in t || r in e;
    }
  });
}
const ue = /* @__PURE__ */ m();
W({
  id: "identity",
  description: "Per-participant key oracle: exposes signing and HPKE-based wrap/unwrap for the identity the executor has attached to this participant's root overlay. Private keys never leave the executor."
}, {
  getPrincipal: O(/* @__PURE__ */ g({}), /* @__PURE__ */ g({ principal: /* @__PURE__ */ m() })),
  getWrapPublicKey: O(/* @__PURE__ */ g({}), /* @__PURE__ */ g({ wrapPublicKey: ue })),
  sign: O(/* @__PURE__ */ g({ bytes: ue }), /* @__PURE__ */ g({ signature: ue })),
  wrap: O(/* @__PURE__ */ g({
    domain: /* @__PURE__ */ m(),
    bytes: ue
  }), /* @__PURE__ */ g({ blob: ue })),
  unwrap: O(/* @__PURE__ */ g({
    domain: /* @__PURE__ */ m(),
    blob: ue
  }), /* @__PURE__ */ g({ bytes: ue }))
});
W({
  id: "identity.storage",
  description: "Per-identity persistent key/value store. Scope is the executor's managed-identity slot; lifecycle is tied to the identity itself. Backed by an at-rest-encrypted file in the executor."
}, {
  get: O(/* @__PURE__ */ g({ key: /* @__PURE__ */ m() }), /* @__PURE__ */ g({ value: /* @__PURE__ */ y(/* @__PURE__ */ de()) })),
  set: O(/* @__PURE__ */ g({
    key: /* @__PURE__ */ m(),
    value: /* @__PURE__ */ de()
  }), /* @__PURE__ */ g({})),
  delete: O(/* @__PURE__ */ g({ key: /* @__PURE__ */ m() }), /* @__PURE__ */ g({ existed: /* @__PURE__ */ et() })),
  list: O(/* @__PURE__ */ g({ prefix: /* @__PURE__ */ y(/* @__PURE__ */ m()) }), /* @__PURE__ */ g({ keys: /* @__PURE__ */ q(/* @__PURE__ */ m()) }))
});
var Zs = class {
  _our;
  _their;
  _filterSource;
  _listener;
  _buffer = [];
  _closed = !1;
  _handler = (e) => {
    if (this._filterSource && e.source !== this._their) return;
    const t = e.data;
    Ts(t) && (this._listener ? this._listener(t) : this._buffer.push(t));
  };
  constructor(e, t, n = !0) {
    if (this._our = e, this._their = t, this._filterSource = n, e === t) throw new Error("WindowMessageTransport: cannot connect to self");
    e.addEventListener("message", this._handler);
  }
  send(e) {
    this._closed || this._their.postMessage(e, "*");
  }
  setListener(e) {
    if (this._listener = e, e) for (; this._buffer.length > 0 && this._listener; ) e(this._buffer.shift());
  }
  dispose() {
    this._closed || (this._closed = !0, this._our.removeEventListener("message", this._handler));
  }
};
function Ts(e) {
  return typeof e == "object" && e !== null && e.jsonrpc === "2.0";
}
var dn;
function h(e, t, n) {
  function r(c, a) {
    if (c._zod || Object.defineProperty(c, "_zod", {
      value: {
        def: a,
        constr: i,
        traits: /* @__PURE__ */ new Set()
      },
      enumerable: !1
    }), c._zod.traits.has(e)) return;
    c._zod.traits.add(e), t(c, a);
    const u = i.prototype, d = Object.keys(u);
    for (let l = 0; l < d.length; l++) {
      const f = d[l];
      f in c || (c[f] = u[f].bind(c));
    }
  }
  const o = n?.Parent ?? Object;
  class s extends o {
  }
  Object.defineProperty(s, "name", { value: e });
  function i(c) {
    var a;
    const u = n?.Parent ? new s() : this;
    r(u, c), (a = u._zod).deferred ?? (a.deferred = []);
    for (const d of u._zod.deferred) d();
    return u;
  }
  return Object.defineProperty(i, "init", { value: r }), Object.defineProperty(i, Symbol.hasInstance, { value: (c) => n?.Parent && c instanceof n.Parent ? !0 : c?._zod?.traits?.has(e) }), Object.defineProperty(i, "name", { value: e }), i;
}
var be = class extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
}, ur = class extends Error {
  constructor(e) {
    super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
  }
};
(dn = globalThis).__zod_globalConfig ?? (dn.__zod_globalConfig = {});
const Rt = globalThis.__zod_globalConfig;
function he(e) {
  return Rt;
}
function dr(e) {
  const t = Object.values(e).filter((n) => typeof n == "number");
  return Object.entries(e).filter(([n, r]) => t.indexOf(+n) === -1).map(([n, r]) => r);
}
function Et(e, t) {
  return typeof t == "bigint" ? t.toString() : t;
}
function tt(e) {
  return { get value() {
    {
      const t = e();
      return Object.defineProperty(this, "value", { value: t }), t;
    }
  } };
}
function Nt(e) {
  return e == null;
}
function Ct(e) {
  const t = e.startsWith("^") ? 1 : 0, n = e.endsWith("$") ? e.length - 1 : e.length;
  return e.slice(t, n);
}
function Rs(e, t) {
  const n = e / t, r = Math.round(n), o = Number.EPSILON * Math.max(Math.abs(n), 1);
  return Math.abs(n - r) < o ? 0 : n - r;
}
const ln = /* @__PURE__ */ Symbol("evaluating");
function I(e, t, n) {
  let r;
  Object.defineProperty(e, t, {
    get() {
      if (r !== ln)
        return r === void 0 && (r = ln, r = n()), r;
    },
    set(o) {
      Object.defineProperty(e, t, { value: o });
    },
    configurable: !0
  });
}
function me(e, t, n) {
  Object.defineProperty(e, t, {
    value: n,
    writable: !0,
    enumerable: !0,
    configurable: !0
  });
}
function se(...e) {
  const t = {};
  for (const n of e) {
    const r = Object.getOwnPropertyDescriptors(n);
    Object.assign(t, r);
  }
  return Object.defineProperties({}, t);
}
function fn(e) {
  return JSON.stringify(e);
}
function Ns(e) {
  return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const lr = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {
};
function Re(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
const Cs = /* @__PURE__ */ tt(() => {
  if (Rt.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
  try {
    return new Function(""), !0;
  } catch {
    return !1;
  }
});
function Ne(e) {
  if (Re(e) === !1) return !1;
  const t = e.constructor;
  if (t === void 0 || typeof t != "function") return !0;
  const n = t.prototype;
  return !(Re(n) === !1 || Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") === !1);
}
function fr(e) {
  return Ne(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
const As = /* @__PURE__ */ new Set([
  "string",
  "number",
  "symbol"
]);
function $e(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function ce(e, t, n) {
  const r = new e._zod.constr(t ?? e._zod.def);
  return (!t || n?.parent) && (r._zod.parent = e), r;
}
function _(e) {
  const t = e;
  if (!t) return {};
  if (typeof t == "string") return { error: () => t };
  if (t?.message !== void 0) {
    if (t?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
    t.error = t.message;
  }
  return delete t.message, typeof t.error == "string" ? {
    ...t,
    error: () => t.error
  } : t;
}
function js(e) {
  return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
const Ms = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function xs(e, t) {
  const n = e._zod.def, r = n.checks;
  if (r && r.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
  return ce(e, se(e._zod.def, {
    get shape() {
      const o = {};
      for (const s in t) {
        if (!(s in n.shape)) throw new Error(`Unrecognized key: "${s}"`);
        t[s] && (o[s] = n.shape[s]);
      }
      return me(this, "shape", o), o;
    },
    checks: []
  }));
}
function Ds(e, t) {
  const n = e._zod.def, r = n.checks;
  if (r && r.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
  return ce(e, se(e._zod.def, {
    get shape() {
      const o = { ...e._zod.def.shape };
      for (const s in t) {
        if (!(s in n.shape)) throw new Error(`Unrecognized key: "${s}"`);
        t[s] && delete o[s];
      }
      return me(this, "shape", o), o;
    },
    checks: []
  }));
}
function Fs(e, t) {
  if (!Ne(t)) throw new Error("Invalid input to extend: expected a plain object");
  const n = e._zod.def.checks;
  if (n && n.length > 0) {
    const r = e._zod.def.shape;
    for (const o in t) if (Object.getOwnPropertyDescriptor(r, o) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
  }
  return ce(e, se(e._zod.def, { get shape() {
    const r = {
      ...e._zod.def.shape,
      ...t
    };
    return me(this, "shape", r), r;
  } }));
}
function Ls(e, t) {
  if (!Ne(t)) throw new Error("Invalid input to safeExtend: expected a plain object");
  return ce(e, se(e._zod.def, { get shape() {
    const n = {
      ...e._zod.def.shape,
      ...t
    };
    return me(this, "shape", n), n;
  } }));
}
function Us(e, t) {
  if (e._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  return ce(e, se(e._zod.def, {
    get shape() {
      const n = {
        ...e._zod.def.shape,
        ...t._zod.def.shape
      };
      return me(this, "shape", n), n;
    },
    get catchall() {
      return t._zod.def.catchall;
    },
    checks: t._zod.def.checks ?? []
  }));
}
function Js(e, t, n) {
  const r = t._zod.def.checks;
  if (r && r.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
  return ce(t, se(t._zod.def, {
    get shape() {
      const o = t._zod.def.shape, s = { ...o };
      if (n) for (const i in n) {
        if (!(i in o)) throw new Error(`Unrecognized key: "${i}"`);
        n[i] && (s[i] = e ? new e({
          type: "optional",
          innerType: o[i]
        }) : o[i]);
      }
      else for (const i in o) s[i] = e ? new e({
        type: "optional",
        innerType: o[i]
      }) : o[i];
      return me(this, "shape", s), s;
    },
    checks: []
  }));
}
function qs(e, t, n) {
  return ce(t, se(t._zod.def, { get shape() {
    const r = t._zod.def.shape, o = { ...r };
    if (n) for (const s in n) {
      if (!(s in o)) throw new Error(`Unrecognized key: "${s}"`);
      n[s] && (o[s] = new e({
        type: "nonoptional",
        innerType: r[s]
      }));
    }
    else for (const s in r) o[s] = new e({
      type: "nonoptional",
      innerType: r[s]
    });
    return me(this, "shape", o), o;
  } }));
}
function ye(e, t = 0) {
  if (e.aborted === !0) return !0;
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
  return !1;
}
function Vs(e, t = 0) {
  if (e.aborted === !0) return !0;
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
  return !1;
}
function hr(e, t) {
  return t.map((n) => {
    var r;
    return (r = n).path ?? (r.path = []), n.path.unshift(e), n;
  });
}
function De(e) {
  return typeof e == "string" ? e : e?.message;
}
function pe(e, t, n) {
  const r = e.message ? e.message : De(e.inst?._zod.def?.error?.(e)) ?? De(t?.error?.(e)) ?? De(n.customError?.(e)) ?? De(n.localeError?.(e)) ?? "Invalid input", { inst: o, continue: s, input: i, ...c } = e;
  return c.path ?? (c.path = []), c.message = r, t?.reportInput && (c.input = i), c;
}
function At(e) {
  return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Ce(...e) {
  const [t, n, r] = e;
  return typeof t == "string" ? {
    message: t,
    code: "custom",
    input: n,
    inst: r
  } : { ...t };
}
const pr = (e, t) => {
  e.name = "$ZodError", Object.defineProperty(e, "_zod", {
    value: e._zod,
    enumerable: !1
  }), Object.defineProperty(e, "issues", {
    value: t,
    enumerable: !1
  }), e.message = JSON.stringify(t, Et, 2), Object.defineProperty(e, "toString", {
    value: () => e.message,
    enumerable: !1
  });
}, mr = h("$ZodError", pr), _r = h("$ZodError", pr, { Parent: Error });
function Ws(e, t = (n) => n.message) {
  const n = {}, r = [];
  for (const o of e.issues) o.path.length > 0 ? (n[o.path[0]] = n[o.path[0]] || [], n[o.path[0]].push(t(o))) : r.push(t(o));
  return {
    formErrors: r,
    fieldErrors: n
  };
}
function Hs(e, t = (n) => n.message) {
  const n = { _errors: [] }, r = (o, s = []) => {
    for (const i of o.issues) if (i.code === "invalid_union" && i.errors.length) i.errors.map((c) => r({ issues: c }, [...s, ...i.path]));
    else if (i.code === "invalid_key") r({ issues: i.issues }, [...s, ...i.path]);
    else if (i.code === "invalid_element") r({ issues: i.issues }, [...s, ...i.path]);
    else {
      const c = [...s, ...i.path];
      if (c.length === 0) n._errors.push(t(i));
      else {
        let a = n, u = 0;
        for (; u < c.length; ) {
          const d = c[u];
          u !== c.length - 1 ? a[d] = a[d] || { _errors: [] } : (a[d] = a[d] || { _errors: [] }, a[d]._errors.push(t(i))), a = a[d], u++;
        }
      }
    }
  };
  return r(e), n;
}
const jt = (e) => (t, n, r, o) => {
  const s = r ? {
    ...r,
    async: !1
  } : { async: !1 }, i = t._zod.run({
    value: n,
    issues: []
  }, s);
  if (i instanceof Promise) throw new be();
  if (i.issues.length) {
    const c = new (o?.Err ?? e)(i.issues.map((a) => pe(a, s, he())));
    throw lr(c, o?.callee), c;
  }
  return i.value;
}, Mt = (e) => async (t, n, r, o) => {
  const s = r ? {
    ...r,
    async: !0
  } : { async: !0 };
  let i = t._zod.run({
    value: n,
    issues: []
  }, s);
  if (i instanceof Promise && (i = await i), i.issues.length) {
    const c = new (o?.Err ?? e)(i.issues.map((a) => pe(a, s, he())));
    throw lr(c, o?.callee), c;
  }
  return i.value;
}, nt = (e) => (t, n, r) => {
  const o = r ? {
    ...r,
    async: !1
  } : { async: !1 }, s = t._zod.run({
    value: n,
    issues: []
  }, o);
  if (s instanceof Promise) throw new be();
  return s.issues.length ? {
    success: !1,
    error: new (e ?? mr)(s.issues.map((i) => pe(i, o, he())))
  } : {
    success: !0,
    data: s.value
  };
}, Ks = /* @__PURE__ */ nt(_r), rt = (e) => async (t, n, r) => {
  const o = r ? {
    ...r,
    async: !0
  } : { async: !0 };
  let s = t._zod.run({
    value: n,
    issues: []
  }, o);
  return s instanceof Promise && (s = await s), s.issues.length ? {
    success: !1,
    error: new e(s.issues.map((i) => pe(i, o, he())))
  } : {
    success: !0,
    data: s.value
  };
}, Bs = /* @__PURE__ */ rt(_r), Gs = (e) => (t, n, r) => {
  const o = r ? {
    ...r,
    direction: "backward"
  } : { direction: "backward" };
  return jt(e)(t, n, o);
}, Ys = (e) => (t, n, r) => jt(e)(t, n, r), Xs = (e) => async (t, n, r) => {
  const o = r ? {
    ...r,
    direction: "backward"
  } : { direction: "backward" };
  return Mt(e)(t, n, o);
}, Qs = (e) => async (t, n, r) => Mt(e)(t, n, r), ec = (e) => (t, n, r) => {
  const o = r ? {
    ...r,
    direction: "backward"
  } : { direction: "backward" };
  return nt(e)(t, n, o);
}, tc = (e) => (t, n, r) => nt(e)(t, n, r), nc = (e) => async (t, n, r) => {
  const o = r ? {
    ...r,
    direction: "backward"
  } : { direction: "backward" };
  return rt(e)(t, n, o);
}, rc = (e) => async (t, n, r) => rt(e)(t, n, r), oc = /^[cC][0-9a-z]{6,}$/, ic = /^[0-9a-z]+$/, sc = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, cc = /^[0-9a-vA-V]{20}$/, ac = /^[A-Za-z0-9]{27}$/, uc = /^[a-zA-Z0-9_-]{21}$/, dc = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, lc = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, hn = (e) => e ? new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, fc = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, hc = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function pc() {
  return new RegExp(hc, "u");
}
const mc = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, _c = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, gc = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, vc = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, yc = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, gr = /^[A-Za-z0-9_-]*$/, bc = /^https?$/, wc = /^\+[1-9]\d{6,14}$/, vr = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", zc = /* @__PURE__ */ new RegExp(`^${vr}$`);
function yr(e) {
  const t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
  return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function $c(e) {
  return new RegExp(`^${yr(e)}$`);
}
function Sc(e) {
  const t = yr({ precision: e.precision }), n = ["Z"];
  e.local && n.push(""), e.offset && n.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
  const r = `${t}(?:${n.join("|")})`;
  return new RegExp(`^${vr}T(?:${r})$`);
}
const kc = (e) => {
  const t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
  return new RegExp(`^${t}$`);
}, Ic = /^-?\d+$/, Ec = /^-?\d+(?:\.\d+)?$/, Oc = /^(?:true|false)$/i, Pc = /^[^A-Z]*$/, Zc = /^[^a-z]*$/, U = /* @__PURE__ */ h("$ZodCheck", (e, t) => {
  var n;
  e._zod ?? (e._zod = {}), e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), br = {
  number: "number",
  bigint: "bigint",
  object: "date"
}, wr = /* @__PURE__ */ h("$ZodCheckLessThan", (e, t) => {
  U.init(e, t);
  const n = br[typeof t.value];
  e._zod.onattach.push((r) => {
    const o = r._zod.bag, s = (t.inclusive ? o.maximum : o.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    t.value < s && (t.inclusive ? o.maximum = t.value : o.exclusiveMaximum = t.value);
  }), e._zod.check = (r) => {
    (t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
      origin: n,
      code: "too_big",
      maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
      input: r.value,
      inclusive: t.inclusive,
      inst: e,
      continue: !t.abort
    });
  };
}), zr = /* @__PURE__ */ h("$ZodCheckGreaterThan", (e, t) => {
  U.init(e, t);
  const n = br[typeof t.value];
  e._zod.onattach.push((r) => {
    const o = r._zod.bag, s = (t.inclusive ? o.minimum : o.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    t.value > s && (t.inclusive ? o.minimum = t.value : o.exclusiveMinimum = t.value);
  }), e._zod.check = (r) => {
    (t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
      origin: n,
      code: "too_small",
      minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
      input: r.value,
      inclusive: t.inclusive,
      inst: e,
      continue: !t.abort
    });
  };
}), Tc = /* @__PURE__ */ h("$ZodCheckMultipleOf", (e, t) => {
  U.init(e, t), e._zod.onattach.push((n) => {
    var r;
    (r = n._zod.bag).multipleOf ?? (r.multipleOf = t.value);
  }), e._zod.check = (n) => {
    if (typeof n.value != typeof t.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
    (typeof n.value == "bigint" ? n.value % t.value === BigInt(0) : Rs(n.value, t.value) === 0) || n.issues.push({
      origin: typeof n.value,
      code: "not_multiple_of",
      divisor: t.value,
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Rc = /* @__PURE__ */ h("$ZodCheckNumberFormat", (e, t) => {
  U.init(e, t), t.format = t.format || "float64";
  const n = t.format?.includes("int"), r = n ? "int" : "number", [o, s] = Ms[t.format];
  e._zod.onattach.push((i) => {
    const c = i._zod.bag;
    c.format = t.format, c.minimum = o, c.maximum = s, n && (c.pattern = Ic);
  }), e._zod.check = (i) => {
    const c = i.value;
    if (n) {
      if (!Number.isInteger(c)) {
        i.issues.push({
          expected: r,
          format: t.format,
          code: "invalid_type",
          continue: !1,
          input: c,
          inst: e
        });
        return;
      }
      if (!Number.isSafeInteger(c)) {
        c > 0 ? i.issues.push({
          input: c,
          code: "too_big",
          maximum: Number.MAX_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          inclusive: !0,
          continue: !t.abort
        }) : i.issues.push({
          input: c,
          code: "too_small",
          minimum: Number.MIN_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          inclusive: !0,
          continue: !t.abort
        });
        return;
      }
    }
    c < o && i.issues.push({
      origin: "number",
      input: c,
      code: "too_small",
      minimum: o,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    }), c > s && i.issues.push({
      origin: "number",
      input: c,
      code: "too_big",
      maximum: s,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    });
  };
}), Nc = /* @__PURE__ */ h("$ZodCheckMaxLength", (e, t) => {
  var n;
  U.init(e, t), (n = e._zod.def).when ?? (n.when = (r) => {
    const o = r.value;
    return !Nt(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    t.maximum < o && (r._zod.bag.maximum = t.maximum);
  }), e._zod.check = (r) => {
    const o = r.value;
    if (o.length <= t.maximum) return;
    const s = At(o);
    r.issues.push({
      origin: s,
      code: "too_big",
      maximum: t.maximum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !t.abort
    });
  };
}), Cc = /* @__PURE__ */ h("$ZodCheckMinLength", (e, t) => {
  var n;
  U.init(e, t), (n = e._zod.def).when ?? (n.when = (r) => {
    const o = r.value;
    return !Nt(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    t.minimum > o && (r._zod.bag.minimum = t.minimum);
  }), e._zod.check = (r) => {
    const o = r.value;
    if (o.length >= t.minimum) return;
    const s = At(o);
    r.issues.push({
      origin: s,
      code: "too_small",
      minimum: t.minimum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !t.abort
    });
  };
}), Ac = /* @__PURE__ */ h("$ZodCheckLengthEquals", (e, t) => {
  var n;
  U.init(e, t), (n = e._zod.def).when ?? (n.when = (r) => {
    const o = r.value;
    return !Nt(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag;
    o.minimum = t.length, o.maximum = t.length, o.length = t.length;
  }), e._zod.check = (r) => {
    const o = r.value, s = o.length;
    if (s === t.length) return;
    const i = At(o), c = s > t.length;
    r.issues.push({
      origin: i,
      ...c ? {
        code: "too_big",
        maximum: t.length
      } : {
        code: "too_small",
        minimum: t.length
      },
      inclusive: !0,
      exact: !0,
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), ot = /* @__PURE__ */ h("$ZodCheckStringFormat", (e, t) => {
  var n, r;
  U.init(e, t), e._zod.onattach.push((o) => {
    const s = o._zod.bag;
    s.format = t.format, t.pattern && (s.patterns ?? (s.patterns = /* @__PURE__ */ new Set()), s.patterns.add(t.pattern));
  }), t.pattern ? (n = e._zod).check ?? (n.check = (o) => {
    t.pattern.lastIndex = 0, !t.pattern.test(o.value) && o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: t.format,
      input: o.value,
      ...t.pattern ? { pattern: t.pattern.toString() } : {},
      inst: e,
      continue: !t.abort
    });
  }) : (r = e._zod).check ?? (r.check = () => {
  });
}), jc = /* @__PURE__ */ h("$ZodCheckRegex", (e, t) => {
  ot.init(e, t), e._zod.check = (n) => {
    t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: n.value,
      pattern: t.pattern.toString(),
      inst: e,
      continue: !t.abort
    });
  };
}), Mc = /* @__PURE__ */ h("$ZodCheckLowerCase", (e, t) => {
  t.pattern ?? (t.pattern = Pc), ot.init(e, t);
}), xc = /* @__PURE__ */ h("$ZodCheckUpperCase", (e, t) => {
  t.pattern ?? (t.pattern = Zc), ot.init(e, t);
}), Dc = /* @__PURE__ */ h("$ZodCheckIncludes", (e, t) => {
  U.init(e, t);
  const n = $e(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
  t.pattern = r, e._zod.onattach.push((o) => {
    const s = o._zod.bag;
    s.patterns ?? (s.patterns = /* @__PURE__ */ new Set()), s.patterns.add(r);
  }), e._zod.check = (o) => {
    o.value.includes(t.includes, t.position) || o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: t.includes,
      input: o.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Fc = /* @__PURE__ */ h("$ZodCheckStartsWith", (e, t) => {
  U.init(e, t);
  const n = new RegExp(`^${$e(t.prefix)}.*`);
  t.pattern ?? (t.pattern = n), e._zod.onattach.push((r) => {
    const o = r._zod.bag;
    o.patterns ?? (o.patterns = /* @__PURE__ */ new Set()), o.patterns.add(n);
  }), e._zod.check = (r) => {
    r.value.startsWith(t.prefix) || r.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: t.prefix,
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Lc = /* @__PURE__ */ h("$ZodCheckEndsWith", (e, t) => {
  U.init(e, t);
  const n = new RegExp(`.*${$e(t.suffix)}$`);
  t.pattern ?? (t.pattern = n), e._zod.onattach.push((r) => {
    const o = r._zod.bag;
    o.patterns ?? (o.patterns = /* @__PURE__ */ new Set()), o.patterns.add(n);
  }), e._zod.check = (r) => {
    r.value.endsWith(t.suffix) || r.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: t.suffix,
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Uc = /* @__PURE__ */ h("$ZodCheckOverwrite", (e, t) => {
  U.init(e, t), e._zod.check = (n) => {
    n.value = t.tx(n.value);
  };
});
var Jc = class {
  constructor(e = []) {
    this.content = [], this.indent = 0, this && (this.args = e);
  }
  indented(e) {
    this.indent += 1, e(this), this.indent -= 1;
  }
  write(e) {
    if (typeof e == "function") {
      e(this, { execution: "sync" }), e(this, { execution: "async" });
      return;
    }
    const t = e.split(`
`).filter((o) => o), n = Math.min(...t.map((o) => o.length - o.trimStart().length)), r = t.map((o) => o.slice(n)).map((o) => " ".repeat(this.indent * 2) + o);
    for (const o of r) this.content.push(o);
  }
  compile() {
    const e = Function, t = this?.args, n = [...(this?.content ?? [""]).map((r) => `  ${r}`)];
    return new e(...t, n.join(`
`));
  }
};
const qc = {
  major: 4,
  minor: 4,
  patch: 3
}, R = /* @__PURE__ */ h("$ZodType", (e, t) => {
  var n;
  e ?? (e = {}), e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = qc;
  const r = [...e._zod.def.checks ?? []];
  e._zod.traits.has("$ZodCheck") && r.unshift(e);
  for (const o of r) for (const s of o._zod.onattach) s(e);
  if (r.length === 0)
    (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
      e._zod.run = e._zod.parse;
    });
  else {
    const o = (i, c, a) => {
      let u = ye(i), d;
      for (const l of c) {
        if (l._zod.def.when) {
          if (Vs(i) || !l._zod.def.when(i)) continue;
        } else if (u) continue;
        const f = i.issues.length, p = l._zod.check(i);
        if (p instanceof Promise && a?.async === !1) throw new be();
        if (d || p instanceof Promise) d = (d ?? Promise.resolve()).then(async () => {
          await p, i.issues.length !== f && (u || (u = ye(i, f)));
        });
        else {
          if (i.issues.length === f) continue;
          u || (u = ye(i, f));
        }
      }
      return d ? d.then(() => i) : i;
    }, s = (i, c, a) => {
      if (ye(i))
        return i.aborted = !0, i;
      const u = o(c, r, a);
      if (u instanceof Promise) {
        if (a.async === !1) throw new be();
        return u.then((d) => e._zod.parse(d, a));
      }
      return e._zod.parse(u, a);
    };
    e._zod.run = (i, c) => {
      if (c.skipChecks) return e._zod.parse(i, c);
      if (c.direction === "backward") {
        const u = e._zod.parse({
          value: i.value,
          issues: []
        }, {
          ...c,
          skipChecks: !0
        });
        return u instanceof Promise ? u.then((d) => s(d, i, c)) : s(u, i, c);
      }
      const a = e._zod.parse(i, c);
      if (a instanceof Promise) {
        if (c.async === !1) throw new be();
        return a.then((u) => o(u, r, c));
      }
      return o(a, r, c);
    };
  }
  I(e, "~standard", () => ({
    validate: (o) => {
      try {
        const s = Ks(e, o);
        return s.success ? { value: s.data } : { issues: s.error?.issues };
      } catch {
        return Bs(e, o).then((i) => i.success ? { value: i.data } : { issues: i.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
}), xt = /* @__PURE__ */ h("$ZodString", (e, t) => {
  R.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? kc(e._zod.bag), e._zod.parse = (n, r) => {
    if (t.coerce) try {
      n.value = String(n.value);
    } catch {
    }
    return typeof n.value == "string" || n.issues.push({
      expected: "string",
      code: "invalid_type",
      input: n.value,
      inst: e
    }), n;
  };
}), Z = /* @__PURE__ */ h("$ZodStringFormat", (e, t) => {
  ot.init(e, t), xt.init(e, t);
}), Vc = /* @__PURE__ */ h("$ZodGUID", (e, t) => {
  t.pattern ?? (t.pattern = lc), Z.init(e, t);
}), Wc = /* @__PURE__ */ h("$ZodUUID", (e, t) => {
  if (t.version) {
    const n = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    }[t.version];
    if (n === void 0) throw new Error(`Invalid UUID version: "${t.version}"`);
    t.pattern ?? (t.pattern = hn(n));
  } else t.pattern ?? (t.pattern = hn());
  Z.init(e, t);
}), Hc = /* @__PURE__ */ h("$ZodEmail", (e, t) => {
  t.pattern ?? (t.pattern = fc), Z.init(e, t);
}), Kc = /* @__PURE__ */ h("$ZodURL", (e, t) => {
  Z.init(e, t), e._zod.check = (n) => {
    try {
      const r = n.value.trim();
      if (!t.normalize && t.protocol?.source === bc.source && !/^https?:\/\//i.test(r)) {
        n.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: n.value,
          inst: e,
          continue: !t.abort
        });
        return;
      }
      const o = new URL(r);
      t.hostname && (t.hostname.lastIndex = 0, t.hostname.test(o.hostname) || n.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid hostname",
        pattern: t.hostname.source,
        input: n.value,
        inst: e,
        continue: !t.abort
      })), t.protocol && (t.protocol.lastIndex = 0, t.protocol.test(o.protocol.endsWith(":") ? o.protocol.slice(0, -1) : o.protocol) || n.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid protocol",
        pattern: t.protocol.source,
        input: n.value,
        inst: e,
        continue: !t.abort
      })), t.normalize ? n.value = o.href : n.value = r;
      return;
    } catch {
      n.issues.push({
        code: "invalid_format",
        format: "url",
        input: n.value,
        inst: e,
        continue: !t.abort
      });
    }
  };
}), Bc = /* @__PURE__ */ h("$ZodEmoji", (e, t) => {
  t.pattern ?? (t.pattern = pc()), Z.init(e, t);
}), Gc = /* @__PURE__ */ h("$ZodNanoID", (e, t) => {
  t.pattern ?? (t.pattern = uc), Z.init(e, t);
}), Yc = /* @__PURE__ */ h("$ZodCUID", (e, t) => {
  t.pattern ?? (t.pattern = oc), Z.init(e, t);
}), Xc = /* @__PURE__ */ h("$ZodCUID2", (e, t) => {
  t.pattern ?? (t.pattern = ic), Z.init(e, t);
}), Qc = /* @__PURE__ */ h("$ZodULID", (e, t) => {
  t.pattern ?? (t.pattern = sc), Z.init(e, t);
}), ea = /* @__PURE__ */ h("$ZodXID", (e, t) => {
  t.pattern ?? (t.pattern = cc), Z.init(e, t);
}), ta = /* @__PURE__ */ h("$ZodKSUID", (e, t) => {
  t.pattern ?? (t.pattern = ac), Z.init(e, t);
}), na = /* @__PURE__ */ h("$ZodISODateTime", (e, t) => {
  t.pattern ?? (t.pattern = Sc(t)), Z.init(e, t);
}), ra = /* @__PURE__ */ h("$ZodISODate", (e, t) => {
  t.pattern ?? (t.pattern = zc), Z.init(e, t);
}), oa = /* @__PURE__ */ h("$ZodISOTime", (e, t) => {
  t.pattern ?? (t.pattern = $c(t)), Z.init(e, t);
}), ia = /* @__PURE__ */ h("$ZodISODuration", (e, t) => {
  t.pattern ?? (t.pattern = dc), Z.init(e, t);
}), sa = /* @__PURE__ */ h("$ZodIPv4", (e, t) => {
  t.pattern ?? (t.pattern = mc), Z.init(e, t), e._zod.bag.format = "ipv4";
}), ca = /* @__PURE__ */ h("$ZodIPv6", (e, t) => {
  t.pattern ?? (t.pattern = _c), Z.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n) => {
    try {
      new URL(`http://[${n.value}]`);
    } catch {
      n.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: n.value,
        inst: e,
        continue: !t.abort
      });
    }
  };
}), aa = /* @__PURE__ */ h("$ZodCIDRv4", (e, t) => {
  t.pattern ?? (t.pattern = gc), Z.init(e, t);
}), ua = /* @__PURE__ */ h("$ZodCIDRv6", (e, t) => {
  t.pattern ?? (t.pattern = vc), Z.init(e, t), e._zod.check = (n) => {
    const r = n.value.split("/");
    try {
      if (r.length !== 2) throw new Error();
      const [o, s] = r;
      if (!s) throw new Error();
      const i = Number(s);
      if (`${i}` !== s) throw new Error();
      if (i < 0 || i > 128) throw new Error();
      new URL(`http://[${o}]`);
    } catch {
      n.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: n.value,
        inst: e,
        continue: !t.abort
      });
    }
  };
});
function $r(e) {
  if (e === "") return !0;
  if (/\s/.test(e) || e.length % 4 !== 0) return !1;
  try {
    return atob(e), !0;
  } catch {
    return !1;
  }
}
const da = /* @__PURE__ */ h("$ZodBase64", (e, t) => {
  t.pattern ?? (t.pattern = yc), Z.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n) => {
    $r(n.value) || n.issues.push({
      code: "invalid_format",
      format: "base64",
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
});
function la(e) {
  if (!gr.test(e)) return !1;
  const t = e.replace(/[-_]/g, (n) => n === "-" ? "+" : "/");
  return $r(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
const fa = /* @__PURE__ */ h("$ZodBase64URL", (e, t) => {
  t.pattern ?? (t.pattern = gr), Z.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n) => {
    la(n.value) || n.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), ha = /* @__PURE__ */ h("$ZodE164", (e, t) => {
  t.pattern ?? (t.pattern = wc), Z.init(e, t);
});
function pa(e, t = null) {
  try {
    const n = e.split(".");
    if (n.length !== 3) return !1;
    const [r] = n;
    if (!r) return !1;
    const o = JSON.parse(atob(r));
    return !("typ" in o && o?.typ !== "JWT" || !o.alg || t && (!("alg" in o) || o.alg !== t));
  } catch {
    return !1;
  }
}
const ma = /* @__PURE__ */ h("$ZodJWT", (e, t) => {
  Z.init(e, t), e._zod.check = (n) => {
    pa(n.value, t.alg) || n.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Sr = /* @__PURE__ */ h("$ZodNumber", (e, t) => {
  R.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? Ec, e._zod.parse = (n, r) => {
    if (t.coerce) try {
      n.value = Number(n.value);
    } catch {
    }
    const o = n.value;
    if (typeof o == "number" && !Number.isNaN(o) && Number.isFinite(o)) return n;
    const s = typeof o == "number" ? Number.isNaN(o) ? "NaN" : Number.isFinite(o) ? void 0 : "Infinity" : void 0;
    return n.issues.push({
      expected: "number",
      code: "invalid_type",
      input: o,
      inst: e,
      ...s ? { received: s } : {}
    }), n;
  };
}), _a = /* @__PURE__ */ h("$ZodNumberFormat", (e, t) => {
  Rc.init(e, t), Sr.init(e, t);
}), ga = /* @__PURE__ */ h("$ZodBoolean", (e, t) => {
  R.init(e, t), e._zod.pattern = Oc, e._zod.parse = (n, r) => {
    if (t.coerce) try {
      n.value = !!n.value;
    } catch {
    }
    const o = n.value;
    return typeof o == "boolean" || n.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input: o,
      inst: e
    }), n;
  };
}), va = /* @__PURE__ */ h("$ZodUnknown", (e, t) => {
  R.init(e, t), e._zod.parse = (n) => n;
}), ya = /* @__PURE__ */ h("$ZodNever", (e, t) => {
  R.init(e, t), e._zod.parse = (n, r) => (n.issues.push({
    expected: "never",
    code: "invalid_type",
    input: n.value,
    inst: e
  }), n);
});
function pn(e, t, n) {
  e.issues.length && t.issues.push(...hr(n, e.issues)), t.value[n] = e.value;
}
const ba = /* @__PURE__ */ h("$ZodArray", (e, t) => {
  R.init(e, t), e._zod.parse = (n, r) => {
    const o = n.value;
    if (!Array.isArray(o))
      return n.issues.push({
        expected: "array",
        code: "invalid_type",
        input: o,
        inst: e
      }), n;
    n.value = Array(o.length);
    const s = [];
    for (let i = 0; i < o.length; i++) {
      const c = o[i], a = t.element._zod.run({
        value: c,
        issues: []
      }, r);
      a instanceof Promise ? s.push(a.then((u) => pn(u, n, i))) : pn(a, n, i);
    }
    return s.length ? Promise.all(s).then(() => n) : n;
  };
});
function He(e, t, n, r, o, s) {
  const i = n in r;
  if (e.issues.length) {
    if (o && s && !i) return;
    t.issues.push(...hr(n, e.issues));
  }
  if (!i && !o) {
    e.issues.length || t.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: void 0,
      path: [n]
    });
    return;
  }
  e.value === void 0 ? i && (t.value[n] = void 0) : t.value[n] = e.value;
}
function kr(e) {
  const t = Object.keys(e.shape);
  for (const r of t) if (!e.shape?.[r]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${r}": expected a Zod schema`);
  const n = js(e.shape);
  return {
    ...e,
    keys: t,
    keySet: new Set(t),
    numKeys: t.length,
    optionalKeys: new Set(n)
  };
}
function Ir(e, t, n, r, o, s) {
  const i = [], c = o.keySet, a = o.catchall._zod, u = a.def.type, d = a.optin === "optional", l = a.optout === "optional";
  for (const f in t) {
    if (f === "__proto__" || c.has(f)) continue;
    if (u === "never") {
      i.push(f);
      continue;
    }
    const p = a.run({
      value: t[f],
      issues: []
    }, r);
    p instanceof Promise ? e.push(p.then((v) => He(v, n, f, t, d, l))) : He(p, n, f, t, d, l);
  }
  return i.length && n.issues.push({
    code: "unrecognized_keys",
    keys: i,
    input: t,
    inst: s
  }), e.length ? Promise.all(e).then(() => n) : n;
}
const wa = /* @__PURE__ */ h("$ZodObject", (e, t) => {
  if (R.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
    const i = t.shape;
    Object.defineProperty(t, "shape", { get: () => {
      const c = { ...i };
      return Object.defineProperty(t, "shape", { value: c }), c;
    } });
  }
  const n = tt(() => kr(t));
  I(e._zod, "propValues", () => {
    const i = t.shape, c = {};
    for (const a in i) {
      const u = i[a]._zod;
      if (u.values) {
        c[a] ?? (c[a] = /* @__PURE__ */ new Set());
        for (const d of u.values) c[a].add(d);
      }
    }
    return c;
  });
  const r = Re, o = t.catchall;
  let s;
  e._zod.parse = (i, c) => {
    s ?? (s = n.value);
    const a = i.value;
    if (!r(a))
      return i.issues.push({
        expected: "object",
        code: "invalid_type",
        input: a,
        inst: e
      }), i;
    i.value = {};
    const u = [], d = s.shape;
    for (const l of s.keys) {
      const f = d[l], p = f._zod.optin === "optional", v = f._zod.optout === "optional", w = f._zod.run({
        value: a[l],
        issues: []
      }, c);
      w instanceof Promise ? u.push(w.then(($) => He($, i, l, a, p, v))) : He(w, i, l, a, p, v);
    }
    return o ? Ir(u, a, i, c, n.value, e) : u.length ? Promise.all(u).then(() => i) : i;
  };
}), za = /* @__PURE__ */ h("$ZodObjectJIT", (e, t) => {
  wa.init(e, t);
  const n = e._zod.parse, r = tt(() => kr(t)), o = (l) => {
    const f = new Jc([
      "shape",
      "payload",
      "ctx"
    ]), p = r.value, v = (C) => {
      const b = fn(C);
      return `shape[${b}]._zod.run({ value: input[${b}], issues: [] }, ctx)`;
    };
    f.write("const input = payload.value;");
    const w = /* @__PURE__ */ Object.create(null);
    let $ = 0;
    for (const C of p.keys) w[C] = `key_${$++}`;
    f.write("const newResult = {};");
    for (const C of p.keys) {
      const b = w[C], z = fn(C), x = l[C], ae = x?._zod?.optin === "optional", ke = x?._zod?.optout === "optional";
      f.write(`const ${b} = ${v(C)};`), ae && ke ? f.write(`
        if (${b}.issues.length) {
          if (${z} in input) {
            payload.issues = payload.issues.concat(${b}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${z}, ...iss.path] : [${z}]
            })));
          }
        }
        
        if (${b}.value === undefined) {
          if (${z} in input) {
            newResult[${z}] = undefined;
          }
        } else {
          newResult[${z}] = ${b}.value;
        }
        
      `) : ae ? f.write(`
        if (${b}.issues.length) {
          payload.issues = payload.issues.concat(${b}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${z}, ...iss.path] : [${z}]
          })));
        }
        
        if (${b}.value === undefined) {
          if (${z} in input) {
            newResult[${z}] = undefined;
          }
        } else {
          newResult[${z}] = ${b}.value;
        }
        
      `) : f.write(`
        const ${b}_present = ${z} in input;
        if (${b}.issues.length) {
          payload.issues = payload.issues.concat(${b}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${z}, ...iss.path] : [${z}]
          })));
        }
        if (!${b}_present && !${b}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${z}]
          });
        }

        if (${b}_present) {
          if (${b}.value === undefined) {
            newResult[${z}] = undefined;
          } else {
            newResult[${z}] = ${b}.value;
          }
        }

      `);
    }
    f.write("payload.value = newResult;"), f.write("return payload;");
    const E = f.compile();
    return (C, b) => E(l, C, b);
  };
  let s;
  const i = Re, c = !Rt.jitless, a = c && Cs.value, u = t.catchall;
  let d;
  e._zod.parse = (l, f) => {
    d ?? (d = r.value);
    const p = l.value;
    return i(p) ? c && a && f?.async === !1 && f.jitless !== !0 ? (s || (s = o(t.shape)), l = s(l, f), u ? Ir([], p, l, f, d, e) : l) : n(l, f) : (l.issues.push({
      expected: "object",
      code: "invalid_type",
      input: p,
      inst: e
    }), l);
  };
});
function mn(e, t, n, r) {
  for (const s of e) if (s.issues.length === 0)
    return t.value = s.value, t;
  const o = e.filter((s) => !ye(s));
  return o.length === 1 ? (t.value = o[0].value, o[0]) : (t.issues.push({
    code: "invalid_union",
    input: t.value,
    inst: n,
    errors: e.map((s) => s.issues.map((i) => pe(i, r, he())))
  }), t);
}
const Er = /* @__PURE__ */ h("$ZodUnion", (e, t) => {
  R.init(e, t), I(e._zod, "optin", () => t.options.some((r) => r._zod.optin === "optional") ? "optional" : void 0), I(e._zod, "optout", () => t.options.some((r) => r._zod.optout === "optional") ? "optional" : void 0), I(e._zod, "values", () => {
    if (t.options.every((r) => r._zod.values)) return new Set(t.options.flatMap((r) => Array.from(r._zod.values)));
  }), I(e._zod, "pattern", () => {
    if (t.options.every((r) => r._zod.pattern)) {
      const r = t.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${r.map((o) => Ct(o.source)).join("|")})$`);
    }
  });
  const n = t.options.length === 1 ? t.options[0]._zod.run : null;
  e._zod.parse = (r, o) => {
    if (n) return n(r, o);
    let s = !1;
    const i = [];
    for (const c of t.options) {
      const a = c._zod.run({
        value: r.value,
        issues: []
      }, o);
      if (a instanceof Promise)
        i.push(a), s = !0;
      else {
        if (a.issues.length === 0) return a;
        i.push(a);
      }
    }
    return s ? Promise.all(i).then((c) => mn(c, r, e, o)) : mn(i, r, e, o);
  };
}), $a = /* @__PURE__ */ h("$ZodDiscriminatedUnion", (e, t) => {
  t.inclusive = !1, Er.init(e, t);
  const n = e._zod.parse;
  I(e._zod, "propValues", () => {
    const o = {};
    for (const s of t.options) {
      const i = s._zod.propValues;
      if (!i || Object.keys(i).length === 0) throw new Error(`Invalid discriminated union option at index "${t.options.indexOf(s)}"`);
      for (const [c, a] of Object.entries(i)) {
        o[c] || (o[c] = /* @__PURE__ */ new Set());
        for (const u of a) o[c].add(u);
      }
    }
    return o;
  });
  const r = tt(() => {
    const o = t.options, s = /* @__PURE__ */ new Map();
    for (const i of o) {
      const c = i._zod.propValues?.[t.discriminator];
      if (!c || c.size === 0) throw new Error(`Invalid discriminated union option at index "${t.options.indexOf(i)}"`);
      for (const a of c) {
        if (s.has(a)) throw new Error(`Duplicate discriminator value "${String(a)}"`);
        s.set(a, i);
      }
    }
    return s;
  });
  e._zod.parse = (o, s) => {
    const i = o.value;
    if (!Re(i))
      return o.issues.push({
        code: "invalid_type",
        expected: "object",
        input: i,
        inst: e
      }), o;
    const c = r.value.get(i?.[t.discriminator]);
    return c ? c._zod.run(o, s) : t.unionFallback || s.direction === "backward" ? n(o, s) : (o.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: t.discriminator,
      options: Array.from(r.value.keys()),
      input: i,
      path: [t.discriminator],
      inst: e
    }), o);
  };
}), Sa = /* @__PURE__ */ h("$ZodIntersection", (e, t) => {
  R.init(e, t), e._zod.parse = (n, r) => {
    const o = n.value, s = t.left._zod.run({
      value: o,
      issues: []
    }, r), i = t.right._zod.run({
      value: o,
      issues: []
    }, r);
    return s instanceof Promise || i instanceof Promise ? Promise.all([s, i]).then(([c, a]) => _n(n, c, a)) : _n(n, s, i);
  };
});
function Ot(e, t) {
  if (e === t) return {
    valid: !0,
    data: e
  };
  if (e instanceof Date && t instanceof Date && +e == +t) return {
    valid: !0,
    data: e
  };
  if (Ne(e) && Ne(t)) {
    const n = Object.keys(t), r = Object.keys(e).filter((s) => n.indexOf(s) !== -1), o = {
      ...e,
      ...t
    };
    for (const s of r) {
      const i = Ot(e[s], t[s]);
      if (!i.valid) return {
        valid: !1,
        mergeErrorPath: [s, ...i.mergeErrorPath]
      };
      o[s] = i.data;
    }
    return {
      valid: !0,
      data: o
    };
  }
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length) return {
      valid: !1,
      mergeErrorPath: []
    };
    const n = [];
    for (let r = 0; r < e.length; r++) {
      const o = e[r], s = t[r], i = Ot(o, s);
      if (!i.valid) return {
        valid: !1,
        mergeErrorPath: [r, ...i.mergeErrorPath]
      };
      n.push(i.data);
    }
    return {
      valid: !0,
      data: n
    };
  }
  return {
    valid: !1,
    mergeErrorPath: []
  };
}
function _n(e, t, n) {
  const r = /* @__PURE__ */ new Map();
  let o;
  for (const c of t.issues) if (c.code === "unrecognized_keys") {
    o ?? (o = c);
    for (const a of c.keys)
      r.has(a) || r.set(a, {}), r.get(a).l = !0;
  } else e.issues.push(c);
  for (const c of n.issues) if (c.code === "unrecognized_keys") for (const a of c.keys)
    r.has(a) || r.set(a, {}), r.get(a).r = !0;
  else e.issues.push(c);
  const s = [...r].filter(([, c]) => c.l && c.r).map(([c]) => c);
  if (s.length && o && e.issues.push({
    ...o,
    keys: s
  }), ye(e)) return e;
  const i = Ot(t.value, n.value);
  if (!i.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(i.mergeErrorPath)}`);
  return e.value = i.data, e;
}
const ka = /* @__PURE__ */ h("$ZodEnum", (e, t) => {
  R.init(e, t);
  const n = dr(t.entries), r = new Set(n);
  e._zod.values = r, e._zod.pattern = new RegExp(`^(${n.filter((o) => As.has(typeof o)).map((o) => typeof o == "string" ? $e(o) : o.toString()).join("|")})$`), e._zod.parse = (o, s) => {
    const i = o.value;
    return r.has(i) || o.issues.push({
      code: "invalid_value",
      values: n,
      input: i,
      inst: e
    }), o;
  };
}), Ia = /* @__PURE__ */ h("$ZodLiteral", (e, t) => {
  if (R.init(e, t), t.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
  const n = new Set(t.values);
  e._zod.values = n, e._zod.pattern = new RegExp(`^(${t.values.map((r) => typeof r == "string" ? $e(r) : r ? $e(r.toString()) : String(r)).join("|")})$`), e._zod.parse = (r, o) => {
    const s = r.value;
    return n.has(s) || r.issues.push({
      code: "invalid_value",
      values: t.values,
      input: s,
      inst: e
    }), r;
  };
}), Ea = /* @__PURE__ */ h("$ZodTransform", (e, t) => {
  R.init(e, t), e._zod.optin = "optional", e._zod.parse = (n, r) => {
    if (r.direction === "backward") throw new ur(e.constructor.name);
    const o = t.transform(n.value, n);
    if (r.async) return (o instanceof Promise ? o : Promise.resolve(o)).then((s) => (n.value = s, n.fallback = !0, n));
    if (o instanceof Promise) throw new be();
    return n.value = o, n.fallback = !0, n;
  };
});
function gn(e, t) {
  return t === void 0 && (e.issues.length || e.fallback) ? {
    issues: [],
    value: void 0
  } : e;
}
const Or = /* @__PURE__ */ h("$ZodOptional", (e, t) => {
  R.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", I(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, void 0]) : void 0), I(e._zod, "pattern", () => {
    const n = t.innerType._zod.pattern;
    return n ? new RegExp(`^(${Ct(n.source)})?$`) : void 0;
  }), e._zod.parse = (n, r) => {
    if (t.innerType._zod.optin === "optional") {
      const o = n.value, s = t.innerType._zod.run(n, r);
      return s instanceof Promise ? s.then((i) => gn(i, o)) : gn(s, o);
    }
    return n.value === void 0 ? n : t.innerType._zod.run(n, r);
  };
}), Oa = /* @__PURE__ */ h("$ZodExactOptional", (e, t) => {
  Or.init(e, t), I(e._zod, "values", () => t.innerType._zod.values), I(e._zod, "pattern", () => t.innerType._zod.pattern), e._zod.parse = (n, r) => t.innerType._zod.run(n, r);
}), Pa = /* @__PURE__ */ h("$ZodNullable", (e, t) => {
  R.init(e, t), I(e._zod, "optin", () => t.innerType._zod.optin), I(e._zod, "optout", () => t.innerType._zod.optout), I(e._zod, "pattern", () => {
    const n = t.innerType._zod.pattern;
    return n ? new RegExp(`^(${Ct(n.source)}|null)$`) : void 0;
  }), I(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (n, r) => n.value === null ? n : t.innerType._zod.run(n, r);
}), Za = /* @__PURE__ */ h("$ZodDefault", (e, t) => {
  R.init(e, t), e._zod.optin = "optional", I(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (n, r) => {
    if (r.direction === "backward") return t.innerType._zod.run(n, r);
    if (n.value === void 0)
      return n.value = t.defaultValue, n;
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then((s) => vn(s, t)) : vn(o, t);
  };
});
function vn(e, t) {
  return e.value === void 0 && (e.value = t.defaultValue), e;
}
const Ta = /* @__PURE__ */ h("$ZodPrefault", (e, t) => {
  R.init(e, t), e._zod.optin = "optional", I(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (n, r) => (r.direction === "backward" || n.value === void 0 && (n.value = t.defaultValue), t.innerType._zod.run(n, r));
}), Ra = /* @__PURE__ */ h("$ZodNonOptional", (e, t) => {
  R.init(e, t), I(e._zod, "values", () => {
    const n = t.innerType._zod.values;
    return n ? new Set([...n].filter((r) => r !== void 0)) : void 0;
  }), e._zod.parse = (n, r) => {
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then((s) => yn(s, e)) : yn(o, e);
  };
});
function yn(e, t) {
  return !e.issues.length && e.value === void 0 && e.issues.push({
    code: "invalid_type",
    expected: "nonoptional",
    input: e.value,
    inst: t
  }), e;
}
const Na = /* @__PURE__ */ h("$ZodCatch", (e, t) => {
  R.init(e, t), e._zod.optin = "optional", I(e._zod, "optout", () => t.innerType._zod.optout), I(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (n, r) => {
    if (r.direction === "backward") return t.innerType._zod.run(n, r);
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then((s) => (n.value = s.value, s.issues.length && (n.value = t.catchValue({
      ...n,
      error: { issues: s.issues.map((i) => pe(i, r, he())) },
      input: n.value
    }), n.issues = [], n.fallback = !0), n)) : (n.value = o.value, o.issues.length && (n.value = t.catchValue({
      ...n,
      error: { issues: o.issues.map((s) => pe(s, r, he())) },
      input: n.value
    }), n.issues = [], n.fallback = !0), n);
  };
}), Ca = /* @__PURE__ */ h("$ZodPipe", (e, t) => {
  R.init(e, t), I(e._zod, "values", () => t.in._zod.values), I(e._zod, "optin", () => t.in._zod.optin), I(e._zod, "optout", () => t.out._zod.optout), I(e._zod, "propValues", () => t.in._zod.propValues), e._zod.parse = (n, r) => {
    if (r.direction === "backward") {
      const s = t.out._zod.run(n, r);
      return s instanceof Promise ? s.then((i) => Fe(i, t.in, r)) : Fe(s, t.in, r);
    }
    const o = t.in._zod.run(n, r);
    return o instanceof Promise ? o.then((s) => Fe(s, t.out, r)) : Fe(o, t.out, r);
  };
});
function Fe(e, t, n) {
  return e.issues.length ? (e.aborted = !0, e) : t._zod.run({
    value: e.value,
    issues: e.issues,
    fallback: e.fallback
  }, n);
}
const Aa = /* @__PURE__ */ h("$ZodReadonly", (e, t) => {
  R.init(e, t), I(e._zod, "propValues", () => t.innerType._zod.propValues), I(e._zod, "values", () => t.innerType._zod.values), I(e._zod, "optin", () => t.innerType?._zod?.optin), I(e._zod, "optout", () => t.innerType?._zod?.optout), e._zod.parse = (n, r) => {
    if (r.direction === "backward") return t.innerType._zod.run(n, r);
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then(bn) : bn(o);
  };
});
function bn(e) {
  return e.value = Object.freeze(e.value), e;
}
const ja = /* @__PURE__ */ h("$ZodCustom", (e, t) => {
  U.init(e, t), R.init(e, t), e._zod.parse = (n, r) => n, e._zod.check = (n) => {
    const r = n.value, o = t.fn(r);
    if (o instanceof Promise) return o.then((s) => wn(s, n, r, e));
    wn(o, n, r, e);
  };
});
function wn(e, t, n, r) {
  if (!e) {
    const o = {
      code: "custom",
      input: n,
      inst: r,
      path: [...r._zod.def.path ?? []],
      continue: !r._zod.def.abort
    };
    r._zod.def.params && (o.params = r._zod.def.params), t.issues.push(Ce(o));
  }
}
var zn, Ma = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
  }
  add(e, ...t) {
    const n = t[0];
    return this._map.set(e, n), n && typeof n == "object" && "id" in n && this._idmap.set(n.id, e), this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
  }
  remove(e) {
    const t = this._map.get(e);
    return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(e), this;
  }
  get(e) {
    const t = e._zod.parent;
    if (t) {
      const n = { ...this.get(t) ?? {} };
      delete n.id;
      const r = {
        ...n,
        ...this._map.get(e)
      };
      return Object.keys(r).length ? r : void 0;
    }
    return this._map.get(e);
  }
  has(e) {
    return this._map.has(e);
  }
};
function xa() {
  return new Ma();
}
(zn = globalThis).__zod_globalRegistry ?? (zn.__zod_globalRegistry = xa());
const Pe = globalThis.__zod_globalRegistry;
// @__NO_SIDE_EFFECTS__
function Da(e, t) {
  return new e({
    type: "string",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Fa(e, t) {
  return new e({
    type: "string",
    format: "email",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function $n(e, t) {
  return new e({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function La(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ua(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v4",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ja(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v6",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function qa(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v7",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Va(e, t) {
  return new e({
    type: "string",
    format: "url",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Wa(e, t) {
  return new e({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ha(e, t) {
  return new e({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ka(e, t) {
  return new e({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ba(e, t) {
  return new e({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ga(e, t) {
  return new e({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ya(e, t) {
  return new e({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Xa(e, t) {
  return new e({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Qa(e, t) {
  return new e({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function eu(e, t) {
  return new e({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function tu(e, t) {
  return new e({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function nu(e, t) {
  return new e({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function ru(e, t) {
  return new e({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function ou(e, t) {
  return new e({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function iu(e, t) {
  return new e({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function su(e, t) {
  return new e({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: !1,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function cu(e, t) {
  return new e({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: !1,
    local: !1,
    precision: null,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function au(e, t) {
  return new e({
    type: "string",
    format: "date",
    check: "string_format",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function uu(e, t) {
  return new e({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function du(e, t) {
  return new e({
    type: "string",
    format: "duration",
    check: "string_format",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function lu(e, t) {
  return new e({
    type: "number",
    checks: [],
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function fu(e, t) {
  return new e({
    type: "number",
    check: "number_format",
    abort: !1,
    format: "safeint",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function hu(e, t) {
  return new e({
    type: "boolean",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function pu(e) {
  return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function mu(e, t) {
  return new e({
    type: "never",
    ..._(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Sn(e, t) {
  return new wr({
    check: "less_than",
    ..._(t),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function lt(e, t) {
  return new wr({
    check: "less_than",
    ..._(t),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function kn(e, t) {
  return new zr({
    check: "greater_than",
    ..._(t),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function ft(e, t) {
  return new zr({
    check: "greater_than",
    ..._(t),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function In(e, t) {
  return new Tc({
    check: "multiple_of",
    ..._(t),
    value: e
  });
}
// @__NO_SIDE_EFFECTS__
function Pr(e, t) {
  return new Nc({
    check: "max_length",
    ..._(t),
    maximum: e
  });
}
// @__NO_SIDE_EFFECTS__
function Ke(e, t) {
  return new Cc({
    check: "min_length",
    ..._(t),
    minimum: e
  });
}
// @__NO_SIDE_EFFECTS__
function Zr(e, t) {
  return new Ac({
    check: "length_equals",
    ..._(t),
    length: e
  });
}
// @__NO_SIDE_EFFECTS__
function _u(e, t) {
  return new jc({
    check: "string_format",
    format: "regex",
    ..._(t),
    pattern: e
  });
}
// @__NO_SIDE_EFFECTS__
function gu(e) {
  return new Mc({
    check: "string_format",
    format: "lowercase",
    ..._(e)
  });
}
// @__NO_SIDE_EFFECTS__
function vu(e) {
  return new xc({
    check: "string_format",
    format: "uppercase",
    ..._(e)
  });
}
// @__NO_SIDE_EFFECTS__
function yu(e, t) {
  return new Dc({
    check: "string_format",
    format: "includes",
    ..._(t),
    includes: e
  });
}
// @__NO_SIDE_EFFECTS__
function bu(e, t) {
  return new Fc({
    check: "string_format",
    format: "starts_with",
    ..._(t),
    prefix: e
  });
}
// @__NO_SIDE_EFFECTS__
function wu(e, t) {
  return new Lc({
    check: "string_format",
    format: "ends_with",
    ..._(t),
    suffix: e
  });
}
// @__NO_SIDE_EFFECTS__
function Se(e) {
  return new Uc({
    check: "overwrite",
    tx: e
  });
}
// @__NO_SIDE_EFFECTS__
function zu(e) {
  return /* @__PURE__ */ Se((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function $u() {
  return /* @__PURE__ */ Se((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function Su() {
  return /* @__PURE__ */ Se((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function ku() {
  return /* @__PURE__ */ Se((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function Iu() {
  return /* @__PURE__ */ Se((e) => Ns(e));
}
// @__NO_SIDE_EFFECTS__
function Eu(e, t, n) {
  return new e({
    type: "array",
    element: t,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Ou(e, t, n) {
  return new e({
    type: "custom",
    check: "custom",
    fn: t,
    ..._(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Pu(e, t) {
  const n = /* @__PURE__ */ Zu((r) => (r.addIssue = (o) => {
    if (typeof o == "string") r.issues.push(Ce(o, r.value, n._zod.def));
    else {
      const s = o;
      s.fatal && (s.continue = !1), s.code ?? (s.code = "custom"), s.input ?? (s.input = r.value), s.inst ?? (s.inst = n), s.continue ?? (s.continue = !n._zod.def.abort), r.issues.push(Ce(s));
    }
  }, e(r.value, r)), t);
  return n;
}
// @__NO_SIDE_EFFECTS__
function Zu(e, t) {
  const n = new U({
    check: "custom",
    ..._(t)
  });
  return n._zod.check = e, n;
}
function Tr(e) {
  let t = e?.target ?? "draft-2020-12";
  return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
    processors: e.processors ?? {},
    metadataRegistry: e?.metadata ?? Pe,
    target: t,
    unrepresentable: e?.unrepresentable ?? "throw",
    override: e?.override ?? (() => {
    }),
    io: e?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: e?.cycles ?? "ref",
    reused: e?.reused ?? "inline",
    external: e?.external ?? void 0
  };
}
function A(e, t, n = {
  path: [],
  schemaPath: []
}) {
  var r;
  const o = e._zod.def, s = t.seen.get(e);
  if (s)
    return s.count++, n.schemaPath.includes(e) && (s.cycle = n.path), s.schema;
  const i = {
    schema: {},
    count: 1,
    cycle: void 0,
    path: n.path
  };
  t.seen.set(e, i);
  const c = e._zod.toJSONSchema?.();
  if (c) i.schema = c;
  else {
    const u = {
      ...n,
      schemaPath: [...n.schemaPath, e],
      path: n.path
    };
    if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, i.schema, u);
    else {
      const l = i.schema, f = t.processors[o.type];
      if (!f) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${o.type}`);
      f(e, t, l, u);
    }
    const d = e._zod.parent;
    d && (i.ref || (i.ref = d), A(d, t, u), t.seen.get(d).isParent = !0);
  }
  const a = t.metadataRegistry.get(e);
  return a && Object.assign(i.schema, a), t.io === "input" && M(e) && (delete i.schema.examples, delete i.schema.default), t.io === "input" && "_prefault" in i.schema && ((r = i.schema).default ?? (r.default = i.schema._prefault)), delete i.schema._prefault, t.seen.get(e).schema;
}
function Rr(e, t) {
  const n = e.seen.get(t);
  if (!n) throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = /* @__PURE__ */ new Map();
  for (const i of e.seen.entries()) {
    const c = e.metadataRegistry.get(i[0])?.id;
    if (c) {
      const a = r.get(c);
      if (a && a !== i[0]) throw new Error(`Duplicate schema id "${c}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      r.set(c, i[0]);
    }
  }
  const o = (i) => {
    const c = e.target === "draft-2020-12" ? "$defs" : "definitions";
    if (e.external) {
      const d = e.external.registry.get(i[0])?.id, l = e.external.uri ?? ((p) => p);
      if (d) return { ref: l(d) };
      const f = i[1].defId ?? i[1].schema.id ?? `schema${e.counter++}`;
      return i[1].defId = f, {
        defId: f,
        ref: `${l("__shared")}#/${c}/${f}`
      };
    }
    if (i[1] === n) return { ref: "#" };
    const a = `#/${c}/`, u = i[1].schema.id ?? `__schema${e.counter++}`;
    return {
      defId: u,
      ref: a + u
    };
  }, s = (i) => {
    if (i[1].schema.$ref) return;
    const c = i[1], { ref: a, defId: u } = o(i);
    c.def = { ...c.schema }, u && (c.defId = u);
    const d = c.schema;
    for (const l in d) delete d[l];
    d.$ref = a;
  };
  if (e.cycles === "throw") for (const i of e.seen.entries()) {
    const c = i[1];
    if (c.cycle) throw new Error(`Cycle detected: #/${c.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
  }
  for (const i of e.seen.entries()) {
    const c = i[1];
    if (t === i[0]) {
      s(i);
      continue;
    }
    if (e.external) {
      const a = e.external.registry.get(i[0])?.id;
      if (t !== i[0] && a) {
        s(i);
        continue;
      }
    }
    if (e.metadataRegistry.get(i[0])?.id) {
      s(i);
      continue;
    }
    if (c.cycle) {
      s(i);
      continue;
    }
    if (c.count > 1 && e.reused === "ref") {
      s(i);
      continue;
    }
  }
}
function Nr(e, t) {
  const n = e.seen.get(t);
  if (!n) throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = (c) => {
    const a = e.seen.get(c);
    if (a.ref === null) return;
    const u = a.def ?? a.schema, d = { ...u }, l = a.ref;
    if (a.ref = null, l) {
      r(l);
      const p = e.seen.get(l), v = p.schema;
      if (v.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (u.allOf = u.allOf ?? [], u.allOf.push(v)) : Object.assign(u, v), Object.assign(u, d), c._zod.parent === l) for (const w in u)
        w === "$ref" || w === "allOf" || w in d || delete u[w];
      if (v.$ref && p.def) for (const w in u)
        w === "$ref" || w === "allOf" || w in p.def && JSON.stringify(u[w]) === JSON.stringify(p.def[w]) && delete u[w];
    }
    const f = c._zod.parent;
    if (f && f !== l) {
      r(f);
      const p = e.seen.get(f);
      if (p?.schema.$ref && (u.$ref = p.schema.$ref, p.def))
        for (const v in u)
          v === "$ref" || v === "allOf" || v in p.def && JSON.stringify(u[v]) === JSON.stringify(p.def[v]) && delete u[v];
    }
    e.override({
      zodSchema: c,
      jsonSchema: u,
      path: a.path ?? []
    });
  };
  for (const c of [...e.seen.entries()].reverse()) r(c[0]);
  const o = {};
  if (e.target === "draft-2020-12" ? o.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? o.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? o.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
    const c = e.external.registry.get(t)?.id;
    if (!c) throw new Error("Schema is missing an `id` property");
    o.$id = e.external.uri(c);
  }
  Object.assign(o, n.def ?? n.schema);
  const s = e.metadataRegistry.get(t)?.id;
  s !== void 0 && o.id === s && delete o.id;
  const i = e.external?.defs ?? {};
  for (const c of e.seen.entries()) {
    const a = c[1];
    a.def && a.defId && (a.def.id === a.defId && delete a.def.id, i[a.defId] = a.def);
  }
  e.external || Object.keys(i).length > 0 && (e.target === "draft-2020-12" ? o.$defs = i : o.definitions = i);
  try {
    const c = JSON.parse(JSON.stringify(o));
    return Object.defineProperty(c, "~standard", {
      value: {
        ...t["~standard"],
        jsonSchema: {
          input: Be(t, "input", e.processors),
          output: Be(t, "output", e.processors)
        }
      },
      enumerable: !1,
      writable: !1
    }), c;
  } catch {
    throw new Error("Error converting schema to JSON.");
  }
}
function M(e, t) {
  const n = t ?? { seen: /* @__PURE__ */ new Set() };
  if (n.seen.has(e)) return !1;
  n.seen.add(e);
  const r = e._zod.def;
  if (r.type === "transform") return !0;
  if (r.type === "array") return M(r.element, n);
  if (r.type === "set") return M(r.valueType, n);
  if (r.type === "lazy") return M(r.getter(), n);
  if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault") return M(r.innerType, n);
  if (r.type === "intersection") return M(r.left, n) || M(r.right, n);
  if (r.type === "record" || r.type === "map") return M(r.keyType, n) || M(r.valueType, n);
  if (r.type === "pipe")
    return e._zod.traits.has("$ZodCodec") ? !0 : M(r.in, n) || M(r.out, n);
  if (r.type === "object") {
    for (const o in r.shape) if (M(r.shape[o], n)) return !0;
    return !1;
  }
  if (r.type === "union") {
    for (const o of r.options) if (M(o, n)) return !0;
    return !1;
  }
  if (r.type === "tuple") {
    for (const o of r.items) if (M(o, n)) return !0;
    return !!(r.rest && M(r.rest, n));
  }
  return !1;
}
const Tu = (e, t = {}) => (n) => {
  const r = Tr({
    ...n,
    processors: t
  });
  return A(e, r), Rr(r, e), Nr(r, e);
}, Be = (e, t, n = {}) => (r) => {
  const { libraryOptions: o, target: s } = r ?? {}, i = Tr({
    ...o ?? {},
    target: s,
    io: t,
    processors: n
  });
  return A(e, i), Rr(i, e), Nr(i, e);
}, Ru = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
}, Nu = (e, t, n, r) => {
  const o = n;
  o.type = "string";
  const { minimum: s, maximum: i, format: c, patterns: a, contentEncoding: u } = e._zod.bag;
  if (typeof s == "number" && (o.minLength = s), typeof i == "number" && (o.maxLength = i), c && (o.format = Ru[c] ?? c, o.format === "" && delete o.format, c === "time" && delete o.format), u && (o.contentEncoding = u), a && a.size > 0) {
    const d = [...a];
    d.length === 1 ? o.pattern = d[0].source : d.length > 1 && (o.allOf = [...d.map((l) => ({
      ...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
      pattern: l.source
    }))]);
  }
}, Cu = (e, t, n, r) => {
  const o = n, { minimum: s, maximum: i, format: c, multipleOf: a, exclusiveMaximum: u, exclusiveMinimum: d } = e._zod.bag;
  typeof c == "string" && c.includes("int") ? o.type = "integer" : o.type = "number";
  const l = typeof d == "number" && d >= (s ?? Number.NEGATIVE_INFINITY), f = typeof u == "number" && u <= (i ?? Number.POSITIVE_INFINITY), p = t.target === "draft-04" || t.target === "openapi-3.0";
  l ? p ? (o.minimum = d, o.exclusiveMinimum = !0) : o.exclusiveMinimum = d : typeof s == "number" && (o.minimum = s), f ? p ? (o.maximum = u, o.exclusiveMaximum = !0) : o.exclusiveMaximum = u : typeof i == "number" && (o.maximum = i), typeof a == "number" && (o.multipleOf = a);
}, Au = (e, t, n, r) => {
  n.type = "boolean";
}, ju = (e, t, n, r) => {
  n.not = {};
}, Mu = (e, t, n, r) => {
  const o = e._zod.def, s = dr(o.entries);
  s.every((i) => typeof i == "number") && (n.type = "number"), s.every((i) => typeof i == "string") && (n.type = "string"), n.enum = s;
}, xu = (e, t, n, r) => {
  const o = e._zod.def, s = [];
  for (const i of o.values) if (i === void 0) {
    if (t.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
  } else if (typeof i == "bigint") {
    if (t.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
    s.push(Number(i));
  } else s.push(i);
  if (s.length !== 0) if (s.length === 1) {
    const i = s[0];
    n.type = i === null ? "null" : typeof i, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [i] : n.const = i;
  } else
    s.every((i) => typeof i == "number") && (n.type = "number"), s.every((i) => typeof i == "string") && (n.type = "string"), s.every((i) => typeof i == "boolean") && (n.type = "boolean"), s.every((i) => i === null) && (n.type = "null"), n.enum = s;
}, Du = (e, t, n, r) => {
  if (t.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
}, Fu = (e, t, n, r) => {
  if (t.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
}, Lu = (e, t, n, r) => {
  const o = n, s = e._zod.def, { minimum: i, maximum: c } = e._zod.bag;
  typeof i == "number" && (o.minItems = i), typeof c == "number" && (o.maxItems = c), o.type = "array", o.items = A(s.element, t, {
    ...r,
    path: [...r.path, "items"]
  });
}, Uu = (e, t, n, r) => {
  const o = n, s = e._zod.def;
  o.type = "object", o.properties = {};
  const i = s.shape;
  for (const u in i) o.properties[u] = A(i[u], t, {
    ...r,
    path: [
      ...r.path,
      "properties",
      u
    ]
  });
  const c = new Set(Object.keys(i)), a = new Set([...c].filter((u) => {
    const d = s.shape[u]._zod;
    return t.io === "input" ? d.optin === void 0 : d.optout === void 0;
  }));
  a.size > 0 && (o.required = Array.from(a)), s.catchall?._zod.def.type === "never" ? o.additionalProperties = !1 : s.catchall ? s.catchall && (o.additionalProperties = A(s.catchall, t, {
    ...r,
    path: [...r.path, "additionalProperties"]
  })) : t.io === "output" && (o.additionalProperties = !1);
}, Ju = (e, t, n, r) => {
  const o = e._zod.def, s = o.inclusive === !1, i = o.options.map((c, a) => A(c, t, {
    ...r,
    path: [
      ...r.path,
      s ? "oneOf" : "anyOf",
      a
    ]
  }));
  s ? n.oneOf = i : n.anyOf = i;
}, qu = (e, t, n, r) => {
  const o = e._zod.def, s = A(o.left, t, {
    ...r,
    path: [
      ...r.path,
      "allOf",
      0
    ]
  }), i = A(o.right, t, {
    ...r,
    path: [
      ...r.path,
      "allOf",
      1
    ]
  }), c = (a) => "allOf" in a && Object.keys(a).length === 1;
  n.allOf = [...c(s) ? s.allOf : [s], ...c(i) ? i.allOf : [i]];
}, Vu = (e, t, n, r) => {
  const o = e._zod.def, s = A(o.innerType, t, r), i = t.seen.get(e);
  t.target === "openapi-3.0" ? (i.ref = o.innerType, n.nullable = !0) : n.anyOf = [s, { type: "null" }];
}, Wu = (e, t, n, r) => {
  const o = e._zod.def;
  A(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType;
}, Hu = (e, t, n, r) => {
  const o = e._zod.def;
  A(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType, n.default = JSON.parse(JSON.stringify(o.defaultValue));
}, Ku = (e, t, n, r) => {
  const o = e._zod.def;
  A(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(o.defaultValue)));
}, Bu = (e, t, n, r) => {
  const o = e._zod.def;
  A(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType;
  let i;
  try {
    i = o.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  n.default = i;
}, Gu = (e, t, n, r) => {
  const o = e._zod.def, s = o.in._zod.traits.has("$ZodTransform"), i = t.io === "input" ? s ? o.out : o.in : o.out;
  A(i, t, r);
  const c = t.seen.get(e);
  c.ref = i;
}, Yu = (e, t, n, r) => {
  const o = e._zod.def;
  A(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType, n.readOnly = !0;
}, Cr = (e, t, n, r) => {
  const o = e._zod.def;
  A(o.innerType, t, r);
  const s = t.seen.get(e);
  s.ref = o.innerType;
}, Xu = /* @__PURE__ */ h("ZodISODateTime", (e, t) => {
  na.init(e, t), T.init(e, t);
});
function Qu(e) {
  return /* @__PURE__ */ cu(Xu, e);
}
const ed = /* @__PURE__ */ h("ZodISODate", (e, t) => {
  ra.init(e, t), T.init(e, t);
});
function td(e) {
  return /* @__PURE__ */ au(ed, e);
}
const nd = /* @__PURE__ */ h("ZodISOTime", (e, t) => {
  oa.init(e, t), T.init(e, t);
});
function rd(e) {
  return /* @__PURE__ */ uu(nd, e);
}
const od = /* @__PURE__ */ h("ZodISODuration", (e, t) => {
  ia.init(e, t), T.init(e, t);
});
function id(e) {
  return /* @__PURE__ */ du(od, e);
}
const sd = (e, t) => {
  mr.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
    format: { value: (n) => Hs(e, n) },
    flatten: { value: (n) => Ws(e, n) },
    addIssue: { value: (n) => {
      e.issues.push(n), e.message = JSON.stringify(e.issues, Et, 2);
    } },
    addIssues: { value: (n) => {
      e.issues.push(...n), e.message = JSON.stringify(e.issues, Et, 2);
    } },
    isEmpty: { get() {
      return e.issues.length === 0;
    } }
  });
}, B = /* @__PURE__ */ h("ZodError", sd, { Parent: Error }), cd = /* @__PURE__ */ jt(B), ad = /* @__PURE__ */ Mt(B), ud = /* @__PURE__ */ nt(B), dd = /* @__PURE__ */ rt(B), ld = /* @__PURE__ */ Gs(B), fd = /* @__PURE__ */ Ys(B), hd = /* @__PURE__ */ Xs(B), pd = /* @__PURE__ */ Qs(B), md = /* @__PURE__ */ ec(B), _d = /* @__PURE__ */ tc(B), gd = /* @__PURE__ */ nc(B), vd = /* @__PURE__ */ rc(B), En = /* @__PURE__ */ new WeakMap();
function je(e, t, n) {
  const r = Object.getPrototypeOf(e);
  let o = En.get(r);
  if (o || (o = /* @__PURE__ */ new Set(), En.set(r, o)), !o.has(t)) {
    o.add(t);
    for (const s in n) {
      const i = n[s];
      Object.defineProperty(r, s, {
        configurable: !0,
        enumerable: !1,
        get() {
          const c = i.bind(this);
          return Object.defineProperty(this, s, {
            configurable: !0,
            writable: !0,
            enumerable: !0,
            value: c
          }), c;
        },
        set(c) {
          Object.defineProperty(this, s, {
            configurable: !0,
            writable: !0,
            enumerable: !0,
            value: c
          });
        }
      });
    }
  }
}
const N = /* @__PURE__ */ h("ZodType", (e, t) => (R.init(e, t), Object.assign(e["~standard"], { jsonSchema: {
  input: Be(e, "input"),
  output: Be(e, "output")
} }), e.toJSONSchema = Tu(e, {}), e.def = t, e.type = t.type, Object.defineProperty(e, "_def", { value: t }), e.parse = (n, r) => cd(e, n, r, { callee: e.parse }), e.safeParse = (n, r) => ud(e, n, r), e.parseAsync = async (n, r) => ad(e, n, r, { callee: e.parseAsync }), e.safeParseAsync = async (n, r) => dd(e, n, r), e.spa = e.safeParseAsync, e.encode = (n, r) => ld(e, n, r), e.decode = (n, r) => fd(e, n, r), e.encodeAsync = async (n, r) => hd(e, n, r), e.decodeAsync = async (n, r) => pd(e, n, r), e.safeEncode = (n, r) => md(e, n, r), e.safeDecode = (n, r) => _d(e, n, r), e.safeEncodeAsync = async (n, r) => gd(e, n, r), e.safeDecodeAsync = async (n, r) => vd(e, n, r), je(e, "ZodType", {
  check(...n) {
    const r = this.def;
    return this.clone(se(r, { checks: [...r.checks ?? [], ...n.map((o) => typeof o == "function" ? { _zod: {
      check: o,
      def: { check: "custom" },
      onattach: []
    } } : o)] }), { parent: !0 });
  },
  with(...n) {
    return this.check(...n);
  },
  clone(n, r) {
    return ce(this, n, r);
  },
  brand() {
    return this;
  },
  register(n, r) {
    return n.add(this, r), this;
  },
  refine(n, r) {
    return this.check(fl(n, r));
  },
  superRefine(n, r) {
    return this.check(hl(n, r));
  },
  overwrite(n) {
    return this.check(/* @__PURE__ */ Se(n));
  },
  optional() {
    return Zn(this);
  },
  exactOptional() {
    return Qd(this);
  },
  nullable() {
    return Tn(this);
  },
  nullish() {
    return Zn(Tn(this));
  },
  nonoptional(n) {
    return il(this, n);
  },
  array() {
    return we(this);
  },
  or(n) {
    return qd([this, n]);
  },
  and(n) {
    return Kd(this, n);
  },
  transform(n) {
    return Rn(this, Yd(n));
  },
  default(n) {
    return nl(this, n);
  },
  prefault(n) {
    return ol(this, n);
  },
  catch(n) {
    return cl(this, n);
  },
  pipe(n) {
    return Rn(this, n);
  },
  readonly() {
    return dl(this);
  },
  describe(n) {
    const r = this.clone();
    return Pe.add(r, { description: n }), r;
  },
  meta(...n) {
    if (n.length === 0) return Pe.get(this);
    const r = this.clone();
    return Pe.add(r, n[0]), r;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(n) {
    return n(this);
  }
}), Object.defineProperty(e, "description", {
  get() {
    return Pe.get(e)?.description;
  },
  configurable: !0
}), e)), Ar = /* @__PURE__ */ h("_ZodString", (e, t) => {
  xt.init(e, t), N.init(e, t), e._zod.processJSONSchema = (r, o, s) => Nu(e, r, o);
  const n = e._zod.bag;
  e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, je(e, "_ZodString", {
    regex(...r) {
      return this.check(/* @__PURE__ */ _u(...r));
    },
    includes(...r) {
      return this.check(/* @__PURE__ */ yu(...r));
    },
    startsWith(...r) {
      return this.check(/* @__PURE__ */ bu(...r));
    },
    endsWith(...r) {
      return this.check(/* @__PURE__ */ wu(...r));
    },
    min(...r) {
      return this.check(/* @__PURE__ */ Ke(...r));
    },
    max(...r) {
      return this.check(/* @__PURE__ */ Pr(...r));
    },
    length(...r) {
      return this.check(/* @__PURE__ */ Zr(...r));
    },
    nonempty(...r) {
      return this.check(/* @__PURE__ */ Ke(1, ...r));
    },
    lowercase(r) {
      return this.check(/* @__PURE__ */ gu(r));
    },
    uppercase(r) {
      return this.check(/* @__PURE__ */ vu(r));
    },
    trim() {
      return this.check(/* @__PURE__ */ $u());
    },
    normalize(...r) {
      return this.check(/* @__PURE__ */ zu(...r));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ Su());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ ku());
    },
    slugify() {
      return this.check(/* @__PURE__ */ Iu());
    }
  });
}), yd = /* @__PURE__ */ h("ZodString", (e, t) => {
  xt.init(e, t), Ar.init(e, t), e.email = (n) => e.check(/* @__PURE__ */ Fa(bd, n)), e.url = (n) => e.check(/* @__PURE__ */ Va(wd, n)), e.jwt = (n) => e.check(/* @__PURE__ */ su(jd, n)), e.emoji = (n) => e.check(/* @__PURE__ */ Wa(zd, n)), e.guid = (n) => e.check(/* @__PURE__ */ $n(On, n)), e.uuid = (n) => e.check(/* @__PURE__ */ La(Le, n)), e.uuidv4 = (n) => e.check(/* @__PURE__ */ Ua(Le, n)), e.uuidv6 = (n) => e.check(/* @__PURE__ */ Ja(Le, n)), e.uuidv7 = (n) => e.check(/* @__PURE__ */ qa(Le, n)), e.nanoid = (n) => e.check(/* @__PURE__ */ Ha($d, n)), e.guid = (n) => e.check(/* @__PURE__ */ $n(On, n)), e.cuid = (n) => e.check(/* @__PURE__ */ Ka(Sd, n)), e.cuid2 = (n) => e.check(/* @__PURE__ */ Ba(kd, n)), e.ulid = (n) => e.check(/* @__PURE__ */ Ga(Id, n)), e.base64 = (n) => e.check(/* @__PURE__ */ ru(Nd, n)), e.base64url = (n) => e.check(/* @__PURE__ */ ou(Cd, n)), e.xid = (n) => e.check(/* @__PURE__ */ Ya(Ed, n)), e.ksuid = (n) => e.check(/* @__PURE__ */ Xa(Od, n)), e.ipv4 = (n) => e.check(/* @__PURE__ */ Qa(Pd, n)), e.ipv6 = (n) => e.check(/* @__PURE__ */ eu(Zd, n)), e.cidrv4 = (n) => e.check(/* @__PURE__ */ tu(Td, n)), e.cidrv6 = (n) => e.check(/* @__PURE__ */ nu(Rd, n)), e.e164 = (n) => e.check(/* @__PURE__ */ iu(Ad, n)), e.datetime = (n) => e.check(Qu(n)), e.date = (n) => e.check(td(n)), e.time = (n) => e.check(rd(n)), e.duration = (n) => e.check(id(n));
});
function D(e) {
  return /* @__PURE__ */ Da(yd, e);
}
const T = /* @__PURE__ */ h("ZodStringFormat", (e, t) => {
  Z.init(e, t), Ar.init(e, t);
}), bd = /* @__PURE__ */ h("ZodEmail", (e, t) => {
  Hc.init(e, t), T.init(e, t);
}), On = /* @__PURE__ */ h("ZodGUID", (e, t) => {
  Vc.init(e, t), T.init(e, t);
}), Le = /* @__PURE__ */ h("ZodUUID", (e, t) => {
  Wc.init(e, t), T.init(e, t);
}), wd = /* @__PURE__ */ h("ZodURL", (e, t) => {
  Kc.init(e, t), T.init(e, t);
}), zd = /* @__PURE__ */ h("ZodEmoji", (e, t) => {
  Bc.init(e, t), T.init(e, t);
}), $d = /* @__PURE__ */ h("ZodNanoID", (e, t) => {
  Gc.init(e, t), T.init(e, t);
}), Sd = /* @__PURE__ */ h("ZodCUID", (e, t) => {
  Yc.init(e, t), T.init(e, t);
}), kd = /* @__PURE__ */ h("ZodCUID2", (e, t) => {
  Xc.init(e, t), T.init(e, t);
}), Id = /* @__PURE__ */ h("ZodULID", (e, t) => {
  Qc.init(e, t), T.init(e, t);
}), Ed = /* @__PURE__ */ h("ZodXID", (e, t) => {
  ea.init(e, t), T.init(e, t);
}), Od = /* @__PURE__ */ h("ZodKSUID", (e, t) => {
  ta.init(e, t), T.init(e, t);
}), Pd = /* @__PURE__ */ h("ZodIPv4", (e, t) => {
  sa.init(e, t), T.init(e, t);
}), Zd = /* @__PURE__ */ h("ZodIPv6", (e, t) => {
  ca.init(e, t), T.init(e, t);
}), Td = /* @__PURE__ */ h("ZodCIDRv4", (e, t) => {
  aa.init(e, t), T.init(e, t);
}), Rd = /* @__PURE__ */ h("ZodCIDRv6", (e, t) => {
  ua.init(e, t), T.init(e, t);
}), Nd = /* @__PURE__ */ h("ZodBase64", (e, t) => {
  da.init(e, t), T.init(e, t);
}), Cd = /* @__PURE__ */ h("ZodBase64URL", (e, t) => {
  fa.init(e, t), T.init(e, t);
}), Ad = /* @__PURE__ */ h("ZodE164", (e, t) => {
  ha.init(e, t), T.init(e, t);
}), jd = /* @__PURE__ */ h("ZodJWT", (e, t) => {
  ma.init(e, t), T.init(e, t);
}), jr = /* @__PURE__ */ h("ZodNumber", (e, t) => {
  Sr.init(e, t), N.init(e, t), e._zod.processJSONSchema = (r, o, s) => Cu(e, r, o), je(e, "ZodNumber", {
    gt(r, o) {
      return this.check(/* @__PURE__ */ kn(r, o));
    },
    gte(r, o) {
      return this.check(/* @__PURE__ */ ft(r, o));
    },
    min(r, o) {
      return this.check(/* @__PURE__ */ ft(r, o));
    },
    lt(r, o) {
      return this.check(/* @__PURE__ */ Sn(r, o));
    },
    lte(r, o) {
      return this.check(/* @__PURE__ */ lt(r, o));
    },
    max(r, o) {
      return this.check(/* @__PURE__ */ lt(r, o));
    },
    int(r) {
      return this.check(Pn(r));
    },
    safe(r) {
      return this.check(Pn(r));
    },
    positive(r) {
      return this.check(/* @__PURE__ */ kn(0, r));
    },
    nonnegative(r) {
      return this.check(/* @__PURE__ */ ft(0, r));
    },
    negative(r) {
      return this.check(/* @__PURE__ */ Sn(0, r));
    },
    nonpositive(r) {
      return this.check(/* @__PURE__ */ lt(0, r));
    },
    multipleOf(r, o) {
      return this.check(/* @__PURE__ */ In(r, o));
    },
    step(r, o) {
      return this.check(/* @__PURE__ */ In(r, o));
    },
    finite() {
      return this;
    }
  });
  const n = e._zod.bag;
  e.minValue = Math.max(n.minimum ?? Number.NEGATIVE_INFINITY, n.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null, e.maxValue = Math.min(n.maximum ?? Number.POSITIVE_INFINITY, n.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? 0.5), e.isFinite = !0, e.format = n.format ?? null;
});
function ee(e) {
  return /* @__PURE__ */ lu(jr, e);
}
const Md = /* @__PURE__ */ h("ZodNumberFormat", (e, t) => {
  _a.init(e, t), jr.init(e, t);
});
function Pn(e) {
  return /* @__PURE__ */ fu(Md, e);
}
const xd = /* @__PURE__ */ h("ZodBoolean", (e, t) => {
  ga.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Au(e, n, r);
});
function F(e) {
  return /* @__PURE__ */ hu(xd, e);
}
const Dd = /* @__PURE__ */ h("ZodUnknown", (e, t) => {
  va.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => {
  };
});
function Pt() {
  return /* @__PURE__ */ pu(Dd);
}
const Fd = /* @__PURE__ */ h("ZodNever", (e, t) => {
  ya.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => ju(e, n, r);
});
function Ld(e) {
  return /* @__PURE__ */ mu(Fd, e);
}
const Ud = /* @__PURE__ */ h("ZodArray", (e, t) => {
  ba.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Lu(e, n, r, o), e.element = t.element, je(e, "ZodArray", {
    min(n, r) {
      return this.check(/* @__PURE__ */ Ke(n, r));
    },
    nonempty(n) {
      return this.check(/* @__PURE__ */ Ke(1, n));
    },
    max(n, r) {
      return this.check(/* @__PURE__ */ Pr(n, r));
    },
    length(n, r) {
      return this.check(/* @__PURE__ */ Zr(n, r));
    },
    unwrap() {
      return this.element;
    }
  });
});
function we(e, t) {
  return /* @__PURE__ */ Eu(Ud, e, t);
}
const Jd = /* @__PURE__ */ h("ZodObject", (e, t) => {
  za.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Uu(e, n, r, o), I(e, "shape", () => t.shape), je(e, "ZodObject", {
    keyof() {
      return Dt(Object.keys(this._zod.def.shape));
    },
    catchall(n) {
      return this.clone({
        ...this._zod.def,
        catchall: n
      });
    },
    passthrough() {
      return this.clone({
        ...this._zod.def,
        catchall: Pt()
      });
    },
    loose() {
      return this.clone({
        ...this._zod.def,
        catchall: Pt()
      });
    },
    strict() {
      return this.clone({
        ...this._zod.def,
        catchall: Ld()
      });
    },
    strip() {
      return this.clone({
        ...this._zod.def,
        catchall: void 0
      });
    },
    extend(n) {
      return Fs(this, n);
    },
    safeExtend(n) {
      return Ls(this, n);
    },
    merge(n) {
      return Us(this, n);
    },
    pick(n) {
      return xs(this, n);
    },
    omit(n) {
      return Ds(this, n);
    },
    partial(...n) {
      return Js(xr, this, n[0]);
    },
    required(...n) {
      return qs(Dr, this, n[0]);
    }
  });
});
function k(e, t) {
  const n = {
    type: "object",
    shape: e ?? {},
    ..._(t)
  };
  return new Jd(n);
}
const Mr = /* @__PURE__ */ h("ZodUnion", (e, t) => {
  Er.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Ju(e, n, r, o), e.options = t.options;
});
function qd(e, t) {
  return new Mr({
    type: "union",
    options: e,
    ..._(t)
  });
}
const Vd = /* @__PURE__ */ h("ZodDiscriminatedUnion", (e, t) => {
  Mr.init(e, t), $a.init(e, t);
});
function Wd(e, t, n) {
  return new Vd({
    type: "union",
    options: t,
    discriminator: e,
    ..._(n)
  });
}
const Hd = /* @__PURE__ */ h("ZodIntersection", (e, t) => {
  Sa.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => qu(e, n, r, o);
});
function Kd(e, t) {
  return new Hd({
    type: "intersection",
    left: e,
    right: t
  });
}
const Zt = /* @__PURE__ */ h("ZodEnum", (e, t) => {
  ka.init(e, t), N.init(e, t), e._zod.processJSONSchema = (r, o, s) => Mu(e, r, o), e.enum = t.entries, e.options = Object.values(t.entries);
  const n = new Set(Object.keys(t.entries));
  e.extract = (r, o) => {
    const s = {};
    for (const i of r) if (n.has(i)) s[i] = t.entries[i];
    else throw new Error(`Key ${i} not found in enum`);
    return new Zt({
      ...t,
      checks: [],
      ..._(o),
      entries: s
    });
  }, e.exclude = (r, o) => {
    const s = { ...t.entries };
    for (const i of r) if (n.has(i)) delete s[i];
    else throw new Error(`Key ${i} not found in enum`);
    return new Zt({
      ...t,
      checks: [],
      ..._(o),
      entries: s
    });
  };
});
function Dt(e, t) {
  const n = Array.isArray(e) ? Object.fromEntries(e.map((r) => [r, r])) : e;
  return new Zt({
    type: "enum",
    entries: n,
    ..._(t)
  });
}
const Bd = /* @__PURE__ */ h("ZodLiteral", (e, t) => {
  Ia.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => xu(e, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
    if (t.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
    return t.values[0];
  } });
});
function Ge(e, t) {
  return new Bd({
    type: "literal",
    values: Array.isArray(e) ? e : [e],
    ..._(t)
  });
}
const Gd = /* @__PURE__ */ h("ZodTransform", (e, t) => {
  Ea.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Fu(e, n), e._zod.parse = (n, r) => {
    if (r.direction === "backward") throw new ur(e.constructor.name);
    n.addIssue = (s) => {
      if (typeof s == "string") n.issues.push(Ce(s, n.value, t));
      else {
        const i = s;
        i.fatal && (i.continue = !1), i.code ?? (i.code = "custom"), i.input ?? (i.input = n.value), i.inst ?? (i.inst = e), n.issues.push(Ce(i));
      }
    };
    const o = t.transform(n.value, n);
    return o instanceof Promise ? o.then((s) => (n.value = s, n.fallback = !0, n)) : (n.value = o, n.fallback = !0, n);
  };
});
function Yd(e) {
  return new Gd({
    type: "transform",
    transform: e
  });
}
const xr = /* @__PURE__ */ h("ZodOptional", (e, t) => {
  Or.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Cr(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Zn(e) {
  return new xr({
    type: "optional",
    innerType: e
  });
}
const Xd = /* @__PURE__ */ h("ZodExactOptional", (e, t) => {
  Oa.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Cr(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Qd(e) {
  return new Xd({
    type: "optional",
    innerType: e
  });
}
const el = /* @__PURE__ */ h("ZodNullable", (e, t) => {
  Pa.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Vu(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Tn(e) {
  return new el({
    type: "nullable",
    innerType: e
  });
}
const tl = /* @__PURE__ */ h("ZodDefault", (e, t) => {
  Za.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Hu(e, n, r, o), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function nl(e, t) {
  return new tl({
    type: "default",
    innerType: e,
    get defaultValue() {
      return typeof t == "function" ? t() : fr(t);
    }
  });
}
const rl = /* @__PURE__ */ h("ZodPrefault", (e, t) => {
  Ta.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Ku(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function ol(e, t) {
  return new rl({
    type: "prefault",
    innerType: e,
    get defaultValue() {
      return typeof t == "function" ? t() : fr(t);
    }
  });
}
const Dr = /* @__PURE__ */ h("ZodNonOptional", (e, t) => {
  Ra.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Wu(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function il(e, t) {
  return new Dr({
    type: "nonoptional",
    innerType: e,
    ..._(t)
  });
}
const sl = /* @__PURE__ */ h("ZodCatch", (e, t) => {
  Na.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Bu(e, n, r, o), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function cl(e, t) {
  return new sl({
    type: "catch",
    innerType: e,
    catchValue: typeof t == "function" ? t : () => t
  });
}
const al = /* @__PURE__ */ h("ZodPipe", (e, t) => {
  Ca.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Gu(e, n, r, o), e.in = t.in, e.out = t.out;
});
function Rn(e, t) {
  return new al({
    type: "pipe",
    in: e,
    out: t
  });
}
const ul = /* @__PURE__ */ h("ZodReadonly", (e, t) => {
  Aa.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Yu(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function dl(e) {
  return new ul({
    type: "readonly",
    innerType: e
  });
}
const ll = /* @__PURE__ */ h("ZodCustom", (e, t) => {
  ja.init(e, t), N.init(e, t), e._zod.processJSONSchema = (n, r, o) => Du(e, n);
});
function fl(e, t = {}) {
  return /* @__PURE__ */ Ou(ll, e, t);
}
function hl(e, t) {
  return /* @__PURE__ */ Pu(e, t);
}
const Ye = Pt(), pl = k({
  supportsContentEdits: F().optional(),
  supportsOptions: F().optional()
}), ml = k({
  supportsContentEdits: F().optional(),
  supportsOptions: F().optional(),
  supportsForceUpdate: F().optional()
}), _l = k({
  offset: ee().int().nonnegative(),
  length: ee().int().nonnegative(),
  newText: D()
}), Fr = Wd("kind", [k({
  kind: Ge("replace"),
  path: we(D()),
  newValue: Ye
}), k({
  kind: Ge("stringEdits"),
  path: we(D()),
  stringEdits: we(_l)
})]), gl = k({
  content: Ye.optional(),
  options: Ye.optional(),
  readOnly: F().optional(),
  serverRevision: ee().int().nonnegative().optional(),
  acknowledgedClientRevision: ee().int().nonnegative().optional(),
  force: F().optional()
}), vl = W({
  id: "web-editor-host",
  description: "Methods the host exposes to the editor (web-editor/0.12)."
}, {
  initialized: O(k({
    protocolVersion: Ge("web-editor/0.12"),
    contentType: Dt(["text", "json"]),
    capabilities: pl.optional()
  }), k({
    protocolVersion: Ge("web-editor-host/0.12"),
    capabilities: ml.optional()
  })),
  applyContentEdit: ie(k({
    edits: we(Fr),
    clientRevision: ee().int().nonnegative(),
    basedOnServerRevision: ee().int().nonnegative()
  })),
  /**
  * The editor reports its laid-out content height (px). An embedding host
  * that reserves block space (e.g. an iframe with no intrinsic height)
  * uses this to size the frame once the guest has measured itself.
  */
  reportSize: ie(k({ height: ee().nonnegative() }))
}), yl = W({
  id: "web-editor",
  description: "Methods the editor exposes to the host (web-editor/0.12)."
}, {
  update: ie(gl),
  applyContentEdits: ie(k({
    edits: we(Fr),
    serverRevision: ee().int().nonnegative(),
    acknowledgedClientRevision: ee().int().nonnegative()
  })),
  getContentSchema: O(k({}), k({ schema: Ye }))
}), Ue = k({
  registered: F(),
  isDefault: F()
}), Ft = k({
  handleId: D(),
  appId: D(),
  serviceId: D(),
  serviceIdPrefix: D()
}), bl = Ft.extend({ parentAppId: D() });
W({
  id: "vscode-app-host",
  description: "Methods an app `.vscode-app.html` exposes to the host (vscode-app-host/0.1)."
}, {
  getContext: O(k({}), k({
    dataDocument: k({ contentType: Dt(["text", "json"]) }).nullable(),
    embedding: bl.nullable()
  })),
  /**
  * Load a relative local app as an initially-hidden, independently
  * sandboxed child. Resolves after the child signals that its API is ready.
  */
  loadApp: O(k({ path: D() }), Ft).withStream({ server: k({}) }),
  /** Unload a direct child owned by this app runtime. */
  unloadApp: O(k({ handleId: D() }), k({})),
  /** Signal that this embedded app has registered the API its parent calls. */
  embeddedReady: ie(k({})),
  /**
  * Show or hide this embedded app's trusted-shell-owned modal surface.
  * Only embedded runtimes may call this method.
  */
  setModalVisibility: O(k({
    visible: F(),
    presentation: k({ title: D().optional() }).optional()
  }), k({})),
  /**
  * This app's registration for `extension` (e.g. `".csv"`), reported per
  * scope. Served on the app's own (ungated) root overlay, so it needs no
  * capability. For each scope:
  *   - `registered` — the app is wired up for the type (an "Open as
  *     Custom Editor" toolbar button appears), via the `editorTypes`
  *     setting.
  *   - `isDefault` — the type *auto-opens* in the app (implies
  *     `registered`), via `workbench.editorAssociations`.
  * `hasWorkspace` indicates whether a workspace is open. Changing any of
  * this is done via {@link configureEditorAssociation} (host-rendered).
  */
  getEditorRegistration: O(k({ extension: D() }), k({
    global: Ue,
    workspace: Ue,
    hasWorkspace: F()
  })),
  /**
  * Ask the host to show its (trusted, host-rendered) editor-association
  * dialog for `extension` (e.g. `".csv"`). The host owns the UI and
  * applies any change to `editorTypes` / `workbench.editorAssociations`
  * itself — the app never writes settings and needs no capability.
  *
  * `dismissable` is a hint: when the app is opened directly (no bound
  * data document) the host shows the dialog *unclosable* (the user can
  * still just close the editor tab) regardless of the hint; when bound to
  * a data document the dialog is dismissable unless `dismissable` is
  * `false`. Resolves once the dialog is dismissed, reporting the final
  * per-scope registration and whether anything `changed`.
  */
  configureEditorAssociation: O(k({
    extension: D(),
    dismissable: F().optional()
  }), k({
    global: Ue,
    workspace: Ue,
    hasWorkspace: F(),
    changed: F()
  }))
});
W({
  id: "vscode-app-embedding-events",
  description: "Lifecycle notifications for child apps loaded by a VS Code app."
}, {
  changed: ie(Ft),
  removed: ie(k({ handleId: D() }))
});
function Nn(e, t) {
  let n = e;
  for (const r of t) if (r.kind === "replace") n = Cn(n, r.path, r.newValue);
  else {
    const o = zl(n, r.path);
    if (typeof o != "string") throw new Error(`applyContentEdits: stringEdits at path [${r.path.join(", ")}] requires a string, got ${typeof o}`);
    n = Cn(n, r.path, wl(o, r.stringEdits));
  }
  return n;
}
function wl(e, t) {
  let n = e;
  for (const r of t) n = n.slice(0, r.offset) + r.newText + n.slice(r.offset + r.length);
  return n;
}
function zl(e, t) {
  let n = e;
  for (const r of t) {
    if (n == null) return;
    n = n[r];
  }
  return n;
}
function Cn(e, t, n) {
  if (t.length === 0) return n;
  const r = e === null || typeof e != "object" ? {} : e;
  let o = r;
  for (let s = 0; s < t.length - 1; s++) {
    const i = t[s], c = o[i];
    (c === null || typeof c != "object") && (o[i] = {}), o = o[i];
  }
  return o[t[t.length - 1]] = n, r;
}
function ht(e, t) {
  return t === "text" ? e : e === "" ? null : JSON.parse(e);
}
function An(e, t, n = {}) {
  if (t === "text") {
    if (typeof e != "string") throw new Error(`decodeFromEditor: expected string for text content, got ${typeof e}`);
    return e;
  }
  let r = n.indentation;
  if (e !== null && typeof e == "object" && !Array.isArray(e)) {
    const o = e["$web-editor.format-json"];
    typeof o == "number" || o === "	" ? r = o : o !== void 0 && (r = 4);
  }
  return JSON.stringify(e, void 0, r);
}
var pt = class {
  _listeners = /* @__PURE__ */ new Set();
  event = (e) => (this._listeners.add(e), { dispose: () => this._listeners.delete(e) });
  fire(e) {
    for (const t of this._listeners) try {
      t(e);
    } catch (n) {
      console.error("Emitter listener threw:", n);
    }
  }
  dispose() {
    this._listeners.clear();
  }
}, $l = class {
  _connection;
  _editor;
  _contentType;
  _jsonFormat;
  _onError;
  _capabilities;
  _text;
  _readOnly;
  _serverRevision = 0;
  _acknowledgedClientRevision = 0;
  _editorInitialized = !1;
  _editorCapabilities;
  _onDidChangeText = new pt();
  onDidChangeText = this._onDidChangeText.event;
  _onDidInitialize = new pt();
  onDidInitialize = this._onDidInitialize.event;
  _onDidReportSize = new pt();
  onDidReportSize = this._onDidReportSize.event;
  constructor(e) {
    this._connection = e.connection, this._contentType = e.contentType ?? "text", this._text = e.initialText ?? "", this._readOnly = e.readOnly ?? !1, this._jsonFormat = e.jsonFormat ?? {}, this._onError = e.onError ?? ((t, n) => console.error("WebEditorHost:", t, n)), this._capabilities = e.capabilities ?? { supportsForceUpdate: !0 }, this._editor = this._connection.get(yl), this._connection.register(vl, {
      initialized: (t) => (t.contentType !== this._contentType && this._onError(`Editor contentType "${t.contentType}" does not match host "${this._contentType}"`), this._editorCapabilities = t.capabilities, this._editorInitialized = !0, this._serverRevision = 0, this._acknowledgedClientRevision = 0, this._pushFullUpdate(), this._onDidInitialize.fire({ capabilities: t.capabilities }), {
        protocolVersion: "web-editor-host/0.12",
        capabilities: this._capabilities
      }),
      applyContentEdit: (t) => {
        if (this._readOnly) {
          this._onError("Editor sent applyContentEdit while readOnly"), this._acknowledgeAndRestore(t.clientRevision);
          return;
        }
        if (t.basedOnServerRevision !== this._serverRevision) {
          this._onError(`Editor edit is based on stale server revision ${t.basedOnServerRevision}; current revision is ${this._serverRevision}`), this._acknowledgeAndRestore(t.clientRevision);
          return;
        }
        let n;
        try {
          n = Nn(ht(this._text, this._contentType), t.edits);
        } catch (o) {
          this._onError("Failed to apply content edits from editor", o), this._acknowledgeAndRestore(t.clientRevision);
          return;
        }
        let r;
        try {
          r = An(n, this._contentType, this._jsonFormat);
        } catch (o) {
          this._onError("Failed to decode editor content", o), this._acknowledgeAndRestore(t.clientRevision);
          return;
        }
        this._acknowledgedClientRevision = Math.max(this._acknowledgedClientRevision, t.clientRevision), r !== this._text && (this._text = r, this._onDidChangeText.fire({ text: r })), this._pushAcknowledgement();
      },
      reportSize: (t) => {
        this._onDidReportSize.fire({ height: t.height });
      }
    });
  }
  /** The text the host believes the document currently holds. */
  getText() {
    return this._text;
  }
  /**
  * Push a new full text to the editor. Sent as a `replace` at the document
  * root. If `force`, the editor must adopt it even with pending local edits.
  */
  setText(e, t = {}) {
    e === this._text && !t.force || (this._text = e, this._pushFullUpdate(t.force));
  }
  /**
  * Reassign this host/editor connection to another logical document.
  * The forced update advances the server revision, making edits queued by
  * the previous logical document stale before the caller switches routing.
  */
  reuse(e, t) {
    this._readOnly = t, this._text = e, this._pushFullUpdate(!0);
  }
  getReadOnly() {
    return this._readOnly;
  }
  setReadOnly(e) {
    this._readOnly !== e && (this._readOnly = e, this._editorInitialized && this._editor.update({
      readOnly: e,
      acknowledgedClientRevision: this._acknowledgedClientRevision
    }));
  }
  /**
  * Push fine-grained edits to the editor.
  * The host is responsible for keeping its own `_text` consistent with these edits.
  */
  applyEdits(e) {
    if (e.length === 0 || !this._editorInitialized) return;
    let t;
    try {
      t = Nn(ht(this._text, this._contentType), e), this._text = An(t, this._contentType, this._jsonFormat);
    } catch (n) {
      this._onError("Failed to apply outgoing edits to local text", n);
      return;
    }
    this._serverRevision++, this._editor.applyContentEdits({
      edits: e,
      serverRevision: this._serverRevision,
      acknowledgedClientRevision: this._acknowledgedClientRevision
    });
  }
  dispose() {
    this._onDidChangeText.dispose(), this._onDidInitialize.dispose(), this._onDidReportSize.dispose(), this._connection.close();
  }
  _pushFullUpdate(e) {
    if (!this._editorInitialized) return;
    this._serverRevision++;
    let t;
    try {
      t = ht(this._text, this._contentType);
    } catch (n) {
      this._onError("Failed to encode text for editor", n);
      return;
    }
    this._editor.update({
      content: t,
      readOnly: this._readOnly,
      serverRevision: this._serverRevision,
      acknowledgedClientRevision: this._acknowledgedClientRevision,
      force: e
    });
  }
  _pushAcknowledgement() {
    this._editorInitialized && this._editor.update({
      serverRevision: this._serverRevision,
      acknowledgedClientRevision: this._acknowledgedClientRevision
    });
  }
  _acknowledgeAndRestore(e) {
    this._acknowledgedClientRevision = Math.max(this._acknowledgedClientRevision, e), this._pushFullUpdate(!0);
  }
};
function Sl(e, t) {
  const n = e.filter((s) => "language" in s.selector && s.selector.language === t);
  if (n.length > 0)
    return n.length === 1 ? { kind: "match", provider: n[0] } : { kind: "ambiguous", providers: n };
  let r = -1, o = [];
  for (const s of e) {
    if (!("languagePrefix" in s.selector) || !t.startsWith(s.selector.languagePrefix))
      continue;
    const i = s.selector.languagePrefix.length;
    i > r ? (r = i, o = [s]) : i === r && o.push(s);
  }
  if (o.length !== 0)
    return o.length === 1 ? { kind: "match", provider: o[0] } : { kind: "ambiguous", providers: o };
}
const kl = `
	:root { color-scheme: light dark; }
	html, body { margin: 0; padding: 0; background: transparent; }
	body {
		font-family: var(--vscode-font-family, system-ui, sans-serif);
		font-size: var(--vscode-font-size, 13px);
		color: var(--vscode-foreground, #1e1e1e);
		box-sizing: border-box;
	}
`, Xe = "vscode-markdown-editor::control", Il = 1e4;
function El(e, t, n) {
  const r = kl.replace(/<\/style/gi, "<\\/style"), o = (t ?? "").replace(/<\/style/gi, "<\\/style"), s = n ? ` nonce="${Ol(n)}"` : "", i = `<style data-vscode-markdown-editor-base>${r}</style><style data-vscode-markdown-editor-theme>${o}</style><script${s}>(function(){var t=document.currentScript.previousElementSibling;var sendSize=function(){parent.postMessage({type:${JSON.stringify(Xe)},height:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)},"*");};addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(d&&d.type===${JSON.stringify(Xe)}&&typeof d.themeCss==="string")t.textContent=d.themeCss;});addEventListener("load",sendSize);new ResizeObserver(sendSize).observe(document.documentElement);})();<\/script>`, c = n ? e.replace(/<script\b(?![^>]*\bnonce\s*=)/gi, `<script${s}`) : e, a = c.search(/<\/head\s*>/i);
  if (a !== -1)
    return c.slice(0, a) + i + c.slice(a);
  const u = c.match(/<html[^>]*>/i);
  if (u?.index !== void 0) {
    const d = u.index + u[0].length;
    return c.slice(0, d) + `<head>${i}</head>` + c.slice(d);
  }
  return `<!doctype html><html><head>${i}</head><body>${c}</body></html>`;
}
function Ol(e) {
  return e.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
class jl {
  constructor(t) {
    this._options = t, this._providers = t.providers, this._frameLayer = document.createElement("div"), this._frameLayer.style.position = "absolute", this._frameLayer.style.inset = "0", this._frameLayer.style.height = "0", this._frameLayer.style.pointerEvents = "none", this._frameLayer.style.zIndex = "1", t.frameRoot && this._setFrameRoot(t.frameRoot), this._observer = typeof IntersectionObserver > "u" ? void 0 : new IntersectionObserver((n) => {
      for (const r of n)
        Array.from(this._logicalEditors).find((s) => s.element === r.target)?.setVisible(r.isIntersecting);
    }, { root: t.root ?? null });
  }
  _frameLayer;
  _frameRoot;
  _restoreFrameRootPosition;
  _layoutObserver;
  _layoutFrame = 0;
  _observer;
  _logicalEditors = /* @__PURE__ */ new Set();
  _pools = /* @__PURE__ */ new Map();
  _descriptorCache = /* @__PURE__ */ new Map();
  _rejectedProviders = /* @__PURE__ */ new Set();
  _providers;
  _generation = 0;
  _descriptorCacheHits = 0;
  _disposed = !1;
  updateProviders(t) {
    this._providers = t, this._generation++, this._descriptorCache.clear(), this._rejectedProviders.clear(), this._descriptorCacheHits = 0, this._disposePools();
    for (const n of this._logicalEditors)
      n.invalidate();
    this._options.onDidChange?.();
  }
  get diagnostics() {
    let t = 0, n = 0;
    for (const r of this._pools.values())
      t += r.leasedFrames, n += r.idleFrames;
    return {
      logicalEditors: this._logicalEditors.size,
      leasedFrames: t,
      idleFrames: n,
      descriptorCacheEntries: this._descriptorCache.size,
      descriptorCacheHits: this._descriptorCacheHits
    };
  }
  create(t, n, r) {
    const o = Sl(this._providers, t);
    if (!o)
      return;
    if (o.kind === "ambiguous") {
      this._options.onAmbiguous?.(t, o.providers);
      return;
    }
    const s = jn(o.provider.id, n);
    if (this._rejectedProviders.has(s))
      return;
    const i = new Pl(
      this,
      o.provider,
      n,
      r,
      this._options.defaultHeight ?? 120,
      this._generation
    );
    return this._logicalEditors.add(i), this._observer?.observe(i.element), this._layoutObserver && i.observeLayout(this._layoutObserver), this._observer || i.setVisible(!0), i;
  }
  dispose() {
    if (!this._disposed) {
      this._disposed = !0, this._observer?.disconnect(), this._layoutObserver?.disconnect(), cancelAnimationFrame(this._layoutFrame), window.removeEventListener("resize", this._scheduleLayout);
      for (const t of Array.from(this._logicalEditors))
        t.dispose();
      this._disposePools(), this._frameLayer.remove(), this._frameRoot && this._restoreFrameRootPosition !== void 0 && (this._frameRoot.style.position = this._restoreFrameRootPosition);
    }
  }
  remove(t) {
    this._observer?.unobserve(t.element), this._layoutObserver?.unobserve(t.element), this._logicalEditors.delete(t), t.frame?.unbind();
  }
  async resolve(t, n) {
    const r = jn(t.provider.id, t.infoString);
    let o = this._descriptorCache.get(r), s;
    try {
      o ? this._descriptorCacheHits++ : (o = t.provider.resolve(t.infoString), this._descriptorCache.set(r, o)), s = await o;
    } catch {
      o && this._descriptorCache.get(r) === o && this._descriptorCache.delete(r), this._rejectEditor(t, n, r);
      return;
    }
    if (this._disposed || t.disposed || n !== this._generation || !s) {
      this._rejectEditor(t, n, r);
      return;
    }
    const i = Rl(t.provider.id, t.infoString, s);
    let c = this._pools.get(i);
    if (!c) {
      const a = this._ensureFrameRoot(t);
      c = new Zl(
        s,
        this._frameLayer,
        a,
        this._options.scriptNonce,
        this._options.themeCss
      ), this._pools.set(i, c);
    }
    t.resolve(c);
  }
  _rejectEditor(t, n, r) {
    t.resolve(void 0), !this._disposed && !t.disposed && n === this._generation && (this._rejectedProviders.add(r), this._options.onDidChange?.());
  }
  _ensureFrameRoot(t) {
    return this._frameRoot ?? this._setFrameRoot(
      t.element.closest(".md-editor") ?? (this._options.root instanceof HTMLElement ? this._options.root : document.body)
    );
  }
  _setFrameRoot(t) {
    if (this._frameRoot = t, t !== document.body && getComputedStyle(t).position === "static" && (this._restoreFrameRootPosition = t.style.position, t.style.position = "relative"), t.appendChild(this._frameLayer), typeof ResizeObserver < "u") {
      this._layoutObserver = new ResizeObserver(() => this._scheduleLayout()), this._layoutObserver.observe(t);
      for (const n of this._logicalEditors)
        n.observeLayout(this._layoutObserver);
    }
    return window.addEventListener("resize", this._scheduleLayout), t;
  }
  _scheduleLayout = () => {
    this._layoutFrame || (this._layoutFrame = requestAnimationFrame(() => {
      this._layoutFrame = 0;
      for (const t of this._pools.values())
        t.layout();
    }));
  };
  _disposePools() {
    for (const t of this._pools.values())
      t.dispose();
    this._pools.clear();
  }
}
class Pl {
  constructor(t, n, r, o, s, i) {
    this._factory = t, this.provider = n, this.infoString = r, this._content = o, this.element = document.createElement("div"), this.element.style.width = "100%", this.element.style.minHeight = `${s}px`, this._frameHost = document.createElement("div"), this._frameHost.style.width = "100%", this.element.appendChild(this._frameHost), this.estimateHeight = () => parseFloat(this.element.style.minHeight) || s, this._factory.resolve(this, i);
  }
  element;
  onEdit;
  estimateHeight;
  frame;
  disposed = !1;
  visible = !1;
  infoString;
  _frameHost;
  _content;
  _readOnly = !1;
  _pool;
  _resolved = !1;
  setContent(t) {
    t !== this._content && (this._content = t, this.frame?.bind(this));
  }
  setReadOnly(t) {
    this._readOnly !== t && (this._readOnly = t, this.frame?.bind(this));
  }
  setVisible(t) {
    this.visible = t, this._resolved && (t ? this._pool?.acquire(this) : this.hasFocus() || this._pool?.release(this));
  }
  resolve(t) {
    this.disposed || (this._resolved = !0, this._pool = t, t ? t.descriptor.initialHeight !== void 0 && (this.element.style.minHeight = `${t.descriptor.initialHeight}px`) : this._renderFallback(), this.visible && t?.acquire(this));
  }
  invalidate() {
    this.frame?.unbind(), this._pool = void 0, this._resolved = !1, this._renderFallback();
  }
  bindFrame(t) {
    this.frame = t, t.layout(this);
  }
  unbindFrame(t) {
    this.frame && (this.element.style.minHeight = `${t}px`, this.frame = void 0);
  }
  applyGuestText(t) {
    if (t === this._content)
      return;
    const n = Ur.replace(Jr.ofLength(this._content.length), t);
    this._content = t, this.onEdit?.(n);
  }
  applyHeight(t) {
    const n = Tt(t);
    this.element.style.minHeight = `${n}px`, this.frame && (this.frame.iframe.style.height = `${n}px`, this.frame.layout(this));
  }
  observeLayout(t) {
    t.observe(this.element);
  }
  hasFocus() {
    return this.frame !== void 0 && document.activeElement === this.frame.iframe;
  }
  get content() {
    return this._content;
  }
  get readOnly() {
    return this._readOnly;
  }
  get frameHost() {
    return this._frameHost;
  }
  dispose() {
    this.disposed || (this.disposed = !0, this._factory.remove(this), this.element.remove());
  }
  _renderFallback() {
    const t = document.createElement("pre"), n = document.createElement("code");
    n.textContent = this._content, t.appendChild(n), this._frameHost.replaceChildren(t);
  }
}
class Zl {
  constructor(t, n, r, o, s) {
    this._frameLayer = n, this._frameRoot = r, this._scriptNonce = o, this._themeCss = s, this.descriptor = t;
  }
  descriptor;
  _frames = /* @__PURE__ */ new Set();
  get leasedFrames() {
    return Array.from(this._frames).filter((t) => t.editor !== void 0).length;
  }
  get idleFrames() {
    return this._frames.size - this.leasedFrames;
  }
  acquire(t) {
    if (t.frame) {
      t.frame.bind(t);
      return;
    }
    (Array.from(this._frames).find((o) => o.editor === void 0) ?? this._createFrame()).bind(t);
  }
  release(t) {
    const n = t.frame;
    !n || n.editor !== t || t.hasFocus() || n.unbind();
  }
  park(t) {
    t.style.top = "-100000px", t.style.left = "0";
  }
  dispose() {
    for (const t of this._frames)
      t.dispose();
    this._frames.clear();
  }
  layout() {
    for (const t of this._frames)
      t.editor && t.layout(t.editor);
  }
  _createFrame() {
    const t = new Tl(this, this.descriptor, this._frameLayer, this._frameRoot, this._scriptNonce, this._themeCss);
    return this._frames.add(t), t;
  }
}
class Tl {
  constructor(t, n, r, o, s, i) {
    this._descriptor = n, this._frameRoot = o, this._scriptNonce = s, this._themeCss = i, this.pool = t;
    const c = document.createElement("iframe");
    c.setAttribute("sandbox", Lr(n.sandbox)), c.setAttribute("allow", n.sandbox?.clipboardWrite ? "clipboard-write" : ""), c.style.width = "100%", c.style.border = "none", c.style.display = "block", c.style.position = "absolute", c.style.pointerEvents = "auto", c.style.background = "transparent", c.style.height = `${n.initialHeight ?? 120}px`, t.park(c), c.addEventListener("blur", () => {
      const a = this.editor;
      a && !a.visible && this.pool.release(a);
    }), this.iframe = c, this._onWindowMessage = (a) => {
      if (a.source !== c.contentWindow)
        return;
      const u = a.data;
      u?.type !== Xe || typeof u.height != "number" || !Number.isFinite(u.height) || this.editor?.applyHeight(u.height);
    }, window.addEventListener("message", this._onWindowMessage), r.appendChild(c), queueMicrotask(() => this._setup());
  }
  iframe;
  editor;
  pool;
  _host;
  _transport;
  _pendingEditor;
  _disposed = !1;
  _onWindowMessage;
  bind(t) {
    if (this.editor === t) {
      this._host?.setText(t.content), this._host?.setReadOnly(t.readOnly), this.iframe.style.height = `${Tt(t.estimateHeight())}px`, this.layout(t);
      return;
    }
    this.editor && this.editor !== t && this.unbind(), this._pendingEditor = t, this._host && this._host.reuse(t.content, t.readOnly), this.editor = t, this._pendingEditor = void 0, t.bindFrame(this), this.iframe.style.height = `${Tt(t.estimateHeight())}px`;
  }
  unbind() {
    const t = this.editor;
    if (!t)
      return;
    const n = parseFloat(this.iframe.style.height) || this._descriptor.initialHeight || 120;
    this.editor = void 0, t.unbindFrame(n), this.pool.park(this.iframe);
  }
  layout(t) {
    if (this.editor !== t)
      return;
    const n = t.element.getBoundingClientRect(), r = this._frameRoot.getBoundingClientRect(), o = this._frameRoot === document.body, s = o ? n.top + window.scrollY : n.top - r.top + this._frameRoot.scrollTop, i = o ? n.left + window.scrollX : n.left - r.left + this._frameRoot.scrollLeft;
    this.iframe.style.top = `${s}px`, this.iframe.style.left = `${i}px`, this.iframe.style.width = `${n.width}px`;
  }
  dispose() {
    this._disposed || (this._disposed = !0, this.unbind(), window.removeEventListener("message", this._onWindowMessage), this._host?.dispose(), this._transport?.dispose(), this.iframe.remove());
  }
  _setup() {
    if (this._disposed)
      return;
    const t = this.iframe.contentWindow;
    if (!t) {
      requestAnimationFrame(() => this._setup());
      return;
    }
    this._transport = new Zs(window, t);
    const n = new ks(sr.create(this._transport)), r = this._pendingEditor ?? this.editor;
    this._host = new $l({
      connection: n,
      contentType: this._descriptor.contentType ?? "text",
      initialText: r?.content ?? "",
      readOnly: r?.readOnly ?? !1
    }), this._host.onDidChangeText(({ text: o }) => this.editor?.applyGuestText(o)), this._host.onDidReportSize(({ height: o }) => this.editor?.applyHeight(o)), this.iframe.addEventListener("load", () => this._postTheme(), { once: !0 }), this.iframe.srcdoc = El(
      this._descriptor.html,
      this._getThemeCss(),
      this._scriptNonce
    );
  }
  _getThemeCss() {
    return typeof this._themeCss == "function" ? this._themeCss() : this._themeCss;
  }
  _postTheme() {
    const t = this._getThemeCss();
    t !== void 0 && this.iframe.contentWindow?.postMessage({ type: Xe, themeCss: t }, "*");
  }
}
function Lr(e) {
  const t = ["allow-scripts"];
  return e?.forms && t.push("allow-forms"), e?.downloads && t.push("allow-downloads"), e?.pointerLock && t.push("allow-pointer-lock"), t.join(" ");
}
function Tt(e) {
  return Math.max(1, Math.min(Il, Math.ceil(e)));
}
function jn(e, t) {
  return `${e}\0${t}`;
}
function Rl(e, t, n) {
  return [
    e,
    t,
    n.contentType ?? "text",
    Lr(n.sandbox),
    n.sandbox?.clipboardWrite === !0 ? "clipboard-write" : ""
  ].join("\0");
}
export {
  jl as VirtualizedIframeEmbeddedEditorFactory,
  Sl as selectCodeBlockEditorProvider
};
//# sourceMappingURL=web-editors.js.map
