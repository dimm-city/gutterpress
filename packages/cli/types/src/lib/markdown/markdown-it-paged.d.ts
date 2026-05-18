export = plugin;
declare function plugin(md: any, pluginOptions?: {}): void;
declare namespace plugin {
    export { plugin as default, PAGED_CSS };
}
/**
 * Minimal Paged.js-friendly CSS for the classes this plugin emits.
 * Consumers should inject this into <head> after their user stylesheets so
 * the layout contract (page/section/column breaks) wins at equal specificity.
 */
declare const PAGED_CSS: "\n.md-page-break { break-before: page; }\n.page { break-before: page; }\n.spread { break-before: page; }\n.section { break-inside: avoid; }\n.section.col-split { break-inside: auto; }\n.md-column-break { break-after: column; height: 0; font-size: 0; line-height: 0; visibility: hidden; }\n";
