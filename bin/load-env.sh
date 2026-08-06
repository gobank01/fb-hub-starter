#!/bin/zsh
# โหลด ~/fb-hub/.env เข้า environment แบบทนคนเขียน
#   source ~/fb-hub/bin/load-env.sh
#
# ห้ามใช้ `source .env` ตรง ๆ — ค่าที่มีช่องว่างและไม่ได้ใส่ quote (FB_NAME=Joe Somchai)
# จะถูก zsh แตกคำแล้วรันเป็นคำสั่ง ("command not found: Somchai") ซึ่งคนกรอกจะเขียนแบบนั้นเป็นปกติ
#
# ห่อเป็นฟังก์ชันเพื่อให้ setopt เป็น local ไม่ไปเปลี่ยนพฤติกรรม shell ที่เรียกมา
__fbhub_load_env() {
  setopt local_options extended_glob
  local f="$HOME/fb-hub/.env"
  [[ -f "$f" ]] || return 0
  local line k v
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == \#* || "$line" != *=* ]] && continue
    k="${line%%=*}"; v="${line#*=}"
    k="${k//[[:space:]]/}"
    # ตัดคอมเมนต์ท้ายบรรทัด เฉพาะตอนที่ # มีช่องว่างนำหน้า
    # (ไม่งั้นค่าที่มี # อยู่ในตัว เช่น URL หรือแฮชแท็ก จะโดนตัดทิ้ง)
    [[ "$v" == *[[:space:]]\#* ]] && v="${v%%[[:space:]]\#*}"
    v="${v##[[:space:]]##}"; v="${v%%[[:space:]]##}"
    v="${v#[\"\']}"; v="${v%[\"\']}"
    [[ -n "$k" ]] && export "$k=$v"
  done < "$f"
}
__fbhub_load_env
unset -f __fbhub_load_env
