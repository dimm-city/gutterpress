/**
 * Inline script that polyfills Paged.js's missing break-inside: avoid support.
 *
 * Paged.js has an avoidBreakInside() method but never calls it. This handler
 * intercepts onBreakToken and, when the break lands inside an element with
 * data-break-inside="avoid", moves the break to before that element.
 *
 * Uses a data attribute (not CSS) because source nodes are disconnected from
 * the DOM when onBreakToken fires, so getComputedStyle returns empty values.
 *
 * Must be registered via PagedConfig.before (runs before Paged.js renders).
 */
export declare const BREAK_INSIDE_HANDLER: string;
/**
 * Inject the Paged.js polyfill + render-complete marker into an HTML file.
 * Modifies the file in-place.
 */
export declare function patchHtmlForPagedjs(htmlPath: string, vendorPath: string): Promise<void>;
