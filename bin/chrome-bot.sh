#!/bin/bash
# Launch the bot's Chrome with a dedicated profile + CDP on port 9222.
# macOS: real window in the GUI session.  Linux/VPS: Xvfb virtual screen.
PORT=9222

# ponytail: หา Chrome ตัวแรกที่มีจริง แทนที่จะ if uname — ครอบทั้ง mac/ubuntu/debian
CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         google-chrome google-chrome-stable chromium chromium-browser; do
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
done
# --which = ตัวตรวจของไฟล์นี้ ต้องมาก่อนเช็คพอร์ต ไม่งั้นโดน already-running ดักจนตรวจไม่ได้
[ "$1" = "--which" ] && { echo "${CHROME:-ไม่เจอ Chrome}"; [ -n "$CHROME" ]; exit $?; }
if [ -z "$CHROME" ]; then
  echo "chrome-bot: หา Chrome ไม่เจอ — ลง Google Chrome ก่อน (Linux: apt install ./google-chrome-stable_current_amd64.deb)"
  exit 1
fi

if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "chrome-bot: already running"
  exit 0
fi

# VPS ไม่มีจอจริง → ยืมจอเสมือน (ต้อง apt install xvfb)
# ต้องเป็น array ไม่ใช่สตริง ไม่งั้น --server-args="..." โดนตัดเป็นหลายอาร์กิวเมนต์
XVFB=()
if [ "$(uname)" = "Linux" ] && [ -z "$DISPLAY" ]; then
  command -v xvfb-run >/dev/null 2>&1 || {
    echo "chrome-bot: Linux ไม่มี DISPLAY และไม่มี xvfb-run — apt install xvfb"; exit 1; }
  XVFB=(xvfb-run -a --server-args="-screen 0 1440x900x24")
fi

# Chrome ปฏิเสธการรันเป็น root ถ้าไม่ปิด sandbox (crbug 638180)
# ทางที่ดีกว่าคือสร้างผู้ใช้ธรรมดาไว้รันบอท — อันนี้เป็นทางหนีสำหรับ VPS ที่มีแต่ root
SANDBOX=()
[ "$(id -u)" = "0" ] && SANDBOX=(--no-sandbox)

"${XVFB[@]}" "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$HOME/chrome-bot" \
  --no-first-run --no-default-browser-check \
  "${SANDBOX[@]}" \
  >/dev/null 2>&1 &

for _ in $(seq 1 25); do
  sleep 1
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "chrome-bot: started on $PORT"
    exit 0
  fi
done
echo "chrome-bot: failed to start"
exit 1
