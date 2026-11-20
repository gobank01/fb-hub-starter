#!/usr/bin/env python3
"""fb-deadman.py — ตัวเฝ้า "งานที่ไม่เกิด" รันทุก 30 นาที

ทำไม: ตัวเฝ้าทั่วไปเฝ้า "งานที่เกิด" (error) — แต่บอทพังแบบเงียบได้โดยไม่มี error สักตัว
ระบบต้นแบบเคยค้าง 37 ชม. ทั้งที่ตัวจับเวลารายงาน exit 0 ทุกรอบ และส่งได้ 0 คอมเมนต์ 49 ชม.
ทั้งที่ Facebook/ล็อกอิน/Chrome ปกติ → วัดที่ "มีอะไรเกิดขึ้นไหม" ไม่ใช่ "มี error ไหม"

ตรวจ:
  1. รอบเฝ้าคอมเมนต์ (fbwatch-*) ไม่มีรอบจบใหม่เกิน 120 นาที — ตัวจับเวลาตาย/เครื่องหลับ/คิวค้าง
  2. รอบล่าสุดจบ exit ≠ 0 — Claude ติดลิมิต/ล็อกอิน Claude หลุด
  3. งานค้างสถานะ .running เกิน 120 นาที — แฮงค์คา Chrome
  4. Chrome ไม่ตอบที่พอร์ต 9222
  5. ดิสก์เหลือ < 10% — เต็มแล้ว Chrome/log/คิวพังพร้อมกัน
  6. ฝั่งกลุ่ม: รอบคอมเมนต์กลุ่มล่าสุด exit ≠ 0 · ตัวจับเวลากลุ่มเปิดอยู่แต่ log ไม่ขยับเกิน 60 นาที
  7. ซ้อม group-dry เสร็จเกิน 6 ชม. แล้วตัวจับเวลากลุ่มยังปิด (ลืม fbhub on) — เตือนแค่ 3 วันหลังซ้อม
  8. ช่องแจ้งเตือนยังไม่ได้ตั้ง (ตรวจนี้พิมพ์ออกจอเท่านั้น เพราะส่งไม่ได้อยู่แล้ว)

เตือนผ่าน notify-once (เรื่องเดิมครั้งเดียวทุก 6 ชม.) · ถ้าปิดบอทอยู่ (fbhub off) ข้อ 1 จะไม่เตือน

  python3 ~/fb-hub/bin/fb-deadman.py          ตรวจแล้วเตือน
  python3 ~/fb-hub/bin/fb-deadman.py --dry    ตรวจแล้วพิมพ์ ไม่ส่ง
  python3 ~/fb-hub/bin/fb-deadman.py --demo   เช็กตัวเอง
"""
import glob, os, platform, shutil, subprocess, sys, time, urllib.request

HUB = os.path.expanduser("~/fb-hub")
JOBS = os.path.join(HUB, "jobs")
LOG = os.path.join(HUB, "logs/deadman.log")
STALE_MIN = 120
RUNNING_MIN = 120
GROUP_LOG = os.path.join(HUB, "logs/fb-group-watch.log")
DRY_REMIND_H = (6, 72)      # ซ้อมเสร็จแล้ว 6 ชม.–3 วัน ตัวจับเวลากลุ่มยังปิด = เตือน (เกิน 3 วัน = ถือว่าตั้งใจปิด)
GROUP_LOG_MIN = 90          # ตัวจับเวลากลุ่มเช็กทุก 10 นาที จด log อย่างน้อยชั่วโมงละครั้ง — เงียบ 90 นาที = ตาย


def watcher_on():
    """ตัวจับเวลา fbwatch เปิดอยู่ไหม — ปิดอยู่ = ตั้งใจหยุด ไม่ต้องเตือนว่าเงียบ"""
    try:
        if platform.system() == "Linux":
            return subprocess.run(["systemctl", "is-active", "--quiet", "fbhub-fbwatch.timer"]).returncode == 0
        out = subprocess.run(["launchctl", "list"], capture_output=True, text=True).stdout
        return "com.fbhub.fbwatch" in out
    except OSError:
        return True      # ไม่แน่ใจ = ถือว่าเปิด (เตือนเกินดีกว่าเงียบ)


def group_watcher_on():
    try:
        if platform.system() == "Linux":
            return subprocess.run(["systemctl", "is-active", "--quiet", "fbhub-fbgroupwatch.timer"]).returncode == 0
        return "com.fbhub.fbgroupwatch" in subprocess.run(["launchctl", "list"], capture_output=True, text=True).stdout
    except OSError:
        return False


def chrome_ok():
    try:
        urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=3).read()
        return True
    except Exception:
        return False


def last_exit(done):
    try:
        return open(done[:-5] + ".exit").read().strip()
    except OSError:
        return "0"


def problems(now, jobs_dir=JOBS, watching=True, chrome=True, disk_free=1.0, group_watching=False, group_log=GROUP_LOG):
    out = []
    gdone = sorted(glob.glob(os.path.join(jobs_dir, "fbgroup-*.done")), key=os.path.getmtime)
    if gdone and last_exit(gdone[-1]) != "0":
        out.append((f"fbgroup exit {last_exit(gdone[-1])}", "⚠️ fb-hub: รอบคอมเมนต์กลุ่มล่าสุดจบแบบผิดพลาด — ดู " + os.path.basename(gdone[-1])[:-5] + ".out"))
    if group_watching and os.path.exists(group_log) and (now - os.path.getmtime(group_log)) / 60 > GROUP_LOG_MIN:
        out.append(("fbgroup เงียบ", f"⚠️ fb-hub: ตัวจับเวลากลุ่มเปิดอยู่แต่ไม่ขยับเกิน {GROUP_LOG_MIN} นาที — เครื่องหลับ? ลอง fbhub status"))
    ddone = sorted(glob.glob(os.path.join(jobs_dir, "dry-group-*.done")), key=os.path.getmtime)
    if ddone and not group_watching:
        age_h = (now - os.path.getmtime(ddone[-1])) / 3600
        real_after = gdone and os.path.getmtime(gdone[-1]) > os.path.getmtime(ddone[-1])
        if DRY_REMIND_H[0] <= age_h <= DRY_REMIND_H[1] and not real_after:
            out.append(("group-dry ลืมเปิด", "👉 fb-hub: ซ้อมคอมเมนต์กลุ่มเสร็จแล้ว แต่ตัวจับเวลากลุ่มยังปิดอยู่ — ระบบยังไม่คอมเมนต์กลุ่มเลย"
                        " ดูผลซ้อมแล้วรัน fbhub on (ถ้าตั้งใจปิด ไม่ต้องทำอะไร จะเลิกเตือนเองใน 3 วัน)"))
    done = sorted(glob.glob(os.path.join(jobs_dir, "fbwatch-*.done")), key=os.path.getmtime)
    if watching:
        if not done:
            pass     # ติดตั้งใหม่ ยังไม่เคยมีรอบ — ไม่เตือน
        elif (now - os.path.getmtime(done[-1])) / 60 > STALE_MIN:
            out.append(("fbwatch เงียบ", f"⚠️ fb-hub: ไม่มีรอบเฝ้าคอมเมนต์จบใหม่เกิน {STALE_MIN} นาที"
                        " — เครื่องหลับ? ตัวจับเวลาตาย? ลอง fbhub status"))
    if done:
        ex = done[-1][:-5] + ".exit"
        try:
            code = open(ex).read().strip()
        except OSError:
            code = "0"
        if code != "0":
            tail = ""
            try:
                tail = open(done[-1][:-5] + ".out", errors="replace").read().strip().splitlines()[-1][:200]
            except (OSError, IndexError):
                pass
            out.append((f"fbwatch exit {code}", f"⚠️ fb-hub: รอบล่าสุดจบแบบผิดพลาด (exit {code})\n{tail}\n"
                        "ถ้าเป็นเรื่อง limit/login ของ Claude = ไม่ใช่ Facebook บล็อก"))
    for r in glob.glob(os.path.join(jobs_dir, "*.running")):
        if (now - os.path.getmtime(r)) / 60 > RUNNING_MIN:
            out.append(("งานค้าง", f"⚠️ fb-hub: งาน {os.path.basename(r)} ค้างเกิน {RUNNING_MIN} นาที — อาจแฮงค์คา Chrome"))
    if not chrome:
        out.append(("chrome ต่อไม่ได้", "⚠️ fb-hub: Chrome ไม่ตอบที่พอร์ต 9222 — รัน fbhub chrome"))
    if disk_free < 0.10:
        out.append(("ดิสก์ใกล้เต็ม", f"⚠️ fb-hub: ดิสก์เหลือ {disk_free:.0%} — เต็มแล้วบอทพังทั้งระบบ ลบไฟล์ใหญ่ที่ไม่ใช้"))
    return out


def demo():
    import tempfile
    d = tempfile.mkdtemp()
    now = time.time()

    def mk(name, age_min, body=""):
        p = os.path.join(d, name)
        open(p, "w").write(body)
        os.utime(p, (now - age_min * 60,) * 2)

    assert problems(now, d) == [], "ติดตั้งใหม่ยังไม่มีรอบ = ไม่เตือน"
    mk("fbwatch-1.done", 30); mk("fbwatch-1.exit", 30, "0")
    assert problems(now, d) == [], "ปกติต้องไม่เตือน"
    mk("fbwatch-1.done", 200)
    assert [k for k, _ in problems(now, d)] == ["fbwatch เงียบ"]
    assert problems(now, d, watching=False) == [], "ปิดบอทอยู่ = ไม่เตือนว่าเงียบ"
    mk("fbwatch-2.done", 10); mk("fbwatch-2.exit", 10, "1"); mk("fbwatch-2.out", 10, "x\nYou've hit your limit")
    ks = problems(now, d)
    assert ks[0][0] == "fbwatch exit 1" and "limit" in ks[0][1], ks
    mk("manual-9.running", 150)
    assert "งานค้าง" in [k for k, _ in problems(now, d)]
    assert "chrome ต่อไม่ได้" in [k for k, _ in problems(now, d, chrome=False)]
    assert "ดิสก์ใกล้เต็ม" in [k for k, _ in problems(now, d, disk_free=0.05)]
    gl = os.path.join(d, "g.log")
    mk("g.log", 20)
    assert not [k for k, _ in problems(now, d, group_watching=True, group_log=gl) if "fbgroup" in k], "กลุ่มปกติต้องไม่เตือน"
    mk("g.log", 120)
    assert "fbgroup เงียบ" in [k for k, _ in problems(now, d, group_watching=True, group_log=gl)]
    assert "fbgroup เงียบ" not in [k for k, _ in problems(now, d, group_watching=False, group_log=gl)], "ปิดฝั่งกลุ่ม = ไม่เตือน"
    mk("fbgroup-1.done", 5); mk("fbgroup-1.exit", 5, "1")
    assert "fbgroup exit 1" in [k for k, _ in problems(now, d)]
    mk("dry-group-1.done", 2)
    assert "group-dry ลืมเปิด" not in [k for k, _ in problems(now, d)], "เพิ่งซ้อมเสร็จ = ยังไม่เตือน"
    mk("dry-group-1.done", 8 * 60); mk("fbgroup-1.done", 9 * 60)
    assert "group-dry ลืมเปิด" in [k for k, _ in problems(now, d)], "ซ้อมเสร็จ 8 ชม. ตัวจับเวลายังปิด = เตือน"
    assert "group-dry ลืมเปิด" not in [k for k, _ in problems(now, d, group_watching=True, group_log=gl)], "เปิดแล้ว = ไม่เตือน"
    mk("fbgroup-1.done", 60)
    assert "group-dry ลืมเปิด" not in [k for k, _ in problems(now, d)], "มีรอบจริงหลังซ้อม = ไม่เตือน"
    mk("fbgroup-1.done", 9 * 60); mk("dry-group-1.done", 80 * 60)
    assert "group-dry ลืมเปิด" not in [k for k, _ in problems(now, d)], "เกิน 3 วัน = ถือว่าตั้งใจปิด"
    shutil.rmtree(d)
    print("✅ fb-deadman demo ผ่าน")


def main(dry):
    du = shutil.disk_usage(os.path.expanduser("~"))
    found = problems(time.time(), watching=watcher_on(), chrome=chrome_ok(), disk_free=du.free / du.total,
                     group_watching=group_watcher_on())
    stamp = time.strftime("%F %T")
    if not found:
        print(f"{stamp} ปกติ")
        return 0
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    for key, msg in found:
        print(f"{stamp} {key}: {msg}")
        if dry:
            continue
        r = subprocess.run([sys.executable, os.path.join(HUB, "bin/notify-once.py"), key, msg],
                           capture_output=True, text=True)
        # จดทุกครั้งที่พยายามเตือน — ไม่งั้นไม่มีหลักฐานว่าเตือนถึงจริงไหม
        with open(LOG, "a") as f:
            f.write(f"{stamp} {key} → exit {r.returncode} {(r.stdout + r.stderr).strip()[:200]}\n")
    return 0


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
        sys.exit(0)
    sys.exit(main("--dry" in sys.argv))
