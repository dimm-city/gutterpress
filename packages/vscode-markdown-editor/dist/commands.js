const r = ["macos"], i = ["windows", "linux"], o = (n, u = !1) => ({
  kind: "cursor",
  command: n,
  extend: u
}), d = (n) => ({ kind: "edit", command: n }), l = (n) => ({ kind: "history", command: n }), s = (n) => ({ kind: "tab", command: n }), c = (n) => ({
  kind: "enter",
  command: n
}), t = (n, u, a) => ({ key: n, modifiers: u, platforms: a }), e = (n, u, a, m, w = "host") => ({ id: n, title: u, action: a, keybindings: m, routing: w }), L = [
  e("markdown.editor.cursorLeft", "Move Cursor Left", o("left"), [
    t("b", { ctrl: !0 }, r),
    t("ArrowLeft")
  ]),
  e("markdown.editor.cursorRight", "Move Cursor Right", o("right"), [
    t("f", { ctrl: !0 }, r),
    t("ArrowRight")
  ]),
  e("markdown.editor.cursorUp", "Move Cursor Up", o("up"), [
    t("p", { ctrl: !0 }, r),
    t("ArrowUp")
  ]),
  e("markdown.editor.cursorDown", "Move Cursor Down", o("down"), [
    t("n", { ctrl: !0 }, r),
    t("ArrowDown")
  ]),
  e("markdown.editor.cursorLeftSelect", "Select Left", o("left", !0), [
    t("ArrowLeft", { shift: !0 })
  ]),
  e("markdown.editor.cursorRightSelect", "Select Right", o("right", !0), [
    t("ArrowRight", { shift: !0 })
  ]),
  e("markdown.editor.cursorUpSelect", "Select Up", o("up", !0), [
    t("ArrowUp", { shift: !0 })
  ]),
  e("markdown.editor.cursorDownSelect", "Select Down", o("down", !0), [
    t("ArrowDown", { shift: !0 })
  ]),
  e("markdown.editor.cursorWordLeft", "Move Cursor Word Left", o("wordLeft"), [
    t("ArrowLeft", { alt: !0 }, r),
    t("ArrowLeft", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.cursorWordRight", "Move Cursor Word Right", o("wordRight"), [
    t("ArrowRight", { alt: !0 }, r),
    t("ArrowRight", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.cursorWordLeftSelect", "Select Word Left", o("wordLeft", !0), [
    t("ArrowLeft", { alt: !0, shift: !0 }, r),
    t("ArrowLeft", { ctrl: !0, shift: !0 }, i)
  ]),
  e("markdown.editor.cursorWordRightSelect", "Select Word Right", o("wordRight", !0), [
    t("ArrowRight", { alt: !0, shift: !0 }, r),
    t("ArrowRight", { ctrl: !0, shift: !0 }, i)
  ]),
  e("markdown.editor.cursorVisualLineStart", "Move Cursor to Visual Line Start", o("visualLineStart"), [
    t("ArrowLeft", { meta: !0 }, r),
    t("Home")
  ]),
  e("markdown.editor.cursorVisualLineEnd", "Move Cursor to Visual Line End", o("visualLineEnd"), [
    t("ArrowRight", { meta: !0 }, r),
    t("End")
  ]),
  e("markdown.editor.cursorVisualLineStartSelect", "Select to Visual Line Start", o("visualLineStart", !0), [
    t("ArrowLeft", { meta: !0, shift: !0 }, r),
    t("Home", { shift: !0 })
  ]),
  e("markdown.editor.cursorVisualLineEndSelect", "Select to Visual Line End", o("visualLineEnd", !0), [
    t("ArrowRight", { meta: !0, shift: !0 }, r),
    t("End", { shift: !0 })
  ]),
  e("markdown.editor.cursorLogicalLineStart", "Move Cursor to Logical Line Start", o("logicalLineStart"), [
    t("a", { ctrl: !0 }, r)
  ]),
  e("markdown.editor.cursorLogicalLineEnd", "Move Cursor to Logical Line End", o("logicalLineEnd"), [
    t("e", { ctrl: !0 }, r)
  ]),
  e("markdown.editor.cursorLogicalLineStartSelect", "Select to Logical Line Start", o("logicalLineStart", !0), [
    t("a", { ctrl: !0, shift: !0 }, r)
  ]),
  e("markdown.editor.cursorLogicalLineEndSelect", "Select to Logical Line End", o("logicalLineEnd", !0), [
    t("e", { ctrl: !0, shift: !0 }, r)
  ]),
  e("markdown.editor.cursorDocumentStart", "Move Cursor to Document Start", o("documentStart"), [
    t("ArrowUp", { meta: !0 }, r),
    t("Home", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.cursorDocumentEnd", "Move Cursor to Document End", o("documentEnd"), [
    t("ArrowDown", { meta: !0 }, r),
    t("End", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.cursorDocumentStartSelect", "Select to Document Start", o("documentStart", !0), [
    t("ArrowUp", { meta: !0, shift: !0 }, r),
    t("Home", { ctrl: !0, shift: !0 }, i)
  ]),
  e("markdown.editor.cursorDocumentEndSelect", "Select to Document End", o("documentEnd", !0), [
    t("ArrowDown", { meta: !0, shift: !0 }, r),
    t("End", { ctrl: !0, shift: !0 }, i)
  ]),
  e("markdown.editor.selectAll", "Select All", { kind: "selectAll" }, [
    t("a", { meta: !0 }, r),
    t("a", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.deleteLeft", "Delete Left", d("deleteLeft"), [
    t("h", { ctrl: !0 }, r),
    t("Backspace", { ctrl: !0 }, r),
    t("Backspace"),
    t("Backspace", { shift: !0 })
  ]),
  e("markdown.editor.deleteRight", "Delete Right", d("deleteRight"), [
    t("d", { ctrl: !0 }, r),
    t("Delete", { ctrl: !0 }, r),
    t("Delete")
  ]),
  e("markdown.editor.deleteWordLeft", "Delete Word Left", d("deleteWordLeft"), [
    t("Backspace", { alt: !0 }, r),
    t("Backspace", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.deleteWordRight", "Delete Word Right", d("deleteWordRight"), [
    t("Delete", { alt: !0 }, r),
    t("Delete", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.deleteLineLeft", "Delete All Left", d("deleteLineLeft"), [
    t("Backspace", { meta: !0 }, r)
  ]),
  e("markdown.editor.deleteLineRight", "Delete All Right", d("deleteLineRight"), [
    t("Delete", { meta: !0 }, r),
    t("k", { ctrl: !0 }, r)
  ]),
  e("markdown.editor.undo", "Undo", l("undo"), [
    t("z", { meta: !0 }, r),
    t("z", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.redo", "Redo", l("redo"), [
    t("z", { meta: !0, shift: !0 }, r),
    t("z", { ctrl: !0, shift: !0 }, i),
    t("y", { ctrl: !0 }, i)
  ]),
  e("markdown.editor.insertTab", "Insert Tab", s("insert"), [
    t("Tab")
  ], "local"),
  e("markdown.editor.outdent", "Outdent", s("outdent"), [
    t("Tab", { shift: !0 })
  ], "local"),
  e("markdown.editor.toggleTabFocus", "Toggle Tab Key Moves Focus", { kind: "toggleTabFocus" }, [
    t("m", { ctrl: !0 })
  ], "local"),
  e("markdown.editor.smartEnter", "Insert Paragraph", c("smartEnter"), [
    t("Enter")
  ]),
  e("markdown.editor.insertHardLineBreak", "Insert Hard Line Break", c("insertHardLineBreak"), [
    t("Enter", { shift: !0 })
  ]),
  e("markdown.editor.insertParagraph", "Insert Paragraph Without Continuing Markup", c("insertParagraph"), [
    t("Enter", { meta: !0 }, r),
    t("Enter", { ctrl: !0 })
  ])
];
export {
  L as commands
};
//# sourceMappingURL=commands.js.map
