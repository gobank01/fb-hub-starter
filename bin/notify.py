#!/usr/bin/env python3
"""
notify.py — ยิงแจ้งเตือนเข้า Telegram (+ LINE ถ้าตั้งไว้)

  python3 ~/fb-hub/bin/notify.py "ข้อความ"
  echo "ข้อความ" | python3 ~/fb-hub/bin/notify.py
  python3 ~/fb-hub/bin/notify.py --test     ส่งข้อความทดสอบจริง
  python3 ~/fb-hub/bin/notify.py --demo     เช็กตัวเอง (ไม่ส่งจริง)

คีย์ใน ~/fb-hub/.env:
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID       — ช่องหลัก (แนะนำ ฟรี ไม่มีโควตา)
  LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID    — ช่องเสริม (LINE OA ฟรีส่งได้ ~300 ข้อความ/เดือน)

exit 0 = ส่งถึงอย่างน้อย 1 ช่อง · 1 = ไม่ถึงใครเลย (หรือยังไม่ได้ตั้งช่องไหนไว้)

บทเรียนที่อยู่ในไฟล์นี้ (ดู LESSONS.md):
- ไม่ได้ตั้งช่องไหนเลย = exit 1 ดัง ๆ ไม่ใช่ "ข้ามเงียบ" — ไม่งั้นบอทพังแล้วไม่มีใครรู้
- LINE ล้ม (เต็มโควตาเดือน) แต่ Telegram รอด → ต่อท้ายข้อความ Telegram ว่า LINE ล้ม
  เดิม `return ok_line or ok_tg` ทำให้ LINE ตายเงียบเป็นสัปดาห์
- ข้อความภาษาไทยที่ถูกตัดด้วย `head -c` ขาดกลางตัวอักษร (ไทย 1 ตัว = 3 ไบต์)
  ต้องทิ้งเศษไบต์ ไม่งั้นส่งพังทั้งข้อความ (เคยหายเงียบราวครึ่งหนึ่งของรายงาน)
"""
import json
import os
import sys
import urllib.parse
import urllib.request

ENV_FILE = os.path.expanduser("~/fb-hub/.env")
TG_API = "https://api.telegram.org/bot{}/sendMessage"
LINE_API = "https://api.line.me/v2/bot/message/push"


def _load_env():
    """อ่าน ~/fb-hub/.env เอง — ถูกเรียกตรงจาก cron/launchd ได้โดยไม่ต้อง source"""
    try:
        for line in open(ENV_FILE, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.split(" #")[0].strip().strip("\"'")
            os.environ.setdefault(k.strip(), v)
    except OSError:
        pass


def env(k):
    return os.environ.get(k, "").strip()


def clean(text):
    """ทิ้งเศษตัวอักษรที่ขาด (surrogate) จากการตัดกลางตัวไทย"""
    return text.encode("utf-8", "ignore").decode("utf-8", "ignore") if isinstance(text, str) else \
        text.decode("utf-8", "ignore")


def _post(url, data, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    urllib.request.urlopen(req, timeout=30).read()


def telegram(text):
    """None = ไม่ได้ตั้ง · True/False = ส่งได้/ไม่ได้"""
    token, chat = env("TELEGRAM_BOT_TOKEN"), env("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return None
    try:
        _post(TG_API.format(token), urllib.parse.urlencode({"chat_id": chat, "text": text[:4000]}).encode())
        return True
    except Exception as e:
        print(f"✗ ส่ง Telegram ไม่ได้: {e}", file=sys.stderr)
        return False


def line(text):
    token, user = env("LINE_CHANNEL_ACCESS_TOKEN"), env("LINE_USER_ID")
    if not token or not user:
        return None
    body = json.dumps({"to": user, "messages": [{"type": "text", "text": text[:4900]}]}).encode()
    try:
        _post(LINE_API, body, {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        return True
    except Exception as e:
        print(f"✗ ส่ง LINE ไม่ได้: {e}", file=sys.stderr)
        return False


def send(text, _tg=None, _line=None):
    _tg, _line = _tg or telegram, _line or line
    text = clean(text).strip()
    ok_line = _line(text)
    if ok_line is False:
        # ช่องเตือนที่ล้ม ต้องดังกว่าเรื่องที่มันจะเตือน
        text += "\n\n⚠️ LINE ส่งไม่ได้ (โควตาเดือนเต็ม/คีย์หมดอายุ?) เหลือแต่ Telegram"
    ok_tg = _tg(text)
    if ok_tg is None and ok_line is None:
        print("✗ ยังไม่ได้ตั้งช่องแจ้งเตือนใน ~/fb-hub/.env (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)"
              " — บอทพังจะไม่มีใครรู้", file=sys.stderr)
        return False
    return bool(ok_tg or ok_line)


def demo():
    th = "สวัสดีครับ".encode("utf-8")[:7]          # ตัดกลางตัวไทย
    assert clean(th) == "สว", clean(th)
    assert clean("ก\udcff") == "ก", "surrogate จาก stdin ต้องถูกทิ้ง"
    sent = []
    tg_ok = lambda t: sent.append(t) or True
    assert send("x", _tg=tg_ok, _line=lambda t: False)
    assert "LINE ส่งไม่ได้" in sent[-1], "LINE ล้มต้องบอกใน Telegram"
    assert not send("x", _tg=lambda t: None, _line=lambda t: None), "ไม่ได้ตั้งช่องไหน = False"
    assert send("x", _tg=lambda t: None, _line=lambda t: True), "มีแต่ LINE ก็ได้"
    assert not send("x", _tg=lambda t: False, _line=lambda t: None), "ส่งไม่ถึงใคร = False"
    print("✅ notify demo ผ่าน")


if __name__ == "__main__":
    arg = " ".join(sys.argv[1:]).strip()
    if arg == "--demo":
        demo()
        sys.exit(0)
    _load_env()
    if arg == "--test":
        arg = "✅ fb-hub ทดสอบแจ้งเตือน — ถ้าเห็นข้อความนี้ แปลว่าใช้ได้"
    msg = arg or clean(sys.stdin.buffer.read())
    if not msg.strip():
        print('ใช้: python3 ~/fb-hub/bin/notify.py "ข้อความ"', file=sys.stderr)
        sys.exit(1)
    sys.exit(0 if send(msg) else 1)
