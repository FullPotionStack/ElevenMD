import { Editor } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { SourceHistory } from './source-history.js'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import { ListStyle, CompatibleTaskList } from './list-style.js'
import 'katex/dist/katex.min.css'
import { imageNode, loadImage, previewImages } from './images.js'
import { setupSupport } from './support-ui.js'
import './style.css'

const $ = s => document.querySelector(s)
const root = $('#app')
root.innerHTML = `<header class="tabs" aria-label="Document tabs"><div id="tablist" role="tablist"></div><button id="new-tab" aria-label="New tab" title="New tab (Ctrl+N)">＋</button><span class="spacer"></span><span class="app-name"><svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#211f29"/><path d="M20 46V18M44 46V18" fill="none" stroke="#fff7ed" stroke-width="7" stroke-linecap="round"/><path d="M20 18L32 35L44 18" fill="none" stroke="#ef8062" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Eleven<span class="brand-md">MD</span></span></span></header>
<nav class="menubar"><div class="menus"><button id="file-menu">File</button><button id="edit-menu">Edit</button><button id="view-menu">View</button><button id="help-menu">Help</button></div><label class="quick-theme">Theme<select id="quick-theme" aria-label="Quick theme"><option value="system">Auto (system)</option><option value="light">Light</option><option value="dark">Dark</option></select></label><button id="settings" aria-label="Settings" title="Settings">⚙ Settings</button><div class="modes" aria-label="Editing mode"><button id="formatted" class="selected">Formatted</button><button id="source-mode">Source</button><button id="preview-mode">Preview</button></div></nav>
<div class="toolbar" aria-label="Formatting"><select id="block-style" aria-label="Block style"><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="h5">Heading 5</option><option value="h6">Heading 6</option></select><span class="separator"></span></div>
<div id="find-bar" hidden><input id="find-text" aria-label="Find text" placeholder="Find in Markdown source"><input id="replace-text" aria-label="Replace with" placeholder="Replace with"><button id="find-next">Next</button><button id="replace-one">Replace</button><button id="replace-all">Replace all</button><span id="find-result" role="status"></span><button id="close-find" aria-label="Close find">×</button></div><main><div id="rich"></div><article id="preview" aria-label="Markdown preview" hidden></article><textarea id="source" aria-label="Markdown source" spellcheck="false" hidden></textarea></main>
<footer><span id="file-status"></span><span id="statistics"></span><span class="spacer"></span><button id="update-status" hidden aria-live="polite"></button><span id="encoding">UTF-8</span><button id="zoom" title="Reset zoom">100%</button><span>Markdown</span></footer>
<div id="toast" role="status" hidden></div><dialog id="modal"></dialog>`
let docs = [], activeId, untitledCount = 0, mode = 'formatted', saving = false
let sessionReady = false, autosaveTimer, booting, closingWindow = false, sessionStoragePath = ''
const api = window.notepad
const record = event => api?.recordDiagnostic?.(event)?.catch(() => {})
const formatNames = { bulletList: 'bullet_list', orderedList: 'ordered_list', taskList: 'task_list', codeBlock: 'code_block', horizontalRule: 'horizontal_rule' }
const active = () => docs.find(d => d.id === activeId)
const dirty = d => d.content !== d.savedContent
const source = document.querySelector('#source')
const modal = $('#modal'), showModal = modal.showModal.bind(modal)
modal.showModal = () => {
  const heading = modal.querySelector('h2'); if (heading) { heading.id = 'dialog-heading'; modal.setAttribute('aria-labelledby', heading.id) }
  modal.classList.toggle('settings-dialog', heading?.textContent === 'Settings')
  showModal()
}
const editor = new Editor({
  element: document.querySelector('#rich'),
  extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown, TableKit, CompatibleTaskList, TaskItem.configure({ nested: true }), ListStyle, imageNode(Image, { api, getDocument: active, getPreferences: () => prefs })],
  content: '', contentType: 'markdown',
  editorProps: { attributes: { 'aria-label': 'Formatted Markdown', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' } },
  onUpdate: () => { if (active()) { active().content = editor.getMarkdown(); active().richContent = active().content; update() } },
})
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true }, 5000) }
function update() {
  const tablist = $('#tablist'); tablist.replaceChildren()
  for (const doc of docs) {
    const container = document.createElement('div'); container.className = 'tab-container'
    const button = document.createElement('button'); button.className = 'tab'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(doc.id === activeId)); button.setAttribute('aria-label', doc.name); button.dataset.dirty = String(dirty(doc)); button.title = doc.path || doc.name
    const name = document.createElement('span'); name.textContent = doc.name
    const dot = document.createElement('span'); dot.className = 'dirty-dot'; dot.textContent = dirty(doc) ? '●' : ''; dot.setAttribute('aria-hidden', 'true')
    button.append(name, dot); button.onclick = () => select(doc.id)
    const close = document.createElement('button'); close.className = 'close-tab'; close.setAttribute('aria-label', `Close ${doc.name}`); close.textContent = '×'; close.onclick = () => closeDoc(doc.id)
    container.append(button, close); tablist.append(container)
  }
  const doc = active(); if (!doc) return
  $('#file-status').textContent = doc.recovered && !doc.path ? 'Recovered draft · Save as…' : dirty(doc) ? 'Unsaved changes' : doc.path ? 'Saved' : 'New document'
  $('#statistics').textContent = `${doc.content.trim() ? doc.content.trim().split(/\s+/u).length : 0} words · ${doc.content.length} characters`
  $('#encoding').textContent = `UTF-8${doc.bom ? ' BOM' : ''} · ${doc.eol || 'LF'}`
  document.title = `${dirty(doc) ? '● ' : ''}${doc.name} — ElevenMD`
  api?.setDirty(docs.some(dirty))
  if (!api?.saveSession) try { localStorage.setItem('notepad-drafts', JSON.stringify(docs.filter(dirty).map(d => ({ name: d.name, content: d.content, eol: d.eol, bom: d.bom })))) } catch { toast('Draft recovery storage is full or unavailable. Save your file to keep your changes.') }
  if (sessionReady) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => checkpointSession().catch(error => toast(`Could not keep session: ${error.message}`)), 150) }
}
function sessionSnapshot() {
  return { tabs: docs.map(d => ({ id: d.id, name: d.name, content: d.content, savedContent: d.savedContent, eol: d.eol || 'LF', bom: !!d.bom })), activeId, mode }
}
function checkpointSession() {
  const snapshot = sessionSnapshot()
  if (api?.saveSession) return api.saveSession(snapshot)
  try { localStorage.setItem('notepad-session', JSON.stringify(snapshot)); return Promise.resolve() } catch (error) { return Promise.reject(error) }
}
function select(id) {
  if (active()) active().editorState = editor.state
  activeId = id; const doc = active()
  source.value = doc.content
  if (mode === 'preview') { renderPreview(); update(); return }
  if (mode === 'source') { setMode('source'); update(); return }
  if (needsSource(doc.content) && !doc.allowConversion) { setMode('source'); update(); return }
  if (doc.editorState && doc.richContent === doc.content) editor.view.updateState(doc.editorState)
  else loadRich(doc)
  toolbarState(); update()
}
function loadRich(doc) {
  editor.commands.setContent(doc.content, { contentType: 'markdown', emitUpdate: false })
  // A fresh plugin state prevents opening or switching files from entering undo history.
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }))
  doc.richContent = doc.content
}
function newDoc() {
  const doc = { id: crypto.randomUUID(), name: `Untitled ${++untitledCount}`, content: '', savedContent: '', eol: 'LF', bom: false }
  docs.push(doc); select(doc.id); mode === 'source' ? source.focus() : editor.commands.focus()
  record({ type: 'document_new', outcome: 'success' })
}
function addFiles(files) {
  for (const file of files) {
    const existing = docs.find(d => d.path && d.path === file.path)
    if (existing) { select(existing.id); continue }
    if (docs.length === 1 && !docs[0].path && !docs[0].content) docs = []
    docs.push({ ...file, savedContent: file.content }); select(file.id)
  }
}
async function openFiles() {
  if (!api) return toast('Use the Windows desktop app to open and save local files.')
  try { addFiles(await api.open()) } catch (error) { toast(error.message) }
}
async function saveDoc(doc = active(), saveAs = false) {
  if (saving) return false
  if (!api) { toast('Use the Windows desktop app to save local files.'); return false }
  saving = true
  const snapshot = doc.content
  try {
    const result = await api.save({ id: doc.id, content: snapshot, saveAs, name: doc.name })
    if (!result) return false
    doc.path = result.path; doc.name = result.name; doc.eol = result.eol || doc.eol; doc.bom = result.bom ?? doc.bom; doc.savedContent = snapshot
    update(); toast('Saved'); return true
  } catch (error) { toast(error.message); return false } finally { saving = false }
}
async function canClose(doc) {
  if (!dirty(doc)) return true
  if (!api) { toast('Unsaved changes. Open the desktop app to save your document.'); return false }
  const answer = await api.confirmClose(doc.name)
  if (answer === 'discard') return true
  if (answer === 'save') return await saveDoc(doc) && !dirty(doc)
  return false
}
async function closeDoc(id) {
  const doc = docs.find(d => d.id === id); if (!doc) return
  if (!await canClose(doc)) { record({ type: 'document_close', outcome: 'cancelled' }); return }
  record({ type: 'document_close', outcome: 'success' })
  const index = docs.indexOf(doc); docs.splice(index, 1)
  if (!docs.length) newDoc()
  else if (activeId === id) select(docs[Math.min(index, docs.length - 1)].id)
  else update()
}
async function closeWindow() {
  if (closingWindow) return
  closingWindow = true
  try {
    await booting
    clearTimeout(autosaveTimer)
    await checkpointSession()
    await api?.closeWindow()
  } catch (error) {
    closingWindow = false
    toast(`Could not keep your session. The window stays open to protect your text: ${error.message}`)
  }
}
function needsSource(content) {
  const text = content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
  return /^(?:---|\+\+\+)\r?\n/.test(text) || /<!--|<\/?[a-z][^>]*>|\[\^[^\]]+\]|^\s*\$\$|^:::|^\s{0,3}:\s+/mi.test(text) || /(^|[^\\])\$[^$\n]+\$/m.test(text)
}
async function renderPreview() {
  const doc = active(), snapshot = doc.content, panel = $('#preview')
  try {
    const { renderMarkdown } = await import('./markdown-preview.js')
    if (active() !== doc || mode !== 'preview') return
    const template = document.createElement('template'); template.innerHTML = renderMarkdown(snapshot)
    // Keep content IDs separate from app controls; preserve scoped footnote links.
    for (const el of template.content.querySelectorAll('[id]')) el.id = `md-preview-${el.id}`
    for (const el of template.content.querySelectorAll('a[href^="#"]')) el.setAttribute('href', `#md-preview-${el.getAttribute('href').slice(1)}`)
    previewImages(template.content, doc, { api, prefs })
    panel.replaceChildren(template.content)
  } catch (error) { panel.textContent = `Could not render preview: ${error.message}` }
}
function setMode(next) {
  if (next === 'formatted' && needsSource(active().content) && !active().allowConversion) {
    const doc = active(), modal = $('#modal')
    modal.innerHTML = `<h2>Keep this Markdown intact?</h2><p>This document contains front matter, HTML, footnotes, or another advanced construct. Formatted editing may remove unsupported syntax when you edit. Source mode keeps the original text.</p><div class="dialog-actions"><button id="keep-source">Keep source</button><button id="convert" class="primary">Use formatted</button></div>`
    $('#keep-source').onclick = () => modal.close()
    $('#convert').onclick = () => { modal.close(); if (active() === doc) { doc.allowConversion = true; setMode('formatted') } }
    modal.showModal(); return
  }
  if (mode !== next) record({ type: 'mode_changed', mode: next })
  mode = next; source.value = active().content
  if (next === 'formatted' && active().richContent !== active().content) loadRich(active())
  source.hidden = next !== 'source'; $('#rich').hidden = next !== 'formatted'; $('#preview').hidden = next !== 'preview'
  for (const [id, name] of [['source-mode', 'source'], ['formatted', 'formatted'], ['preview-mode', 'preview']]) {
    const button = $(`#${id}`); button.classList.toggle('selected', next === name); button.setAttribute('aria-pressed', String(next === name))
  }
  $('.toolbar').hidden = next !== 'formatted'
  if (next === 'preview') renderPreview()
  else if (next === 'source') source.focus()
  else editor.commands.focus()
}
let sourceBefore = { from: 0, to: 0 }
source.addEventListener('beforeinput', () => { sourceBefore = { from: source.selectionStart, to: source.selectionEnd } })
function sourceHistory() {
  const doc = active()
  if (!doc.sourceHistory || doc.sourceHistory.text !== doc.content) doc.sourceHistory = new SourceHistory(doc.content)
  return doc.sourceHistory
}
source.addEventListener('input', event => {
  sourceHistory().record(source.value, sourceBefore.from, sourceBefore.to, event.inputType)
  active().content = source.value; update()
})
function undoWriting(redo = false) {
  if (mode === 'preview') return toast('Switch to Formatted or Source to edit.')
  if (mode === 'formatted') { editor.commands[redo ? 'redo' : 'undo'](); editor.view.focus() }
  else {
    const value = sourceHistory()[redo ? 'redo' : 'undo'](source.selectionStart, source.selectionEnd)
    if (value) { source.value = value.text; active().content = value.text; source.focus(); source.setSelectionRange(value.from, value.to); update() }
  }
  record({ type: 'formatting', action: redo ? 'redo' : 'undo', outcome: 'success' })
}
source.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.preventDefault(); event.stopPropagation(); undoWriting(event.key.toLowerCase() === 'y' || event.shiftKey)
  }
})
$('#source-mode').onclick = () => setMode('source')
$('#formatted').onclick = () => setMode('formatted')
$('#preview-mode').onclick = () => setMode('preview')
$('#new-tab').onclick = newDoc
let zoom = 100
let prefs = { theme: 'system', font: 'Georgia', size: 16, wrap: true, spellcheck: false, remoteImages: false }
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('notepad-preferences') || '{}') } } catch { /* Invalid stored preferences use defaults. */ }
if (prefs.font === 'Segoe UI') prefs.font = 'Georgia'
function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme
  $('#quick-theme').value = prefs.theme
  const value = prefs.font === 'Consolas' ? 'Consolas, monospace' : "Georgia, 'Times New Roman', serif"
  document.documentElement.style.setProperty('--editor-font', value)
  document.documentElement.style.setProperty('--editor-size', `${prefs.size * zoom / 100}px`)
  source.classList.toggle('nowrap', !prefs.wrap)
  $('#zoom').textContent = `${zoom}%`
  editor.setOptions({ editorProps: { ...editor.options.editorProps, attributes: { ...editor.options.editorProps.attributes, spellcheck: String(prefs.spellcheck) } } })
  source.spellcheck = prefs.spellcheck
  const effectiveTheme = prefs.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : prefs.theme
  const configured = api?.preferences?.({ theme: prefs.theme, effectiveTheme, spellcheck: prefs.spellcheck, remoteImages: prefs.remoteImages }) || Promise.resolve()
  configured.then(() => {
    for (const dom of document.querySelectorAll('.markdown-image')) if (dom.dataset.source) loadImage(dom.querySelector('img'), dom.querySelector('.image-message'), dom.dataset.source, active(), { api, prefs })
  }).catch(error => toast(error.message))
  try { localStorage.setItem('notepad-preferences', JSON.stringify(prefs)) } catch { /* Editing does not require storage. */ }
}
function changeZoom(amount) { zoom = Math.max(50, Math.min(200, zoom + amount)); applyPrefs() }
$('#zoom').onclick = () => { zoom = 100; applyPrefs() }
function settings(section = 'appearance') {
  const modal = $('#modal')
  if (modal.open) modal.close()
  modal.dataset.support = 'settings'
  const sections = [['appearance', 'Appearance'], ['editor', 'Editor'], ['privacy', 'Privacy & diagnostics'], ['updates', 'Updates']]
  modal.innerHTML = `<h2>Settings</h2><div class="settings-tabs" role="tablist" aria-label="Settings sections">${sections.map(([id, name]) => `<button id="settings-tab-${id}" role="tab" aria-controls="settings-${id}" aria-selected="false" tabindex="-1">${name}</button>`).join('')}</div>
    <section id="settings-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" tabindex="0" hidden><h3>Appearance</h3><label>App theme<select id="theme" aria-label="App theme"><option value="system">Use system setting</option><option value="light">Light</option><option value="dark">Dark</option></select></label><p class="muted small">ElevenMD · 0.3.5 alpha</p></section>
    <section id="settings-editor" role="tabpanel" aria-labelledby="settings-tab-editor" tabindex="0" hidden><h3>Editor</h3><label>Editor font<select id="font" aria-label="Editor font"><option value="Georgia">Georgia</option><option value="Consolas">Consolas</option></select></label><label>Text size<select id="text-size" aria-label="Text size"><option>14</option><option>16</option><option>18</option><option>20</option><option>24</option></select></label><label class="check-label"><input type="checkbox" id="wrap">Wrap Markdown source lines</label><label class="check-label"><input type="checkbox" id="spellcheck">Spell check</label><p class="muted small">Closing the app keeps every tab automatically. Only Save writes to your document file.</p><label class="stacked">Session storage<input id="session-location" aria-label="Session storage" readonly></label></section>
    <section id="settings-privacy" role="tabpanel" aria-labelledby="settings-tab-privacy" tabindex="0" hidden><h3>Privacy & diagnostics</h3><label class="check-label"><input type="checkbox" id="remote-images">Load remote images</label><p class="muted small">Remote images contact their hosting websites only when enabled.</p><div id="settings-diagnostics"></div></section>
    <section id="settings-updates" role="tabpanel" aria-labelledby="settings-tab-updates" tabindex="0" hidden><div id="settings-update-tools"></div></section>
    <div class="dialog-actions"><button id="done" class="primary">Done</button></div>`
  $('#session-location').value = sessionStoragePath || 'Browser storage (development preview)'
  $('#theme').value = prefs.theme; $('#font').value = prefs.font; $('#text-size').value = prefs.size; $('#wrap').checked = prefs.wrap; $('#spellcheck').checked = prefs.spellcheck; $('#remote-images').checked = prefs.remoteImages
  const changed = () => { prefs = { ...prefs, theme: $('#theme').value, font: $('#font').value, size: Number($('#text-size').value), wrap: $('#wrap').checked, spellcheck: $('#spellcheck').checked, remoteImages: $('#remote-images').checked }; applyPrefs() }
  for (const id of ['theme', 'font', 'text-size', 'wrap', 'spellcheck', 'remote-images']) $(`#${id}`).onchange = changed
  const activate = (id, focus = false) => {
    for (const [name] of sections) {
      const tab = $(`#settings-tab-${name}`), selected = id === name
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1
      $(`#settings-${name}`).hidden = !selected
    }
    if (id === 'privacy') support.privacy($('#settings-diagnostics'))
    if (id === 'updates') support.updates($('#settings-update-tools'))
    if (focus) $(`#settings-tab-${id}`).focus()
  }
  for (const [id] of sections) $(`#settings-tab-${id}`).onclick = () => activate(id)
  $('.settings-tabs').onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = sections.findIndex(([id]) => `settings-tab-${id}` === event.target.id)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length
    activate(sections[next][0], true)
  }
  $('#done').onclick = () => { changed(); modal.close() }
  modal.showModal(); activate(typeof section === 'string' && sections.some(([id]) => id === section) ? section : 'appearance')
  $('.settings-tabs [aria-selected="true"]').focus()
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs.theme === 'system') applyPrefs() })
$('#settings').onclick = settings
$('#quick-theme').onchange = event => { prefs.theme = event.target.value; applyPrefs(); record({ type: 'theme_changed', preference: prefs.theme }) }
function showFind(replace = false) {
  record({ type: 'find_replace', action: replace ? 'open_replace' : 'open_find', outcome: 'success' })
  setMode('source'); $('#find-bar').hidden = false
  $('#replace-text').hidden = !replace; $('#replace-one').hidden = !replace; $('#replace-all').hidden = !replace
  $('#find-text').focus(); $('#find-text').select()
}
function findNext() {
  const query = $('#find-text').value; if (!query) { record({ type: 'find_replace', action: 'find_next', outcome: 'noop' }); return false }
  const text = source.value.toLocaleLowerCase(), q = query.toLocaleLowerCase()
  let index = text.indexOf(q, source.selectionEnd); if (index < 0) index = text.indexOf(q)
  if (index < 0) { $('#find-result').textContent = 'No matches'; record({ type: 'find_replace', action: 'find_next', outcome: 'noop' }); return false }
  record({ type: 'find_replace', action: 'find_next', outcome: 'success' })
  source.focus(); source.setSelectionRange(index, index + query.length); $('#find-result').textContent = 'Match selected'; return true
}
function replaceText(all = false) {
  const query = $('#find-text').value; if (!query) return
  const replacement = $('#replace-text').value
  sourceHistory().breakGroup() // Each Replace/Replace all is a separate undoable action.
  if (all) {
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    let count = 0; const result = source.value.replace(pattern, () => { count++; return replacement })
    source.focus(); source.select(); document.execCommand('insertText', false, result)
    // execCommand integrates with Chromium textarea undo. The input event updates the document.
    $('#find-result').textContent = `${count} replaced`
    record({ type: 'find_replace', action: 'replace_all', outcome: count ? 'success' : 'noop', count: Math.min(count, 10000) })
  } else {
    const selected = source.value.slice(source.selectionStart, source.selectionEnd)
    if (selected.toLocaleLowerCase() !== query.toLocaleLowerCase() && !findNext()) return
    source.focus(); document.execCommand('insertText', false, replacement); record({ type: 'find_replace', action: 'replace_one', outcome: 'success' }); findNext()
  }
}
$('#find-next').onclick = findNext; $('#replace-one').onclick = () => replaceText(); $('#replace-all').onclick = () => replaceText(true)
$('#close-find').onclick = () => { $('#find-bar').hidden = true; source.focus() }
$('#find-text').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); findNext() } }
document.addEventListener('click', event => {
  const anchor = event.target.closest('a')
  if (!anchor || !anchor.closest('#preview, #rich') || anchor.closest('#rich') && !(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  const href = anchor.getAttribute('href') || ''
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1))
    const target = [...$('#preview').querySelectorAll('[id]')].find(el => el.id === id)
    target?.scrollIntoView({ block: 'nearest' }); return
  }
  if (!api?.openLink) return toast('Use the desktop app to open links.')
  api.openLink(href).catch(error => toast(error.message))
})
function dismissMenu(restoreFocus = false) {
  const menu = $('#popup-menu'), anchor = menu?.dataset.anchor
  menu?.remove()
  if (restoreFocus && anchor) $(`#${anchor}`)?.focus()
}
function showMenu(anchor, items) {
  const wasOpen = $('#popup-menu')?.dataset.anchor === anchor.id; dismissMenu(); if (wasOpen) return
  const menu = document.createElement('div'); menu.id = 'popup-menu'; menu.className = 'popup-menu'; menu.setAttribute('role', 'menu'); menu.dataset.anchor = anchor.id
  for (const [label, shortcut, action] of items) {
    if (!label) { menu.append(document.createElement('hr')); continue }
    const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); const name = document.createElement('span'); name.textContent = label; const keys = document.createElement('span'); keys.className = 'shortcut'; keys.textContent = shortcut || ''; button.append(name, keys); button.onclick = () => { dismissMenu(); action() }; menu.append(button)
  }
  document.body.append(menu); const rect = anchor.getBoundingClientRect(); menu.style.left = `${rect.left}px`; menu.style.top = `${rect.bottom + 4}px`; menu.querySelector('button').focus()
}
$('#file-menu').onclick = () => showMenu($('#file-menu'), [['New tab','Ctrl+N',newDoc],['Open…','Ctrl+O',openFiles],['Save','Ctrl+S',() => saveDoc()],['Save as…','Ctrl+Shift+S',() => saveDoc(active(),true)],['','',''],['Close tab','Ctrl+W',() => closeDoc(activeId)],['Exit','Alt+F4',closeWindow]])
$('#edit-menu').onclick = () => showMenu($('#edit-menu'), [['Find…','Ctrl+F',() => showFind()],['Replace…','Ctrl+H',() => showFind(true)],['','',''],['Undo','Ctrl+Z',() => undoWriting()],['Redo','Ctrl+Y',() => undoWriting(true)],['Select all','Ctrl+A',() => { if (mode === 'formatted') { editor.commands.selectAll(); editor.view.focus() } else if (mode === 'source') { source.focus(); source.select() } else toast('Switch to Formatted or Source to select editing content.') }]])
$('#view-menu').onclick = () => showMenu($('#view-menu'), [['Formatted','',() => setMode('formatted')],['Markdown source','',() => setMode('source')],['Preview','',() => setMode('preview')],['','',''],['Zoom in','Ctrl++',() => changeZoom(10)],['Zoom out','Ctrl+−',() => changeZoom(-10)],['Reset zoom','Ctrl+0',() => { zoom = 100; applyPrefs() }],['Settings','',settings]])
document.addEventListener('pointerdown', event => { if (!event.target.closest('.popup-menu, .menus')) dismissMenu() })
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#modal').open) {
    if ($('#popup-menu')) { dismissMenu(true); return }
    if (!$('#find-bar').hidden) { $('#close-find').click(); event.preventDefault() }
  }
  if (event.target.closest('.popup-menu') && ['ArrowDown','ArrowUp'].includes(event.key)) {
    event.preventDefault(); const buttons = [...$('#popup-menu').querySelectorAll('button')]; const i = buttons.indexOf(document.activeElement); buttons[(i + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus()
  }
})
function insertLink() {
  const doc = active(), selection = { from: editor.state.selection.from, to: editor.state.selection.to }, modal = $('#modal')
  modal.innerHTML = `<h2>Insert link</h2><label>Link text<input id="link-text" aria-label="Link text"></label><label>Link destination<input id="link-url" aria-label="Link destination" placeholder="https://example.com"></label><div class="dialog-actions"><button id="cancel-insert">Cancel</button><button id="confirm-insert" class="primary">Insert</button></div>`
  $('#link-text').value = editor.state.doc.textBetween(selection.from, selection.to, ' ')
  $('#link-url').value = editor.getAttributes('link').href || ''
  $('#cancel-insert').onclick = () => modal.close()
  $('#confirm-insert').onclick = () => {
    const href = $('#link-url').value.trim(), text = $('#link-text').value || href
    if (!href || /^[a-z][a-z\d+.-]*:/i.test(href) && !/^(?:https?:|mailto:)/i.test(href)) return toast('Use an HTTP(S), mailto, relative, or #anchor link.')
    modal.close(); if (active() !== doc) return
    editor.chain().focus().setTextSelection(selection).insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run()
    record({ type: 'formatting', action: 'link', outcome: 'success' })
  }
  modal.showModal(); $('#link-url').focus()
}
function insertImage() {
  const doc = active(), selection = { from: editor.state.selection.from, to: editor.state.selection.to }, modal = $('#modal')
  modal.innerHTML = `<h2>Insert image</h2><label>Image URL<input id="image-url" aria-label="Image URL" placeholder="https://example.com/image.png or assets/image.png"></label><label>Image alt text<input id="image-alt" aria-label="Image alt text"></label><label>Image title<input id="image-title" aria-label="Image title"></label><p class="muted small">Local images are copied into an assets folder beside your saved Markdown file. Remote images require “Load remote images” in Settings.</p><button id="local-image">Choose local image…</button><div class="dialog-actions"><button id="cancel-insert">Cancel</button><button id="confirm-insert" class="primary">Insert</button></div>`
  const insert = src => {
    const alt = $('#image-alt').value, title = $('#image-title').value
    modal.close(); if (active() !== doc) return
    editor.chain().focus().setTextSelection(selection).setImage({ src, alt, title }).run()
    record({ type: 'formatting', action: 'image', outcome: 'success' })
  }
  $('#cancel-insert').onclick = () => modal.close()
  $('#confirm-insert').onclick = () => {
    const src = $('#image-url').value.trim()
    if (!src || /^[a-z][a-z\d+.-]*:/i.test(src) && !/^https:\/\//i.test(src) && !/^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,/i.test(src)) return toast('Use an HTTPS image URL or a relative local image path.')
    insert(src)
  }
  $('#local-image').onclick = async () => {
    if (!api?.importImage) return toast('Use the desktop app to choose a local image.')
    const button = $('#local-image'); button.disabled = true
    try {
      if (!doc.path && !await saveDoc(doc)) return
      const result = await api.importImage({ id: doc.id })
      if (result && active() === doc && modal.open) insert(result.source)
    } catch (error) { toast(error.message) } finally { button.disabled = false }
  }
  modal.showModal(); $('#image-url').focus()
}
const actions = [
  ['Bold','B',() => editor.chain().focus().toggleBold().run(),'bold'],
  ['Italic','I',() => editor.chain().focus().toggleItalic().run(),'italic'],
  ['Strikethrough','S̶',() => editor.chain().focus().toggleStrike().run(),'strike'],
  ['Inline code','‹/›',() => editor.chain().focus().toggleCode().run(),'code'],
  ['Bullet list','• ≡',() => editor.chain().focus().toggleBulletList().run(),'bulletList'],
  ['Numbered list','1. ≡',() => editor.chain().focus().toggleOrderedList().run(),'orderedList'],
  ['Task list','☑',() => editor.chain().focus().toggleTaskList().run(),'taskList'],
  ['Quote','❝',() => editor.chain().focus().toggleBlockquote().run(),'blockquote'],
  ['Code block','{ }',() => editor.chain().focus().toggleCodeBlock().run(),'codeBlock'],
  ['Horizontal rule','―',() => editor.chain().focus().setHorizontalRule().run(),'horizontalRule'],
  ['Insert link','↗',insertLink,'link'],
  ['Insert image','▧',insertImage,'image'],
  ['Insert table','▦',() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),'table'],
]
for (const [label, symbol, action, mark] of actions) {
  const button = document.createElement('button'); button.textContent = symbol; button.setAttribute('aria-label', label); button.title = label; button.dataset.mark = mark; button.onpointerdown = e => e.preventDefault(); button.onclick = () => { const result = action(); if (!['link', 'image'].includes(mark)) record({ type: 'formatting', action: formatNames[mark] || mark, outcome: result === false ? 'noop' : 'success' }) }; $('.toolbar').append(button)
}
const tableActions = document.createElement('select'); tableActions.id = 'table-actions'; tableActions.setAttribute('aria-label', 'Table actions'); tableActions.hidden = true
for (const [value, label] of [['','Table actions…'],['addRowBefore','Add row above'],['addRowAfter','Add row below'],['deleteRow','Delete row'],['addColumnBefore','Add column left'],['addColumnAfter','Add column right'],['deleteColumn','Delete column'],['align-left','Align column left'],['align-center','Align column center'],['align-right','Align column right'],['deleteTable','Delete table']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; tableActions.append(option) }
$('.toolbar').append(tableActions)
function alignColumn(align) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const table = $from.node(depth)
    if (table.type.name !== 'table') continue
    const start = $from.start(depth), map = TableMap.get(table)
    const cell = $from.before(depth + 2) - start, column = map.findCell(cell).left
    const tr = editor.state.tr, positions = new Set()
    for (let row = 0; row < map.height; row++) positions.add(map.map[row * map.width + column])
    for (const pos of positions) {
      const node = table.nodeAt(pos)
      tr.setNodeMarkup(start + pos, undefined, { ...node.attrs, align })
    }
    editor.view.dispatch(tr); editor.view.focus(); return true
  }
  return false
}
tableActions.onchange = () => {
  const action = tableActions.value
  if (action.startsWith('align-')) alignColumn(action.slice(6))
  else if (action) { editor.commands[action](); editor.view.focus() }
  tableActions.value = ''
  record({ type: 'formatting', action: 'table', outcome: 'success' })
}
$('#block-style').onchange = e => { const level = Number(e.target.value.slice(1)); level ? editor.chain().focus().setHeading({ level }).run() : editor.chain().focus().setParagraph().run(); record({ type: 'formatting', action: level ? 'heading' : 'paragraph', outcome: 'success' }) }
// Clicking cell padding must target that cell, not leave selection in the header.
editor.view.dom.addEventListener('click', event => {
  const cell = event.target.closest('td, th')
  if (!cell) return
  const pos = editor.view.posAtDOM(cell, 0)
  const size = editor.state.doc.nodeAt(pos - 1)?.nodeSize || 0
  if (editor.state.selection.from < pos || editor.state.selection.from >= pos - 1 + size) {
    editor.commands.setTextSelection(pos + 1); editor.view.focus()
  }
})
editor.on('selectionUpdate', toolbarState)
editor.on('transaction', toolbarState)
function toolbarState() {
  const tableActions = $('#table-actions'); if (tableActions) tableActions.hidden = !editor.isActive('table')
  for (const button of document.querySelectorAll('[data-mark]')) { const pressed = editor.isActive(button.dataset.mark); button.classList.toggle('selected', pressed); button.setAttribute('aria-pressed', String(pressed)) }
  const level = editor.getAttributes('heading').level; $('#block-style').value = level <= 6 ? `h${level}` : 'p'
}
applyPrefs()
window.addEventListener('keydown', event => {
  if ($('#modal').open || !(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (mode === 'formatted' && ['b', 'i', 'z', 'y'].includes(key)) record({ type: 'formatting', action: key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'y' || event.shiftKey ? 'redo' : 'undo', outcome: 'success' })
  if (key === '+' || key === '=') { event.preventDefault(); changeZoom(10) }
  if (key === '-') { event.preventDefault(); changeZoom(-10) }
  if (key === '0') { event.preventDefault(); zoom = 100; applyPrefs() }
  if (key === 'f' || key === 'h') { event.preventDefault(); showFind(key === 'h') }
  if (key === 'n') { event.preventDefault(); newDoc() }
  if (key === 'o') { event.preventDefault(); openFiles() }
  if (key === 's') { event.preventDefault(); saveDoc(active(), event.shiftKey) }
  if (key === 'w') { event.preventDefault(); closeDoc(activeId) }
  if (key === 'tab') { event.preventDefault(); const i = docs.findIndex(d => d.id === activeId); select(docs[(i + (event.shiftKey ? docs.length - 1 : 1)) % docs.length].id) }
})
async function bootstrap() {
  const stored = api?.restoreSession ? await api.restoreSession() : JSON.parse(localStorage.getItem('notepad-session') || 'null')
  sessionStoragePath = stored?.storagePath || ''
  if (stored?.tabs?.length) {
    docs = stored.tabs.map(tab => ({ ...tab })); mode = stored.mode || 'formatted'
  } else {
    try {
      const drafts = JSON.parse(localStorage.getItem('notepad-drafts') || '[]')
      if (Array.isArray(drafts)) for (const d of drafts) {
        if (typeof d.content !== 'string' || typeof d.name !== 'string') continue
        docs.push({ id: crypto.randomUUID(), name: d.name, content: d.content, savedContent: null, eol: d.eol === 'CRLF' ? 'CRLF' : 'LF', bom: !!d.bom, recovered: true })
      }
    } catch { toast('Could not restore previous drafts.') }
  }
  for (const doc of docs) { const n = Number(doc.name.match(/^Untitled (\d+)$/)?.[1]); if (n > untitledCount) untitledCount = n }
  if (docs.length) select(docs.some(d => d.id === stored?.activeId) ? stored.activeId : docs[0].id); else newDoc()
  if (api) addFiles(await api.initialFiles())
  sessionReady = true; update()
}
if (api) api.onAction(action => {
  if (action === 'close-window') closeWindow()
  if (action?.type === 'diagnostics-error') toast('Diagnostics storage failed; collection is disabled. Old disk logs may remain. Review Settings → Privacy & diagnostics before restarting.')
  if (action?.type === 'opened') booting.then(() => addFiles(action.files))
  if (action?.type === 'checkpoint-update') booting.then(() => api.checkpointUpdate({ token: action.token, snapshot: sessionSnapshot() })).catch(() => toast('Update stopped: could not checkpoint your tabs.'))
})
booting = bootstrap().catch(error => toast(`Could not restore session: ${error.message}`))
const support = setupSupport({ api, checkpoint: checkpointSession, showMenu, toast, openSettings: settings })
booting.then(() => support.initialize()).catch(() => {})
