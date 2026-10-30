import MarkdownIt from 'markdown-it'

const parser = new MarkdownIt({ html: false, linkify: true })

// RTF Unicode escapes are signed UTF-16 code units, including surrogate pairs.
function escapeRtf(text) {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i), char = text[i]
    if (char === '\\' || char === '{' || char === '}') result += `\\${char}`
    else if (code > 127) result += `\\u${code > 32767 ? code - 65536 : code}?`
    else if (char === '\n') result += '\\line '
    else if (code >= 32 || char === '\t') result += char
  }
  return result
}

/** Convert Markdown to a portable, deliberately limited RTF document. */
export function markdownToRtf(markdown) {
  const warnings = new Set()
  let output = '{\\rtf1\\ansi\\deff0\\uc1{\\fonttbl{\\f0 Arial;}{\\f1 Courier New;}}\\f0\\fs24\n'
  const lists = []
  function inline(tokens) {
    let result = '', linkDestination = ''
    for (const token of tokens || []) {
      switch (token.type) {
        case 'text': result += escapeRtf(token.content); break
        case 'softbreak': result += ' '; break
        case 'hardbreak': result += '\\line '; break
        case 'code_inline': result += `{\\f1 ${escapeRtf(token.content)}}`; break
        case 'strong_open': result += '{\\b '; break
        case 'em_open': result += '{\\i '; break
        case 's_open': result += '{\\strike '; break
        case 'strong_close': case 'em_close': case 's_close': result += '}'; break
        case 'link_open': linkDestination = token.attrGet('href') || ''; result += '{\\ul '; break
        case 'link_close': result += `}${linkDestination ? ` (${escapeRtf(linkDestination)})` : ''}`; linkDestination = ''; break
        case 'image': result += escapeRtf(token.content || token.attrGet('alt') || '[Image]'); warnings.add('Images are exported as alternative text.'); break
        default: warnings.add('Some formatting could not be preserved.'); if (token.content) result += escapeRtf(token.content)
      }
    }
    return result
  }
  const tokens = parser.parse(markdown, {})
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    switch (token.type) {
      case 'heading_open': output += `{\\b\\fs${Math.max(28, 44 - Number(token.tag.slice(1)) * 3)} `; break
      case 'heading_close': output += '}\\par\n'; break
      case 'paragraph_open': break
      case 'paragraph_close': output += '\\par\n'; break
      case 'inline': output += inline(token.children); break
      case 'bullet_list_open': lists.push({ ordered: false, index: 0 }); break
      case 'ordered_list_open': lists.push({ ordered: true, index: Number(token.attrGet('start') || 1) }); break
      case 'bullet_list_close': case 'ordered_list_close': lists.pop(); break
      case 'list_item_open': {
        const list = lists.at(-1)
        output += `\\li${Math.max(0, lists.length - 1) * 360} ${list?.ordered ? `${list.index++}. ` : '\\u8226? '}`
        break
      }
      case 'list_item_close': output += '\\li0 '; break
      case 'fence': case 'code_block': output += `{\\f1 ${escapeRtf(token.content)}}\\par\n`; break
      case 'blockquote_open': output += '{\\li360 '; break
      case 'blockquote_close': output += '}'; break
      case 'hr': output += '\\par ----------------\\par\n'; break
      case 'table_open': case 'thead_open': case 'thead_close': case 'tbody_open': case 'tbody_close': break
      case 'tr_open': {
        let columns = 0
        for (let next = index + 1; next < tokens.length && tokens[next].type !== 'tr_close'; next++) {
          if (tokens[next].type === 'th_open' || tokens[next].type === 'td_open') columns++
        }
        const width = Math.max(1, Math.floor(9000 / columns))
        output += '\\trowd\\trgaph108\\trleft0'
        for (let col = 1; col <= columns; col++) {
          output += `\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx${col * width}`
        }
        output += '\n'
        break
      }
      case 'th_open': case 'td_open': {
        const align = /text-align:(left|right|center)/.exec(token.attrGet('style') || '')?.[1]
        output += `\\pard\\intbl\\${align === 'right' ? 'qr' : align === 'center' ? 'qc' : 'ql'} `
        if (token.type === 'th_open') output += '{\\b '
        break
      }
      case 'th_close': output += '}\\cell '; break
      case 'td_close': output += '\\cell '; break
      case 'tr_close': output += '\\row\n'; break
      case 'table_close': output += '\\pard\n'; break
      default: warnings.add('Some formatting could not be preserved.')
    }
  }
  return { rtf: `${output}}`, warnings: [...warnings] }
}
