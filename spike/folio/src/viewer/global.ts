/** IIFE entry: exposes the viewer API as `window.Folio` for the <script> tag. */
import { mount } from "./index.ts";
import * as fragment from "./fragment.ts";
import { decorate } from "./decorate.ts";
import * as gcpm from "../shared/gcpm-extract.ts";
import * as content from "../shared/content-value.ts";

(window as any).Folio = { mount, decorate, ...fragment, gcpm, content };
