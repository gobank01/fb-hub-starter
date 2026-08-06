#!/usr/bin/env node
// โพสต์ Reel ลงโปรไฟล์ Facebook ส่วนตัวทันที (ไม่ตั้งเวลา) ผ่าน Chrome ที่ล็อกอินค้างไว้
//
//   node fb-reel-post.js --file <mp4> --caption <txt> [--confirm]
//
// ไม่ใส่ --confirm = หยุดที่ด่านตรวจ ไม่กดปุ่มสุดท้าย (ค่าเริ่มต้น ปลอดภัยไว้ก่อน)
//
// ⛔ ด่านตรวจ ตามบทเรียน 2026-08-02 (เผยแพร่หลุด 5 คลิป) — ไม่ผ่านข้อใดข้อหนึ่ง = ไม่กด
//    1. วิดีโอต้องอัปโหลดขึ้นจริง (มีตัวอย่างเล่นได้) ไม่ใช่แค่ชื่อไฟล์
//    2. แคปชั่นในกล่องต้องตรงกับไฟล์ต้นฉบับเป๊ะ
//    3. สวิตช์ "โปรโมทคลิป Reels" ต้องปิด (เปิดค้าง = ยิงแอดเสียเงิน)
//    4. ต้องมีปุ่ม "โพสต์"
const fs = require('fs');
const { chromium } = require('playwright-core');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = arg('--file');
const CAPTION = fs.readFileSync(arg('--caption'), 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');
const SHOT = arg('--shot', '$HOME/reels/post-gate.png');

const die = (m) => { console.log('FAIL: ' + m); process.exit(1); };

(async () => {
  if (!FILE) die('ต้องมี --file');

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = await b.contexts()[0].newPage();
  await page.goto('https://www.facebook.com/reels/create', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // 1. อัปไฟล์ตรง ๆ ผ่าน CDP — setInputFiles ของ Playwright ส่งไฟล์ >50MB ผ่าน connectOverCDP ไม่ได้
  await page.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 30000 });
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  if (!nodeId) die('ไม่เจอช่องอัปโหลดไฟล์');
  await cdp.send('DOM.setFileInputFiles', { files: [FILE], nodeId });
  console.log('อัปโหลด:', FILE.split('/').pop());
  await page.waitForTimeout(30000);

  // 2. ถัดไป x2 → หน้าการตั้งค่า
  for (let i = 0; i < 2; i++) {
    const n = page.getByRole('button', { name: 'ถัดไป', exact: true }).first();
    await n.waitFor({ timeout: 60000 });
    await n.click({ force: true });
    await page.waitForTimeout(6000);
  }

  // 3. แคปชั่น
  const box = page.locator('[contenteditable=true]').last();
  await box.click({ force: true });
  await page.waitForTimeout(500);
  await box.fill('');
  await page.keyboard.insertText(CAPTION);
  await page.waitForTimeout(3000);

  // 4. ด่านตรวจ
  const gate = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role=button]')]
      .map(e => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' '));
    const promo = document.querySelector('[aria-label="ปุ่มโปรโมทคลิป Reels"]');
    const vids = [...document.querySelectorAll('video')]
      .map(v => ({ src: (v.currentSrc || v.src || '').slice(0, 40), dur: v.duration, w: v.videoWidth }));
    const eds = [...document.querySelectorAll('[contenteditable=true]')];
    return {
      hasPost: btns.some(t => t === 'โพสต์'),
      hasSchedule: btns.some(t => t === 'กำหนดเวลา'),
      promoOn: promo ? (promo.getAttribute('aria-checked') === 'true' || promo.checked === true) : null,
      videos: vids,
      caption: eds.length ? eds[eds.length - 1].innerText : '',
    };
  });
  await page.screenshot({ path: SHOT });

  const videoOK = gate.videos.some(v => v.w > 0 && v.dur > 0);
  const capOK = gate.caption.trim() === CAPTION;

  console.log('\n--- ด่านตรวจ ---');
  console.log('1) วิดีโอขึ้นจริง  :', videoOK ? 'ผ่าน' : 'ไม่ผ่าน', JSON.stringify(gate.videos));
  console.log('2) แคปชั่นตรง      :', capOK ? 'ผ่าน' : 'ไม่ผ่าน');
  if (!capOK) { console.log('   ในกล่อง:', JSON.stringify(gate.caption.slice(0, 120))); }
  console.log('3) สวิตช์โปรโมท    :', gate.promoOn === false ? 'ปิด ผ่าน' : `(${gate.promoOn})`);
  console.log('4) ปุ่ม "โพสต์"     :', gate.hasPost ? 'ผ่าน' : 'ไม่ผ่าน');
  console.log('   ภาพ:', SHOT);

  if (!videoOK) die('วิดีโอยังไม่ขึ้น — ไม่กดเด็ดขาด');
  if (!capOK) die('แคปชั่นไม่ตรงต้นฉบับ — ไม่กด');
  if (gate.promoOn === true) die('สวิตช์โปรโมทเปิดอยู่ — ไม่กด');
  if (!gate.hasPost) die('ไม่เจอปุ่ม "โพสต์" — ไม่กด');

  if (!CONFIRM) {
    console.log('\nOK: ผ่านด่านตรวจครบ — ยังไม่กดปุ่ม (ไม่ได้ใส่ --confirm)');
    b.close();
    return;
  }

  await page.getByRole('button', { name: 'โพสต์', exact: true }).first().click({ force: true });
  await page.waitForTimeout(15000);
  console.log('\nPOSTED: กดปุ่มโพสต์แล้ว url=' + page.url());
  b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
