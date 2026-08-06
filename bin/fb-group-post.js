#!/usr/bin/env node
// โพสต์คลิป + แคปชั่น ลงกลุ่ม Facebook หนึ่งกลุ่ม ผ่าน Chrome ที่ล็อกอินค้างไว้
//
//   node fb-group-post.js --group <id> --file <mp4> --caption <txt> [--fallback <png>] [--confirm]
//
// ไม่ใส่ --confirm = หยุดที่ด่านตรวจ ไม่กดปุ่มโพสต์ (ค่าเริ่มต้น ปลอดภัยไว้ก่อน)
//
// ⛔ ด่านตรวจ — ไม่ผ่าน = ไม่กด
//    1. สื่อต้องแนบขึ้นจริง (มี preview) ไม่ใช่แค่ชื่อไฟล์
//    2. แคปชั่นในกล่องต้องตรงกับไฟล์ต้นฉบับเป๊ะ
//    3. ต้องมีปุ่ม "โพสต์"
const fs = require('fs');
const { chromium } = require('playwright-core');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const GROUP = arg('--group');
const FILE = arg('--file');
const FALLBACK = arg('--fallback');
const CAPTION = fs.readFileSync(arg('--caption'), 'utf8').trim();
const CONFIRM = process.argv.includes('--confirm');

const die = (m) => { console.log('FAIL: ' + m); process.exit(1); };
const log = (m) => console.log(m);

(async () => {
  if (!GROUP || !FILE) die('ต้องมี --group และ --file');

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = await b.contexts()[0].newPage();
  await page.goto(`https://www.facebook.com/groups/${GROUP}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);

  const groupName = (await page.title()).replace(' | Facebook', '');
  log('กลุ่ม: ' + groupName);

  // 1. เปิดกล่องเขียนโพสต์
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="button"]')]
      .find(e => /เขียนอะไรสักหน่อย|คุณคิดอะไรอยู่|เขียนอะไรบางอย่าง/.test(e.innerText || '')
        && e.getBoundingClientRect().width > 0);
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) die('ไม่เจอปุ่มเปิดกล่องเขียนโพสต์ (อาจโพสต์ในกลุ่มนี้ไม่ได้)');
  await page.waitForTimeout(5000);

  // หา dialog ที่เป็นกล่องเขียนโพสต์จริง (กว้างพอและมีช่องพิมพ์)
  const dialogIdx = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')];
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      if (d.getBoundingClientRect().width > 300 && d.querySelector('[role="textbox"],[contenteditable=true]')) {
        d.setAttribute('data-bd-composer', '1');
        return i;
      }
    }
    return -1;
  });
  if (dialogIdx < 0) die('เปิดกล่องแล้วแต่ไม่เจอช่องพิมพ์');

  // 2. แนบไฟล์ผ่าน CDP (Playwright ส่งไฟล์ >50MB ผ่าน connectOverCDP ไม่ได้)
  const cdp = await page.context().newCDPSession(page);
  const attach = async (path) => {
    const marked = await page.evaluate(() => {
      const d = document.querySelector('[data-bd-composer]');
      const i = d && d.querySelector('input[type=file]');
      if (!i) return false;
      i.id = 'bd-group-file';
      return true;
    });
    if (!marked) die('ไม่เจอช่องอัปโหลดไฟล์ในกล่องเขียนโพสต์');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#bd-group-file' });
    if (!nodeId) die('resolve ช่องอัปโหลดไม่ได้');
    await cdp.send('DOM.setFileInputFiles', { files: [path], nodeId });
  };

  // preview ขึ้นจริงหรือยัง — video ที่เล่นได้ หรือ img ที่โหลดแล้วในกล่อง
  const mediaReady = () => page.evaluate(() => {
    const d = document.querySelector('[data-bd-composer]');
    if (!d) return { ok: false, why: 'no composer' };
    const v = [...d.querySelectorAll('video')].find(v => v.videoWidth > 0 && v.duration > 0);
    if (v) return { ok: true, kind: 'video', w: v.videoWidth, dur: v.duration };
    const img = [...d.querySelectorAll('img')]
      .find(i => i.naturalWidth > 200 && i.naturalHeight > 200 && /blob:|scontent/.test(i.src || ''));
    if (img) return { ok: true, kind: 'image', w: img.naturalWidth };
    return { ok: false, why: 'no preview yet' };
  });

  await attach(FILE);
  log('แนบ: ' + FILE.split('/').pop() + ' — รอ preview');

  let media = { ok: false };
  for (let i = 0; i < 30; i++) {           // รอสูงสุด ~150 วิ
    await page.waitForTimeout(5000);
    media = await mediaReady();
    if (media.ok) break;
  }

  let usedFallback = false;
  if (!media.ok && FALLBACK) {
    log('คลิปไม่ขึ้น preview — สลับไปแนบปก PNG แทน');
    await attach(FALLBACK);
    usedFallback = true;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      media = await mediaReady();
      if (media.ok) break;
    }
  }
  log('สื่อ: ' + JSON.stringify(media) + (usedFallback ? ' (fallback PNG)' : ''));

  // 3. แคปชั่น
  const box = page.locator('[data-bd-composer] [role="textbox"], [data-bd-composer] [contenteditable=true]').first();
  await box.click({ force: true });
  await page.waitForTimeout(800);
  await page.keyboard.insertText(CAPTION);
  await page.waitForTimeout(2500);

  // 4. ด่านตรวจ
  const gate = await page.evaluate(() => {
    const d = document.querySelector('[data-bd-composer]');
    const btns = [...d.querySelectorAll('[role=button]')]
      .filter(e => e.getBoundingClientRect().width > 0)
      .map(e => (e.innerText || e.getAttribute('aria-label') || '').trim());
    const ed = d.querySelector('[role="textbox"], [contenteditable=true]');
    return { hasPost: btns.includes('โพสต์'), btns: btns.slice(0, 20), caption: ed ? ed.innerText : '' };
  });
  const capOK = gate.caption.trim() === CAPTION;

  log('--- ด่านตรวจ ---');
  log('1) สื่อขึ้นจริง : ' + (media.ok ? 'ผ่าน (' + media.kind + ')' : 'ไม่ผ่าน'));
  log('2) แคปชั่นตรง   : ' + (capOK ? 'ผ่าน' : 'ไม่ผ่าน'));
  if (!capOK) log('   ในกล่อง: ' + JSON.stringify(gate.caption.slice(0, 100)));
  log('3) ปุ่ม "โพสต์"  : ' + (gate.hasPost ? 'ผ่าน' : 'ไม่ผ่าน · ปุ่ม=' + JSON.stringify(gate.btns)));

  if (!media.ok) die('สื่อไม่ขึ้น — ไม่กด');
  if (!capOK) die('แคปชั่นไม่ตรง — ไม่กด');
  if (!gate.hasPost) die('ไม่เจอปุ่มโพสต์ — ไม่กด');

  if (!CONFIRM) {
    log('OK: ผ่านด่านตรวจ — ยังไม่กด (ไม่ได้ใส่ --confirm)');
    b.close();
    return;
  }

  // ต้องเป็นคลิกเมาส์จริง — el.click() แบบ synthetic React ของ FB เมินเฉย (โพสต์ไม่ออก)
  const postBtn = page.locator('[data-bd-composer] [role=button]')
    .filter({ hasText: /^โพสต์$/ }).last();
  await postBtn.click({ force: true });
  await page.waitForTimeout(20000);

  // 5. ยืนยันผลจากหน้า "เนื้อหาของคุณ" ของกลุ่มเอง — เชื่อถือได้กว่าเดาจากฟีด
  //    (ฟีดยังค้างข้อความในกล่องเขียนโพสต์ ทำให้ false positive ว่า "ขึ้นเลย")
  const marker = CAPTION.slice(0, 30);
  const check = async (path) => {
    await page.goto(`https://www.facebook.com/groups/${GROUP}/${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    return page.evaluate(m => document.body.innerText.includes(m), marker);
  };
  // บางกลุ่มแท็บ "รอดำเนินการ" ขึ้นประกาศ "ผู้ดูแลกำลังตรวจสอบผู้มีส่วนร่วมรายใหม่" แทนตัวโพสต์
  // เลยต้องดูตัวนับ "ตัวบ่งชี้เนื้อหาใหม่ N โพสต์" ควบคู่ไปด้วย
  const pendingCount = () => page.evaluate(() => {
    const m = document.body.innerText.match(/ตัวบ่งชี้เนื้อหาใหม่\s*\n?\s*(\d+)\s*โพสต์/);
    return m ? Number(m[1]) : 0;
  });
  // สัญญาณที่ชัวร์สุดคือแบนเนอร์บนหัวกลุ่ม "รออนุมัติจากผู้ดูแล N โพสต์"
  const bannerPending = async () => {
    await page.goto(`https://www.facebook.com/groups/${GROUP}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    return page.evaluate(() => /รออนุมัติจากผู้ดูแล\s*\n?\s*\d+\s*โพสต์/.test(document.body.innerText));
  };
  const isPending = (await check('my_pending_content'))
    || (await pendingCount()) > 0
    || (await bannerPending());
  const isPosted = isPending ? false : await check('my_posted_content');

  const status = isPending ? 'รออนุมัติจากผู้ดูแล'
    : (isPosted ? 'ขึ้นเลย' : 'ไม่แน่ใจ (ไม่เจอทั้งรอดำเนินการและเผยแพร่แล้ว)');
  log('RESULT: ' + groupName + ' :: ' + status + (usedFallback ? ' [ลงเป็นรูปปก ไม่ใช่คลิป]' : ' [คลิป]'));
  b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
