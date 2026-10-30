import { normalizeLocale, translate } from './i18n.js'

// Never translate the editor, document tabs, release content or user-entered values.
export function createUiTranslator(root) {
  const texts = new WeakMap(), attributes = new WeakMap()
  let locale = 'en'
  const excluded = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('#rich, #preview, #source, #tablist, #release-notes, .release-notes, [contenteditable], pre')
  function apply(node) {
    if (excluded(node)) return
    if (node.nodeType === Node.TEXT_NODE) {
      const current = node.nodeValue, old = texts.get(node)
      const original = old && current === old.translated ? old.original : current
      const text = original.trim(), translated = translate(locale, text)
      const value = text ? original.replace(text, translated) : original
      texts.set(node, { original, translated: value })
      if (current !== value) node.nodeValue = value
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const state = attributes.get(node) || {}
    for (const name of ['aria-label', 'title', 'placeholder']) {
      if (!node.hasAttribute(name)) continue
      const current = node.getAttribute(name), old = state[name]
      const original = old && current === old.translated ? old.original : current
      const value = translate(locale, original)
      state[name] = { original, translated: value }
      if (current !== value) node.setAttribute(name, value)
    }
    attributes.set(node, state)
    for (const child of node.childNodes) apply(child)
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') apply(record.target)
      else for (const node of record.addedNodes) apply(node)
    }
  })
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  return {
    setLocale(value) { locale = normalizeLocale(value); document.documentElement.lang = locale; apply(root) },
    disconnect() { observer.disconnect() },
  }
}
