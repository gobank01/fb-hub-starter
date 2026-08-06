// Read-only recon: who commented on the sales post, what they said, did we reply, and their profile link.
const { chromium } = require('playwright-core');
const URL = process.argv[2];

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = await b.contexts()[0].newPage();
  await page.setViewportSize({ width: 1500, height: 2200 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);

  // โหลดคอมเมนต์ให้ครบ
  for (let i = 0; i < 12; i++) {
    const n = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role=button], span')]
        .filter(e => /^ดูความคิดเห็นเพิ่มเติม|^ดูความคิดเห็นอีก|ความคิดเห็นก่อนหน้า/.test(e.textContent.trim()));
      btns.forEach(x => x.click());
      return btns.length;
    });
    if (!n) break;
    await page.waitForTimeout(2500);
  }

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
      const link = [...g.querySelectorAll('a[href*="facebook.com/"], a[href^="/"]')]
        .map(a => a.href).find(h => /facebook\.com\/(profile\.php\?id=\d+|[a-zA-Z0-9.]+)($|\?|\/$)/.test(h)) || '';
      const lines = art.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      const body = lines.filter(s => s !== name && !/^(ตอบกลับ|ซ่อน|โดยผู้เขียน|·)$/.test(s) && !/^\d+ (นาที|ชั่วโมง|วัน|สัปดาห์)/.test(s)).join(' ');
      const txt = g.innerText.replace(/\n+/g, ' | ');
      return { name, body: body.slice(0, 90), replied: /ดูการตอบกลับ|ซ่อนการตอบกลับ/.test(txt), link: link.split('?')[0].slice(0, 70) };
    });
  });

  console.log('url:', page.url().slice(0, 90));
  console.log('คอมเมนต์ทั้งหมด:', data.length);
  data.forEach((d, i) => console.log(`${String(i).padStart(2)} ${d.replied ? '✅' : '⬜'} ${d.name}\n     "${d.body}"\n     ${d.link}`));
  await page.screenshot({ path: 'post-recon.png' });
  await page.close();
  b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
