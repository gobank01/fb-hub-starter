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
[ -f "$HUB/config/no-reply.txt" ]     || cp "$SRC/config/no-reply.txt.example"     "$HUB/config/no-reply.txt"
[ -f "$HUB/config/banned-words.txt" ] || cp "$SRC/config/banned-words.txt.example" "$HUB/config/banned-words.txt"
touch "$HUB/state/progress.log" "$HUB/state/replies.tsv"

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

echo "▸ ต่อ Claude เข้ากับ Chrome ของบอท (Playwright MCP)"
# prompt สั่งให้ Claude "ใช้ playwright MCP ขับ Chrome" — ไม่ลงตัวนี้ Claude จะไม่มีมือคลิกเว็บเลย
# ชี้ไปที่ Chrome ตัวที่ chrome-bot.sh เปิดไว้ (พอร์ต 9222) ไม่ได้เปิดเบราว์เซอร์ใหม่
if command -v claude >/dev/null 2>&1; then
  claude mcp remove playwright --scope user >/dev/null 2>&1 || true
  claude mcp add playwright --scope user -- npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222 \
    && echo "  ✓ playwright MCP" || echo "  ⚠ ลงไม่สำเร็จ — รันเองทีหลัง: claude mcp add playwright --scope user -- npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222"
else
  echo "  ⚠ ยังไม่มีคำสั่ง claude — ลง Claude Code ก่อน (ดู README หัวข้อ 'ต้องมีอะไรก่อนเริ่ม') แล้วรัน install.sh ซ้ำ"
fi

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
ติดตั้งเสร็จแล้ว เหลืออีก 4 อย่างที่ต้องทำเอง:

  1. แก้ $HUB/.env          ← ใส่ FB_HANDLE กับ FB_NAME ของคุณ
  2. แก้ $HUB/config/voice.md ← เล่าน้ำเสียงของคุณ
  3. ใส่คีย์ Telegram ใน .env แล้วทดสอบ:
         python3 $HUB/bin/notify.py --test
  4. เปิด Chrome แล้วล็อกอิน Facebook:
         bash $HUB/bin/chrome-bot.sh
     หน้าต่างจะเด้งมา ให้ล็อกอินให้เรียบร้อย แล้วปล่อยค้างไว้

จากนั้นลองแบบไม่ส่งจริงก่อน:
     node $HUB/bin/fb-recent.js 7      # ดูว่าหาโพสต์เจอไหม
     node $HUB/bin/fb-pending.js 7     # ดูว่าใครยังไม่ได้ตอบ

เช็คสถานะได้ตลอดด้วย:
     fbhub status

อยากดู log จากมือถือ (ของเสริม ไม่ทำก็ได้):
     อ่าน dashboard/README.md แล้วรัน  fbhub dashboard

อ่าน SOP.md ต่อ — ติ๊กไปทีละข้อ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
