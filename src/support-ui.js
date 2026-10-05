import { renderReleaseNotes } from './release-notes.js'

export function setupSupport({ api, checkpoint, showMenu, toast, openSettings }) {
  const $ = s => document.querySelector(s)
  let update = { status: 'idle' }, diagnostics = { consent: null, count: 0 }
  let busy = false, updateHeading
  const owns = heading => $('#modal').open && heading?.isConnected && !heading.closest('[hidden]')
  const privacyText = () => diagnostics.storageError ? 'Collection is disabled in this process. The system could not update or delete diagnostics storage; old disk logs may remain and a previous consent choice could return after restart. Check file permissions before restarting.' : `${diagnostics.consent === true ? 'Enabled' : 'Off'} · ${diagnostics.count || 0} recorded actions`
  async function privacyFailure(action, heading) {
    try { diagnostics = await api.diagnosticsState() } catch { diagnostics = { consent: false, count: 0, storageError: 'diagnostics_storage' } }
    status()
    if (owns(heading) && $('#diagnostics-status')) $('#diagnostics-status').textContent = privacyText()
    toast(`Could not ${action} diagnostics. Logs were not confirmed cleared; collection may be disabled. Review Settings → Privacy & diagnostics.`)
  }
  function status() {
    const button = $('#update-status')
    button.hidden = !['available', 'downloaded', 'downloading', 'checking', 'error'].includes(update.status)
    button.textContent = update.status === 'downloaded' ? `Update ready: ${update.version}` : update.status === 'available' ? `Update available: ${update.version}` : update.status === 'checking' ? 'Checking updates…' : update.status === 'downloading' ? 'Downloading update…' : 'Update check unavailable'
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
    target.innerHTML = `<h3>Updates</h3><p id="update-description"></p><div id="release-notes" class="release-notes" role="region" aria-label="Release notes" tabindex="0"></div><div class="support-actions"><button id="check-updates">Check updates</button><button id="release-page">Release notes on GitHub</button><button id="download-update" class="primary" hidden>Download update</button><button id="install-update" class="primary" hidden>Install and restart</button></div><p class="small muted">Checking contacts GitHub. Downloads and installation only happen when you choose them. Installing checkpoints your tabs first; it does not save over your document files.</p>`
    updateHeading = target.querySelector('h3')
    $('#update-description').textContent = update.status === 'available' ? `Version ${update.version} is available.` : update.status === 'downloaded' ? `Version ${update.version} is downloaded and verified.` : update.status === 'current' ? 'You are up to date.' : update.status === 'error' ? update.error || 'Could not check for updates. Try again when you are online.' : update.status === 'unpublished' ? 'There are no published releases yet.' : update.status === 'checking' ? 'Checking GitHub for a newer release…' : update.status === 'downloading' ? 'Downloading and verifying the installer…' : 'Check GitHub for a newer release.'
    if (update.manualDownload) {
      $('#release-page').textContent = 'Download for your platform on GitHub'
      target.querySelector('.small.muted').textContent = 'Checking contacts GitHub. On Linux and macOS, choose the matching installer or portable archive on the release page, then install it yourself after closing the app. This app does not download or run installers on these platforms.'
    }
    $('#release-notes').innerHTML = renderReleaseNotes(update.notes || 'Release notes appear here when an update is available.')
    $('#download-update').hidden = update.manualDownload === true || update.status !== 'available'
    $('#install-update').hidden = update.manualDownload === true || update.status !== 'downloaded'
    $('#check-updates').onclick = () => check(true)
    $('#release-page').onclick = () => api?.openRelease?.().catch(() => toast('Could not open the release page.'))
    $('#download-update').onclick = async () => {
      if (busy) return
      busy = true; $('#download-update').disabled = true; update.status = 'downloading'; status()
      try { update = await api.downloadUpdate() } catch { update = { ...update, status: 'available' }; toast('Download failed. Your app has not changed.') } finally {
        busy = false; status(); if (owns(updateHeading)) updates(updateHeading.parentElement)
      }
    }
    $('#install-update').onclick = async () => {
      if (busy) return
      busy = true; $('#install-update').disabled = true
      try { await checkpoint(); const result = await api.installUpdate(); if (result) update = result } catch { toast('Could not start the update. Your tabs stay open.') } finally {
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
    target.innerHTML = `<h4>Sanitized local diagnostics</h4><p>Optional sanitized logs stay on this computer. They keep the last <strong>200 meaningful actions</strong> for up to <strong>7 days</strong>, such as opening a file, changing mode, formatting, or a save failure.</p><p>We do not log document text, keystrokes, clipboard contents, file names or paths, search text, links, screenshots, credentials, or your identity. This is not a recording of your entire session. Nothing is sent automatically.</p><p id="diagnostics-status" role="status"></p><div class="support-actions"><button id="enable-diagnostics" class="primary">Enable sanitized local logs</button><button id="disable-diagnostics">Disable and delete logs</button><button id="inspect-diagnostics">Inspect logs</button><button id="clear-diagnostics">Clear logs</button><button id="export-diagnostics">Export sanitized logs…</button></div><p class="small muted">Collection is opt-in. Logs stay on this computer and are never uploaded. Exported copies remain yours to delete.</p>`
    const heading = target.querySelector('h4')
    $('#diagnostics-status').textContent = privacyText()
    $('#enable-diagnostics').hidden = diagnostics.consent === true
    $('#disable-diagnostics').textContent = diagnostics.consent === true ? 'Disable and delete logs' : 'Keep logs off'
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
  $('#help-menu').onclick = () => showMenu($('#help-menu'), [['Check updates', '', () => check(true)], ['Release notes', '', () => updates()]])
  $('#update-status').onclick = () => updates()
  return { async initialize() {
    try { if (api?.diagnosticsState) diagnostics = await api.diagnosticsState() } catch { /* Keep consent unknown/off on error. */ }
    status()
    if (diagnostics.storageError) toast(privacyText())
    if (api?.checkUpdates) await check()
  }, privacy, updates }
}
