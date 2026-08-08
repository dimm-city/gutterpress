/** IIFE entry: exposes the viewer API as `window.Gutterpress` for the <script> tag. */
import { mount } from "./index.ts";
import * as fragment from "./fragment.ts";
import { decorate } from "./decorate.ts";
import * as gcpm from "../shared/gcpm-extract.ts";
import * as content from "../shared/content-value.ts";

const api = { mount, decorate, ...fragment, gcpm, content };
(window as any).Gutterpress = api;
// deprecated aliases, same object — remove after one release
(window as any).Folio = api;
(window as any).folio = api;
