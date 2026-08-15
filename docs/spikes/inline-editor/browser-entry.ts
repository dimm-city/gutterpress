import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { DOMParser as PMDOMParser, Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-markdown";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history } from "prosemirror-history";

(window as any).SPIKE = {
  /** Mount a real ProseMirror view over a live .gp-strip's content. */
  mount(stripSelector: string) {
    const strip = document.querySelector(stripSelector) as HTMLElement;
    if (!strip) throw new Error("no strip");
    const doc = PMDOMParser.fromSchema(basicSchema).parse(strip);
    const view = new EditorView(
      { mount: strip },
      { state: EditorState.create({ doc, plugins: [history(), keymap(baseKeymap)] }) },
    );
    (window as any).__view = view;
    return { nodes: doc.childCount };
  },
  /** Per-keystroke cost THROUGH ProseMirror's transaction pipeline. */
  bench(samples: number) {
    const view = (window as any).__view as EditorView;
    const times: number[] = [];
    // caret into the middle of the doc
    const pos = Math.floor(view.state.doc.content.size / 2);
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now();
      const tr = view.state.tr.insertText("x", pos + i);
      view.dispatch(tr);                       // state + DOM update
      void (view.dom as HTMLElement).offsetHeight; // force layout/reflow
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], n: times.length };
  },
};
