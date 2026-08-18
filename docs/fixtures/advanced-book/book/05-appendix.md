@chapter "Appendix: Forms and Signals" #ch-appendix

@page

# Appendix: Forms and Signals

## Radio procedure {#radio .procedure}

Call-signs are spoken as written: <span class="callsign">Kestrel
Nine</span> calls <span class="callsign">Granite Base</span>, never the
reverse, and the word *over* ends every transmission except the last —
that one ends with *out*.

1. Open with both call-signs, called station first.
2. Keep transmissions under ten seconds.
3. Spell proper nouns with the standard alphabet:
   * **A**lder, **B**irch, **C**edar…
   * numerals are spoken singly: *three-one*, never *thirty-one*

## The incident form

Forms are raw HTML so their layout is exact:

<div class="incident-form">
  <div class="field"><span>Warden</span><span>call-sign</span></div>
  <div class="field"><span>District</span><span>code</span></div>
  <div class="field"><span>Observed</span><span>date · time · weather</span></div>
  <div class="field"><span>Action taken</span><span>free text</span></div>
</div>

Submit the form in duplicate; the [radio procedure](#radio) above
governs any follow-up traffic. External references use standard link
attributes: the [almanac archive](https://example.org/almanac){target="_blank" .external}
is mirrored off-range.

## Signals quick reference

```text {.line-numbers}
LONG      hold position
LONG LONG come to me
LONG x3   emergency — all wardens
SHORT     acknowledged
```

The fence above carries a brace attribute; the heading below carries an
id and a class, and — like every `h2` in this book — is decorated by
the plugin's token transform, which must never leak into this file on
save.

---

## Weather glyphs {#glyphs .reference}

| Glyph | Meaning | Enter in book as |
| :---: | --- | ---: |
| ○ | clear deck | `deck 0/8` |
| ◐ | broken deck | `deck 4/8` |
| ● | overcast | `deck 8/8` |
