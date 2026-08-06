#!/bin/bash
# ติดตั้ง "ฝั่งคนสั่ง" — รันบน **เครื่องคุณเอง** ไม่ใช่เครื่องบอท
#   bash install-controller.sh
#
# เสร็จแล้วจะสั่งเครื่องบอทจากเครื่องนี้ได้เลย เช่น  fbhub status / fbhub job "..."
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"

if [ -d "$HOME/fb-hub" ]; then
  echo "⚠️  เครื่องนี้มี ~/fb-hub อยู่ = เป็นเครื่องบอทเอง ไม่ต้องลงตัวคุม"
  exit 1
fi

echo "▸ หาเครื่องบอทในวงแลน"
found=$(for i in $(seq 1 254); do
  net=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  net=${net%.*}
  (nc -z -G1 "$net.$i" 22 2>/dev/null && nc -z -G1 "$net.$i" 5900 2>/dev/null && echo "$net.$i" &)
done; sleep 12; true)

[ -n "$found" ] && { echo "  เจอเครื่องที่เปิดทั้ง SSH และ Screen Sharing:"; echo "$found" | sed 's/^/    /'; }

echo
read -r -p "ใส่ user@host ของเครื่องบอท (เช่น bot@192.168.1.38 หรือ bot@mac-mini.local): " REMOTE
[ -z "$REMOTE" ] && { echo "ยกเลิก"; exit 1; }

echo "▸ ทดสอบ ssh"
if ! ssh -o ConnectTimeout=8 -o BatchMode=yes "$REMOTE" 'test -x $HOME/fb-hub/bin/fbhub' 2>/dev/null; then
  echo
  echo "  ต่อไม่ได้ หรือเครื่องนั้นยังไม่ได้ลง fb-hub — เช็ค:"
  echo "    1. ssh $REMOTE            เข้าได้ไหม (ถ้าถามรหัสทุกครั้ง → ssh-copy-id $REMOTE)"
  echo "    2. บนเครื่องนั้นรัน bash install.sh แล้วหรือยัง"
  exit 1
fi

printf '%s\n' "$REMOTE" > "$HOME/.fbhub-remote"

mkdir -p "$HOME/.local/bin"
cp "$SRC/bin/fbhub" "$HOME/.local/bin/fbhub"
chmod +x "$HOME/.local/bin/fbhub"

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
     echo "  เพิ่ม ~/.local/bin ลง PATH แล้ว — เปิด terminal ใหม่ หรือ source ~/.zshrc" ;;
esac

cat <<MSG

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
เสร็จแล้ว — สั่งเครื่องบอทจากเครื่องนี้ได้เลย

  fbhub status              เปิดอยู่ไหม ตอบไปกี่คนวันนี้
  fbhub off                 หยุดบอท
  fbhub job "ไปตอบคอมเมนต์โพสต์ https://... ให้หน่อย"
  fbhub result <job-id>     ดูผลงานที่สั่งไป
  fbhub screen              เปิดหน้าจอเครื่องบอท
  fbhub shell               ssh เข้าไปเอง

คำสั่งทุกตัวเหมือนกับตอนอยู่บนเครื่องบอทเป๊ะ ไม่ต้องจำสองชุด
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
