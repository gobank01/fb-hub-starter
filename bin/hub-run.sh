#!/bin/zsh
# คิวงานเดียวของมินิ — งาน Facebook ทุกอย่างต่อแถวกันตรงนี้ ห้ามรันพร้อมกัน
# (Chrome มีตัวเดียว สองงานขับพร้อมกันแล้วหน้าเว็บโดนปิดกลางคัน)
# รันในเซสชันหน้าจอผ่าน LaunchAgent com.fbhub.hubrun (WatchPaths ~/fb-hub/jobs)
export PATH="$HOME/.local/bin:$PATH"
# โหลด .env ให้ทุก process ลูก (claude → node fb-recent.js อ่าน FB_HANDLE/FB_NAME จากตรงนี้)
source "$HOME/fb-hub/bin/load-env.sh"
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
    # หัวไฟล์งาน (บรรทัดต้น ๆ ที่ขึ้นต้นด้วย #) — ตัวเลือกของงานนั้น
    #   #quiet          แจ้งเตือนเฉพาะตอนมีอะไรเกิดขึ้นจริง
    #   #engine: shell  รันเป็นสคริปต์ zsh ตรง ๆ ไม่เรียก AI (งานเช็ก/ทดสอบ ไม่กินโควตา Claude)
    quiet=0; engine=claude
    grep -qx '#quiet' <(head -5 "$b.running") && quiet=1
    grep -qx '#engine: shell' <(head -5 "$b.running") && engine=shell
    cd "$HOME"
    start=$(date +%s)
    print -r -- "RUNNING ${b:t} $start" > "$JOBS/.status"

    if [[ $engine == shell ]]; then
      zsh "$b.running" > "$b.out" 2>&1
    else
      # --model: Sonnet พอสำหรับงานตอบคอมเมนต์ และกินโควตาน้อยกว่า Opus มาก
      #   (ระบบต้นแบบ: บอทตัวเดียวกินลิมิตรายสัปดาห์ 63% ใน 1.7 วันตอนใช้ Opus — และใช้บัญชีเดียวกับเจ้าของ)
      # --disallowedTools Agent: ห้ามแตกตัวเป็นเอเจนต์ย่อย — แต่ละตัวโหลดบริบทใหม่ กินโควตาคูณ
      claude -p "$(grep -v -e '^#quiet$' -e '^#engine:' "$b.running")" --output-format text \
          --model "${CLAUDE_MODEL:-sonnet}" --disallowedTools Agent \
          --permission-mode bypassPermissions > "$b.out" 2>&1
    fi
    code=$?
    print -r -- $code > "$b.exit"
    mv "$b.running" "$b.done"
    print -r -- "DONE ${b:t} $(date +%s) $(( $(date +%s) - start ))" > "$JOBS/.status"

    # งาน #quiet แจ้งเฉพาะตอนมีอะไรเกิดขึ้นจริง (กันเตือนทุก 30 นาทีตอนไม่มีงาน)
    if (( quiet )) && [[ $code -eq 0 ]] && ! head -1 "$b.out" | grep -qE 'RESULT: (SENT|LOGIN_LOST)'; then
      continue
    fi
    if [[ $code -ne 0 ]]; then
      # งานตามรอบล้มซ้ำ ๆ (Claude ติดลิมิต/ล็อกอินหลุด) = เรื่องเดียวกัน เตือนครั้งเดียวทุก 6 ชม.
      # ไม่งั้นเครื่องดับ 1 วันยิงเป็นร้อยข้อความ แล้วคนปิดเสียง (ระบบต้นแบบ: 294 ครั้งเรื่องเดียว)
      python3 "$HOME/fb-hub/bin/notify-once.py" "งานล้ม ${b:t} $(tail -1 "$b.out" | cut -c1-80)" \
        "⚠️ fb-hub งานจบแบบผิดพลาด (exit $code) — ${b:t}

$(tail -c 800 "$b.out")" >> "$HOME/fb-hub/logs/notify.log" 2>&1
    else
      # notify.py ทิ้งเศษตัวอักษรไทยที่ head -c ตัดขาดให้เอง
      { print -r -- "🖥️ fb-hub งานเสร็จ — ${b:t}"; print -r -- ""; head -c 800 "$b.out" } \
        | python3 "$HOME/fb-hub/bin/notify.py" >> "$HOME/fb-hub/logs/notify.log" 2>&1
    fi

    # เว้นจังหวะสลับงานให้เหมือนคนจริง ไม่รัวติดกัน
    sleep $((20 + RANDOM % 40))
  done
done
