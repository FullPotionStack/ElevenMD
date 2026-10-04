import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import definitionLists from 'markdown-it-deflist'
import hljs from 'highlight.js'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import createDOMPurify from 'dompurify'

// A private browser instance keeps these hooks separate from app sanitizers.
const purifier = createDOMPurify(window)
purifier.addHook('uponSanitizeElement', node => {
  if (node.nodeName === 'INPUT') {
    if (node.getAttribute('type')?.toLowerCase() !== 'checkbox') node.remove()
    else node.setAttribute('disabled', '')
  }
})
purifier.addHook('uponSanitizeAttribute', (node, attribute) => {
  if (attribute.attrName === 'src' || attribute.attrName === 'href') {
    const url = attribute.attrValue.replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
    const allowed = attribute.attrName === 'src' ? ['http', 'https', 'file'] : ['http', 'https', 'mailto', 'tel']
    if (scheme && !allowed.includes(scheme)) attribute.keepAttr = false
  }
})
const sanitizeOptions = {
  ALLOWED_TAGS: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'em', 'strong', 's', 'del', 'b', 'i', 'u', 'mark', 'small', 'sub', 'sup', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'pre', 'code', 'kbd', 'samp', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'section', 'details', 'summary', 'input',
    'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'ms', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'menclose', 'mpadded', 'mphantom', 'mmultiscripts', 'mprescripts', 'none', 'mstyle'],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'id', 'class', 'type', 'checked', 'disabled', 'start', 'reversed', 'colspan', 'rowspan', 'align', 'open', 'display', 'xmlns', 'encoding', 'mathvariant', 'stretchy', 'fence', 'separator', 'accent', 'accentunder', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'linethickness', 'width', 'height', 'depth', 'lspace', 'rspace', 'minsize', 'maxsize', 'movablelimits', 'notation', 'scriptlevel', 'displaystyle'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  FORBID_TAGS: ['svg', 'foreignObject', 'iframe', 'script', 'style'],
  FORBID_ATTR: ['style'],
  // File image references remain logical references, not granted capabilities.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.:\-]|$))/i,
}

const parser = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    }
    return '' // markdown-it escapes unrecognized/plain code itself.
  },
})
  .use(footnote)
  .use(taskLists, { enabled: false })
  .use(definitionLists)
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    // Native MathML avoids generated inline CSS/SVG while keeping fractions/layout.
    katexOptions: { output: 'mathml', trust: false, throwOnError: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 },
  })

// Markdown-it emits alignment as inline CSS, which our sanitizer correctly removes.
// Preserve only the parser-owned alignment enum as a safe attribute instead.
for (const type of ['th_open', 'td_open']) parser.renderer.rules[type] = (tokens, index, options, _env, renderer) => {
  const token = tokens[index], style = token.attrGet('style')
  const alignment = /^text-align:(left|center|right)$/.exec(style || '')?.[1]
  token.attrs = (token.attrs || []).filter(([name]) => name !== 'style')
  if (alignment) token.attrSet('align', alignment)
  return renderer.renderToken(tokens, index, options)
}

// Recognize empty editor-created tasks at the token level, never in code or
// escaped literal text. The upstream plugin requires text after the marker.
parser.core.ruler.before('github-task-lists', 'empty-task-items', state => {
  for (let i = 2; i < state.tokens.length; i++) {
    const token = state.tokens[i], item = state.tokens[i - 2]
    if (token.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' || item.type !== 'list_item_open' || !/^\[[ xX]\]$/.test(token.content)) continue
    const checkbox = new state.Token('html_inline', '', 0)
    checkbox.content = `<input type="checkbox" disabled${token.content !== '[ ]' ? ' checked' : ''}>`
    token.children = [checkbox]; token.content = ''
    item.attrJoin('class', 'task-list-item')
    for (let j = i - 3; j >= 0; j--) if (state.tokens[j].level === item.level - 1) { state.tokens[j].attrJoin('class', 'contains-task-list'); break }
  }
})

// markdown-it rejects file: by default. Only image src survives the sanitizer's
// scheme policy; the app must resolve these references before mounting preview.
const validateLink = parser.validateLink.bind(parser)
parser.validateLink = url => /^file:\/\//i.test(url) || validateLink(url)

/** Render a display-only preview; the caller retains the original source. */
export function renderMarkdown(markdown) {
  const metadata = /^(?:\uFEFF)?---[ \t]*\r?\n/.test(markdown)
    ? /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(markdown)
    : /^(?:\uFEFF)?\+\+\+[ \t]*\r?\n/.test(markdown)
      ? /^(?:\uFEFF)?\+\+\+[ \t]*\r?\n[\s\S]*?^\+\+\+[ \t]*(?:\r?\n|$)/m.exec(markdown)
      : null
  const frontMatter = metadata?.[0] || ''
  const header = frontMatter
    ? `<details class="markdown-metadata"><summary>Document metadata</summary><pre><code>${parser.utils.escapeHtml(frontMatter)}</code></pre></details>\n`
    : ''
  const template = document.createElement('template')
  template.innerHTML = purifier.sanitize(header + parser.render(markdown.slice(frontMatter.length)), sanitizeOptions)
  for (const item of template.content.querySelectorAll('li.task-list-item')) {
    const checkbox = item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]')
    if (!checkbox) continue
    checkbox.remove()
    const control = document.createElement('span'); control.className = 'task-control'; control.append(checkbox)
    const content = document.createElement('div'); content.className = 'task-content'; content.append(...item.childNodes)
    item.replaceChildren(control, content)
    item.classList.toggle('task-checked', checkbox.hasAttribute('checked'))
  }
  return template.innerHTML
}
