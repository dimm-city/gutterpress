/** IIFE entry: exposes the viewer API as `window.Gutterpress` for the <script> tag. */
import { mount } from "./index.ts";
import * as fragment from "./fragment.ts";
import * as split from "./split.ts";
import { decorate } from "./decorate.ts";
import * as gcpm from "../shared/gcpm-extract.ts";
import * as content from "../shared/content-value.ts";

const api = { mount, decorate, ...fragment, ...split, gcpm, content };
(window as any).Gutterpress = api;
