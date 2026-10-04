'use strict';
const REPOSITORY = 'FullPotionStack/ElevenMD';
function redactText(text) {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted credential]')
    .replace(/(?:["']?\b(?:password|token|api[_-]?key|secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, '[redacted credential]')
    .replace(/\bbearer\s+\S+/gi, '[redacted credential]')
    .replace(/\b[A-Z]:[\\/][^\r\n<>"|]*/gi, '[redacted path]')
    .replace(/\\\\[^\s]+/g, '[redacted path]')
    .replace(/\/(?:Users|home|mnt|media|private|var|tmp)\/[^\s]+/g, '[redacted path]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[redacted email]')
    .replace(/https?:\/\/[^\s<>]+/gi, '[redacted URL]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
function prepareReport(payload) {
  if (!payload || Object.keys(payload).some(k => !['title', 'body', 'includeDiagnostics'].includes(k)) || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 100 || typeof payload.body !== 'string' || payload.body.length > 6000 || typeof payload.includeDiagnostics !== 'boolean') throw new Error('Invalid bug report.');
  const report = { title: redactText(payload.title).replace(/[\r\n]/g, ' '), body: redactText(payload.body), includeDiagnostics: payload.includeDiagnostics };
  if (report.title.length > 100 || report.body.length > 6000) throw new Error('Report too long after redaction. Shorten your steps or export diagnostics separately.');
  return report;
}
function issueURL(payload) {
  const report = prepareReport(payload);
  const url = new URL(`https://github.com/${REPOSITORY}/issues/new`);
  url.searchParams.set('title', report.title);
  url.searchParams.set('body', report.body);
  // Keep browser navigation reliable; larger diagnostics stay in a reviewed export.
  if (url.href.length > 16000) throw new Error('Report is too large for a GitHub issue draft. Shorten your steps.');
  return url.href;
}
module.exports = { REPOSITORY, redactText, prepareReport, issueURL };
