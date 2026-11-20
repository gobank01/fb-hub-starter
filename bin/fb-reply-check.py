#!/usr/bin/env python3
"""ด่านตรวจข้อความก่อนส่ง — กันคำติดปากแบบบอท ให้ข้อความดูเป็นคนจริง

ทำไมต้องตรวจด้วยโค้ด ไม่ใช่เขียนขอใน prompt (วัดจากคอมเมนต์จริง ~2,000 อันของระบบต้นแบบ):
  - ตัวอย่างประโยคใน prompt ถูก AI ลอกคำต่อคำ — ขึ้นต้นเหมือนกัน 80% ของคอมเมนต์
  - เขียนกฎว่า "สั้น 1-3 บรรทัด" แต่ยาวจริงมัธยฐาน 231 ตัว (คนจริง ~54 ตัว)
  - ปิดนิสัยหนึ่ง AI จะหานิสัยใหม่มาแทน → ต้องวัดซ้ำทุกสัปดาห์ (--stats)
  → ของที่วัดได้ ต้องตรวจด้วยโค้ด

  --check "<ข้อความ>"      ตรวจ 1 อันก่อนพิมพ์   exit 0 ผ่าน · 1 ไม่ผ่าน (พิมพ์เหตุผล)
  --group <drafts.json> [groupId]
                           ตรวจร่างคอมเมนต์กลุ่มทั้งไฟล์ (กติกากลุ่มเข้มกว่า: สั้นกว่า ห้ามขายของในข้อความ
                           ลิงก์ Shopee ต้องอยู่ช่อง link แยก + กลุ่มต้องอนุญาต + ไม่เกินสัดส่วน)
  --recent [N]             ดู N อันล่าสุด (ขึ้นต้น…ลงท้าย) ไว้เลี่ยงก่อนร่าง
  --recent group [N]       ดูเฉพาะฝั่งกลุ่ม
  --stats [วัน]             ตัวเลขเสียงย้อนหลัง (ค่าเริ่ม 7 วัน)
  --demo                   เช็กตัวเอง

อ่านประวัติจาก ~/fb-hub/state/replies.tsv  (เวลา⇥ชื่อ⇥url⇥คอมเมนต์เขา⇥คำตอบเรา)
ตั้งค่าใน ~/fb-hub/.env:
  REPLY_PARTICLE=ครับ          คำลงท้ายของเจ้าของเพจ (ครับ / ค่ะ) — อีกแบบจะถูกห้าม
  REPLY_MAX_LEN=300            ยาวสุดกี่ตัวอักษร
  OWNER=พี่โจ                  ชื่อที่ใช้เรียกตัวเอง (ใช้จับประโยค "เดี๋ยวพี่โจมาตอบ")
คำต้องห้ามของธุรกิจคุณเอง: ~/fb-hub/config/banned-words.txt (บรรทัดละ 1 คำ/regex)
"""
import json, os, re, statistics, sys
from datetime import datetime, timedelta

HUB = os.path.expanduser("~/fb-hub")
REPLIES = os.environ.get("REPLIES", os.path.join(HUB, "state/replies.tsv"))
BANNED_FILE = os.path.join(HUB, "config/banned-words.txt")
GROUPS_FILE = os.path.join(HUB, "config/groups.tsv")

# ── ฝั่งกลุ่ม (คอมเมนต์ใต้โพสต์คนอื่น) ───────────────────────────
# วัดจากระบบต้นแบบ 820 คอมเมนต์ เทียบสมาชิกจริง 3,400 คอมเมนต์ใต้โพสต์เดียวกัน:
#   ยาวมัธยฐาน 231 vs 54 ตัว · "ครับ" 2.4 ครั้ง/อัน vs ครึ่งหนึ่งไม่มีเลย · ออกตัว "ไม่กล้าฟันธง" 27% vs 0.3%
GROUP_MAX = 220
GROUP_LONG = 120          # ยาวเกินนี้ได้ แต่ห้ามเกินครึ่งของ 20 อันล่าสุด
BAN_GROUP = {
    "แก้ตัวว่าไม่รู้/ไม่กล้า": r"ไม่กล้า|ฟันธง|ยังไม่ได้ลอง|ยังไม่เคยลอง|ยังไม่เคยใช้|ยังไม่ได้ใช้|ไม่ได้อยู่สาย|ไม่ใช่สาย|ไม่เชี่ยวชาญ",
    "พูดถึงระบบตอบของตัวเอง": r"auto ?comment|ออโต้ ?คอม|คอมเมนต์อัตโนมัติ|ตอบคอมเมนต์|บอทตอบ|ตรวจก่อนส่ง|อ่านเองก่อน|อ่านเองทุก",
    "พูดถึงเวลาดึก": r"ดึกแล้ว|ตี ?[1-5](?![0-9])",
    # ลิงก์ Shopee ต้องอยู่ช่อง link แยก ห้ามฝังในข้อความ — ข้อความต้องอ่านแล้วเป็นคอมเมนต์ปกติ
    "ขายของในข้อความ": r"คอร์ส|คลาส(?!สิ)|\bline\b|(?<!ออน)ไลน์|inbox|อินบ็อกซ์|ทักมา|ทักแชท|ทักไป|เบอร์โทร|http|www\.|โค้ดส่วนลด|กดลิงก์|ลิงก์ในคอม|พิกัด|จิ้มเลย|สั่งได้ที่",
}
SHOPEE_HOST = re.compile(r"^https://(s\.shopee\.co\.th|shope\.ee|shopee\.co\.th)/\S+$")


def _load_env():
    try:
        for line in open(os.path.join(HUB, ".env"), encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.split(" #")[0].strip().strip("\"'"))
    except OSError:
        pass


def bans(owner="", particle="ครับ"):
    o = re.escape(owner) if owner else r"(?!x)x"
    b = {
        # ห้ามสัญญาลอย ๆ — คนจะนั่งรอคำตอบที่ไม่มีวันมา (ระบบต้นแบบห้ามตั้งแต่ ส.ค. 69)
        "โยนกลับ/สัญญาลอย": rf"เดี๋ยว{o}|{o}(จะ)?มาตอบ|มาตอบ(ให้)?เอง|รอเจ้าตัว|รอเจ้าของ|เดี๋ยวเช็ค|เดี๋ยวมาบอก|เดี๋ยวมาตอบ|รอแป[๊ป]|ขอเช็คก่อน",
        "ชวนเข้าแชท/อินบ็อกซ์": r"inbox|อินบ็อกซ์|ทักแชท|ทักไป|ส่งทางแชท|ในแชท|\bdm\b|ส่งให้ทางข้อความ",
        "บอกว่าเห็นคำถาม แต่ไม่ตอบ": r"เห็นคำถามแล้ว|ถามถูกจุด|คำถามดี",
        "พูดถึงเวลาดึก": r"ดึกแล้ว|ตี ?[1-5](?![0-9])",
        "พูดถึงระบบตอบอัตโนมัติ": r"auto ?comment|ออโต้ ?คอม|คอมเมนต์อัตโนมัติ|บอทตอบ|\bai\b ?ตอบ",
    }
    # ผู้ชายใช้ "ครับ" → ห้าม ค่ะ/คะ · ผู้หญิงใช้ "ค่ะ" → ห้าม ครับ
    # ระบบต้นแบบเจอจริง: ตอบคนที่ลงท้าย "ค่ะ" แล้วบอทตามน้ำเป็น "ค่ะ" ทั้งที่เจ้าของเป็นผู้ชาย
    if particle.startswith("ค่ะ") or particle.startswith("คะ"):
        b["ใช้ครับ (เจ้าของใช้ค่ะ)"] = r"ครับ"
    else:
        b["ใช้ค่ะ/คะ (เจ้าของใช้ครับ)"] = r"ค่ะ|คะ(?![฀-๿])"     # กัน "คะแนน"
    return b


def custom_bans():
    out = {}
    try:
        for line in open(BANNED_FILE, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#"):
                out[f"คำต้องห้ามของร้าน '{s}'"] = s
    except OSError:
        pass
    return out


# นิสัยที่ใช้ได้บ้าง แต่ห้ามถี่ — (regex, เพดานใน 20 อันล่าสุด)
TICS = {
    "ขอบคุณที่": (r"ขอบคุณที่", 3),
    "จริง ๆ": (r"จริง ?ๆ", 4),
    "เหมือนกัน": (r"เหมือนกัน", 3),
    "ขออนุญาต": (r"ขออนุญาต", 1),
    "ถามแบบสัมภาษณ์": (r"อยากรู้ว่า|สงสัยว่า|ขอถาม", 2),
    "ชมแบบตัดสินงาน": (r"ถูกทาง|คิดมาดี|คิดถูก", 2),
    "แหละ": (r"แหละ", 2),
    "🙏": (r"🙏", 3),
}
EMOJI = re.compile("[\U0001F300-\U0001FAFF]")
Q_END = re.compile(r"(ไหม|มั้ย|หรือเปล่า|ยังไง|อย่างไร|อะไร|บ้าง|ไง|หรือยัง|กี่|แค่ไหน|\?)\W*(ครับ|คะ|ค่ะ)?\W*$")


def norm(s):
    s = re.sub(r"https?://\S+", "", s.lower())
    s = re.sub(r"ครับผม|ครับ|ค่ะ|คะ|นะ|จ้า", "", s)
    # เก็บทั้งบล็อกไทยไว้ — สระบน/วรรณยุกต์ไม่นับเป็น \w ถ้าใช้ \W จะหายหมดแล้วเทียบผิด
    return re.sub(r"[^0-9a-z฀-๿]+", "", s)


def grams(s, n=3):
    s = norm(s)
    return {s[i:i + n] for i in range(max(1, len(s) - n + 1))}


def sim(a, b):
    ga, gb = grams(a), grams(b)
    return len(ga & gb) / max(1, len(ga | gb))


def load(bucket=None):
    """bucket=None ทุกอัน · "group" เฉพาะใต้โพสต์ในกลุ่ม · "own" เฉพาะโพสต์ตัวเอง (แยกด้วย url /groups/)"""
    out = []
    try:
        for line in open(REPLIES, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if len(f) >= 5 and f[4].strip():
                if bucket and (("/groups/" in f[2]) != (bucket == "group")):
                    continue
                out.append((f[0], f[4]))
    except FileNotFoundError:
        pass
    return out


q_end = lambda t: bool(Q_END.search(t.strip()))
head = lambda t: norm(t)[:8]
tail = lambda t: norm(t)[-10:]


def check(text, recent, banlist, maxlen=300, owner="", mates=(), group=False):
    """คืนรายการเหตุผลที่ไม่ผ่าน (ว่าง = ผ่าน) · recent = [(เวลา, ข้อความ)] เก่า→ใหม่
    mates = ร่างอื่นในรอบเดียวกัน (กันซ้ำกันเองภายในรอบ) · group = ใช้กติกาฝั่งกลุ่มเพิ่ม"""
    recent = list(recent) + [("", t) for t in mates]
    why, low = [], text.lower()
    flat = " ".join(text.split())
    if len(flat) > maxlen:
        why.append(f"ยาว {len(flat)} ตัว (เพดาน {maxlen}) — คอมเมนต์ ไม่ใช่บทความ")
    for name, rx in banlist.items():
        try:
            m = re.search(rx, low)
        except re.error:
            m = re.search(re.escape(rx.lower()), low)
        if m:
            why.append(f"{name}: '{m.group(0)}'")
    if group and text.count("ครับ") > 1:
        why.append(f"ครับ {text.count('ครับ')} ครั้ง — ในกลุ่มใส่ได้ครั้งเดียว")
    if group and len(flat) > GROUP_LONG:
        p20 = [t for _, t in recent[-20:]]
        if sum(len(" ".join(t.split())) > GROUP_LONG for t in p20) * 2 > max(1, len(p20)):
            why.append(f"ยาว {len(flat)} ตัว ทั้งที่ 20 อันล่าสุดยาวเกิน {GROUP_LONG} เกินครึ่งแล้ว — อันนี้ให้สั้นแบบสมาชิกทั่วไป")
    if owner and re.search(r"(^|\s)ผม", text) and owner in text:
        why.append(f"ใช้ทั้ง 'ผม' และ '{owner}' ในอันเดียว — ตัวตนแตก")
    last20 = [t for _, t in recent[-20:]]
    for name, (rx, cap) in TICS.items():
        if re.search(rx, text) and sum(bool(re.search(rx, t)) for t in last20) >= cap:
            why.append(f"คำติดปาก '{name}' ใช้ไปแล้ว {cap}+ ใน 20 อันล่าสุด")
    if len(norm(text)) >= 8:
        if any(head(text) == head(t) for t in last20):
            why.append(f"ขึ้นต้นซ้ำกับของล่าสุด: '{text.strip()[:15]}…'")
        if any(tail(text) == tail(t) for t in last20 if len(norm(t)) >= 10):
            why.append(f"ลงท้ายซ้ำกับของล่าสุด: '…{text.strip()[-15:]}'")
    if q_end(text) and sum(map(q_end, last20)) * 3 >= max(3, len(last20)):
        why.append("ลงท้ายด้วยคำถามถี่เกิน 1 ใน 3 — อันนี้ไม่ต้องถาม")
    pool = [t for _, t in recent[-200:]]
    short = len(norm(text)) < 12
    for t in (pool[-30:] if short else pool):
        if (norm(t) == norm(text)) if short else sim(t, text) >= 0.5:
            why.append(f"คล้ายของเดิม: '{t.strip()[:40]}…'")
            break
    return why


def _cfg():
    owner = os.environ.get("OWNER", "").strip()
    particle = os.environ.get("REPLY_PARTICLE", "ครับ").strip() or "ครับ"
    try:
        maxlen = int(os.environ.get("REPLY_MAX_LEN", "300"))
    except ValueError:
        maxlen = 300
    return owner, particle, maxlen


def cmd_check(text):
    owner, particle, maxlen = _cfg()
    why = check(text, load(), {**bans(owner, particle), **custom_bans()}, maxlen, owner)
    for w in why:
        print(f"✗ {w}")
    print("OK" if not why else "FAIL — เขียนใหม่ทั้งประโยค อย่าแก้แค่คำเดียว")
    return 1 if why else 0


def group_cfg(gid):
    """อ่านแถวของกลุ่มจาก config/groups.tsv → (ชื่อ, อนุญาต Shopee ไหม, คำต้องห้ามเฉพาะกลุ่ม)"""
    try:
        for line in open(GROUPS_FILE, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if f and f[0].strip() == gid and not line.startswith("#"):
                f += [""] * 5
                ban = [w.strip() for w in f[4].split(",") if w.strip()]
                return f[1].strip(), f[3].strip().lower() in ("yes", "y", "1", "ได้"), ban
    except OSError:
        pass
    return "", False, []


def link_ratio_ok(recent_links, mates_links, ratio):
    """ลิงก์ต่อคอมเมนต์ใน 20 อันล่าสุด+รอบนี้ ต้องไม่เกิน ratio (แอดมินเตะคนขายของ เร็วกว่า FB แบนเสียอีก)"""
    pool = (recent_links[-20:] + mates_links)
    return sum(pool) <= ratio * max(len(pool), 4)


def cmd_group(path, gid=""):
    owner, particle, _ = _cfg()
    items = json.load(open(path, encoding="utf-8"))
    gname, shopee_ok, gban = group_cfg(gid) if gid else ("", False, [])
    try:
        ratio = float(os.environ.get("SHOPEE_LINK_RATIO", "0.25"))
    except ValueError:
        ratio = 0.25
    banlist = {**bans(owner, particle), **BAN_GROUP, **custom_bans(),
               **{f"คำต้องห้ามของกลุ่ม '{w}'": re.escape(w.lower()) for w in gban}}
    recent = load("group")
    # ลิงก์ที่ส่งไปแล้ว — sender จดลิงก์ไว้ช่องที่ 7 ของ replies.tsv
    recent_links = []
    try:
        for line in open(REPLIES, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if len(f) >= 5 and "/groups/" in f[2]:
                recent_links.append(len(f) >= 7 and f[6].startswith("http"))
    except OSError:
        pass
    mates, mate_links, bad = [], [], 0
    for it in items:
        text = it.get("text", "")
        why = check(text, recent, banlist, GROUP_MAX, owner, mates, group=True)
        link = (it.get("link") or "").strip()
        if link:
            if not SHOPEE_HOST.match(link):
                why.append(f"ช่อง link ต้องเป็นลิงก์ Shopee affiliate (s.shopee.co.th / shope.ee) ไม่ใช่ '{link[:40]}'")
            if not shopee_ok:
                why.append(f"กลุ่ม {gname or gid or '?'} ไม่ได้อนุญาตลิงก์ (คอลัมน์ shopee ใน config/groups.tsv) — เอาช่อง link ออก")
            if not link_ratio_ok(recent_links, mate_links + [True], ratio):
                why.append(f"ลิงก์ถี่เกิน {int(ratio * 100)}% ของคอมเมนต์ล่าสุด — อันนี้คอมเมนต์เปล่า ๆ ไม่ต้องแปะ")
        mates.append(text)
        mate_links.append(bool(link))
        print(f"{'FAIL' if why else 'OK  '} {it.get('who', '?')}: {' '.join(text.split())[:60]}" + (" 🔗" if link else ""))
        for w in why:
            print(f"     ✗ {w}")
        bad += bool(why)
    print(f"สรุป: ผ่าน {len(items) - bad}/{len(items)}" + (" — แก้หรือตัดอันที่ FAIL แล้วรันใหม่จนผ่านหมด" if bad else ""))
    return 1 if bad else 0


def cmd_recent(n=20, bucket=None):
    for _, t in load(bucket)[-n:]:
        flat = " ".join(t.split())
        print(f"{len(flat):>3} {'?' if q_end(flat) else ' '} {flat[:18]} … {flat[-18:]}")
    return 0


def cmd_stats(days=7):
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    rows = [t for ts, t in load() if ts >= since]
    if not rows:
        print(f"ไม่มีข้อมูลใน {days} วัน")
        return 0
    n = len(rows)
    pct = lambda f: f"{100 * sum(map(f, rows)) / n:.0f}%"
    print(f"{days} วันล่าสุด {n} อัน: ยาวมัธยฐาน {statistics.median(len(' '.join(t.split())) for t in rows):.0f} ตัว"
          f" · ลงท้ายถาม {pct(q_end)} · ขึ้นต้นไม่ซ้ำ {100 * len({head(t) for t in rows}) / n:.0f}%"
          f" · มีอีโมจิ {pct(lambda t: bool(EMOJI.search(t)))}")
    return 0


def demo():
    import tempfile
    tsv = tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False, encoding="utf-8")
    p = "https://www.facebook.com/someone/posts/pfbid0x"
    for i, t in enumerate(["ขอบคุณที่สนใจนะครับ 🙏", "สวยมากครับ งานละเอียดดี", "ลองแล้วเป็นไงเล่าให้ฟังบ้างนะครับ"]):
        tsv.write(f"2026-09-2{i} 10:00:00\tA\t{p}\tสนใจ\t{t}\n")
    tsv.close()
    global REPLIES
    REPLIES = tsv.name
    B = {**bans("พี่โจ", "ครับ")}
    C = lambda t: check(t, load(), B, 300, "พี่โจ")
    assert C("เดี๋ยวพี่โจมาตอบให้นะครับ"), "โยนกลับต้องโดน"
    assert C("ขอเช็คก่อนนะครับ เดี๋ยวมาบอก"), "สัญญาลอยต้องโดน"
    assert C("ทักแชทมาได้เลยครับ"), "ชวนแชทต้องโดน"
    assert C("คุยกันตรงนี้ได้เลยค่ะ"), "ค่ะ ต้องโดนเมื่อเจ้าของใช้ครับ"
    assert not C("ได้คะแนนเยอะเลยครับ"), "คะแนน ต้องไม่โดน"
    assert C("ผมว่าพี่โจชอบอันนี้"), "ตัวตนแตกต้องโดน"
    assert C("ขอบคุณที่สนใจนะครับ 🙏"), "ซ้ำเป๊ะต้องโดน"
    assert C("สวยมากครับ งานละเอียดดีเลย"), "คล้ายของเดิมต้องโดน"
    assert C("ก" * 310), "ยาวเกินต้องโดน"
    assert not C("ได้เลย ไว้ลองแล้วมาเล่ากันนะครับ 😄"), "ปกติต้องผ่าน"
    W = bans("", "ค่ะ")
    assert check("ยินดีครับ", [], W), "เจ้าของใช้ค่ะ → ครับต้องโดน"
    assert not check("ยินดีค่ะ", [], W)
    assert check("ราคาส่งเท่าไหร่", [], {"คำต้องห้ามของร้าน 'ราคาส่ง'": "ราคาส่ง"}), "คำต้องห้ามของร้านต้องโดน"
    assert q_end("ใช้กับทีมเล็กได้ไหมครับ") and not q_end("ใช้ได้ดีครับ")
    # ฝั่งกลุ่ม
    G = lambda t, m=(): check(t, [], {**B, **BAN_GROUP}, GROUP_MAX, "พี่โจ", m, group=True)
    assert G("ดีครับ ชอบครับ"), "ครับ 2 ครั้งในกลุ่มต้องโดน"
    assert G("ผมยังไม่ได้ลอง เลยไม่กล้าฟันธง"), "ออกตัวต้องโดน"
    assert G("สั่งได้ที่ https://shope.ee/abc"), "ลิงก์ในข้อความต้องโดน"
    assert G("ทำสวยมาก", ["ทำสวยมาก"]), "ซ้ำกับร่างในรอบเดียวกันต้องโดน"
    assert not G("ไอเดียนี้น่ารักดี เดี๋ยวลองเอาไปใช้กับลูกบ้าง"), "ปกติต้องผ่าน"
    assert SHOPEE_HOST.match("https://s.shopee.co.th/AbC123") and not SHOPEE_HOST.match("https://evil.com/x")
    assert link_ratio_ok([False] * 19 + [True], [True], 0.25)
    assert not link_ratio_ok([True] * 5 + [False] * 15, [True], 0.25), "ลิงก์ถี่ต้องโดน"
    assert len(load("group")) == 0 and len(load("own")) == 3, "แยกถังด้วย /groups/ ใน url"
    os.unlink(tsv.name)
    print("✅ fb-reply-check demo ผ่าน")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "--demo":
        sys.exit(demo())
    _load_env()
    if a[0] == "--check":
        sys.exit(cmd_check(" ".join(a[1:])))
    if a[0] == "--group":
        sys.exit(cmd_group(a[1], a[2] if len(a) > 2 else ""))
    if a[0] == "--recent":
        b = "group" if len(a) > 1 and a[1] == "group" else None
        rest = a[2:] if b else a[1:]
        sys.exit(cmd_recent(int(rest[0]) if rest else 20, b))
    if a[0] == "--stats":
        sys.exit(cmd_stats(int(a[1]) if len(a) > 1 else 7))
    sys.exit(__doc__)
