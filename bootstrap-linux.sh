#!/bin/bash
# ลงของที่ระบบต้องมี บน Ubuntu/Debian เปล่า ๆ — รันเป็น root ก่อน install-linux.sh
#   bash bootstrap-linux.sh
set -e
[ "$(id -u)" = "0" ] || { echo "ต้องรันเป็น root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "▸ แพ็กเกจพื้นฐาน + ฟอนต์ไทย + จอเสมือน"
apt-get update -qq
# fonts-thai-tlwg สำคัญ — ไม่มีแล้ว Facebook เรนเดอร์ภาษาไทยเป็นกล่องสี่เหลี่ยม
apt-get install -y -qq curl gnupg ca-certificates git python3 \
                       xvfb x11vnc fonts-thai-tlwg fonts-noto-color-emoji

echo "▸ Google Chrome"
if ! command -v google-chrome >/dev/null 2>&1; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/chrome.deb
  rm -f /tmp/chrome.deb
fi

echo "▸ Node.js 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "▸ Claude Code"
command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code --silent

# swap กัน Chrome + claude ชน OOM บนเครื่อง RAM น้อย
if ! swapon --show | grep -q /swapfile; then
  echo "▸ swap 4GB"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo
echo "── เวอร์ชันที่ได้ ──"
google-chrome --version
echo "node $(node -v) · npm $(npm -v)"
# อย่าเรียก `claude --version` ตรง ๆ — บนเครื่องที่ยังไม่ได้ล็อกอินและไม่มี TTY มันค้างกินซีพียูเต็มคอร์
CC_PKG=/usr/lib/node_modules/@anthropic-ai/claude-code/package.json
[ -f "$CC_PKG" ] && echo "claude $(node -p "require('$CC_PKG').version")" || echo "claude: ลงไม่สำเร็จ"
echo "ฟอนต์ไทย $(fc-list :lang=th | wc -l) ตัว"
echo
echo "ต่อไป:  bash install-linux.sh"
