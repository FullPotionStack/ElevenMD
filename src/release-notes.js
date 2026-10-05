import MarkdownIt from 'markdown-it'
import createDOMPurify from 'dompurify'

// Release notes need formatting, not document capabilities or external resources.
const parser = new MarkdownIt({ html: false, linkify: false })
parser.renderer.rules.link_open = () => ''
parser.renderer.rules.link_close = () => ''
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(tokens[index].content)
const purifier = createDOMPurify(window)

export function renderReleaseNotes(notes) {
  return purifier.sanitize(parser.render(notes), {
    ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 's', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br'],
    ALLOWED_ATTR: ['start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
}
