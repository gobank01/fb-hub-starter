#!/usr/bin/env python3
"""ส่งแจ้งเตือนแบบกันซ้ำ — เรื่องเดิม (หัวข้อเดิม) ส่งได้ครั้งเดียวทุก 6 ชม.

    python3 ~/fb-hub/bin/notify-once.py "<หัวข้อสั้น>" "<ข้อความ>"
    python3 ~/fb-hub/bin/notify-once.py --demo

ทำไม: เรื่องที่ค้างนาน (ล็อกอินหลุด, Claude ติดลิมิต) ถ้ายิงทุกรอบจะยิงเป็นร้อยครั้ง/วัน
→ คนปิดเสียง → ของจริงหลุด · "เตือนรัวจนโดนปิดเสียง อันตรายกว่าไม่เตือน"

กันซ้ำด้วย "หัวข้อ" ไม่ใช่ข้อความ — ตัวเลขในหัวข้อถูกตัดทิ้ง ("ค้าง 38 คน" = "ค้าง 40 คน")
หัวข้อที่ AI แต่งเองคำไม่เคยซ้ำ → เรื่องที่รู้จักแปลงเป็นรหัสตายตัวผ่าน CODES ข้างล่าง
(เคยเกิดจริง: เรื่องเดียวกันถูก AI เขียน 20 แบบใน 2 วัน = เตือน ~11 ครั้ง/วัน)
"""
import json, os, re, subprocess, sys, time

HUB = os.path.expanduser("~/fb-hub")
STATE = os.path.join(HUB, "state/notify-once.json")
HOURS = 6

# เติมแถวได้ — เรื่องที่ AI เตือนบ่อยด้วยคำไม่ซ้ำ
CODES = [
    ("login-lost", r"ล็อกอินหลุด|login.?lost|เข้าสู่ระบบ"),
    ("reel-scan", r"(รีล|reel).*(สแกน|โหลด|กล่องคอมเมนต์)|(สแกน|โหลด).*(รีล|reel)"),
    ("load-incomplete", r"โหลดไม่ครบ|สแกนไม่จบ"),
    ("chrome-down", r"chrome.*(ไม่ตอบ|ไม่ได้เปิด|ต่อไม่ได้)"),
    ("claude-limit", r"limit|ลิมิต|oauth|expired|ล็อกอิน claude"),
]


def keys(topic):
    t = re.sub(r"\d+", "#", topic.strip())
    ks = [c for c, rx in CODES if re.search(rx, t, re.I)]
    return ks or [t]


def due(state, topic, now):
    ks = keys(topic)
    return any((now - state.get(k, 0)) / 3600 >= HOURS for k in ks), ks


def main(topic, msg):
    try:
        state = json.load(open(STATE))
    except (OSError, ValueError):
        state = {}
    now = time.time()
    ok, ks = due(state, topic, now)
    if not ok:
        print(f"ข้าม — เรื่องนี้เพิ่งเตือนไปไม่ถึง {HOURS} ชม.: {ks}")
        return 0
    r = subprocess.run([sys.executable, os.path.join(HUB, "bin/notify.py"), msg])
    if r.returncode == 0:      # ส่งถึงก่อน ค่อยจดว่าเตือนแล้ว — ส่งไม่ถึงต้องลองใหม่รอบหน้า
        state.update({k: now for k in ks})
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        json.dump({k: v for k, v in state.items() if now - v < 7 * 86400}, open(STATE, "w"), ensure_ascii=False)
    return r.returncode


def demo():
    now = 1_000_000
    ok, k = due({}, "คนค้าง 38 คน โพสต์ #ของแจก", now)
    assert ok and k == ["คนค้าง # คน โพสต์ #ของแจก"], k
    assert not due({k[0]: now - 3600}, "คนค้าง 40 คน โพสต์ #ของแจก", now)[0], "ตัวเลขเปลี่ยน = เรื่องเดิม"
    assert due({k[0]: now - 7 * 3600}, "คนค้าง 40 คน โพสต์ #ของแจก", now)[0], "ครบ 6 ชม. ยิงซ้ำได้"
    for t in ["รีล 3 อันสแกนไม่ได้", "Reels 2 อันโหลดคอมเมนต์ไม่ขึ้น", "สแกนรีลไม่เจอกล่องคอมเมนต์"]:
        assert keys(t) == ["reel-scan"], (t, keys(t))
    assert keys("⚠️ บอท FB หยุด — ล็อกอินหลุด") == ["login-lost"]
    assert keys("You've hit your session limit · resets 2:40pm") == ["claude-limit"]
    st = {"reel-scan": now - 60}
    assert not due(st, "รีล 3 อันสแกนไม่ได้", now)[0], "คำต่างแต่เรื่องเดิม = ไม่ยิงซ้ำ"
    assert due(st, "รีลสแกนไม่ได้ + โหลดไม่ครบ", now)[0], "มีเรื่องใหม่พ่วง = ยิง"
    print("✅ notify-once demo ผ่าน")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--demo":
        sys.exit(demo())
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
