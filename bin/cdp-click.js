#!/usr/bin/env node
// Click at the centre of an element using real (trusted) CDP mouse events.
// Facebook's React buttons sometimes ignore synthetic el.click(); these don't.
// usage: node cdp-click.js <pageUrl> '<js expression returning the element>'
const PORT = 9222;
const [, , urlMatch, elExpr] = process.argv;
if (!urlMatch || !elExpr) {
  console.error("usage: cdp-click.js <pageUrl> '<js expr returning element>'");
  process.exit(1);
}

(async () => {
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

  // Only scroll when the element is actually outside the viewport — scrolling
  // shifts layout, and a stale rect makes the click land somewhere else.
  const measure = async () => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const el = (${elExpr});
        if (!el) return null;
        const b0 = el.getBoundingClientRect();
        const off = b0.top < 0 || b0.bottom > innerHeight;
        if (off) el.scrollIntoView({block:'center'});
        const b = el.getBoundingClientRect();
        return {x: b.x + b.width/2, y: b.y + b.height/2, w: b.width, h: b.height, scrolled: off};
      })()`,
      returnByValue: true,
    });
    return r.result.value;
  };
  let box = await measure();
  if (box && box.scrolled) {
    // Let the scroll settle, then take the rect that actually matters.
    await new Promise(r => setTimeout(r, 400));
    box = await measure();
  }
  if (!box) throw new Error('element not found');
  if (!box.w || !box.h) throw new Error('element has zero size');

  const base = { x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y });
  await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
  console.log(`CLICK_OK at ${base.x},${base.y}`);
  ws.close();
})().catch(e => {
  console.error('ERR ' + e.message);
  process.exit(1);
});
