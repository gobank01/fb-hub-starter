// Read-only: connect to the mini's own Chrome over CDP and report who has a reply from us.
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('/reel/')) || ctx.pages()[0];
  const data = await page.evaluate(() => {
    const arts = [...document.querySelectorAll('div[role="article"][aria-label^="ความคิดเห็นจาก"]')];
    const groups = [];
    arts.forEach(a => {
      let n = a;
      while (n.parentElement && !(n.parentElement.querySelectorAll('div[role="article"][aria-label^="ความคิดเห็นจาก"]').length > 3)) n = n.parentElement;
      if (!groups.includes(n)) groups.push(n);
    });
    return groups.map(g => {
      const art = g.querySelector('div[role="article"][aria-label^="ความคิดเห็นจาก"]');
      const name = art.getAttribute('aria-label').replace('ความคิดเห็นจาก', '').split(' เมื่อ')[0].trim();
      const txt = g.innerText.replace(/\n+/g, ' | ');
      return { name, replied: /ดูการตอบกลับ|ซ่อนการตอบกลับ|" + ME + "/.test(txt) };
    });
  });
  console.log('url:', page.url());
  data.forEach((d, i) => console.log(`${String(i).padStart(2)} ${d.replied ? '✅ ตอบแล้ว' : '⬜ ยังไม่ตอบ'}  ${d.name}`));
  console.log('total:', data.length, 'replied:', data.filter(d => d.replied).length);
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
