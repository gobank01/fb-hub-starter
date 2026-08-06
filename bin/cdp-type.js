#!/usr/bin/env node
// Insert text into the currently focused element via raw CDP Input.insertText.
// Reliable for Facebook's Lexical editors, including newlines (fill()/pressSequentially
// both mangle them). Text is read from stdin so quoting/newlines survive intact.
// usage: node cdp-type.js <pageUrl> [focusSelector]  < text.txt
const PORT = 9222;
const [, , urlMatch, focusSelector] = process.argv;
if (!urlMatch) {
  console.error('usage: cdp-type.js <pageUrl> [focusSelector] < text');
  process.exit(1);
}

const readStdin = () =>
  new Promise(res => {
    let b = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => (b += d));
    process.stdin.on('end', () => res(b));
  });

(async () => {
  const text = await readStdin();
  if (!text) throw new Error('empty stdin');

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pages = list.filter(t => t.type === 'page');
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

  if (focusSelector) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const e = document.querySelector(${JSON.stringify(focusSelector)});
        if (!e) return 'nf'; e.focus();
        const s = getSelection(); const rg = document.createRange();
        rg.selectNodeContents(e); rg.collapse(false); s.removeAllRanges(); s.addRange(rg);
        return 'ok'; })()`,
      returnByValue: true,
    });
    if (r.result.value !== 'ok') throw new Error('focus failed: ' + r.result.value);
  }

  await send('Input.insertText', { text });
  console.log('TYPE_OK ' + text.length + ' chars');
  ws.close();
})().catch(e => {
  console.error('ERR ' + e.message);
  process.exit(1);
});
