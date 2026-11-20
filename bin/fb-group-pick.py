#!/usr/bin/env python3
"""เลือกว่าชั่วโมงนี้จะไปคอมเมนต์กลุ่มไหน — ตามน้ำหนักใน ~/fb-hub/config/groups.tsv

    fb-group-pick.py            → "<group_id>\\t<ชื่อกลุ่ม>"  ของชั่วโมงนี้   (exit 1 = ยังไม่ได้ตั้งกลุ่ม)
    fb-group-pick.py --hour 10  → ของชั่วโมงที่ 10
    fb-group-pick.py --table    → ตาราง 24 ชั่วโมงว่าได้กลุ่มไหน (เช็กสัดส่วนก่อนเปิดจริง)
    fb-group-pick.py --demo     → เช็กตัวเอง

ไม่สุ่ม — เลือกด้วย smooth weighted round-robin ตามชั่วโมงของวัน
นับเฉพาะชั่วโมงที่ทำงาน (ข้ามช่วงงด GROUP_QUIET_FROM–GROUP_QUIET_TO) ไม่งั้นกลุ่มเล็กไปตกช่วงงดแล้วไม่ได้รอบเลย
ทำซ้ำได้ ทดสอบได้ ไม่ต้องเก็บตัวนับ (ระบบต้นแบบใช้ "ชั่วโมงหาร 5 ลงตัว = กลุ่มรอง" แบบเดียวกัน)
"""
import os, sys
from datetime import datetime

GROUPS = os.path.expanduser("~/fb-hub/config/groups.tsv")


def parse(text):
    out = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        f = line.split("\t") + [""] * 4
        gid, name = f[0].strip(), f[1].strip()
        if not gid.isdigit():
            continue          # กันคนพิมพ์ช่องว่างแทน TAB หรือใส่ลิงก์ทั้งเส้น
        try:
            w = max(0, int(f[2].strip() or 1))
        except ValueError:
            w = 1
        if w:
            out.append((gid, name or gid, w))
    return out


def pick(groups, hour):
    """smooth weighted round-robin เดิน hour+1 ก้าวจาก 0 → กระจายตัว ไม่จับกลุ่มเดียวติดกันยาว"""
    cur = [0] * len(groups)
    total = sum(w for _, _, w in groups)
    best = 0
    for _ in range(hour + 1):
        for i, (_, _, w) in enumerate(groups):
            cur[i] += w
        best = max(range(len(groups)), key=lambda i: cur[i])
        cur[best] -= total
    return groups[best]


def _quiet():
    try:
        return int(os.environ.get("GROUP_QUIET_FROM", "1")), int(os.environ.get("GROUP_QUIET_TO", "6"))
    except ValueError:
        return 1, 6


def slot(hour, qf, qt):
    """ชั่วโมงนี้เป็นรอบที่เท่าไหร่ของวัน (นับเฉพาะชั่วโมงทำงาน) · None = อยู่ในช่วงงด"""
    quiet = lambda h: qf <= h <= qt
    return None if quiet(hour) else sum(not quiet(h) for h in range(hour))


def demo():
    g = parse("# x\n111\tA\t4\tyes\n222\tB\t1\tno\nlink ผิด\tC\t9\n333 D 1\n")
    assert [x[0] for x in g] == ["111", "222"], g
    hours = [pick(g, h)[0] for h in range(24)]
    assert 18 <= hours.count("111") <= 20 and 4 <= hours.count("222") <= 6, hours
    assert all(pick(g, h) == pick(g, h) for h in range(24)), "ต้องทำซ้ำได้"
    assert pick(parse("555\tเดี่ยว\t1\n"), 13)[0] == "555"
    assert parse("") == []
    act = [slot(h, 1, 6) for h in range(24)]
    assert act[3] is None and act[0] == 0 and act[7] == 1 and act[23] == 17
    busy = [pick(g, act[h])[0] for h in range(24) if act[h] is not None]
    assert len(busy) == 18 and 3 <= busy.count("222") <= 4, busy
    print("✅ fb-group-pick demo ผ่าน")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["--demo"]:
        demo(); sys.exit(0)
    try:
        groups = parse(open(GROUPS, encoding="utf-8").read())
    except OSError:
        groups = []
    if not groups:
        print(f"ยังไม่ได้ตั้งกลุ่ม — คัดลอก config/groups.tsv.example เป็น {GROUPS} แล้วเติมกลุ่ม", file=sys.stderr)
        sys.exit(1)
    qf, qt = _quiet()
    if a[:1] == ["--table"]:
        for h in range(24):
            s = slot(h, qf, qt)
            print(f"{h:02d}:00  " + ("(งดช่วงคนนอน)" if s is None else "{1} ({0})".format(*pick(groups, s))))
        sys.exit(0)
    h = int(a[1]) if a[:1] == ["--hour"] and len(a) > 1 else datetime.now().hour
    gid, name, _ = pick(groups, slot(h, qf, qt) or 0)
    print(f"{gid}\t{name}")
