# Markdown modes in ElevenMD

Use Source when exact Markdown syntax matters. Preview renders that source without editing it. The formatted editor uses a Tiptap document model and can normalize Markdown or lose constructs outside its schema when you edit.

## Feature matrix

The formatted-editor column describes the configured editor extensions, not a promise of lossless Markdown round trips. Preview support comes from `src/markdown-preview.js`; its UI and image-loading policy belong to the application shell.

| Construct | Formatted editor | Preview | Source |
| --- | --- | --- | --- |
| ATX headings h1–h6 and setext headings | Heading nodes; syntax may normalize | Rendered headings | Original syntax |
| Emphasis, bold, strikethrough, inline code | Editable marks | Rendered marks | Original syntax |
| Blockquotes, nested ordered/unordered lists, rules, hard breaks | Editable nodes | Rendered structure | Original syntax |
| Task lists | Editable task nodes | Disabled checkboxes | Original syntax |
| Pipe tables | Editable table nodes | Rendered table; column alignment survives as safe enum attributes | Original syntax |
| Links, reference links, automatic URL links | Link marks; reference syntax may normalize | Resolved links and URL linkification | Original definitions |
| Inline and reference images | Image nodes; reference syntax may normalize | Logical image references; loading requires shell policy | Original references |
| Fenced and indented code | Code blocks | Escaped code; recognized fence languages receive highlight.js spans | Original code and fence info |
| Footnotes and inline notes | No dedicated extension | References, note bodies, and return links | Original definitions |
| Dollar-delimited inline/block TeX math | No dedicated extension | KaTeX-generated native MathML | Original TeX |
| Definition lists | No dedicated extension | Term and definition pairs | Original syntax |
| Closed YAML/TOML front matter at the document start | No dedicated metadata node | Collapsed metadata block containing escaped original text | Original text |
| Raw HTML | Not an arbitrary HTML editor | Sanitized safe subset | Original markup |
| HTML comments | No comment-preservation guarantee after formatted edits | Omitted | Original comments |
| Backslash escapes and entities | Text/marks; syntax may normalize | Parsed as Markdown text | Original syntax |

## Application image policy

Local raster images are resolved through the saved document capability, without replacing the Markdown path with a generated data URL. Insert image copies a selected picture into a sibling assets folder. PNG, JPEG, GIF, WebP, BMP, and AVIF signatures are supported; SVG is not supported. Paths must stay within the document directory: absolute paths, file URLs, parent-directory paths, and symlink escapes are blocked. HTTPS images load only after enabling Load remote images in Settings. Plain HTTP images are not loaded. This is separate from the parser retaining a logical reference.

## Preview contract

```js
import { renderMarkdown } from './src/markdown-preview.js'
const html = renderMarkdown(markdownSource)
```

`renderMarkdown(markdown: string): string` is a browser module. It returns sanitized HTML and does not change the input, save a document, or grant filesystem access. Keep the Markdown source as the document's authority rather than converting preview HTML back into Markdown.

- Safe HTML includes paragraphs, headings, lists, tables, links, images, inline text formatting, code, and `details`/`summary`.
- The sanitizer removes scripts, event handlers, styles, iframes, SVG/foreignObject, forms, embedded objects, and custom `data-*` attributes, including `data-hermes`.
- All retained inputs are disabled checkboxes. Preview is not an editing surface.
- Dangerous URL schemes and data URLs are removed. Image `src` values retain their logical HTTPS/HTTP, relative, or `file://` references, subject to Markdown URL normalization. The shell must resolve local references through document-scoped capabilities and apply its remote-image policy **before mounting the HTML**. The renderer does not fetch images itself.
- Math uses `$...$` and `$$...$$`, with KaTeX `trust: false`, bounded expansion, and native MathML rather than SVG or inline CSS. Invalid TeX remains visible as an error/fallback. It does not enable TeX commands that inject HTML.
- Front matter recognizes `---` with a closing `---` or `...`, and `+++` with a closing `+++`. It displays the delimiters and contents without interpreting YAML/TOML. An unclosed block remains ordinary Markdown. Browser display normalizes line endings; the source stays unchanged.
- Unrecognized fence languages remain escaped plain code. The renderer supplies highlighting classes; the shell supplies colors.

## Dialect limits

This is markdown-it's CommonMark-oriented default parser with tables, strikethrough, linkification, task lists, footnotes, dollar math, and definition-list plugins. It is not complete GitHub, Pandoc, Obsidian, or MDX compatibility.

Mermaid and other diagram fences display as code; they do not execute or render diagrams. Wiki links, transclusions, citations, custom directives, JSX/MDX, arbitrary plugin syntax, and alternate TeX delimiters are not implemented. Source can retain those constructs even when Preview shows them as text. Sanitized HTML cannot reproduce author-supplied CSS layouts.

## Verification

Run `npx playwright test tests/ui/preview-module.spec.js --reporter=line`. The bounded regression suite loads `/`, dynamically imports the module in Chromium, and inspects rendered DOM using the real browser DOMPurify instance. It tests the renderer independently of the shell's Preview UI and image-capability integration.

## Implementation and release notices

The renderer composes installed dependencies rather than implementing a Markdown parser. APIs and license grants were checked against their shipped READMEs, source, and license files.

| Dependency | Installed version | Shipped license text |
| --- | --- | --- |
| markdown-it | 15.0.2 | MIT, `node_modules/markdown-it/LICENSE` |
| markdown-it-footnote | 4.0.0 | MIT, `node_modules/markdown-it-footnote/LICENSE` |
| markdown-it-task-lists | 2.1.1 | ISC, `node_modules/markdown-it-task-lists/LICENSE` |
| markdown-it-texmath | 1.0.0 | MIT, `node_modules/markdown-it-texmath/license.txt` |
| markdown-it-deflist | 4.0.0 | MIT, `node_modules/markdown-it-deflist/LICENSE` |
| KaTeX | 0.19.0 | MIT, `node_modules/katex/LICENSE` |
| highlight.js | 11.12.0 | BSD-3-Clause, `node_modules/highlight.js/LICENSE` |
| DOMPurify | 3.4.16 | Apache-2.0 OR MPL-2.0; Apache-2.0 reviewed, `node_modules/dompurify/LICENSE` |

A release must carry the applicable complete dependency license/copyright notices. For DOMPurify's Apache-2.0 option, retain applicable upstream notices and any shipped NOTICE content; mark modified upstream files if there are any. This table is an inventory, not a replacement for those texts or a review of every transitive dependency. Packaging the notices remains the release owner's responsibility.
