

### Plugin class naming convention

All classes emitted by `plugins/dimm-city-plugin.js` must use the `dc-` prefix
(e.g. `dc-note-callout`, `dc-outcomes-label`). When adding new plugin output,
always check that the emitted class name has a matching CSS rule before shipping.


**All shipped macros:**
`@chapter`, `@page`, `@section`, `@spread`, `@break`, `@specialty`, `@end-specialty`,
`@specialty-intro`, `@end-specialty-intro`, `@specialty-art`, `@end-specialty-art`,
`@specialty-card`, `@end-specialty-card`, `@learning-path`, `@end-learning-path`,
`@skill`, `@end-skill`, `@continue`, `@outcome`, `@end-outcome`, `@chapter-opener`,
`@class-entry`, `@end-class-entry`, `@roll-table`, `@options-table`,
`@sidebar`, `@end-sidebar`, `@sidebar-box`, `@end-sidebar-box`,
`@definition`, `@end-definition`, `@procedure`, `@end-procedure`,
`@callout`, `@end-callout`, `@dm-note`, `@end-dm-note`,
`@toc`, `@end-toc`, `@two-column`, `@end-two-column`,
`@three-column`, `@end-three-column`, `@no-break`, `@end-no-break`,
`@gear-card`, `@end-gear-card`, `@tape`, `@lede`, `@end-lede`,
`@glossary`, `@end-glossary`