#!/bin/zsh
# ทุก 10 นาที: ถ้าโควตากลุ่มว่างพอ → หย่อนงาน "คอมเมนต์ใต้โพสต์คนอื่นในกลุ่ม" เข้าคิวรวม
# ไม่ขับ Chrome เอง — งาน FB ทุกอย่างต้องต่อแถวกันที่ hub-run ไม่งั้นแย่ง Chrome กันแล้วพังทั้งคู่
#
#   fb-group-watch.sh              ทำงานปกติ (ตัวจับเวลาเรียก)
#   fb-group-watch.sh --render 10  พิมพ์งานที่จะเข้าคิวตอน 10 โมง (ไม่เข้าคิว) ไว้ตรวจก่อนเปิดจริง
#
# ⚠️ บรรทัด log ตอน "รอ/พัก" ห้ามมีคำว่า "ข้าม" — fb-deadman นับ "ข้าม" ติดกัน = ฝั่งกลุ่มค้าง
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
setopt NULL_GLOB
zmodload zsh/stat 2>/dev/null
HUB="$HOME/fb-hub"
source "$HUB/bin/load-env.sh"
JOBS="$HUB/jobs"
LOG="$HUB/logs/fb-group-watch.log"
DRAFTS="$HUB/state/group-drafts.json"
PROMPT="${FB_GROUP_PROMPT:-$HUB/prompts/group-comment.txt}"
mkdir -p "${LOG:h}" "$HUB/state"

: ${GROUP_MIN_FREE:=2}        # เข้าคิวเมื่อโควตาชั่วโมงนี้ว่าง ≥ เท่านี้ (ว่างช่องเดียวแล้วไปสแกนทั้งกลุ่ม = เปลือง AI)
: ${GROUP_QUIET_FROM:=1}      # งดช่วงคนนอน — คนจริงไม่ค่อยพิมพ์ตอนตีสาม คอมเมนต์ช่วงนั้นดูเป็นบอท
: ${GROUP_QUIET_TO:=6}
export GROUP_QUIET_FROM GROUP_QUIET_TO   # fb-group-pick.py ใช้ข้ามช่วงงดตอนแบ่งสัดส่วน
: ${SHOPEE_ENABLE:=0}
DRAFT_MAX_H=12                # ร่างค้างเกินนี้ = รอบก่อนพังกลางทาง → เก็บไว้แล้วสแกนใหม่ (ไม่ให้ค้างตลอดกาล)
STALE_MIN=90

mtime() { zstat +mtime -- "$1" 2>/dev/null || print 0 }
say() { print -r -- "$(date '+%F %T') $*" >> "$LOG" }

render_job() {   # $1 = ชั่วโมง (ไม่ใส่ = ตอนนี้)
  local pick gid gname shopee tpl
  pick="$(python3 "$HUB/bin/fb-group-pick.py" ${1:+--hour} $1)" || return 1
  gid="${pick%%$'\t'*}"; gname="${pick#*$'\t'}"
  shopee=no
  [[ "$SHOPEE_ENABLE" == 1 ]] && awk -F'\t' -v g="$gid" '$1==g && tolower($4) ~ /^(yes|y|1)$/ {f=1} END{exit !f}' "$HUB/config/groups.tsv" && shopee=yes
  tpl="$("$HUB/bin/render-prompt.sh" "$PROMPT")" || return 1
  # แทนด้วย zsh ไม่ใช้ sed — ชื่อกลุ่มมี & หรือ / ได้ แล้ว sed พัง
  tpl="${tpl//__GID__/$gid}"
  tpl="${tpl//__GROUP__/$gname}"
  # ส่วน Shopee อยู่ระหว่าง #SHOPEE-START / #SHOPEE-END — กลุ่มที่ไม่อนุญาต ตัดทิ้งทั้งก้อน (AI ไม่เห็นเลย ไม่เผลอแปะ)
  if [[ $shopee == yes ]]; then
    tpl="$(print -r -- "$tpl" | grep -v -e '^#SHOPEE-START$' -e '^#SHOPEE-END$')"
  else
    tpl="$(print -r -- "$tpl" | awk '/^#SHOPEE-START$/{s=1;next} /^#SHOPEE-END$/{s=0;next} !s')"
  fi
  print -r -- "#quiet"
  print -r -- "$tpl"
}
if [[ "$1" == "--render" ]]; then render_job "$2"; exit $?; fi

# 0) ยังไม่ได้ตั้งกลุ่ม = ฟีเจอร์นี้ปิดอยู่ ไม่ใช่ error
if ! python3 "$HUB/bin/fb-group-pick.py" >/dev/null 2>&1; then
  (( 10#$(date +%M) < 10 )) && say "พัก — ยังไม่ได้ตั้งกลุ่มใน config/groups.tsv"   # ชั่วโมงละบรรทัดพอ
  exit 0
fi

# 1) ช่วงคนนอน — จดแค่ครั้งแรกของชั่วโมง (log ยังขยับ ตัวเฝ้าไม่เข้าใจผิดว่าตาย)
hh=$((10#$(date +%H)))
if (( hh >= GROUP_QUIET_FROM && hh <= GROUP_QUIET_TO )); then
  (( 10#$(date +%M) < 10 )) && say "พักช่วงคนนอน $(printf %02d $GROUP_QUIET_FROM):00–$(printf %02d $GROUP_QUIET_TO):59"
  # งานที่เข้าคิวก่อนเข้าช่วงงดแต่ยังไม่ได้วิ่ง → ย้ายออก ไม่ให้ไปส่งตอนตีสอง (ต้นแบบเคยหลุดส่ง 02:34)
  for j in "$JOBS"/fbgroup-*.job; do
    mv "$j" "${j%.job}.quiet-skipped" 2>/dev/null && say "พัก — ย้ายงานค้างคิว ${j:t} ออก (เข้าช่วงคนนอน)"
  done
  exit 0
fi

# 2) เก็บกวาดงานค้างจากไฟดับ/โดนฆ่า (.running ไม่มีใครปิดให้ → รอบหน้ามองว่ามีงานอยู่ แล้วไม่ทำอะไรตลอดไป)
if [[ ! -d "$JOBS/.lock" ]]; then
  for r in "$JOBS"/fbgroup-*.running; do
    age=$(( ( $(date +%s) - $(mtime "$r") ) / 60 ))
    (( age >= STALE_MIN )) && mv "$r" "${r%.running}.killed-stale" && say "เก็บกวาดงานค้าง ${r:t} (${age} นาที ไม่มีตัวรันคิว)"
  done
fi

pending=("$JOBS"/fbgroup-*.job "$JOBS"/fbgroup-*.running)
if (( ${#pending} > 0 )); then
  say "รอ — มีงานคอมเมนต์กลุ่มอยู่ในคิวแล้ว"
  exit 0
fi

# 3) ร่างค้าง = รอบก่อนพังก่อนส่งครบ · ไม่ให้ล็อกระบบตลอดกาล (ต้นแบบ: ร่างค้างทำให้ 76/77 รอบไม่ทำอะไร)
if [[ -s "$DRAFTS" ]] && ! grep -q '^\[[[:space:]]*\]' "$DRAFTS"; then
  age_h=$(( ( $(date +%s) - $(mtime "$DRAFTS") ) / 3600 ))
  if (( age_h >= DRAFT_MAX_H )); then
    stamp=$(date '+%Y%m%d-%H%M%S')
    mv "$DRAFTS" "$HUB/state/group-drafts-expired-$stamp.json"
    print -r -- "[]" > "$DRAFTS"
    say "ร่างค้าง ${age_h} ชม. — เก็บไว้ที่ group-drafts-expired-$stamp.json แล้วสแกนใหม่"
  else
    say "รอ — มีร่างค้างจากรอบก่อน (${age_h} ชม.) รอบหน้าจะส่งต่อ"
  fi
fi

# 4) โควตา — ว่างไม่ถึง GROUP_MIN_FREE ยังไม่เข้าคิว (เช็กโควตาไม่เรียก AI ไม่เปลือง)
q="$(python3 "$HUB/bin/fb-quota.py" --group 2>&1)"; qrc=$?
if (( qrc != 0 )); then
  say "รอโควตาว่าง — $q"
  exit 0
fi
free="${${q##*เหลือชั่วโมงนี้ }%%)*}"
if [[ "$free" != <-> ]] || (( free < GROUP_MIN_FREE )); then
  say "รอโควตาว่าง (ว่าง ${free} ต้องการ ${GROUP_MIN_FREE}) — $q"
  exit 0
fi

"$HUB/bin/chrome-bot.sh" >> "$LOG" 2>&1

id="fbgroup-$(date '+%Y%m%d-%H%M%S')"
gid="$(python3 "$HUB/bin/fb-group-pick.py" | cut -f1)"
render_job > "$JOBS/$id.tmp" 2>> "$LOG"
# งานต้องชี้กลุ่มที่เลือกจริง และไม่เหลือ placeholder — ผิดข้อไหนไม่เข้าคิวและต้องดัง
if ! grep -qF "fb-group-scan.js $gid" "$JOBS/$id.tmp" || ! grep -qF "fb-group-comment.js $gid" "$JOBS/$id.tmp" \
   || grep -q -e '__GID__' -e '__GROUP__' -e '{{[A-Z_]*}}' "$JOBS/$id.tmp"; then
  rm -f "$JOBS/$id.tmp"
  say "ERROR งานที่สร้างไม่ชี้กลุ่ม $gid หรือมี placeholder ค้าง — ไม่เข้าคิว (เช็ก prompts/group-comment.txt)"
  python3 "$HUB/bin/notify-once.py" "group-render" "⚠️ fb-hub: สร้างงานคอมเมนต์กลุ่มไม่ได้ — เช็ก prompts/group-comment.txt" >> "$LOG" 2>&1
  exit 1
fi
mv "$JOBS/$id.tmp" "$JOBS/$id.job"      # mv ทีเดียว — ตัวรันคิวไม่เห็นไฟล์ครึ่ง ๆ
say "เข้าคิวแล้ว: $id (กลุ่ม $gid) · $q"
