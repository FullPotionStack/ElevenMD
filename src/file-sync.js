import { lineDiff } from './line-diff.js'

export function setupFileSync({ api, getDocs, active, dirty, update, refresh, checkpoint, saveAs, modal, toast }) {
  const banner = document.createElement('section'); banner.id = 'file-sync-banner'; banner.hidden = true; banner.setAttribute('aria-label', 'File synchronization')
  document.querySelector('main').before(banner)
  let running, again = false, resolving = false
  const labels = { changed: 'Conflict: changed on disk and in ElevenMD', missing: 'File missing — buffer retained', unreadable: 'Unable to check file' }
  function describe(doc) { return labels[doc.external?.status] || null }
  function button(parent, label, handler) {
    const el = document.createElement('button'); el.textContent = label; el.onclick = () => Promise.resolve().then(handler).catch(error => { toast(error.message); check() }); parent.append(el); return el
  }
  function restorePrevious(doc) {
    const previous = doc.previousContent; if (typeof previous !== 'string') return
    doc.previousContent = doc.content; doc.content = previous; doc.syncNotice = ''
    if (doc.kind === 'pdf') { doc.savedContent = previous; doc.pdfPreviousSelected = !doc.pdfPreviousSelected }
    refresh(doc); update(); checkpoint().catch(error => toast(error.message))
  }
  function render() {
    banner.replaceChildren(); const doc = active(); if (!doc) { banner.hidden = true; return }
    const message = describe(doc)
    banner.hidden = !message && typeof doc.previousContent !== 'string'
    if (banner.hidden) return
    const label = document.createElement('span'); label.setAttribute('role', 'status'); label.textContent = message || 'Updated from disk; previous buffer is recoverable.'; banner.append(label)
    if (doc.external?.status === 'changed') button(banner, 'Compare changes', () => review(doc))
    if (doc.external?.status === 'missing') {
      button(banner, 'Locate file', () => locate(doc)); button(banner, 'Save As', () => saveAs(doc)); button(banner, 'Recreate file', () => write(doc, doc.external, 'recreate', doc.content))
    }
    if (doc.external?.status === 'unreadable') button(banner, 'Check again', check)
    if (typeof doc.previousContent === 'string') button(banner, 'Restore previous buffer', () => restorePrevious(doc))
  }
  async function reload(doc, observed, cleanOnly = false) {
    const content = doc.content, filename = doc.path
    doc.previousContent = content
    await checkpoint() // Preserve before replacing the only visible buffer.
    if (!getDocs().includes(doc) || doc.path !== filename || doc.content !== content || cleanOnly && dirty(doc)) { doc.external = observed; update(); return false }
    const result = await api.resolveFile({ id: doc.id, revision: observed.revision, action: 'reload' })
    if (!getDocs().includes(doc) || doc.path !== filename || doc.content !== content) { doc.external = observed; update(); return false }
    doc.content = result.content; doc.savedContent = result.content; doc.eol = result.eol; doc.bom = result.bom
    doc.external = null; doc.syncNotice = 'Updated from disk'; refresh(doc); update()
    try { await api.adoptFile({ id: doc.id, revision: observed.revision }) }
    catch (error) { doc.external = { ...observed }; again = true; toast(error.message) }
    await checkpoint(); return !doc.external
  }
  async function check() {
    if (!api?.inspectFiles || !api?.resolveFile || !api?.adoptFile || resolving) return
    if (running) { again = true; return running }
    running = (async () => {
      do {
        again = false
        const docs = getDocs().filter(d => d.path), observations = await api.inspectFiles(docs.map(d => d.id))
        for (const observed of observations) {
          const doc = docs.find(d => d.id === observed.id); if (!doc || !getDocs().includes(doc)) continue
          doc.external = observed.status === 'same' ? null : observed
          if (observed.status === 'changed' && !dirty(doc) && !modal.open) {
            try { await reload(doc, observed, true) } catch (error) { doc.external = observed; toast(error.message) }
          }
        }
        update()
      } while (again)
    })().catch(error => { for (const doc of getDocs().filter(d => d.path)) doc.external = { status: 'unreadable' }; update(); toast('Could not check files on disk.') }).finally(() => { running = null })
    return running
  }
  async function write(doc, observed, action, content) {
    if (resolving) return
    resolving = true; const before = doc.content
    try {
      await checkpoint()
      const result = await api.resolveFile({ id: doc.id, revision: observed.revision, action, content })
      if (!result) return false
      if (!getDocs().includes(doc)) return false
      doc.previousContent = before
      if (doc.content === before) doc.content = result.content
      doc.savedContent = result.content; doc.eol = result.eol; doc.bom = result.bom; doc.external = null; doc.syncNotice = ''
      refresh(doc); update(); await checkpoint(); if (modal.open) modal.close(); return true
    } finally { resolving = false; check() }
  }
  async function locate(doc) {
    const result = await api.locateFile(doc.id); if (!result) return
    doc.path = result.path; doc.name = result.name; update(); await checkpoint(); await check()
  }
  function review(doc) {
    const observed = doc.external
    if (!observed) return
    if (observed.status !== 'changed') { toast(describe(doc)); return }
    if (modal.open) modal.close()
    modal.replaceChildren(); modal.classList.add('file-comparison'); modal.id = 'modal'
    const root = document.createElement('div'); root.id = 'file-comparison'; modal.append(root)
    const heading = document.createElement('h2'); heading.textContent = 'Compare file changes'; root.append(heading)
    const note = document.createElement('p'); note.textContent = 'Neither version changes until you choose. Further disk changes invalidate this comparison.'; root.append(note)
    const columns = document.createElement('div'); columns.className = 'file-comparison-columns'; root.append(columns)
    function textArea(parent, label, value, readonly = true) {
      const wrapper = document.createElement('label'); wrapper.className = 'stacked'; wrapper.append(document.createTextNode(label))
      const input = document.createElement('textarea'); input.setAttribute('aria-label', label); input.readOnly = readonly; input.rows = 9; input.value = readonly ? value.slice(0, 200000) : value; wrapper.append(input); parent.append(wrapper); return input
    }
    textArea(columns, 'Your version', doc.content); textArea(columns, 'Disk version', observed.content || '')
    const base = document.createElement('details'), baseLabel = document.createElement('summary'); baseLabel.textContent = 'Last synchronized version'; base.append(baseLabel); root.append(base); textArea(base, 'Last synchronized text', doc.savedContent || '')
    const diff = lineDiff(doc.content, observed.content || ''), view = document.createElement('pre'); view.className = 'file-line-diff'; view.setAttribute('aria-label', 'Line differences'); root.append(view)
    if (diff.truncated) view.textContent = 'Large comparison: bounded text previews shown above. Full editor text is preserved; no automatic merge.'
    else for (const line of diff.lines) { const row = document.createElement('div'); row.className = `diff-${line.kind}`; row.textContent = `${line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '} ${line.text}`; view.append(row) }
    const merged = textArea(root, 'Merged result', doc.content, false)
    const controls = document.createElement('div'); controls.className = 'dialog-actions'; root.append(controls)
    button(controls, 'Use disk version', async () => { if (await reload(doc, observed)) modal.close(); check() })
    button(controls, 'Overwrite disk with mine', () => write(doc, observed, 'overwrite', doc.content))
    button(controls, 'Save merged result', () => write(doc, observed, 'overwrite', merged.value))
    button(controls, 'Save mine separately', () => saveAs(doc))
    button(controls, 'Cancel', () => modal.close())
    modal.showModal()
  }
  modal.addEventListener('close', () => { modal.classList.remove('file-comparison'); check() })
  window.addEventListener('focus', check)
  return { check, render, describe, review }
}
