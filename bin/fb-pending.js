// Read-only: ไล่โพสต์ 7 วันล่าสุด แล้วนับว่าโพสต์ไหนมีคนคอมเมนต์ที่ "เรายังไม่ได้ตอบ"
//   node fb-pending.js [วัน]
// ยืม lock ตัวเดียวกับ hub-run.sh — Chrome มีตัวเดียว สองงานขับพร้อมกันแล้วหน้าเว็บโดนปิดกลางคัน
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const ME = process.env.FB_NAME;
const DAYS = process.argv[2] || "7";

(async () => {
  // เรียกด้วย node ตัวเดียวกับที่กำลังรันอยู่ (process.execPath)
  // ห้ามฝัง /opt/homebrew/bin/node — เครื่องอื่นติดตั้ง node คนละที่
  const posts = JSON.parse(execFileSync(process.execPath, [__dirname + "/fb-recent.js", DAYS]).toString());
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = await b.contexts()[0].newPage();
  await page.setViewportSize({ width: 1500, height: 2200 });
  const out = [];

  for (const p of posts) {
    try {
      // หน้า /reel/ ไม่เรนเดอร์คอมเมนต์จนกว่าจะกดปุ่มเปิดแผง — ใช้ /watch/?v= แทน เห็นทันที
      // (บั๊กจริง 5 ส.ค. 69: สแกนรอบแรกรีลคืน 0 ทั้ง 7 อัน ทั้งที่มีคนรอตอบอยู่)
      const m = p.url.match(/\/reel\/(\d+)/);
      await page.goto(m ? "https://www.facebook.com/watch/?v=" + m[1] : p.url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(9000);
      for (let i = 0; i < 6; i++) {
        const n = await page.evaluate(() => {
          const bs = [...document.querySelectorAll("[role=button], span")]
            .filter((e) => /^ดูความคิดเห็นเพิ่มเติม|^ดูความคิดเห็นอีก|ความคิดเห็นก่อนหน้า/.test((e.textContent || "").trim()));
          bs.forEach((x) => x.click());
          return bs.length;
        });
        if (!n) break;
        await page.waitForTimeout(2200);
      }
      const r = await page.evaluate((me) => {
        const arts = [...document.querySelectorAll("div[role=\"article\"][aria-label^=\"ความคิดเห็นจาก\"]")];
        // จับกลุ่ม "คอมเมนต์หลัก + รีพลายของมัน" ด้วยการไต่ขึ้นไปหา container ที่มีหลาย article
        const groups = [];
        arts.forEach((a) => {
          let n = a;
          while (n.parentElement && !(n.parentElement.querySelectorAll("div[role=\"article\"][aria-label^=\"ความคิดเห็นจาก\"]").length > 3)) n = n.parentElement;
          if (!groups.includes(n)) groups.push(n);
        });
        const rows = [];
        for (const g of groups) {
          const art = g.querySelector("div[role=\"article\"][aria-label^=\"ความคิดเห็นจาก\"]");
          if (!art) continue;
          const name = (art.getAttribute("aria-label") || "").replace("ความคิดเห็นจาก", "").split(" เมื่อ")[0].trim();
          if (name === me) continue;
          const txt = (g.innerText || "").replace(/\n+/g, " | ");
          rows.push({ name, replied: /ดูการตอบกลับ|ซ่อนการตอบกลับ|" + ME + "/.test(txt) });
        }
        return { total: rows.length, waiting: rows.filter((x) => !x.replied).map((x) => x.name) };
      }, ME);
      out.push({ ...p, ...r });
      console.error(`  ${out.length}/${posts.length} ${r.waiting.length} รอ  ${p.url.slice(-18)}`);
    } catch (e) {
      out.push({ ...p, total: -1, waiting: [], err: e.message.slice(0, 60) });
    }
  }
  console.log(JSON.stringify(out, null, 1));
  await page.close(); b.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
