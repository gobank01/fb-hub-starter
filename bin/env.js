// env.js — โหลด ~/fb-hub/.env ให้สคริปต์ node ที่รันมือ (ตาม SOP) ได้ค่าเดียวกับตอนรันผ่านคิว
//   require("./env.js")   — ค่าที่มีอยู่แล้วใน environment ชนะเสมอ (คิว/ตัวจับเวลา source ไว้แล้ว)
// ไม่โหลดแล้ว FB_NAME ว่าง → สคริปต์บอก "ยังไม่ได้ตั้ง FB_NAME" ทั้งที่ตั้งไว้แล้ว (เจอตอนซ้อมบนเครื่องจริง)
const fs = require("fs");
const FILE = `${process.env.HOME}/fb-hub/.env`;
try {
  for (const raw of fs.readFileSync(FILE, "utf8").split(/\r?\n/)) {
    if (!raw.includes("=") || /^\s*#/.test(raw)) continue;
    const k = raw.slice(0, raw.indexOf("=")).trim();
    let v = raw.slice(raw.indexOf("=") + 1).replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
} catch (e) { /* ไม่มีไฟล์ = ใช้ค่าจาก environment อย่างเดียว */ }
module.exports = { ENV_FILE: FILE };
