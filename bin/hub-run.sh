#!/bin/zsh
# คิวงานเดียวของมินิ — งาน Facebook ทุกอย่างต่อแถวกันตรงนี้ ห้ามรันพร้อมกัน
# (Chrome มีตัวเดียว สองงานขับพร้อมกันแล้วหน้าเว็บโดนปิดกลางคัน)
# รันในเซสชันหน้าจอผ่าน LaunchAgent com.fbhub.hubrun (WatchPaths ~/fb-hub/jobs)
export PATH="$HOME/.local/bin:$PATH"
export FB_HUB_ENV="$HOME/fb-hub/.env"
setopt NULL_GLOB
JOBS="$HOME/fb-hub/jobs"
LOCK="$JOBS/.lock"

# ponytail: mkdir เป็น lock ที่ atomic จริงบนทุกไฟล์ซิสเต็ม ไม่ต้องพึ่ง flock (macOS ไม่มี)
if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0            # มีตัวหนึ่งทำงานอยู่แล้ว — มันจะวนมาเก็บงานใหม่เอง
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

# วนจนกว่าจะไม่เหลืองาน (ไฟล์ที่มาระหว่างทางเก็บได้ในรอบเดียวกัน)
while true; do
  files=("$JOBS"/*.job)
  (( ${#files} == 0 )) && break

  for f in $files; do
    b="${f%.job}"
    mv "$f" "$b.running" 2>/dev/null || continue
    quiet=0
    [[ "$(head -1 "$b.running")" == "#quiet" ]] && quiet=1
    cd "$HOME"
    start=$(date +%s)
    print -r -- "RUNNING ${b:t} $start" > "$JOBS/.status"

    claude -p "$(cat "$b.running")" --output-format text \
        --permission-mode bypassPermissions > "$b.out" 2>&1
    code=$?
    print -r -- $code > "$b.exit"
    mv "$b.running" "$b.done"
    print -r -- "DONE ${b:t} $(date +%s) $(( $(date +%s) - start ))" > "$JOBS/.status"

    # งาน #quiet แจ้งเฉพาะตอนมีอะไรเกิดขึ้นจริง (กันเตือนทุก 30 นาทีตอนไม่มีงาน)
    if (( quiet )) && [[ $code -eq 0 ]] && ! head -1 "$b.out" | grep -q 'RESULT: SENT'; then
      continue
    fi
    {
      if [[ $code -eq 0 ]]; then
        print -r -- "🖥️ งานบนมินิเสร็จแล้ว"
      else
        print -r -- "⚠️ งานบนมินิจบแบบผิดพลาด (exit $code)"
      fi
      print -r -- ""
      head -c 800 "$b.out"
    } | python3 "$HOME/fb-hub/bin/notify.py" >/dev/null 2>&1

    # เว้นจังหวะสลับงานให้เหมือนคนจริง ไม่รัวติดกัน
    sleep $((20 + RANDOM % 40))
  done
done
