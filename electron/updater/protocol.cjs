'use strict';
const net = require('node:net');
function createGate({ token, kind, timeoutMs = 30000 }) {
  if (!/^[a-f0-9]{64}$/.test(token) || !['ready', 'restored'].includes(kind)) throw new Error('Invalid gate.');
  return new Promise((resolve, reject) => {
    const peers = new Set(); let settled = false, timer, resolveReady, rejectReady;
    const ready = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; });
    // A failed launch may dispose the gate before the consumer awaits readiness.
    ready.catch(() => {});
    const server = net.createServer(socket => {
      peers.add(socket); let bytes = '';
      socket.setTimeout(3000, () => socket.destroy());
      socket.on('error', () => {}); socket.on('close', () => peers.delete(socket));
      socket.on('data', chunk => {
        bytes += chunk.toString('utf8');
        if (bytes.length > 4096 || settled) return socket.destroy();
        if (!bytes.includes('\n')) return;
        try {
          const value = JSON.parse(bytes.trim());
          if (value.token !== token || value.kind !== kind || Object.keys(value).length !== 2) return socket.destroy();
          settled = true; clearTimeout(timer); socket.setTimeout(0); server.close();
          for (const peer of peers) if (peer !== socket) peer.destroy();
          resolveReady(socket);
        } catch { socket.destroy(); }
      });
    });
    const dispose = () => {
      clearTimeout(timer); for (const peer of peers) peer.destroy(); server.close();
      if (!settled) { settled = true; rejectReady(new Error('Updater handshake disposed.')); }
    };
    server.once('error', error => { if (!server.listening) reject(error); if (!settled) { settled = true; rejectReady(error); } });
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(() => { if (!settled) { settled = true; rejectReady(new Error('Updater handshake timed out.')); } dispose(); }, timeoutMs);
      resolve({ port: server.address().port, ready, dispose });
    });
  });
}
async function waitForExit({ pid, timeoutMs = 30000, intervalMs = 100 }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid parent identity.');
  const end = Date.now() + timeoutMs;
  while (true) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    if (Date.now() >= end) throw new Error('Parent is still running; update stopped.');
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
function notify({ port, token, kind }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/.test(token)) return Promise.reject(new Error('Invalid updater acknowledgement.'));
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1'); socket.setTimeout(5000, () => socket.destroy(new Error('Acknowledgement timed out.')));
    socket.once('error', reject); socket.once('connect', () => socket.end(JSON.stringify({ token, kind }) + '\n', resolve));
  });
}
module.exports = { createGate, waitForExit, notify };
