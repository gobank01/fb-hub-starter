# ตัวเสริมที่ไม่ได้เปิดให้อัตโนมัติ

## ตอบอินบ็อกซ์ (`fb-inbox.sh` + `inbox-sweep.txt`)

**ไม่ติดตั้งให้โดยค่าเริ่มต้นแล้ว** (อัปเดต พ.ย. 69) เพราะ:

- ระบบต้นแบบเจ้าของสั่ง "ห้ามแตะอินบ็อกซ์" แต่ตัวตอบอินบ็อกซ์ยังเดินอยู่จริงในเครื่อง → ตอบแชทลูกค้าไปโดยไม่มีใครรู้
  บทเรียน: **มีกฎในเอกสารไม่พอ ต้องไม่มีตัวรันอยู่ในเครื่องด้วย**
- แชทส่วนตัวมีเรื่องเงิน/ออเดอร์ ผิดพลาดแล้วเสียหายกว่าคอมเมนต์สาธารณะมาก

ถ้าคิดดีแล้วว่าจะใช้จริง (macOS):
```bash
cp ~/fb-hub-starter/config/optional/fb-inbox.sh ~/fb-hub/bin/ && chmod +x ~/fb-hub/bin/fb-inbox.sh
cp ~/fb-hub-starter/config/optional/inbox-sweep.txt ~/fb-hub/prompts/
sed "s|\$HOME|$HOME|g" ~/fb-hub-starter/config/optional/com.fbhub.fbinbox.plist > ~/Library/LaunchAgents/com.fbhub.fbinbox.plist
launchctl load ~/Library/LaunchAgents/com.fbhub.fbinbox.plist
```
ปิด: `launchctl unload ~/Library/LaunchAgents/com.fbhub.fbinbox.plist && rm ~/Library/LaunchAgents/com.fbhub.fbinbox.plist`

Linux: ก๊อป `fbhub-fbinbox.service/.timer` ไป `/etc/systemd/system/` (แทน `__HOME__`/`__USER__`) แล้ว `systemctl enable --now fbhub-fbinbox.timer`
