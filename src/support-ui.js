import { renderReleaseNotes } from './release-notes.js'

export function setupSupport({ api, checkpoint, showMenu, toast, openSettings, t = value => value }) {
  const $ = s => document.querySelector(s)
  let update = { status: 'idle' }, diagnostics = { consent: null, count: 0 }
  let busy = false, updateHeading
  const owns = heading => $('#modal').open && heading?.isConnected && !heading.closest('[hidden]')
  const privacyText = () => diagnostics.storageError ? 'Collection is disabled in this process. The system could not update or delete diagnostics storage; old disk logs may remain and a previous consent choice could return after restart. Check file permissions before restarting.' : t('{state} · {count} recorded events', { state: t(diagnostics.consent === true ? 'Detailed logs enabled' : diagnostics.consent === false ? 'Off' : 'Automatic critical logs enabled'), count: diagnostics.count || 0 })
  async function privacyFailure(action, heading) {
    try { diagnostics = await api.diagnosticsState() } catch { diagnostics = { consent: false, count: 0, storageError: 'diagnostics_storage' } }
    status()
    if (owns(heading) && $('#diagnostics-status')) $('#diagnostics-status').textContent = privacyText()
    toast(`Could not ${action} diagnostics. Logs were not confirmed cleared; collection may be disabled. Review Settings → Privacy & diagnostics.`)
  }
  function downloadPercent() {
    const { received, total } = update.progress || {}
    return Number.isSafeInteger(received) && Number.isSafeInteger(total) && total > 0 && received >= 0 && received <= total ? Math.floor(received * 100 / total) : null
  }
  function progress() {
    if (!owns(updateHeading)) return
    const bar = $('#update-progress'), text = $('#update-progress-text')
    const running = ['downloading', 'verifying', 'installing'].includes(update.status)
    bar.hidden = text.hidden = !running
    const percent = downloadPercent()
    if (update.status === 'downloading' && percent !== null) {
      bar.max = update.progress.total; bar.value = update.progress.received
      text.textContent = t('Downloading update… {percent}%', { percent })
    } else {
      bar.removeAttribute('value')
      text.textContent = update.status === 'verifying' ? 'Verifying update…' : update.status === 'installing' ? 'Preparing update and restart…' : 'Preparing download…'
    }
    if (running) $('#update-description').textContent = update.status === 'verifying' ? 'Verifying the update…' : update.status === 'installing' ? 'Preparing update and restart…' : 'Downloading the update…'
    $('#check-updates').disabled = busy
  }
  function status() {
    const button = $('#update-status'), percent = downloadPercent()
    button.hidden = !['available', 'downloaded', 'downloading', 'verifying', 'installing', 'checking', 'error'].includes(update.status)
    button.textContent = update.status === 'downloaded' ? t('Update ready: {version}', { version: update.version }) : update.status === 'available' ? t('Update available: {version}', { version: update.version }) : update.status === 'checking' ? t('Checking updates…') : update.status === 'verifying' ? t('Verifying update…') : update.status === 'installing' ? t('Preparing update…') : update.status === 'downloading' ? percent === null ? t('Downloading update…') : t('Downloading update… {percent}%', { percent }) : t('Update check unavailable')
    progress()
  }
  function onAction(action) {
    if (action?.type !== 'update-progress') return
    update = action.state; status()
  }
  async function check(manual = false) {
    if (!api?.checkUpdates) return toast('Update checks are available in the desktop app.')
    if (busy) { if (manual) updates(); return }
    busy = true; update = { ...update, status: 'checking' }; status()
    if (manual) updates()
    try { update = await api.checkUpdates() } catch { update = { status: 'error' } } finally { busy = false; status() }
    if (owns(updateHeading)) updates(updateHeading.parentElement)
  }
  function updates(target) {
    if (!target) return openSettings('updates')
    target.innerHTML = `<h3>Updates</h3><p id="update-description"></p><progress id="update-progress" aria-label="Update progress" hidden></progress><p id="update-progress-text" role="status" hidden></p><div id="release-notes" class="release-notes" role="region" aria-label="Release notes" tabindex="0"></div><div class="support-actions"><button id="check-updates">Check updates</button><button id="release-page">Release notes on GitHub</button><button id="download-update" class="primary" hidden>Download update</button><button id="install-update" class="primary" hidden>Install and restart</button></div><p class="small muted">Checking contacts GitHub. Downloads and installation only happen when you choose them. Installing checkpoints your tabs first, shows update progress without a setup wizard, and reopens this copy. Portable copies stay portable. Your document files are not overwritten.</p>`
    updateHeading = target.querySelector('h3')
    $('#update-description').textContent = update.status === 'available' ? t('Version {version} is available.', { version: update.version }) : update.status === 'downloaded' ? t('Version {version} is downloaded and verified.', { version: update.version }) : update.status === 'current' ? 'You are up to date.' : update.status === 'error' ? update.error || 'Could not check for updates. Try again when you are online.' : update.status === 'unpublished' ? 'There are no published releases yet.' : update.status === 'checking' ? 'Checking GitHub for a newer release…' : update.status === 'downloading' ? 'Downloading the verified update…' : update.status === 'verifying' ? 'Verifying the update…' : update.status === 'installing' ? 'Preparing update and restart…' : 'Check GitHub for a newer release.'
    if (update.manualDownload) {
      $('#release-page').textContent = 'Download for your platform on GitHub'
      target.querySelector('.small.muted').textContent = 'Checking contacts GitHub. On Linux and macOS, choose the matching installer or portable archive on the release page, then install it yourself after closing the app. This app does not download or run installers on these platforms.'
    }
    $('#release-notes').innerHTML = renderReleaseNotes(update.notes || 'Release notes appear here when an update is available.')
    $('#download-update').hidden = update.manualDownload === true || update.status !== 'available'
    $('#install-update').hidden = update.manualDownload === true || update.status !== 'downloaded'
    $('#check-updates').disabled = busy
    $('#check-updates').onclick = () => check(true)
    $('#release-page').onclick = () => api?.openRelease?.().catch(() => toast('Could not open the release page.'))
    $('#download-update').onclick = async () => {
      if (busy) return
      busy = true; $('#download-update').disabled = true; update.status = 'downloading'; status()
      try { update = await api.downloadUpdate() } catch { update = { ...update, status: 'available' }; toast('Download failed. Your app has not changed.') } finally {
        busy = false; status(); if (owns(updateHeading)) updates(updateHeading.parentElement)
      }
    }
    progress()
    $('#install-update').onclick = async () => {
      if (busy) return
      busy = true; $('#install-update').disabled = true; update.status = 'installing'; status()
      try { await checkpoint(); const result = await api.installUpdate(); if (result) update = result } catch { update.status = 'downloaded'; toast('Could not start the update. Your tabs stay open.') } finally {
        busy = false; status(); if (owns(updateHeading)) updates(updateHeading.parentElement)
      }
    }
  }
  async function privacy(target) {
    if (!target) return openSettings('privacy')
    if (!api?.diagnosticsState) { target.innerHTML = '<p>Diagnostics are available in the desktop app. Collection is off in this preview.</p>'; return }
    target.innerHTML = '<h4>Sanitized local diagnostics</h4><p role="status">Reading diagnostics state…</p>'
    const origin = target.querySelector('h4')
    try { diagnostics = await api.diagnosticsState() } catch { diagnostics = { consent: false, count: 0, storageError: 'diagnostics_storage' } }
    if (!owns(origin)) return
    target.innerHTML = `<h4>Sanitized local diagnostics</h4><p>Warnings, errors and critical failures are recorded automatically on this computer. You can opt in to additional sanitized action history. Logs keep up to <strong>200 events</strong> for <strong>7 days</strong>.</p><p>We do not log document text, keystrokes, clipboard contents, file names or paths, search text, links, screenshots, credentials, or your identity. This is not a recording of your entire session. Nothing is sent automatically.</p><p id="diagnostics-status" role="status"></p><div class="support-actions"><button id="enable-diagnostics" class="primary">Enable detailed sanitized logs</button><button id="disable-diagnostics">Disable and delete logs</button><button id="inspect-diagnostics">Inspect logs</button><button id="clear-diagnostics">Clear logs</button><button id="export-diagnostics">Export sanitized logs…</button></div><p class="small muted">Logs stay on this computer and are never uploaded. Exported copies remain yours to delete.</p>`
    const heading = target.querySelector('h4')
    $('#diagnostics-status').textContent = privacyText()
    $('#enable-diagnostics').hidden = diagnostics.consent === true
    $('#disable-diagnostics').textContent = diagnostics.consent === false ? 'Keep logs off' : 'Disable and delete logs'
    for (const [id, value] of [['enable-diagnostics', true], ['disable-diagnostics', false]]) $(`#${id}`).onclick = async () => {
      try { diagnostics = await api.diagnosticsConsent(value); status(); if (owns(heading)) await privacy(target) } catch { await privacyFailure(value ? 'enable' : 'disable and delete', heading) }
    }
    $('#clear-diagnostics').onclick = async () => { try { await api.diagnosticsClear(); if (owns(heading)) await privacy(target) } catch { await privacyFailure('clear', heading) } }
    $('#inspect-diagnostics').onclick = async () => {
      let report
      try { report = await api.diagnosticsInspect() } catch { return privacyFailure('inspect', heading) }
      if (!owns(heading)) return
      target.innerHTML = '<h4>Exact sanitized diagnostics</h4><pre id="diagnostics-preview" class="support-preview" tabindex="0"></pre><button id="privacy-back">Back</button>'
      $('#diagnostics-preview').textContent = JSON.stringify(report, null, 2)
      $('#privacy-back').onclick = () => privacy(target)
      $('#privacy-back').focus()
    }
    $('#export-diagnostics').onclick = async () => {
      try { if (await api.diagnosticsExport()) toast('Sanitized diagnostics exported. Review before sharing.') } catch { await privacyFailure('export', heading) }
    }
  }
  function shortcuts() {
    const modal = $('#modal')
    const mac = /Mac/i.test(navigator.platform)
    const mod = mac ? '⌘' : 'Ctrl', alt = mac ? 'Option' : 'Alt', shift = 'Shift'
    const sections = [
      ['Formatted editor', [['Bold', [[mod, 'B']]], ['Italic', [[mod, 'I']]], ['Strikethrough', [[mod, shift, 'X']]], ['Inline code', [[mod, 'E']]], ['Headings 1–6', [[mod, alt, '1–6']]], ['Bulleted list', [[mod, shift, '8']]], ['Numbered list', [[mod, shift, '7']]], ['Task list', [[mod, shift, '9']]], ['Code block', [[mod, alt, 'C']]]]],
      ['File & tabs', [['New tab', [[mod, 'N']]], ['Open', [[mod, 'O']]], ['Save', [[mod, 'S']]], ['Save As', [[mod, shift, 'S']]], ['Close tab', [[mod, 'W']]], ['Next tab', [[mod, 'Tab']]], ['Previous tab', [[mod, shift, 'Tab']]]]],
      ['Editing', [['Undo', [[mod, 'Z']]], ['Redo', [[mod, 'Y'], [mod, shift, 'Z']]], ['Select all', [[mod, 'A']]], ['Find', [[mod, 'F']]], ['Replace', [[mod, 'H']]]]],
      ['View & navigation', [['Zoom in', [[mod, '+']]], ['Zoom out', [[mod, '−']]], ['Reset zoom', [[mod, '0']]], ['Dismiss menu or dialog', [['Esc']]]]],
    ]
    modal.replaceChildren(); modal.classList.add('shortcuts-dialog')
    const header = document.createElement('header'); header.className = 'shortcuts-header'
    const heading = document.createElement('h2'); heading.textContent = 'Keyboard shortcuts'
    const description = document.createElement('p'); description.textContent = 'Quick actions for writing and navigating.'
    header.append(heading, description); modal.append(header)
    const grid = document.createElement('div'); grid.className = 'shortcuts-grid'; grid.setAttribute('aria-label', 'Shortcut categories'); grid.tabIndex = 0
    for (const [title, entries] of sections) {
      const card = document.createElement('section'); card.className = 'shortcut-card'
      const h = document.createElement('h3'); h.textContent = title; card.append(h)
      const list = document.createElement('dl'); list.className = 'shortcut-list'
      for (const [label, combos] of entries) {
        const row = document.createElement('div'); row.className = 'shortcut-row'
        const term = document.createElement('dt'), detail = document.createElement('dd')
        term.textContent = label
        combos.forEach((keys, index) => {
          if (index) detail.append(document.createTextNode(' / '))
          keys.forEach((key, keyIndex) => {
            if (keyIndex) detail.append(document.createTextNode('+'))
            const kbd = document.createElement('kbd'); kbd.textContent = key; detail.append(kbd)
          })
        })
        row.append(term, detail); list.append(row)
      }
      card.append(list); grid.append(card)
    }
    modal.append(grid)
    const actions = document.createElement('div'); actions.className = 'dialog-actions shortcuts-actions'
    const note = document.createElement('span'); note.textContent = 'Scroll for more · Find and Replace use Source mode.'
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => modal.close(); actions.append(note, close); modal.append(actions)
    modal.addEventListener('close', () => { modal.classList.remove('shortcuts-dialog'); $('#help-menu').focus() }, { once: true })
    modal.showModal(); close.focus()
  }
  $('#help-menu').onclick = () => showMenu($('#help-menu'), [['Keyboard shortcuts', '', shortcuts], ['Check updates', '', () => check(true)], ['Release notes', '', () => updates()]])
  $('#update-status').onclick = () => updates()
  return { async initialize() {
    try { if (api?.diagnosticsState) diagnostics = await api.diagnosticsState() } catch { /* Keep consent unknown/off on error. */ }
    status()
    if (diagnostics.storageError) toast(privacyText())
    if (api?.checkUpdates) await check()
  }, privacy, updates, onAction, refresh: status }
}
