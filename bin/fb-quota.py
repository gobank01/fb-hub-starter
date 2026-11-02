#!/usr/bin/env python3
"""
fb-quota.py — เพดานจำนวนคอมเมนต์ กัน Facebook มองว่าเป็นสแปม

    python3 ~/fb-hub/bin/fb-quota.py
    OK 4/12 ชม. (เหลือชั่วโมงนี้ 8)      -> ตอบต่อได้      exit 0
    FULL 12/12 รอถึง 14:37               -> หยุดรอบทันที    exit 1
    FULL วันนี้ 150/150 รอพรุ่งนี้        -> หมดโควตาวัน    exit 1

บอทต้องเรียกก่อนพิมพ์ทุกคน (prompts/comment-watch.txt สั่งไว้แล้ว)
ตั้งเพดานใน ~/fb-hub/.env:
    MAX_PER_HOUR=12      ต่อชั่วโมง (ย้อนหลัง 60 นาที ไม่ใช่ชั่วโมงตามนาฬิกา)
    MAX_PER_DAY=0        ต่อวันตามปฏิทิน (0 = ไม่จำกัด)

นับจาก ~/fb-hub/state/progress.log เฉพาะบรรทัดที่ขึ้นต้นด้วย "SENT " หลังเวลา
บรรทัดสรุปรอบที่บังเอิญมีคำว่า SENT อยู่กลางบรรทัด "ไม่นับ" (บั๊กจริง: 178 บรรทัดสรุปถูกนับ
เป็นการส่ง → โควตาหลอกว่าเต็มตอนโพสต์ระเบิด ซึ่งเป็นช่วงที่ต้องตอบมากที่สุด)

อ่าน ledger ไม่ได้ = FULL (ไม่รู้ว่าส่งไปกี่อัน ก็ห้ามส่ง)
เช็กตัวเอง: python3 ~/fb-hub/bin/fb-quota.py --demo
"""
import os
import re
import sys
from datetime import datetime, timedelta

LEDGER = os.path.expanduser("~/fb-hub/state/progress.log")
WINDOW = timedelta(hours=1)

FULL_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s+(.*)$")
SEND_RE = re.compile(r"^SENT\s")


def _load_env():
    """เรียกตรงจาก ssh ก็อ่านเพดานจาก .env ได้ ไม่ต้อง source ก่อน"""
    try:
        for line in open(os.path.expanduser("~/fb-hub/.env"), encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.split(" #")[0].strip().strip("\"'"))
    except OSError:
        pass


def _int(name, default):
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def sent_times(text):
    for line in text.splitlines():
        m = FULL_RE.match(line)
        if not m or not SEND_RE.match(m.group(3)):
            continue
        hhmm = m.group(2) + (":00" if len(m.group(2)) == 5 else "")
        try:
            yield datetime.strptime(f"{m.group(1)} {hhmm}", "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue


def check(text, now, per_hour=12, per_day=0):
    mine = list(sent_times(text))
    recent = sorted(t for t in mine if timedelta(0) <= now - t < WINDOW)
    today = [t for t in mine if t.date() == now.date()]
    # ด่านวันมาก่อน — เต็มวันแล้วบอกให้รอพรุ่งนี้ ไม่ใช่ให้รออีกชั่วโมงแล้วมาเจอเต็มซ้ำ
    if per_day and len(today) >= per_day:
        return False, f"FULL วันนี้ {len(today)}/{per_day} รอพรุ่งนี้"
    if len(recent) >= per_hour:
        free_at = recent[-per_hour] + WINDOW
        return False, f"FULL {len(recent)}/{per_hour} รอถึง {free_at:%H:%M} แล้วค่อยตอบต่อ"
    day = f" · วันนี้ {len(today)}/{per_day}" if per_day else ""
    return True, f"OK {len(recent)}/{per_hour} ชม.{day} (เหลือชั่วโมงนี้ {per_hour - len(recent)})"


def demo():
    now = datetime(2026, 8, 8, 12, 0, 0)
    U = "https://f.com/x"
    lines = [f"2026-08-08 11:{5 + i * 4:02d}:00 SENT คน{i} {U}" for i in range(11)]
    lines.append(f"2026-08-08 10:00:00 SENT คนเก่า {U}")             # เกินหน้าต่าง ไม่นับ
    ok, msg = check("\n".join(lines), now)
    assert ok and "11/12" in msg, msg
    lines.append(f"2026-08-08 11:50:00 SENT คนสุดท้าย {U}")
    ok, msg = check("\n".join(lines), now)
    assert not ok and "FULL 12/12" in msg and "12:05" in msg, msg
    fake = "2026-08-08 11:30:00 ROUND สรุป: ตอบ 3 คน RESULT: SENT 3"
    ok, msg = check(fake, now)
    assert ok and "0/12" in msg, "บรรทัดสรุปรอบต้องไม่นับ"
    day = [f"2026-08-08 {h:02d}:00:00 SENT ก{h} {U}" for h in range(10)]
    ok, msg = check("\n".join(day), now, per_day=10)
    assert not ok and "รอพรุ่งนี้" in msg, msg
    ok, msg = check("\n".join(x.replace("08-08", "08-07") for x in day), now, per_day=10)
    assert ok, "ของเมื่อวานไม่นับรวมวันนี้"
    ok, msg = check("", now)
    assert ok and "วันนี้" not in msg
    print("✅ fb-quota demo ผ่าน")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
        sys.exit(0)
    _load_env()
    try:
        body = open(LEDGER, encoding="utf-8").read()
    except OSError as e:
        print(f"FULL อ่าน ledger ไม่ได้ ({e}) — ไม่รู้ว่าส่งไปกี่อัน ก็ห้ามส่ง")
        sys.exit(1)
    ok, msg = check(body, datetime.now(), _int("MAX_PER_HOUR", 12), _int("MAX_PER_DAY", 0))
    print(msg)
    sys.exit(0 if ok else 1)
