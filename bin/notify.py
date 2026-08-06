#!/usr/bin/env python3
"""
notify.py — ยิงแจ้งเตือนเข้า "เลขา" ทุกช่องทางพร้อมกัน (LINE + Telegram)

ที่เดียวที่สคริปต์อื่นควรเรียก — ถ้าจะเพิ่มช่องทางใหม่ในอนาคต แก้ที่ไฟล์นี้ไฟล์เดียว
LINE ยิงผ่าน notify-line.py (ตัวเดิม) · Telegram อ่านคีย์จาก .env เหมือนกัน

ใช้เป็นคำสั่ง:
  python3 tools/notify.py "ข้อความ"
  echo "ข้อความ" | python3 tools/notify.py

ใช้ในสคริปต์อื่น:
  sys.path.insert(0, os.path.join(ROOT, "tools"))
  from importlib import import_module
  import_module("notify").send("ข้อความ")

คีย์ที่ต้องมีใน .env (ไฟล์เดียวกับที่ notify-line.py อ่าน):
  LINE_CHANNEL_ACCESS_TOKEN, LINE_TEST_USER_ID     — LINE
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID             — Telegram (ไม่มีก็ข้ามเงียบ ๆ)
"""
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request
from importlib import import_module

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_line = import_module("notify-line")

TG_API = "https://api.telegram.org/bot{}/sendMessage"


def _telegram(text):
    """คืน True ถ้าส่งสำเร็จ · ไม่มีคีย์ = ข้ามเงียบ ๆ (ถือว่าไม่ fail)"""
    token, chat = _line.env("TELEGRAM_BOT_TOKEN"), _line.env("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return True
    data = urllib.parse.urlencode({"chat_id": chat, "text": text[:4000]}).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request(TG_API.format(token), data=data),
            timeout=30, context=_line._ctx(),
        ).read()
        return True
    except Exception as e:
        print(f"✗ ส่ง Telegram ไม่ได้: {e}", file=sys.stderr)
        return False


def send(text):
    """ยิงทุกช่องทาง — คืน True ถ้าอย่างน้อย 1 ช่องสำเร็จ (แจ้งเตือนหลุดหมดถึงจะถือว่าพัง)"""
    ok_line = _line.send(text)
    ok_tg = _telegram(text)
    return ok_line or ok_tg


def demo():
    """self-check: ไม่มีคีย์ Telegram ต้องไม่ทำให้ทั้งชุดพัง"""
    real = _line.env
    _line.env = lambda k: "" if k.startswith("TELEGRAM") else real(k)
    assert _telegram("x") is True, "ไม่มีคีย์ Telegram ต้องข้ามเงียบ ๆ ไม่ใช่ False"
    _line.env = real
    assert _line.env("LINE_TEST_USER_ID"), "ไม่พบ LINE_TEST_USER_ID ใน .env"
    print("✓ notify demo ผ่าน")


if __name__ == "__main__":
    arg = " ".join(sys.argv[1:]).strip()
    if arg == "--demo":
        demo()
        sys.exit(0)
    msg = arg or sys.stdin.read().strip()
    if not msg:
        print("ใช้: python3 tools/notify.py \"ข้อความ\"", file=sys.stderr)
        sys.exit(1)
    sys.exit(0 if send(msg) else 1)
