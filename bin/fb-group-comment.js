#!/usr/bin/env node
// คอมเมนต์ใต้โพสต์ของคนอื่นในกลุ่ม — ทีละโพสต์ เว้นจังหวะสุ่ม
//   node ~/fb-hub/bin/fb-group-comment.js <groupId> <drafts.json> [--dry]
//
// drafts.json = [{ id, who, topic, text, link?, product? }, ...]
//   link    = ลิงก์ Shopee affiliate (ไม่บังคับ) — ต่อท้ายเป็นบรรทัดสุดท้ายให้เอง
//   product = ชื่อสินค้าของลิงก์นั้น (ไว้แสดงบน dashboard)
//
// เซฟการ์ดที่ห้ามถอด (ทุกข้อมาจากของจริงที่ระบบต้นแบบเคยพัง):
//   · ตัวตนต้องเป็น FB_NAME — เบราว์เซอร์เคยสวมร่างเพจแล้วคอมเมนต์ออกในนามเพจ
//   · เจอชื่อเราในโพสต์แล้ว = ข้าม ห้ามคอมเมนต์ซ้ำบนโพสต์สาธารณะ
//   · หลายบรรทัดต้อง Shift+Enter — Enter เดี่ยว = ส่งทันที คอมเมนต์ขาดเป็นท่อน
//   · ตรวจว่าข้อความเข้ากล่องครบ "ก่อน" กด Enter · ตรวจว่าขึ้นจริง "หลัง" กด
//   · เช็กโควตาก่อนทุกอัน · ส่งสำเร็จจด progress.log ทันที ไม่รอสรุปตอนจบ
//   · ส่งแล้วลบร่างออกจากไฟล์ทันที — ไม่งั้นตัวจับเวลาเห็นร่างค้าง แล้วหยุดทั้งระบบเงียบ ๆ (ต้นแบบค้าง 37 ชม.)
//   · ห้ามแตะเมนู "..." ข้างคอมเมนต์ — มีปุ่มซ่อน/รายงาน
const { chromium } = require("playwright-core");
const fs = require("fs");
const { execFileSync } = require("child_process");

const [GID, FILE] = process.argv.slice(2);
const DRY = process.argv.includes("--dry");
const HUB = `${process.env.HOME}/fb-hub`;
const FULL = (process.env.FB_NAME || "").trim();
const LOG = `${HUB}/state/progress.log`;
const REPLIES = `${HUB}/state/replies.tsv`;
const DONE = `${HUB}/state/group-done.tsv`;
const SHOPEE_LOG = `${HUB}/state/shopee-posted.tsv`;
const QUOTA = `${HUB}/bin/fb-quota.py`;
const HOST = "https://www.face" + "book.com";
const SHOPEE = /^https:\/\/(s\.shopee\.co\.th|shope\.ee|shopee\.co\.th)\/\S+$/;
const MIN_GAP = +(process.env.MIN_GAP || 70), MAX_GAP = +(process.env.MAX_GAP || 170);

if (!/^\d+$/.test(GID || "") || !FILE) { console.error("ใช้: node fb-group-comment.js <groupId> <drafts.json> [--dry]"); process.exit(2); }
if (!FULL) { console.error("ยังไม่ได้ตั้ง FB_NAME ใน ~/fb-hub/.env"); process.exit(2); }

// เวลาเครื่อง "YYYY-MM-DD HH:MM:SS" — toISOString() เป็น UTC + .268Z ทำให้ fb-quota.py นับไม่ได้ (บั๊กจริงของต้นแบบ)
const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
// แท็ก [group] คือตัวแยกถังโควตา ห้ามถอด
const jot = (m) => { fs.appendFileSync(LOG, `${stamp()} [group] ${m}\n`); console.log(m); };
const flat = (t) => String(t || "").replace(/[\r\n\t]+/g, " ").trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const quotaOk = () => {
  try { console.log("  โควตา: " + execFileSync("python3", [QUOTA, "--group"]).toString().trim()); return true; }
  catch (e) { console.log("  โควตา: " + String(e.stdout || e.message).trim()); return false; }
};
const findBox = () => [...document.querySelectorAll('div[contenteditable="true"][role="textbox"]')]
  .find((e) => /ความคิดเห็น|ตอบในชื่อ|comment|Comment as/i.test(e.getAttribute("aria-label") || ""));

(async () => {
  const items = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (!items.length) { console.log("ไม่มีร่าง — จบ"); process.exit(0); }
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = b.contexts()[0];
  const borrowed = ctx.pages().find((p) => /^https:\/\/www\.face.ook\.com\/?$/.test(p.url()));
  const page = borrowed || (await ctx.newPage());
  page.setDefaultTimeout(30000);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const url = `${HOST}/groups/${GID}/posts/${it.id}/`;
    const tag = `${i + 1}/${items.length} ${flat(it.who)}`;
    const link = (it.link || "").trim();
    try {
      if (link && !SHOPEE.test(link)) { jot(`SKIP ${tag} — ลิงก์ไม่ใช่ Shopee: ${link.slice(0, 60)}`); continue; }
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await wait(9000);

      // --- ด่านตรวจก่อนแตะอะไรทั้งสิ้น ---
      const gate = await page.evaluate(({ full, findSrc }) => {
        const box = eval(findSrc)();
        const dlg = box && box.closest('div[role="dialog"]');
        return { label: box ? box.getAttribute("aria-label") : null, inModal: !!dlg, mine: dlg ? dlg.innerText.split(full).length - 1 : -1 };
      }, { full: FULL, findSrc: `(${findBox.toString()})` });

      if (!gate.label) { jot(`SKIP ${tag} — หากล่องคอมเมนต์ไม่เจอ`); continue; }
      if (!gate.inModal) { jot(`SKIP ${tag} — โพสต์ไม่ได้เปิดใน modal อ่านบริบทไม่ชัวร์`); continue; }
      // ป้ายกล่องต้องมีชื่อเรา — ไม่งั้นกำลังจะคอมเมนต์ในนามเพจ/คนอื่น หยุดทั้งรอบ
      if (!gate.label.includes(FULL)) { jot(`ABORT ${tag} — จะคอมเมนต์ในชื่อ "${gate.label}" ไม่ใช่ ${FULL} (สลับตัวตนที่อวตารขวาบนก่อน)`); break; }
      if (gate.mine > 0) {
        fs.appendFileSync(DONE, `${it.id}\t${stamp()}\t(มีคอมเมนต์ของเราอยู่แล้ว)\n`);
        jot(`SKIP ${tag} — มีคอมเมนต์ของ ${FULL} ในโพสต์แล้ว`); continue;
      }
      if (DRY) { jot(`DRY ${tag} — ผ่านด่านตรวจครบ (${gate.label})${link ? " 🔗" : ""}`); continue; }
      if (!quotaOk()) { jot(`STOP ${tag} — เต็มโควตากลุ่ม หยุดรอบ ที่เหลือยังไม่ได้ส่ง`); break; }

      // --- กดถูกใจโพสต์: ปุ่ม "ถูกใจ" อันแรกในโมดัลเป็นของโพสต์ ---
      const liked = await page.evaluate((findSrc) => {
        const dlg = eval(findSrc)().closest('div[role="dialog"]');
        const btn = [...dlg.querySelectorAll('div[role="button"]')].find((e) => /^(ถูกใจ|Like)$/.test((e.getAttribute("aria-label") || "").trim()));
        if (!btn) return "ไม่เจอปุ่ม";
        if (btn.getAttribute("aria-pressed") === "true") return "ถูกใจอยู่แล้ว";
        btn.click(); return "กดแล้ว";
      }, `(${findBox.toString()})`);
      console.log(`  👍 ${liked}`);
      await wait(2000 + Math.random() * 2000);

      // --- พิมพ์ทีละบรรทัด คั่น Shift+Enter · ลิงก์เป็นบรรทัดสุดท้าย ---
      const lines = String(it.text).split("\n").concat(link ? [link] : []);
      await page.click(`div[contenteditable="true"][aria-label="${gate.label}"]`);
      await wait(1200);
      for (let k = 0; k < lines.length; k++) {
        if (k > 0) { await page.keyboard.down("Shift"); await page.keyboard.press("Enter"); await page.keyboard.up("Shift"); await wait(250); }
        await page.evaluate((L) => {           // caret ต้องอยู่ท้ายกล่องก่อน ไม่งั้นข้อความไม่เข้า
          const el = document.activeElement, r = document.createRange();
          r.selectNodeContents(el); r.collapse(false);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r);
          document.execCommand("insertText", false, L);
        }, lines[k]);
        await wait(400 + Math.random() * 500);
      }

      // --- ตรวจก่อนส่ง ---
      const typed = await page.evaluate((lb) => document.querySelector(`div[contenteditable="true"][aria-label="${lb}"]`).innerText, gate.label);
      const missing = lines.filter((L) => L && !typed.includes(L.slice(0, 40)));
      if (missing.length) { jot(`ABORT ${tag} — ข้อความเข้าไม่ครบ ขาด ${missing.length}/${lines.length} บรรทัด ไม่กดส่ง`); break; }

      await page.keyboard.press("Enter");
      await wait(6000);

      // --- ตรวจหลังส่ง: กล่องต้องว่าง และข้อความต้องอยู่นอกกล่อง ---
      // (เช็กแค่ dialog.innerText หลอกได้ — ถ้า Enter ไม่ทำงาน ข้อความยังค้างในกล่องซึ่งอยู่ใน dialog เหมือนกัน)
      const ok = await page.evaluate(({ probe, findSrc }) => {
        const box = eval(findSrc)();
        const dlg = box && box.closest('div[role="dialog"]');
        if (!dlg) return false;
        const inBox = (box.innerText || "").includes(probe);
        const all = dlg.innerText.split(probe).length - 1;
        return !inBox && all > 0;
      }, { probe: lines[0].slice(0, 40), findSrc: `(${findBox.toString()})` });

      if (!ok) { jot(`⚠️ ${tag} — กด Enter แล้วแต่ยังไม่เห็นคอมเมนต์บนหน้า ต้องเช็กมือ ${url}`); continue; }

      fs.appendFileSync(DONE, `${it.id}\t${stamp()}\t${flat(it.who)}\n`);
      try {   // ลบร่างที่ส่งแล้วออกจากไฟล์ทันที
        const rest = JSON.parse(fs.readFileSync(FILE, "utf8")).filter((d) => d.id !== it.id);
        fs.writeFileSync(FILE, JSON.stringify(rest, null, 1) + "\n");
      } catch (e) { jot(`⚠️ ลบร่าง ${it.id} ไม่สำเร็จ — ${e.message} — ต้องล้างมือ ไม่งั้นฝั่งกลุ่มค้าง`); }
      // replies.tsv: เวลา⇥ชื่อ⇥url⇥(ว่าง)⇥ข้อความเรา⇥เรื่องของโพสต์⇥ลิงก์ — ห้ามมีขึ้นบรรทัดใหม่ในช่อง
      fs.appendFileSync(REPLIES, [stamp(), flat(it.who), url, "", flat(it.text), flat(it.topic) || "คอมเมนต์ใต้โพสต์ในกลุ่ม", link].join("\t") + "\n");
      if (link) fs.appendFileSync(SHOPEE_LOG, [stamp(), GID, url, link, flat(it.product), `g${GID}`].join("\t") + "\n");
      jot(`SENT ${flat(it.who)} ${url}${link ? " 🔗" : ""}`);
    } catch (e) {
      jot(`ERROR ${tag} — ${e.message}`);
    }
    if (i < items.length - 1) {
      const s = Math.round(MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP));
      console.log(`  … พัก ${s} วิ`);
      await wait(s * 1000);
    }
  }
  if (borrowed) await page.goto(HOST, { waitUntil: "domcontentloaded" }).catch(() => {});
  else await page.close();
  process.exit(0);
})().catch((e) => { jot(`FATAL ${e.message}`); process.exit(1); });
