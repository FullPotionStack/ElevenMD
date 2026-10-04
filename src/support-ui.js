export function setupSupport({ api, checkpoint, showMenu, toast }) {
  const $ = s => document.querySelector(s)
  let update = { status: 'idle' }, diagnostics = { consent: null, count: 0 }
  let busy = false, updateHeading
  const owns = heading => $('#modal').open && $('#modal h2') === heading
  const privacyText = () => diagnostics.storageError ? 'Collection is disabled in this process. Windows could not update or delete diagnostics storage; old disk logs may remain and a previous consent choice could return after restart. Check file permissions before restarting.' : `${diagnostics.consent === true ? 'Enabled' : 'Off'} · ${diagnostics.count || 0} recorded actions`
  async function privacyFailure(action, heading) {
    try { diagnostics = await api.diagnosticsState() } catch { diagnostics = { consent: false, count: 0, storageError: 'diagnostics_storage' } }
    status()
    if (owns(heading) && $('#diagnostics-status')) $('#diagnostics-status').textContent = privacyText()
    toast(`Could not ${action} diagnostics. Logs were not confirmed cleared; collection may be disabled. Review Diagnostics & privacy.`)
  }
  function dialog(html, kind) {
    const modal = $('#modal')
    if (modal.open) modal.close()
    modal.innerHTML = html; modal.dataset.support = kind; modal.showModal()
    return modal
  }
  function close() { $('#modal').close() }
  function status() {
    const button = $('#update-status')
    button.hidden = !['available', 'downloaded', 'downloading', 'checking', 'error'].includes(update.status)
    button.textContent = update.status === 'downloaded' ? `Update ready: ${update.version}` : update.status === 'available' ? `Update available: ${update.version}` : update.status === 'checking' ? 'Checking updates…' : update.status === 'downloading' ? 'Downloading update…' : 'Update check unavailable'
    $('#privacy-choice').hidden = !api?.diagnosticsState || diagnostics.consent !== null
  }
  async function check(manual = false) {
    if (!api?.checkUpdates) return toast('Update checks are available in the desktop app.')
    if (busy) { if (manual) updates(); return }
    busy = true; update = { ...update, status: 'checking' }; status()
    if (manual) updates()
    try { update = await api.checkUpdates() } catch { update = { status: 'error' } } finally { busy = false; status() }
    if (owns(updateHeading)) updates()
  }
  function updates() {
    dialog(`<h2>Updates</h2><p id="update-description"></p><pre id="release-notes" class="support-preview"></pre><div class="support-actions"><button id="check-updates">Check updates</button><button id="release-page">Release notes on GitHub</button><button id="download-update" class="primary" hidden>Download update</button><button id="install-update" class="primary" hidden>Install and restart</button></div><p class="small muted">Checking contacts GitHub. Downloads and installation only happen when you choose them. Installing checkpoints your tabs first; it does not save over your document files.</p><div class="dialog-actions"><button id="support-close">Close</button></div>`, 'updates')
    updateHeading = $('#modal h2')
    $('#update-description').textContent = update.status === 'available' ? `Version ${update.version} is available.` : update.status === 'downloaded' ? `Version ${update.version} is downloaded and verified.` : update.status === 'current' ? 'You are up to date.' : update.status === 'error' ? update.error || 'Could not check for updates. Try again when you are online.' : update.status === 'unpublished' ? 'There are no published releases yet.' : update.status === 'checking' ? 'Checking GitHub for a newer release…' : update.status === 'downloading' ? 'Downloading and verifying the installer…' : 'Check GitHub for a newer release.'
    $('#release-notes').textContent = update.notes || 'Release notes appear here when an update is available.'
    $('#download-update').hidden = update.status !== 'available'
    $('#install-update').hidden = update.status !== 'downloaded'
    $('#check-updates').onclick = () => check(true)
    $('#release-page').onclick = () => api?.openRelease?.().catch(() => toast('Could not open the release page.'))
    $('#download-update').onclick = async () => {
      if (busy) return
      busy = true; $('#download-update').disabled = true; update.status = 'downloading'; status()
      try { update = await api.downloadUpdate() } catch { update = { ...update, status: 'available' }; toast('Download failed. Your app has not changed.') } finally {
        busy = false; status(); if (owns(updateHeading)) updates()
      }
    }
    $('#install-update').onclick = async () => {
      if (busy) return
      busy = true; $('#install-update').disabled = true
      try { await checkpoint(); const result = await api.installUpdate(); if (result) update = result } catch { toast('Could not start the update. Your tabs stay open.') } finally {
        busy = false; status(); if (owns(updateHeading)) updates()
      }
    }
    $('#support-close').onclick = close
  }
  async function privacy() {
    if (!api?.diagnosticsState) return toast('Diagnostics are available in the desktop app.')
    const origin = $('#modal h2'), wasOpen = $('#modal').open
    try { diagnostics = await api.diagnosticsState() } catch { return privacyFailure('read', origin) }
    if ($('#modal h2') !== origin || $('#modal').open !== wasOpen) return
    dialog(`<h2>Diagnostics & privacy</h2><p>Optional sanitized logs stay on this computer. They keep the last <strong>200 meaningful actions</strong> for up to <strong>7 days</strong>, such as opening a file, changing mode, formatting, or a save failure.</p><p>We do not log document text, keystrokes, clipboard contents, file names or paths, search text, links, screenshots, credentials, or your identity. This is not a recording of your entire session. Nothing is sent automatically.</p><p id="diagnostics-status" role="status"></p><div class="support-actions"><button id="enable-diagnostics" class="primary">Enable sanitized local logs</button><button id="disable-diagnostics">Disable and delete logs</button><button id="inspect-diagnostics">Inspect logs</button><button id="clear-diagnostics">Clear logs</button><button id="export-diagnostics">Export sanitized logs…</button></div><p class="small muted">Bug reports are public on GitHub. Review the exact report and attach an exported log only if you want to share it. Exported copies remain yours to delete.</p><div class="dialog-actions"><button id="support-close">Close</button></div>`, 'privacy')
    const heading = $('#modal h2')
    $('#diagnostics-status').textContent = privacyText()
    $('#enable-diagnostics').hidden = diagnostics.consent === true
    $('#disable-diagnostics').textContent = diagnostics.consent === true ? 'Disable and delete logs' : 'Keep logs off'
    for (const [id, value] of [['enable-diagnostics', true], ['disable-diagnostics', false]]) $(`#${id}`).onclick = async () => {
      try { diagnostics = await api.diagnosticsConsent(value); status(); if (owns(heading)) close() } catch { await privacyFailure(value ? 'enable' : 'disable and delete', heading) }
    }
    $('#clear-diagnostics').onclick = async () => { try { await api.diagnosticsClear(); if (owns(heading)) await privacy() } catch { await privacyFailure('clear', heading) } }
    $('#inspect-diagnostics').onclick = async () => {
      let report
      try { report = await api.diagnosticsInspect() } catch { return privacyFailure('inspect', heading) }
      if (!owns(heading)) return
      dialog('<h2>Exact sanitized diagnostics</h2><pre id="diagnostics-preview" class="support-preview" tabindex="0"></pre><div class="dialog-actions"><button id="privacy-back">Back</button><button id="support-close">Close</button></div>', 'logs')
      $('#diagnostics-preview').textContent = JSON.stringify(report, null, 2)
      $('#privacy-back').onclick = privacy; $('#support-close').onclick = close
    }
    $('#export-diagnostics').onclick = async () => {
      try { if (await api.diagnosticsExport()) toast('Sanitized diagnostics exported. Review before sharing.') } catch { await privacyFailure('export', heading) }
    }
    $('#support-close').onclick = close
  }
  function report() {
    dialog(`<h2>Report a bug</h2><p class="small muted">Describe the smallest steps that reproduce the problem. Do not include private document text, paths, passwords, or screenshots containing personal information. GitHub reports are public.</p><label class="stacked">Report title<input id="report-title" maxlength="100"></label><label class="stacked">Steps to reproduce<textarea id="report-steps" maxlength="1500" rows="3"></textarea></label><label class="stacked">Expected behavior<textarea id="report-expected" maxlength="800" rows="2"></textarea></label><label class="stacked">Actual behavior<textarea id="report-actual" maxlength="800" rows="2"></textarea></label><label class="check-label"><input type="checkbox" id="include-diagnostics">Include sanitized diagnostics</label><p class="small muted">Includes only safe environment information and recent action categories. For a longer history, export logs from Diagnostics & privacy and attach the file yourself after reviewing it.</p><div class="dialog-actions"><button id="support-close">Cancel</button><button id="review-report" class="primary">Review report</button></div>`, 'report')
    $('#support-close').onclick = close
    $('#review-report').onclick = async () => {
      const title = $('#report-title').value.trim()
      if (!title) return toast('Give the report a short title.')
      const payload = { title, body: `## Steps to reproduce\n${$('#report-steps').value}\n\n## Expected behavior\n${$('#report-expected').value}\n\n## Actual behavior\n${$('#report-actual').value}`, includeDiagnostics: $('#include-diagnostics').checked }
      if (!api?.reportBug) return toast('Use the desktop app to open a GitHub bug report.')
      try {
        const heading = $('#modal h2')
        const prepared = api.prepareBugReport ? await api.prepareBugReport(payload) : payload
        if (!owns(heading)) return
        dialog('<h2>Review public bug report</h2><p class="small muted">This exact text will be placed in a GitHub issue draft. GitHub requires your account and you still choose whether to submit it. Review carefully: automatic redaction cannot detect every secret in text you write.</p><pre id="bug-preview" class="support-preview" tabindex="0"></pre><div class="dialog-actions"><button id="support-close">Cancel</button><button id="send-report" class="primary">Open GitHub issue</button></div>', 'report-preview')
        $('#bug-preview').textContent = `${prepared.title}\n\n${prepared.body}`
        $('#support-close').onclick = close
        $('#send-report').onclick = async () => {
          try { if (await api.reportBug(prepared)) { close(); toast('GitHub issue draft opened. Nothing was submitted automatically.') } } catch { toast('Could not open the bug-report page.') }
        }
      } catch { toast('Could not prepare the report. Shorten the text or export diagnostics separately, then try again.') }
    }
  }
  $('#help-menu').onclick = () => showMenu($('#help-menu'), [['Check updates', '', () => check(true)], ['Release notes', '', updates], ['Diagnostics & privacy', '', privacy], ['Report a bug', '', report]])
  $('#update-status').onclick = updates
  $('#privacy-choice').onclick = privacy
  return { async initialize() {
    try { if (api?.diagnosticsState) diagnostics = await api.diagnosticsState() } catch { /* Keep consent unknown/off on error. */ }
    status()
    if (diagnostics.storageError) toast(privacyText())
    if (api?.checkUpdates) await check()
  }, privacy, updates, report }
}
