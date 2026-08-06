#!/bin/bash
# ติดตั้ง fb-hub บนเครื่องนี้ — รันครั้งเดียว
#   bash install.sh
set -e

HUB="$HOME/fb-hub"
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "▸ ติดตั้งลง $HUB"
mkdir -p "$HUB"/{bin,prompts,config,state,logs,jobs}

cp "$SRC"/bin/*        "$HUB/bin/"
cp "$SRC"/prompts/*    "$HUB/prompts/"
chmod +x "$HUB"/bin/*.sh "$HUB"/bin/*.py 2>/dev/null || true

# ไฟล์ที่ผู้ใช้ต้องแก้เอง — ไม่ทับของเดิมถ้ามีอยู่แล้ว
[ -f "$HUB/.env" ]                    || cp "$SRC/.env.example"                  "$HUB/.env"
[ -f "$HUB/config/post-notes.tsv" ]   || cp "$SRC/config/post-notes.tsv.example" "$HUB/config/post-notes.tsv"
[ -f "$HUB/config/voice.md" ]         || cp "$SRC/config/voice.md.example"       "$HUB/config/voice.md"
touch "$HUB/state/progress.log" "$HUB/state/used-replies.txt"

echo "▸ ทำให้เรียก fbhub ได้จากทุกที่"
mkdir -p "$HOME/.local/bin"
ln -sf "$HUB/bin/fbhub" "$HOME/.local/bin/fbhub"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
     echo "  เพิ่ม ~/.local/bin ลง PATH แล้ว — เปิด terminal ใหม่หรือ source ~/.zshrc" ;;
esac

echo "▸ ติดตั้ง playwright-core"
cd "$HUB" && cp "$SRC/package.json" . && npm install --silent

echo "▸ ตั้งตัวจับเวลา (LaunchAgent)"
mkdir -p "$HOME/Library/LaunchAgents"
for f in "$SRC"/config/launchagents/*.plist; do
  n="$(basename "$f")"
  sed "s|\$HOME|$HOME|g; s|\$USER|$USER|g" "$f" > "$HOME/Library/LaunchAgents/$n"
  launchctl unload "$HOME/Library/LaunchAgents/$n" 2>/dev/null || true
  launchctl load   "$HOME/Library/LaunchAgents/$n"
  echo "  ✓ $n"
done

echo "▸ กันเครื่องหลับ (ต้องใส่รหัสเครื่อง)"
sudo pmset -a sleep 0 disablesleep 1 || echo "  ⚠ ข้ามไป — ตั้งเองที่ System Settings > Lock Screen"

cat <<MSG

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ติดตั้งเสร็จแล้ว เหลืออีก 3 อย่างที่ต้องทำเอง:

  1. แก้ $HUB/.env          ← ใส่ FB_HANDLE กับ FB_NAME ของคุณ
  2. แก้ $HUB/config/voice.md ← วางตัวอย่างข้อความของคุณเอง
  3. เปิด Chrome แล้วล็อกอิน Facebook:
         bash $HUB/bin/chrome-bot.sh
     หน้าต่างจะเด้งมา ให้ล็อกอินให้เรียบร้อย แล้วปล่อยค้างไว้

จากนั้นลองแบบไม่ส่งจริงก่อน:
     node $HUB/bin/fb-recent.js 7      # ดูว่าหาโพสต์เจอไหม
     node $HUB/bin/fb-pending.js 7     # ดูว่าใครยังไม่ได้ตอบ

เช็คสถานะได้ตลอดด้วย:
     fbhub status

อ่าน SOP.md ต่อ — ติ๊กไปทีละข้อ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
