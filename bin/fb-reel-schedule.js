#!/usr/bin/env node
// อัปโหลด + ตั้งเวลาโพสต์ Reel ลงโปรไฟล์ Facebook ส่วนตัว ผ่าน Chrome ที่ล็อกอินค้างไว้
//
//   node fb-reel-schedule.js --file <mp4> --caption <txt> --date 2026-08-07 --time 10:00 [--confirm]
//
// ไม่ใส่ --confirm = หยุดที่ด่านตรวจ ไม่กดปุ่มสุดท้าย (ค่าเริ่มต้น ปลอดภัยไว้ก่อน)
//
// ⛔ ด่านตรวจ 3 ข้อ ตามบทเรียน 2026-08-02 (เผยแพร่หลุด 5 คลิป) — ไม่ผ่านข้อใดข้อหนึ่ง = ไม่กด
//    1. ปุ่มต้องชื่อ "กำหนดเวลา" ไม่ใช่ "โพสต์"
//    2. แถวตั้งเวลาต้องขึ้นวันเวลาที่สั่ง ไม่ใช่ "เผยแพร่เลย"
//    3. สวิตช์ "โปรโมทคลิป Reels" ต้องปิด (เปิดค้าง = ยิงแอดเสียเงิน)
const fs = require('fs');
const { chromium } = require('playwright-core');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = arg('--file');
const CAPTION = fs.readFileSync(arg('--caption'), 'utf8').trim();
const DATE = arg('--date');            // 2026-08-07
const TIME = arg('--time');            // 10:00
const CONFIRM = process.argv.includes('--confirm');
const SHOT = arg('--shot', '$HOME/reels/gate.png');

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                   'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const die = (m) => { console.log('FAIL: ' + m); process.exit(1); };

(async () => {
  if (!FILE || !DATE || !TIME) die('ต้องมี --file --caption --date --time');
  const [, mo, dd] = DATE.split('-').map(Number);
  const dayLabel = new RegExp(`ที่ ${dd} ${TH_MONTHS[mo - 1]} ${DATE.slice(0, 4)}`);
  const wantDateTxt = `${dd} ${TH_SHORT[mo - 1]} ${DATE.slice(0, 4)}`;

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = await b.contexts()[0].newPage();
  await page.goto('https://www.facebook.com/reels/create', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // 1. อัปไฟล์ตรง ๆ ไม่ต้องเปิด file picker
  // ต้องยัดผ่าน CDP: setInputFiles ของ Playwright ส่งไฟล์ >50MB ผ่าน connectOverCDP ไม่ได้
  // (Chrome อยู่บนเครื่องเดียวกับไฟล์อยู่แล้ว DOM.setFileInputFiles เลยใช้ path ตรง ๆ ได้)
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
  await page.waitForTimeout(2000);

  // 4. เปิดตัวเลือกการกำหนดเวลา
  await page.getByRole('button', { name: /ตัวเลือกการกำหนดเวลา/ }).first().click({ force: true });
  await page.waitForTimeout(3000);

  // 5. วันที่
  await page.getByRole('button', { name: /เปิดตัวเลือกวันที่/ }).first().click({ force: true });
  await page.waitForTimeout(2000);
  const cell = page.getByRole('gridcell', { name: dayLabel }).first();
  if (!(await cell.count())) die('ไม่เจอวันที่ ' + wantDateTxt + ' ในปฏิทิน');
  await cell.click({ force: true });
  await page.waitForTimeout(2000);

  // 6. เวลา — พิมพ์ลงช่อง แล้วเลือกจากรายการที่เด้งขึ้นมา
  await page.locator('[aria-label="เปิดตัวเลือกเวลา"]').first().click({ force: true });
  await page.waitForTimeout(1500);
  const opt = page.locator(`text="${TIME}"`).last();
  if (!(await opt.count())) die('ไม่เจอเวลา ' + TIME + ' ในรายการ');
  await opt.scrollIntoViewIfNeeded();
  await opt.click({ force: true });
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: 'กำหนดเวลาเริ่มเป็นภายหลัง' }).first().click({ force: true });
  await page.waitForTimeout(4000);

  // 7. ด่านตรวจ
  const gate = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role=button]')]
      .map(e => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' '));
    const promo = document.querySelector('[aria-label="ปุ่มโปรโมทคลิป Reels"]');
    return {
      hasSchedule: btns.some(t => t === 'กำหนดเวลา'),
      hasPost: btns.some(t => t === 'โพสต์'),
      row: btns.find(t => t.startsWith('ตัวเลือกการกำหนดเวลา')) || '(ไม่เจอแถวตั้งเวลา)',
      promoOn: promo ? (promo.getAttribute('aria-checked') === 'true' || promo.checked === true) : null,
    };
  });
  await page.screenshot({ path: SHOT });

  console.log('\n--- ด่านตรวจ ---');
  console.log('1) ปุ่ม "กำหนดเวลา" :', gate.hasSchedule ? 'ผ่าน' : 'ไม่ผ่าน (ยังเป็นปุ่มโพสต์)');
  console.log('2) แถวตั้งเวลา      :', gate.row);
  console.log('3) สวิตช์โปรโมท     :', gate.promoOn === false ? 'ปิด ผ่าน' : `เปิดอยู่ (${gate.promoOn}) ไม่ผ่าน`);
  console.log('   ภาพ:', SHOT);

  // FB เขียนแถวนี้ว่า "ตัวเลือกการกำหนดเวลา 7 สิงหาคม เวลา 10:00 น." (เดือนเต็ม ไม่มีปี)
  const dateOK = new RegExp(`(^|[^0-9])${dd} ${TH_MONTHS[mo - 1]}`).test(gate.row) && gate.row.includes(TIME);
  if (!gate.hasSchedule) die('ปุ่มยังไม่ใช่ "กำหนดเวลา" — ไม่กดเด็ดขาด');
  if (!dateOK) die(`แถวตั้งเวลาไม่ตรง (ต้องการ ${wantDateTxt} ${TIME}) — ไม่กด`);
  if (gate.promoOn !== false) die('สวิตช์โปรโมทไม่ได้ปิด — ไม่กด');

  if (!CONFIRM) {
    console.log('\nOK: ผ่านด่านตรวจครบ 3 ข้อ — ยังไม่กดปุ่ม (ไม่ได้ใส่ --confirm)');
    b.close();
    return;
  }

  await page.getByRole('button', { name: 'กำหนดเวลา', exact: true }).first().click({ force: true });
  await page.waitForTimeout(12000);
  console.log('\nSCHEDULED: กดปุ่มกำหนดเวลาแล้ว —', wantDateTxt, TIME);
  b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
