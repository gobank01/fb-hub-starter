// ลิสต์โพสต์ "ห้ามตอบ" — เจ้าของเพจสั่งหยุดตอบโพสต์ไหน ใส่ลิงก์ลง ~/fb-hub/config/no-reply.txt
//   บรรทัดละ 1 ลิงก์ · หมายเหตุต่อท้ายหลังช่องว่างได้ · บรรทัดที่ขึ้นต้นด้วย # = หมายเหตุ
//
//   node ~/fb-hub/bin/no-reply.js <url>   → exit 1 + พิมพ์บรรทัดที่ตรง = ห้ามตอบ · exit 0 = ตอบได้
//   node ~/fb-hub/bin/no-reply.js --demo
//
// ทำไมต้องเป็นไฟล์ ไม่ใช่บอกบอทในแชท: ระบบต้นแบบเคยมีโพสต์ที่เจ้าของสั่ง "ห้ามเม้น" ด่วน
// แต่คำสั่งไปไม่ถึงบอท → บอทตอบไปอีกหลายคนบนโพสต์สาธารณะ · ไฟล์นี้ fb-recent.js กับ prompt อ่านทุกรอบ
//
// ลิงก์ FB โพสต์เดียวมีได้หลายหน้าตา (pfbid… / เลข story / ?v= / มีหรือไม่มี www) → เทียบด้วย "token"
const fs = require("fs");
const FILE = process.env.HOME + "/fb-hub/config/no-reply.txt";

function tokensOf(url) {
  const s = String(url || "");
  const out = new Set();
  for (const m of s.matchAll(/pfbid[0-9A-Za-z]{10,}/g)) out.add("pfbid:" + m[0]);
  for (const m of s.matchAll(/(?:[?&](?:v|story_fbid|fbid|id)=|\/(?:posts|videos|reel|permalink)\/)(\d{8,})/g)) out.add("id:" + m[1]);
  return out;
}

function noReplyHit(url, file = FILE) {
  let lines;
  try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch { return null; }
  const mine = tokensOf(url);
  if (!mine.size) return null;
  for (const l of lines) {
    const s = l.trim();
    if (!s || s.startsWith("#")) continue;
    for (const t of tokensOf(s.split(/\s+/)[0])) if (mine.has(t)) return s;
  }
  return null;
}

module.exports = { tokensOf, noReplyHit };

if (require.main === module) {
  const a = process.argv[2];
  if (a === "--demo") {
    const assert = require("assert");
    const os = require("os"), path = require("path");
    const f = path.join(os.tmpdir(), "no-reply-demo.txt");
    fs.writeFileSync(f, "# หมายเหตุ\nhttps://www.facebook.com/joe/posts/pfbid0AbCdEfGhIjKlMnOp  ดราม่า\nhttps://www.facebook.com/watch/?v=1234567890123\n");
    assert.ok(noReplyHit("https://facebook.com/joe/posts/pfbid0AbCdEfGhIjKlMnOp/?comment_id=1", f), "ลิงก์เดิมมีพารามิเตอร์ต้องโดน");
    assert.ok(noReplyHit("https://www.facebook.com/reel/1234567890123", f), "รีลเลขเดียวกันต้องโดน");
    assert.strictEqual(noReplyHit("https://www.facebook.com/joe/posts/pfbid0Zzzzzzzzzzzzzzz", f), null, "โพสต์อื่นต้องไม่โดน");
    assert.strictEqual(noReplyHit("https://www.facebook.com/joe/posts/pfbid0AbCdEfGhIjKlMnOp", f + ".missing"), null, "ไม่มีไฟล์ = ไม่ห้าม");
    fs.unlinkSync(f);
    console.log("✅ no-reply demo ผ่าน");
    process.exit(0);
  }
  if (!a) { console.error("ใช้: node no-reply.js <url>"); process.exit(2); }
  const hit = noReplyHit(a);
  if (hit) { console.log("ห้ามตอบ: " + hit); process.exit(1); }
  console.log("ตอบได้");
}
