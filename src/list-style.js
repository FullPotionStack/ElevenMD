import { Extension, parseIndentedBlocks } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

import { TaskList } from '@tiptap/extension-list'

const taskTokenizer = TaskList.config.markdownTokenizer
export const CompatibleTaskList = TaskList.extend({
  markdownTokenizer: {
    ...taskTokenizer,
    start(src) { return /^\s*[-+*]\s+\[[ xX]\](?:[ \t]*(?:\r?\n|$)|\s+)/.test(src) ? 0 : -1 },
    tokenize(src, tokens, lexer) {
      // Reuse Tiptap's indentation handling, accepting task rows without labels.
      const parse = content => {
        const result = parseIndentedBlocks(content, {
          itemPattern: /^([ \t]*)([-+*])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$/,
          extractItemData: match => ({ indentLevel: match[1].length, mainContent: match[4] || '', checked: match[3].toLowerCase() === 'x' }),
          createToken: (data, nestedTokens) => ({ type: 'taskItem', raw: '', ...data, text: data.mainContent, tokens: lexer.inlineTokens(data.mainContent), nestedTokens }),
          customNestedParser: nestedSource => {
            const nested = parse(nestedSource)
            if (!nested) return lexer.blockTokens(nestedSource)
            const rest = nestedSource.slice(nested.raw.length)
            return [nested, ...(rest.trim() ? lexer.blockTokens(rest) : [])]
          },
        }, lexer)
        return result ? { type: 'taskList', raw: result.raw, items: result.items } : undefined
      }
      return parse(src)
    },
  },
})

const lists = ['bulletList', 'orderedList', 'taskList']

// The built-in toggle can only swap list nodes with compatible item types.
// Convert incompatible task/list items atomically, without nesting wrappers.
function toggleStyle(listName, itemName) {
  return ({ commands, tr, state }) => {
    const first = tr.doc.firstChild
    if (tr.selection.from === 0 && tr.selection.to === tr.doc.content.size && first && lists.includes(first.type.name)) {
      const tail = tr.doc.content.content.slice(1)
      if (tail.every(node => node.type.name === 'paragraph' && node.content.size === 0)) {
        tr.setSelection(TextSelection.between(tr.doc.resolve(1), tr.doc.resolve(first.nodeSize - 1)))
      }
    }
    const { $from, $to, from, to } = tr.selection
    for (let depth = $from.depth; depth > 0; depth--) {
      const current = $from.node(depth), pos = $from.before(depth)
      if (!lists.includes(current.type.name)) continue
      if ($to.pos > pos + current.nodeSize - 1 || current.type.name === listName) break
      const target = state.schema.nodes[listName], itemType = state.schema.nodes[itemName]
      const items = []
      current.forEach(item => items.push(itemType.create(itemName === 'taskItem' ? { checked: !!item.attrs.checked } : null, item.content, item.marks)))
      const replacement = target.create(null, items, current.marks)
      tr.replaceWith(pos, pos + current.nodeSize, replacement)
      tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)))
      return true
    }
    return commands.toggleList(listName, itemName)
  }
}

export const ListStyle = Extension.create({
  name: 'listStyle',
  priority: 10,
  addCommands() {
    return {
      toggleBulletList: () => toggleStyle('bulletList', 'listItem'),
      toggleOrderedList: () => toggleStyle('orderedList', 'listItem'),
      toggleTaskList: () => toggleStyle('taskList', 'taskItem'),
    }
  },
})
