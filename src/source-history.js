// Ephemeral document-owned edit history; never persisted or included in diagnostics.
export class SourceHistory {
  constructor(text) { this.text = text; this.past = []; this.future = []; this.lastTime = -Infinity; this.lastType = '' }
  breakGroup() { this.lastTime = -Infinity; this.lastType = '' }
  record(next, from, to, inputType = '', time = Date.now()) {
    if (next === this.text) return
    const grouped = inputType === 'insertText' && this.lastType === inputType && time - this.lastTime < 500 && this.past.length
    if (!grouped) this.past.push({ text: this.text, from, to })
    this.text = next; this.future = []; this.lastTime = time; this.lastType = inputType
    let size = this.past.reduce((n, item) => n + item.text.length, 0)
    while (this.past.length && (this.past.length > 100 || size > 10000000)) size -= this.past.shift().text.length
  }
  move(from, to, selectionStart, selectionEnd) {
    const value = from.pop()
    if (!value) return null
    to.push({ text: this.text, from: selectionStart, to: selectionEnd })
    this.text = value.text; this.lastTime = -Infinity; this.lastType = ''
    return value
  }
  undo(from = 0, to = from) { return this.move(this.past, this.future, from, to) }
  redo(from = 0, to = from) { return this.move(this.future, this.past, from, to) }
}
