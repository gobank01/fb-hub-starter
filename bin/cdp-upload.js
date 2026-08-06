#!/usr/bin/env node
// Attach a local file to an <input type=file> via raw CDP (DOM.setFileInputFiles).
// Chrome reads the path itself, so there is no 50MB transfer cap like Playwright's.
// usage: node cdp-upload.js <pageUrlSubstring> <absoluteFilePath> [inputPickerJS]
const PORT = 9222;
const [, , urlMatch, filePath, pickerJs] = process.argv;
if (!urlMatch || !filePath) {
  console.error('usage: cdp-upload.js <pageUrlSubstring> <absFilePath> [pickerJS]');
  process.exit(1);
}

// Default picker: the file input inside the widest visible role=dialog.
const PICKER = pickerJs || `
  (() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')]
      .filter(d => d.getBoundingClientRect().width > 100);
    for (const d of ds) {
      const i = d.querySelector('input[type=file]');
      if (i) { i.id = 'cdp-upload-target'; return 'ok'; }
    }
    const any = document.querySelector('input[type=file]');
    if (any) { any.id = 'cdp-upload-target'; return 'ok-fallback'; }
    return 'none';
  })()
`;

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pages = list.filter(t => t.type === 'page');
  // Prefer an exact URL match; fall back to substring. Exact avoids grabbing a
  // sibling facebook.com tab when several are open.
  const target = pages.find(t => t.url === urlMatch)
    || pages.find(t => t.url === urlMatch.replace(/\/$/, ''))
    || pages.filter(t => t.url.includes(urlMatch)).pop();
  if (!target) throw new Error('no page matching ' + urlMatch);
  console.error('target: ' + target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };
  await new Promise(r => (ws.onopen = r));

  const mark = await send('Runtime.evaluate', { expression: PICKER, returnByValue: true });
  const marked = mark.result && mark.result.value;
  if (marked !== 'ok' && marked !== 'ok-fallback') throw new Error('file input not found: ' + marked);

  const { root } = await send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#cdp-upload-target',
  });
  if (!nodeId) throw new Error('marked input not resolvable via DOM.querySelector');

  await send('DOM.setFileInputFiles', { files: [filePath], nodeId });
  console.log('UPLOAD_OK ' + marked + ' -> ' + filePath);
  ws.close();
})().catch(e => {
  console.error('ERR ' + e.message);
  process.exit(1);
});
