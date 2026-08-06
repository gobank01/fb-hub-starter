#!/bin/zsh
# แทนค่า {{...}} ในพรอมต์ด้วยค่าจาก ~/fb-hub/.env แล้วพ่นออก stdout
#   render-prompt.sh ~/fb-hub/prompts/comment-watch.txt
#
# แทนตอนสร้างงานทุกครั้ง ไม่ได้เขียนทับไฟล์ — พรอมต์จึงมีชุดเดียว
# แก้ .env แล้วมีผลรอบถัดไปทันที ไม่ต้อง render ใหม่
set -e
SRC="$1"
[[ -f "$SRC" ]] || { print -u2 -r -- "หาไฟล์ไม่เจอ: $SRC"; exit 1 }
source "$HOME/fb-hub/bin/load-env.sh"

# zsh :? ทำ escape ภาษาไทยเพี้ยน — เช็คเองแล้ว print เอง
if [[ -z "$FB_NAME" ]]; then
  print -u2 -r -- "❌ ยังไม่ได้ตั้ง FB_NAME ใน ~/fb-hub/.env"
  print -u2 -r -- "   FB_NAME = ชื่อที่ Facebook แสดงบนคอมเมนต์ของคุณ ต้องตรงเป๊ะ"
  exit 1
fi
: ${OWNER:=$FB_NAME}          # ไม่ได้ตั้งชื่อเรียกไว้ ก็ใช้ชื่อ Facebook ไปเลย
: ${MAX_PER_ROUND:=10}
: ${MIN_GAP:=70}
: ${MAX_GAP:=170}

sed -e "s|{{OWNER}}|$OWNER|g" \
    -e "s|{{FB_NAME}}|$FB_NAME|g" \
    -e "s|{{MAX_PER_ROUND}}|$MAX_PER_ROUND|g" \
    -e "s|{{MIN_GAP}}|$MIN_GAP|g" \
    -e "s|{{MAX_GAP}}|$MAX_GAP|g" "$SRC"

# เหลือ {{...}} = มี placeholder ตัวใหม่ที่ยังไม่ได้รองรับ ต้องส่งเสียง ไม่ใช่ปล่อยผ่าน
if grep -q '{{[A-Z_]*}}' "$SRC" && \
   sed -e "s|{{OWNER}}||g" -e "s|{{FB_NAME}}||g" -e "s|{{MAX_PER_ROUND}}||g" \
       -e "s|{{MIN_GAP}}||g" -e "s|{{MAX_GAP}}||g" "$SRC" | grep -q '{{[A-Z_]*}}'; then
  print -u2 -r -- "⚠️  ยังมี placeholder ที่แทนไม่ได้ใน $SRC:"
  grep -ohE '\{\{[A-Z_]+\}\}' "$SRC" | sort -u | sed 's/^/    /' >&2
fi
