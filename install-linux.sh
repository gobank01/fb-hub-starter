#!/bin/bash
# ติดตั้ง fb-hub บน Linux (Ubuntu/Debian) — รันเป็น root ครั้งเดียว
#   bash install-linux.sh [ชื่อผู้ใช้ที่จะรันบอท]   (ไม่ใส่ = fbhub)
#
# ต่างจาก install.sh (macOS) ตรงที่ใช้ systemd แทน launchd และไม่มี pmset
set -e

BOT_USER="${1:-fbhub}"
SRC="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" = "0" ] || { echo "ต้องรันเป็น root (sudo bash install-linux.sh)"; exit 1; }

# ─── ผู้ใช้สำหรับรันบอท ───────────────────────────────────────────
# ไม่รันเป็น root เพราะ Chrome ต้องปิด sandbox ถ้าเป็น root
if ! id "$BOT_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$BOT_USER" >/dev/null
  echo "▸ สร้างผู้ใช้ $BOT_USER"
fi
HOME_DIR="$(getent passwd "$BOT_USER" | cut -d: -f6)"
HUB="$HOME_DIR/fb-hub"

# ─── ของที่ต้องมี ────────────────────────────────────────────────
echo "▸ ตรวจของที่ต้องมี"
MISSING=""
command -v google-chrome >/dev/null 2>&1 || MISSING="$MISSING google-chrome"
command -v node          >/dev/null 2>&1 || MISSING="$MISSING nodejs"
command -v xvfb-run      >/dev/null 2>&1 || MISSING="$MISSING xvfb"
command -v python3       >/dev/null 2>&1 || MISSING="$MISSING python3"
fc-list :lang=th 2>/dev/null | grep -q . || MISSING="$MISSING fonts-thai-tlwg"
if [ -n "$MISSING" ]; then
  echo "  ✗ ยังขาด:$MISSING"
  echo "    ลงก่อนด้วย:  bash $SRC/bootstrap-linux.sh"
  exit 1
fi
echo "  ✓ ครบ"

# ─── วางไฟล์ ─────────────────────────────────────────────────────
echo "▸ ติดตั้งลง $HUB"
mkdir -p "$HUB"/{bin,prompts,config,state,logs,jobs}
cp "$SRC"/bin/*     "$HUB/bin/"
cp "$SRC"/prompts/* "$HUB/prompts/"
chmod +x "$HUB"/bin/*.sh "$HUB"/bin/*.py "$HUB"/bin/fbhub 2>/dev/null || true

# ไฟล์ที่ผู้ใช้ต้องแก้เอง — ไม่ทับของเดิม
[ -f "$HUB/.env" ]                  || cp "$SRC/.env.example"                  "$HUB/.env"
[ -f "$HUB/config/post-notes.tsv" ] || cp "$SRC/config/post-notes.tsv.example" "$HUB/config/post-notes.tsv"
[ -f "$HUB/config/voice.md" ]       || cp "$SRC/config/voice.md.example"       "$HUB/config/voice.md"
touch "$HUB/state/progress.log" "$HUB/state/used-replies.txt"

echo "▸ เรียก fbhub ได้จากทุกที่"
mkdir -p "$HOME_DIR/.local/bin"
ln -sf "$HUB/bin/fbhub" "$HOME_DIR/.local/bin/fbhub"
grep -q '.local/bin' "$HOME_DIR/.bashrc" 2>/dev/null || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME_DIR/.bashrc"

echo "▸ ติดตั้ง playwright-core"
cp "$SRC/package.json" "$HUB/"
chown -R "$BOT_USER:$BOT_USER" "$HOME_DIR"
su - "$BOT_USER" -c "cd '$HUB' && npm install --silent"

# ─── ตัวจับเวลา ──────────────────────────────────────────────────
echo "▸ ตั้งตัวจับเวลา (systemd)"
for f in "$SRC"/config/systemd/*; do
  n="$(basename "$f")"
  sed "s|__HOME__|$HOME_DIR|g; s|__USER__|$BOT_USER|g" "$f" > "/etc/systemd/system/$n"
done
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/fbhub-*.{service,timer,path} 2>&1 | grep -v '^$' && \
  echo "  ⚠ systemd บ่น — อ่านข้างบน" || echo "  ✓ systemd-analyze verify ผ่าน"

# จอเสมือน + ตัวให้ดูหน้าจอ เปิดตลอด (ไม่ได้ยิงคอมเมนต์ ปลอดภัย)
systemctl enable --now fbhub-xvfb.service fbhub-x11vnc.service fbhub-chrome.service >/dev/null 2>&1
echo "  ✓ จอเสมือน :99 + VNC (localhost:5900) เปิดแล้ว"

# เปิดเฉพาะตัวเฝ้าคิว ตัวจับเวลาที่ยิงคอมเมนต์จริงยังไม่เปิด (ใช้ fbhub on)
systemctl enable --now fbhub-hubrun.path >/dev/null 2>&1
echo "  ✓ fbhub-hubrun.path (คิวงาน) เปิดแล้ว"
echo "  · fbwatch/fbinbox/logpush ยังไม่เปิด — สั่ง 'fbhub on' เมื่อพร้อม"

grep -q "DISPLAY=:99" "$HOME_DIR/.bashrc" 2>/dev/null || \
  echo 'export DISPLAY=:99' >> "$HOME_DIR/.bashrc"

cat <<MSG

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ติดตั้งเสร็จ เหลืออีก 3 อย่างที่ต้องทำเอง (ในนาม $BOT_USER):

  1. แก้ $HUB/.env            ← FB_HANDLE / FB_NAME / OWNER
  2. แก้ $HUB/config/voice.md ← วางคอมเมนต์เก่าของตัวเอง 10-20 อัน
  3. ล็อกอิน Facebook (เครื่องนี้ไม่มีจอ ต้องดูผ่าน VNC):
         su - $BOT_USER -c 'bash ~/fb-hub/bin/chrome-bot.sh'
         x11vnc -display :99 -localhost -nopw     # แล้วต่อผ่าน Tailscale/ssh -L 5900

ลองแบบไม่ส่งจริงก่อนเสมอ:
     su - $BOT_USER -c 'node ~/fb-hub/bin/fb-recent.js 7'
     su - $BOT_USER -c 'fbhub dry'

อ่าน SOP.md ต่อ — ติ๊กไปทีละข้อ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
