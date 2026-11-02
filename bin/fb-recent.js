// Read-only: ไล่ฟีดโปรไฟล์เจ้าของเพจ คืนโพสต์+รีลที่โพสต์ภายใน N วัน (ค่าเริ่มต้น 7)
//   node fb-recent.js [วัน]          →  JSON [{url,type,age,ageDays,text}]
//   node fb-recent.js --pick 4       →  เลือกโพสต์ที่จะกวาดรอบนี้ (จดคิวใน state/swept.tsv)
//   node fb-recent.js --unsweep <url> →  ถอนโพสต์ออกจากคิว (กวาดไม่จบ ให้รอบหน้าหยิบก่อน)
//   node fb-recent.js --demo         →  เทสต์กติกาเลือกคิว (ไม่เปิดเบราว์เซอร์)
//
// ใช้ฟีดโปรไฟล์ ไม่ใช่ Content Library เพราะ Content Library ไม่มี permalink (เป็น onclick)
// ต้องสะสมทุกรอบที่เลื่อน — FB ถอด article ที่พ้นจอออกจาก DOM (virtualization)
// ถ้าอ่านแค่ snapshot สุดท้ายจะได้โพสต์เดียว
const fs = require("fs");
const { noReplyHit } = require("./no-reply.js");
const args = process.argv.slice(2);
const PICK = args.includes("--pick") ? +args[args.indexOf("--pick") + 1] : 0;
const UNSWEEP = args.includes("--unsweep") ? args[args.indexOf("--unsweep") + 1] : "";
// ตัวเลขเดี่ยว = จำนวนวัน · ยกเว้นตัวเลขที่ตามหลัง --pick
// (บั๊กจริง: "--pick 3" ทำให้ช่วงฟีดกลายเป็น 3 วัน โพสต์อายุ 4–7 วันหายจากคิวเงียบ ๆ)
const daysArg = (a) => +(a.find((x, i) => /^\d+$/.test(x) && a[i - 1] !== "--pick") || 7);
const DAYS = daysArg(args);
const LEDGER = process.env.HOME + "/fb-hub/state/swept.tsv";
const HANDLE = process.env.FB_HANDLE;   // ชื่อผู้ใช้ในลิงก์โปรไฟล์ เช่น facebook.com/<handle>
const ME = process.env.FB_NAME;         // ชื่อที่ Facebook แสดงบนคอมเมนต์ของเรา
const PROFILE = "https://www.facebook.com/" + HANDLE;
if (!args.includes("--demo") && (!HANDLE || !ME)) { console.error("ERR ยังไม่ได้ตั้ง FB_HANDLE / FB_NAME ใน ~/fb-hub/.env"); process.exit(1); }
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
  // ลบทั้งแบบมี/ไม่มี / ท้าย — url จาก post-notes.tsv อาจมี / ท้าย (เดิมลบไม่ออกแต่บอกว่าถอนแล้ว)
  const key = UNSWEEP.split("?")[0].replace(/\/$/, "");
  delete seen[key];
  delete seen[key + "/"];
  fs.writeFileSync(LEDGER, Object.entries(seen).map(([u, t]) => u + "\t" + t).join("\n") + "\n");
  console.log("ถอนออกจากคิวแล้ว จะถูกหยิบก่อนในรอบหน้า");
  process.exit(0);
}

// เลือกโพสต์ที่จะกวาดรอบนี้ — กติกาตายตัว ไม่ปล่อยให้ AI คิดคิวเอง
// 1) โพสต์ใน config/post-notes.tsv (มีของแจก/ลิงก์) ได้ไม่เกินครึ่งรอบ และอยู่ท้ายรอบ
//    (บั๊กจริงของระบบต้นแบบ: notes 9 โพสต์ชนะทุกอย่าง แต่เลือกรอบละ 8 → โพสต์ปกติ 35 โพสต์
//     ไม่ถูกกวาดเลย 3 วัน คอมเมนต์ 85 อันไม่มีใครเปิดดู)
// 2) โพสต์ใหม่ < 1 วันแซงคิวได้ เฉพาะตอนไม่ได้กวาดมาเกิน FRESH_GAP (ไม่งั้นโพสต์ใหม่กินทุกช่องทุกรอบ)
// 3) ที่เหลือเรียงตาม "กวาดครั้งล่าสุดนานสุด" — ของเก่าไม่มีวันโดนลืม
const FRESH_GAP = 9000;   // วินาที (150 นาที)
function choose(out, seen, noted, n, now = Date.now() / 1000) {
  const stale = (r) => seen[r.url] || 0;
  const byStale = (a, c) => stale(a) - stale(c);
  const pinned = out.filter((r) => noted.has(r.url)).sort(byStale);
  const plain = out.filter((r) => !noted.has(r.url));
  const jump = (r) => r.ageDays < 1 && now - stale(r) > FRESH_GAP;
  const fresh = plain.filter(jump).sort(byStale);
  const rest = plain.filter((r) => !jump(r)).sort(byStale);
  const pinSlots = Math.min(pinned.length, Math.floor(n / 2));
  const plainPick = [...fresh, ...rest].slice(0, n - pinSlots);
  const pinPick = pinned.slice(0, n - plainPick.length);
  return [...plainPick, ...pinPick];
}

if (args.includes("--demo")) {
  const assert = require("assert");
  const mk = (u, ageDays) => ({ url: u, ageDays });
  const noted = new Set(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"]);
  const out = [...noted].map((u) => mk(u, 0)).concat([mk("new1", 0.2), mk("old1", 3), mk("old2", 5), mk("old3", 6), mk("old4", 2)]);
  const seen = { old1: 100, old2: 50, old3: 300, old4: 200, n1: 10, n2: 20 };
  let p = choose(out, seen, noted, 8);
  assert.strictEqual(p.length, 8);
  assert.strictEqual(p.filter((r) => noted.has(r.url)).length, 4, "notes ได้ไม่เกินครึ่ง");
  assert.strictEqual(p[0].url, "new1", "โพสต์ใหม่ < 1 วันมาก่อน");
  assert.deepStrictEqual(p.slice(1, 4).map((r) => r.url), ["old2", "old1", "old4"], "ที่เหลือเรียงตามกวาดนานสุด");
  assert.ok(noted.has(p[4].url), "notes อยู่ท้ายรอบ");
  p = choose(out.filter((r) => noted.has(r.url) || r.url === "new1"), seen, noted, 8);
  assert.strictEqual(p.filter((r) => noted.has(r.url)).length, 7, "โพสต์ปกติน้อย = เติม notes จนเต็ม");
  const T = 1_000_000;
  const many = [mk("f1", 0.1), mk("f2", 0.3), mk("f3", 0.5), mk("o1", 3), mk("o2", 5)];
  const recent = { f1: T - 600, f2: T - 1200, f3: T - 1800, o1: 100, o2: 50 };
  p = choose(many, recent, new Set(), 3, T);
  assert.deepStrictEqual(p.slice(0, 2).map((r) => r.url), ["o2", "o1"], "โพสต์ใหม่เพิ่งกวาด = ไม่แซง");
  p = choose(many, { ...recent, f3: T - 10000 }, new Set(), 3, T);
  assert.strictEqual(p[0].url, "f3", "โพสต์ใหม่ไม่ได้กวาดเกิน 150 นาที = แซงได้");
  assert.strictEqual(daysArg(["--pick", "8"]), 7, "--pick 8 ต้องไม่กลายเป็นช่วง 8 วัน");
  assert.strictEqual(daysArg(["3"]), 3);
  console.log("✅ fb-recent demo ผ่าน");
  process.exit(0);
}

(async () => {
  const { chromium } = require("playwright-core");
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
    .filter((r) => !noReplyHit(r.url))   // config/no-reply.txt — เจ้าของสั่งห้ามตอบ ไม่หยิบเลย
    .sort((a, c) => a.ageDays - c.ageDays);
  if (!PICK) {
    console.log(JSON.stringify(out, null, 1));
  } else {
    // กติกาเลือกอยู่ใน choose() ข้างบน (เทสต์: node fb-recent.js --demo)
    const seen = {};
    try {
      for (const l of fs.readFileSync(LEDGER, "utf8").split("\n"))
        if (l.trim()) { const [u, t] = l.split("\t"); seen[u] = +t; }
    } catch {}
    // โพสต์ที่ตั้งไว้ใน config/post-notes.tsv (มีของแจก/ลิงก์ขาย) — ได้ช่องประจำครึ่งรอบ (ดู choose)
    const noted = new Set();
    try {
      for (const l of fs.readFileSync(process.env.HOME + "/fb-hub/config/post-notes.tsv", "utf8").split("\n"))
        if (l.trim() && !l.startsWith("#")) noted.add(l.split("\t")[0].trim());
    } catch {}
    // ยัดโพสต์ที่พี่สั่งเข้าลิสต์ตรง ๆ ถ้าการไล่ฟีดรอบนี้หาไม่เจอ
    // (โพสต์เก่าอยู่ท้ายฟีด บางรอบเลื่อนไปไม่ถึง — จะหายจากคิวทั้งที่มีคนรอตอบอยู่)
    const have = new Set(out.map((r) => r.url));
    for (const u of noted)
      if (!have.has(u)) out.push({ url: u, type: /\/reel\//.test(u) ? "reel" : "post", author: ME, age: "ตั้งไว้ใน post-notes", ageDays: 0, text: "(โพสต์ที่ตั้งไว้ใน config/post-notes.tsv — อ่านเนื้อโพสต์จากหน้าจริงตอนเปิด)" });

    const pick = choose(out.filter((r) => !noReplyHit(r.url)), seen, noted, PICK);
    const now = Math.floor(Date.now() / 1000);
    for (const r of pick) seen[r.url] = now;
    fs.writeFileSync(LEDGER, Object.entries(seen).map(([u, t]) => u + "\t" + t).join("\n") + "\n");
    console.log(JSON.stringify(pick, null, 1));
  }
  await page.close(); b.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
