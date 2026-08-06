#!/usr/bin/env python3
# ยิงสรุปสถานะบอทตอบคอมเมนต์ขึ้นเว็บ os.environ['DASHBOARD_URL'] ทุก 5 นาที
# Vercel เข้าถึงเครื่องนี้ตรง ๆ ไม่ได้ (อยู่หลัง Tailscale) มินิจึงต้องเป็นฝ่ายยิงออก
import json, os, pathlib, re, urllib.request
from datetime import datetime

H = pathlib.Path.home()
JOBS, LOGS = H / 'fb-hub/jobs', H / 'fb-hub/logs'
tail = lambda p, n: (p.read_text(errors='replace').splitlines()[-n:] if p.exists() else [])

# บรรทัดที่ตอบคนจริง — รองรับทั้งแบบมีวันที่ (ของใหม่) และมีแต่เวลา (ของเก่า)
sent = []
for l in tail(H / 'fb-hub/state/progress.log', 400):
    m = re.match(r'^((?:\d{4}-\d\d-\d\d )?\d\d:\d\d:\d\d)\s+(SENT|FOLLOWUP|CODY-FOLLOWUP)\s+(.*)$', l)
    if not m:
        continue
    rest = m.group(3)
    url = (re.search(r'https?://\S+', rest) or [None])
    url = url.group(0) if hasattr(url, 'group') else ''
    sent.append({'at': m.group(1), 'kind': m.group(2), 'who': re.sub(r'\s*https?://\S+.*$', '', rest).strip(), 'url': url})
sent.reverse()

rounds = []
for f in sorted(JOBS.glob('*.out'), key=lambda p: p.stat().st_mtime, reverse=True)[:8]:
    body = f.read_text(errors='replace').strip()
    if not body:
        continue
    rounds.append({
        'name': f.stem,
        'at': datetime.fromtimestamp(f.stat().st_mtime).strftime('%Y-%m-%d %H:%M'),
        'head': next((x for x in body.splitlines() if x.strip()), '')[:160],
        'body': body[:12000],
    })

status = (JOBS / '.status').read_text().strip() if (JOBS / '.status').exists() else ''
snap = {
    'taken_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'status': status,
    'queue': sorted(p.name for p in JOBS.glob('*.job')),
    'sent': sent[:120],
    'rounds': rounds,
    'watch_log': '\n'.join(tail(LOGS / 'fb-watch.log', 60)),
    'notes': [],
}

req = urllib.request.Request(
    'os.environ['DASHBOARD_URL']/api/push',
    data=json.dumps(snap, ensure_ascii=False).encode(),
    headers={'Content-Type': 'application/json', 'x-secret': os.environ.get('FB_LOG_SECRET', '')},
    method='POST')
print(urllib.request.urlopen(req, timeout=25).read().decode())
