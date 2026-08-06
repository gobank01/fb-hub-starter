#!/usr/bin/env node
// ดึง "กฎของกลุ่ม" + สถานะสมาชิก ของหลายกลุ่มรวดเดียว เพื่อคัดว่ากลุ่มไหนโพสต์ขายของได้
//   node fb-group-rules.js <groupId> [groupId ...]
const { chromium } = require('playwright-core');

const IDS = process.argv.slice(2);
if (!IDS.length) { console.error('usage: fb-group-rules.js <groupId> ...'); process.exit(1); }

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = await b.contexts()[0].newPage();
  for (const id of IDS) {
    try {
      await page.goto(`https://www.facebook.com/groups/${id}/about`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      const info = await page.evaluate(() => {
        const t = document.body.innerText;
        const i = t.indexOf('กฎของกลุ่ม');
        return {
          name: (document.title || '').replace(' | Facebook', ''),
          joined: t.includes('เข้าร่วมแล้ว'),
          privacy: t.includes('กลุ่มส่วนตัว') ? 'ส่วนตัว' : (t.includes('กลุ่มสาธารณะ') ? 'สาธารณะ' : '?'),
          rules: i >= 0 ? t.slice(i, i + 1500).replace(/\n+/g, ' | ') : '(ไม่มีกฎประกาศไว้)',
        };
      });
      console.log('=== ' + id + ' :: ' + info.name);
      console.log('   สมาชิก: ' + (info.joined ? 'เข้าร่วมแล้ว' : 'ไม่แน่ใจ') + ' · ' + info.privacy);
      console.log('   กฎ: ' + info.rules.slice(0, 1100));
      console.log('');
    } catch (e) {
      console.log('=== ' + id + ' :: ERR ' + e.message + '\n');
    }
  }
  await page.close();
  b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
