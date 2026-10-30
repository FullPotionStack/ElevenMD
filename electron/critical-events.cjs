'use strict';

function observeCriticalEvents({ app, window, record }) {
  const webContents = window.webContents;
  const reason = value => ({ crashed: 'crashed', 'out-of-memory': 'out_of_memory', 'launch-failed': 'launch_failed', killed: 'killed', 'abnormal-exit': 'crashed' })[value] || 'unknown';
  const renderer = (_event, details) => {
    if (details?.reason !== 'clean-exit') record({ type: 'process_failure', process: 'renderer', reason: reason(details?.reason) });
  };
  const child = (_event, details) => {
    if (details?.type === 'GPU' && details.reason !== 'clean-exit') record({ type: 'process_failure', process: 'gpu', reason: reason(details.reason) });
  };
  const unresponsive = () => record({ type: 'process_failure', process: 'renderer', reason: 'unresponsive' });
  const consoleMessage = details => {
    if (details?.level === 'warning') record({ type: 'warning', category: 'renderer' });
    else if (details?.level === 'error') record({ type: 'error', category: 'renderer' });
  };
  app.on('child-process-gone', child);
  webContents.on('render-process-gone', renderer);
  webContents.on('console-message', consoleMessage);
  window.on('unresponsive', unresponsive);
  return () => {
    app.removeListener('child-process-gone', child);
    webContents.removeListener('render-process-gone', renderer);
    webContents.removeListener('console-message', consoleMessage);
    window.removeListener('unresponsive', unresponsive);
  };
}
module.exports = { observeCriticalEvents };
