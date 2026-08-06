// Read-only: ไล่ฟีดโปรไฟล์เจ้าของเพจ คืนโพสต์+รีลที่โพสต์ภายใน N วัน (ค่าเริ่มต้น 7)
//   node fb-recent.js [วัน]   →  JSON [{url,type,age,ageDays,text}]
//
// ใช้ฟีดโปรไฟล์ ไม่ใช่ Content Library เพราะ Content Library ไม่มี permalink (เป็น onclick)
// ต้องสะสมทุกรอบที่เลื่อน — FB ถอด article ที่พ้นจอออกจาก DOM (virtualization)
// ถ้าอ่านแค่ snapshot สุดท้ายจะได้โพสต์เดียว
const { chromium } = require("playwright-core");
const fs = require("fs");
const args = process.argv.slice(2);
const PICK = args.includes("--pick") ? +args[args.indexOf("--pick") + 1] : 0;
const UNSWEEP = args.includes("--unsweep") ? args[args.indexOf("--unsweep") + 1] : "";
const DAYS = +(args.find((a) => /^\d+$/.test(a)) || 7);
const LEDGER = process.env.HOME + "/fb-hub/state/swept.tsv";
const HANDLE = process.env.FB_HANDLE;   // ชื่อผู้ใช้ในลิงก์โปรไฟล์ เช่น facebook.com/<handle>
const ME = process.env.FB_NAME;         // ชื่อที่ Facebook แสดงบนคอมเมนต์ของเรา
const PROFILE = "https://www.facebook.com/" + HANDLE;
if (!HANDLE || !ME) { console.error("ERR ยังไม่ได้ตั้ง FB_HANDLE / FB_NAME ใน ~/fb-hub/.env"); process.exit(1); }
const UNIT = { "นาที": 0, "ชม.": 1 / 24, "ชั่วโมง": 1 / 24, "วัน": 1, "สัปดาห์": 7 };
// Facebook แสดงเวลาแบบ "3 วัน" เฉพาะโพสต์ใหม่ ๆ · เก่ากว่านั้นเปลี่ยนเป็นวันที่จริง ("17 มิถุนายน")
// อ่านเวลาไม่ออก = เก่ากว่า 1 สัปดาห์ ต้องตีเป็นของเก่าไว้ก่อน ห้ามตีเป็น 0
// (บั๊กจริง 5 ส.ค. 69: โพสต์ 17 มิ.ย. ถูกนับเป็นอายุ 0 วัน แล้วเด้งขึ้นหัวคิว
//  บอทเกือบไปตอบ "ทันไหมครับ" ของคลาสที่จัดจบไปแล้ว 7 สัปดาห์)
const ageOf = (r) => (r.n < 0 ? 999 : (UNIT[r.unit] ?? 999) * r.n);

// ถอนโพสต์ออกจาก ledger — ใช้เมื่อกวาดโพสต์นั้นไม่จบ (ชนโควตา 5 คน ยังเหลือคนค้าง)
// ไม่งั้นโพสต์ที่มีคนรออยู่จะถูกมาร์กว่า "กวาดแล้ว" แล้วหล่นท้ายคิวไปอีก 5 ชั่วโมง
// (เกิดจริง 5 ส.ค. 69: reel 1425699882731213 ตอบ 5 เหลือ 12 คน แล้วคิวหมุนหนี)
if (UNSWEEP) {
  const seen = {};
  try {
    for (const l of fs.readFileSync(LEDGER, "utf8").split("\n"))
      if (l.trim()) { const [u, t] = l.split("\t"); seen[u] = +t; }
  } catch {}
  delete seen[UNSWEEP.split("?")[0].replace(/\/$/, "")];
  fs.writeFileSync(LEDGER, Object.entries(seen).map(([u, t]) => u + "\t" + t).join("\n") + "\n");
  console.log("ถอนออกจากคิวแล้ว จะถูกหยิบก่อนในรอบหน้า");
  process.exit(0);
}

(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = await b.contexts()[0].newPage();
  await page.setViewportSize({ width: 1500, height: 2000 });
  await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000);

  const found = new Map();
  let oldest = 0;
  for (let pass = 0; pass < 15 && oldest <= DAYS; pass++) {
    const rows = await page.evaluate(() => {
      return [...document.querySelectorAll("div[role=article]")].map((a) => {
        const url = [...a.querySelectorAll("a[href]")].map((x) => x.href)
          .filter((h) => /\/(reel|posts|videos|permalink)\//.test(h) && !/comment_id/.test(h))[0];
        if (!url) return null;
        const txt = a.innerText || "";
        const author = (txt.split("\n").filter(Boolean)[0] || "").trim();
        const m = txt.replace(/\s+/g, " ").match(/(\d+)\s*(นาที|ชม\.|ชั่วโมง|วัน|สัปดาห์)/);
        return {
          url: url.split("?")[0].replace(/\/$/, ""),
          type: /\/reel\//.test(url) ? "reel" : "post",
          author,
          age: m ? m[0] : "", unit: m ? m[2] : "", n: m ? +m[1] : -1,
          text: txt.split("\n").filter(Boolean).slice(2).join(" ").replace(/\s+/g, " ").slice(0, 400),
        };
      }).filter(Boolean);
    });
    // เฉพาะโพสต์ของเจ้าของเพจเอง — ฟีดโปรไฟล์มีโพสต์ของเพื่อนที่แท็กถึงปนมาด้วย
    // รีลไม่มีชื่อผู้ใช้ใน url เลยต้องดูจากชื่อผู้เขียนในการ์ด
    for (const r of rows)
      if (!found.has(r.url) && (r.author === ME || r.url.includes("/" + HANDLE + "/"))) found.set(r.url, r);
    // นับเฉพาะโพสต์ที่อ่านเวลาออก — ถ้าเอา 999 มาคิดด้วย การ์ดเดียวที่อ่านไม่ออกจะหยุดการเลื่อนทันที
    oldest = Math.max(...[...found.values()].filter((r) => r.n >= 0).map(ageOf), 0);
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(2800);
  }

  const out = [...found.values()]
    .map((r) => ({ url: r.url, type: r.type, author: r.author, age: r.age || "เก่ากว่า 1 สัปดาห์", ageDays: +ageOf(r).toFixed(1), text: r.text }))
    .filter((r) => r.ageDays <= DAYS)
    .sort((a, c) => a.ageDays - c.ageDays);
  if (!PICK) {
    console.log(JSON.stringify(out, null, 1));
  } else {
    // เลือกโพสต์ที่จะกวาดรอบนี้ — ทำให้เป็นกติกาตายตัว ไม่ปล่อยให้ LLM คิดคิวเอง
    // โพสต์ใหม่ (< 1 วัน) มาก่อนเสมอ เพราะคอมเมนต์เข้าเร็วสุด
    // ที่เหลือเรียงตาม "กวาดครั้งล่าสุดนานสุด" — ของเก่าเลยไม่มีวันโดนลืม
    const seen = {};
    try {
      for (const l of fs.readFileSync(LEDGER, "utf8").split("\n"))
        if (l.trim()) { const [u, t] = l.split("\t"); seen[u] = +t; }
    } catch {}
    // โพสต์ที่ตั้งไว้ใน config/post-notes.tsv (มีของแจก/ลิงก์ขาย) = สำคัญสุด แซงทุกอย่าง
    // ไม่งั้นโพสต์ขายอายุ 7 วันจะแพ้โพสต์ใหม่ที่ไม่มีคอมเมนต์เลย ตลอดกาล
    const noted = new Set();
    try {
      for (const l of fs.readFileSync(process.env.HOME + "/fb-hub/config/post-notes.tsv", "utf8").split("\n"))
        if (l.trim() && !l.startsWith("#")) noted.add(l.split("\t")[0].trim());
    } catch {}
    const score = (r) => (noted.has(r.url) ? -1e15 : r.ageDays < 1 ? -1e12 : 0) + (seen[r.url] || 0);

    // ยัดโพสต์ที่พี่สั่งเข้าลิสต์ตรง ๆ ถ้าการไล่ฟีดรอบนี้หาไม่เจอ
    // (โพสต์เก่าอยู่ท้ายฟีด บางรอบเลื่อนไปไม่ถึง — จะหายจากคิวทั้งที่มีคนรอตอบอยู่)
    const have = new Set(out.map((r) => r.url));
    for (const u of noted)
      if (!have.has(u)) out.push({ url: u, type: /\/reel\//.test(u) ? "reel" : "post", author: ME, age: "ตั้งไว้ใน post-notes", ageDays: 0, text: "(โพสต์ที่ตั้งไว้ใน config/post-notes.tsv — อ่านเนื้อโพสต์จากหน้าจริงตอนเปิด)" });

    const pick = out.sort((a, c) => score(a) - score(c)).slice(0, PICK);
    const now = Math.floor(Date.now() / 1000);
    for (const r of pick) seen[r.url] = now;
    fs.writeFileSync(LEDGER, Object.entries(seen).map(([u, t]) => u + "\t" + t).join("\n") + "\n");
    console.log(JSON.stringify(pick, null, 1));
  }
  await page.close(); b.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
