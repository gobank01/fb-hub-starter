#!/bin/zsh
# ทุก 30 นาที: หย่อนงาน "เฝ้าคอมเมนต์" เข้าคิวรวม แล้วปล่อยให้ hub-run ทำตามคิว
# ไม่ขับ Chrome เอง — งาน FB ทุกอย่างต้องต่อแถวกัน ไม่งั้นแย่ง Chrome กันแล้วพังทั้งคู่
export PATH="$HOME/.local/bin:$PATH"
setopt NULL_GLOB          # ไม่มีไฟล์ตรงแพทเทิร์น = ได้ลิสต์ว่าง ไม่ใช่ error
JOBS="$HOME/fb-hub/jobs"
LOG="$HOME/fb-hub/logs/fb-watch.log"
mkdir -p "${LOG:h}"

# มีงานเฝ้าคอมเมนต์ค้างอยู่ในคิวแล้ว ไม่ต้องใส่ซ้ำ
pending=("$JOBS"/fbwatch-*.job "$JOBS"/fbwatch-*.running)
if (( ${#pending} > 0 )); then
  print -r -- "$(date '+%F %T') ข้าม — มีงานเฝ้าคอมเมนต์อยู่ในคิวแล้ว" >> "$LOG"
  exit 0
fi

"$HOME/fb-hub/bin/chrome-bot.sh" >> "$LOG" 2>&1

id="fbwatch-$(date '+%Y%m%d-%H%M%S')"
{ print -r -- "#quiet"; "$HOME/fb-hub/bin/render-prompt.sh" "$HOME/fb-hub/prompts/comment-watch.txt" } > "$JOBS/$id.job"
print -r -- "$(date '+%F %T') เข้าคิวแล้ว: $id" >> "$LOG"
