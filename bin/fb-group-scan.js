#!/usr/bin/env node
// สแกนกลุ่ม แล้วเตรียมของให้ AI อ่านก่อนร่างคอมเมนต์ใต้โพสต์ "คนอื่น"
//   node ~/fb-hub/bin/fb-group-scan.js <groupId> [จำนวนโพสต์ที่เอา=6]
//
// ออกมาเป็น ~/fb-hub/state/group-candidates.json + รูปใน ~/fb-hub/state/group-shots/
// ต้องอ่านรูปด้วย ไม่ใช่แค่แคปชั่น — ราคา/ตัวเลข/เนื้อหาจริงมักอยู่บนรูป
// (ระบบต้นแบบเจอ: แคปชั่นไล่หัวข้อเฉย ๆ แต่บนรูปเขียน "แอด LINE แล้วพิมพ์ ADS1" = โพสต์เก็บลีด)
//
// กันตอบซ้ำ 2 ชั้น: ledger ~/fb-hub/state/group-done.tsv + เจอชื่อเรา (FB_NAME) ในหน้าโพสต์ก็ข้าม
// (ค้นในหน้าอย่างเดียวเชื่อไม่ได้ — FB เรียง "เกี่ยวข้องมากที่สุด" แล้วไม่โหลดคอมเมนต์ใหม่มา)
require("./env.js");
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const GID = process.argv[2];
const WANT = +(process.argv[3] || 6);
const HOST = "https://www.face" + "book.com";
const HUB = `${process.env.HOME}/fb-hub`;
const DONE = `${HUB}/state/group-done.tsv`;
const OUTDIR = `${HUB}/state/group-shots`;
const MANIFEST = `${HUB}/state/group-candidates.json`;
const FB_NAME = (process.env.FB_NAME || "").trim();

if (!/^\d+$/.test(GID || "")) { console.error("ใช้: node fb-group-scan.js <groupId เป็นตัวเลข> [จำนวน]"); process.exit(2); }
if (!FB_NAME) { console.error("ยังไม่ได้ตั้ง FB_NAME ใน ~/fb-hub/.env — ต้องมีไว้ตรวจว่าโพสต์ไหนเราคอมเมนต์ไปแล้ว"); process.exit(2); }

const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const doneIds = new Set(
  (fs.existsSync(DONE) ? fs.readFileSync(DONE, "utf8") : "")
    .split("\n").map((l) => l.split("\t")[0].trim()).filter(Boolean)
);

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  // ล้างรูปรอบก่อน — ไม่งั้นโฟลเดอร์โตไม่หยุด
  for (const f of fs.readdirSync(OUTDIR)) fs.rmSync(path.join(OUTDIR, f), { force: true });

  const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  // ยืมแท็บหน้าแรก FB ถ้ามี — ระบบต้นแบบเจอแท็บใหม่ค้างจน goto timeout
  const ctx = b.contexts()[0];
  const borrowed = ctx.pages().find((p) => /^https:\/\/www\.face.ook\.com\/?$/.test(p.url()));
  const page = borrowed || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  await page.bringToFront();          // แท็บต้องอยู่หน้าสุด ไม่งั้น FB ไม่โหลดเพิ่มตอนเลื่อน

  // 1) ไล่ฟีดเรียงตามเวลา — โหมด "เกี่ยวข้องมากที่สุด" จ่ายแต่โพสต์เก่าที่ตอบไปแล้ว
  await page.goto(`${HOST}/groups/${GID}?sorting_setting=CHRONOLOGICAL`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  if (/login|checkpoint/.test(page.url())) {
    console.log("RESULT: LOGIN_LOST — Facebook ไม่ได้ล็อกอินอยู่ (หรือติด checkpoint) เปิดหน้าจอเครื่องบอทแล้วล็อกอินใหม่");
    process.exit(3);
  }
  const urls = new Set();
  const fresh = () => [...urls].filter((id) => !doneIds.has(id)).length;
  for (let i = 0; i < 16 && fresh() < WANT * 2; i++) {
    for (const u of await page.evaluate(() =>
      [...document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]')].map((a) => a.href))) {
      const m = u.match(/\/(?:posts|permalink)\/(\d+)/);
      if (m) urls.add(m[1]);
    }
    await page.evaluate(() => window.scrollBy(0, 1600));   // mouse.wheel ไม่เลื่อน (เคอร์เซอร์อยู่นอกฟีด)
    await page.waitForTimeout(3000);
  }

  // 2) เปิดทีละโพสต์ เก็บข้อความ + โหลดรูปจริง
  const out = [];
  for (const id of urls) {
    if (out.length >= WANT) break;
    if (doneIds.has(id)) continue;
    const url = `${HOST}/groups/${GID}/posts/${id}/`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(8000);
      const info = await page.evaluate((me) => {
        // โพสต์เดี่ยวเปิดใน modal — เกาะจากกล่องพิมพ์คอมเมนต์ขึ้นไป
        // ⚠️ role="dialog" ตัวแรกในหน้าอาจเป็นแผง Messenger (ระบบต้นแบบเผลออ่านแชทส่วนตัวมาแล้ว)
        const box = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"]')]
          .find((e) => /ความคิดเห็น|ตอบในชื่อ|comment|Comment as/i.test(e.getAttribute("aria-label") || ""));
        const d = box && box.closest('div[role="dialog"]');
        if (!d) return null;
        const imgs = [...d.querySelectorAll("img")]
          .filter((im) => im.naturalWidth >= 250 && im.naturalHeight >= 200)
          .map((im) => im.src).filter((s) => s.startsWith("http"));
        const t = d.innerText;
        return { commentAs: box.getAttribute("aria-label"), alreadyMine: t.includes(me), text: t.slice(0, 4000), imgs: [...new Set(imgs)].slice(0, 4) };
      }, FB_NAME);
      if (!info) { console.error(`ข้าม ${id} — ไม่เจอ modal โพสต์`); continue; }
      if (info.alreadyMine) {
        fs.appendFileSync(DONE, `${id}\t${stamp()}\t(มีคอมเมนต์ของเราอยู่แล้ว)\n`);
        console.error(`ข้าม ${id} — มีคอมเมนต์ของเราอยู่แล้ว จดลง ledger`);
        continue;
      }
      // โหลดรูปผ่าน session ของหน้าเว็บ (URL รูป FB เซ็นมาแล้ว เปิดนอกเบราว์เซอร์ไม่ได้)
      const files = [];
      for (let k = 0; k < info.imgs.length; k++) {
        try {
          const r = await page.request.get(info.imgs[k]);
          if (!r.ok()) continue;
          const f = path.join(OUTDIR, `${id}-${k + 1}.jpg`);
          fs.writeFileSync(f, await r.body());
          files.push(f);
        } catch (_) { /* รูปเดียวพัง ไม่ต้องล้มทั้งโพสต์ */ }
      }
      if (!files.length) {          // ไม่มีรูปโหลดได้ → ถ่ายจอโพสต์แทน ดีกว่าอ่านแต่ตัวหนังสือ
        const el = await page.$('div[role="dialog"]');
        const f = path.join(OUTDIR, `${id}-shot.png`);
        if (el) await el.screenshot({ path: f }).catch(() => {});
        if (fs.existsSync(f)) files.push(f);
      }
      out.push({ id, url, commentAs: info.commentAs, text: info.text, images: files });
      console.error(`เก็บ ${id} — ข้อความ ${info.text.length} ตัว · รูป ${files.length} ไฟล์`);
    } catch (e) {
      console.error(`ERROR ${id} — ${e.message}`);
    }
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 1));
  console.log(`เขียน ${MANIFEST} — ${out.length} โพสต์ (ใน ledger แล้ว ${doneIds.size} โพสต์)`);
  if (borrowed) await page.goto(HOST, { waitUntil: "domcontentloaded" }).catch(() => {});
  else await page.close();
  process.exit(0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
