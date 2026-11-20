#!/usr/bin/env python3
# ยิงสรุปสถานะบอทขึ้นเว็บ dashboard ทุก 5 นาที
#
# เว็บข้างนอกเข้าถึงเครื่องนี้ตรง ๆ ไม่ได้ (อยู่หลังเราเตอร์) เครื่องจึงต้องเป็นฝ่ายยิงออก
# ไม่ได้ตั้ง DASHBOARD_URL = ไม่ทำ dashboard = จบเงียบ ๆ ไม่ใช่ error
import json, os, pathlib, re, urllib.request
from datetime import datetime

# dashboard เป็นของเสริม ไม่ทำก็ได้ — ไม่ได้ตั้งค่าไว้ก็ออกเงียบ ๆ ไม่ต้องรก log ทุก 5 นาที
URL = os.environ.get('DASHBOARD_URL', '').strip().rstrip('/')
SECRET = os.environ.get('FB_LOG_SECRET', '').strip()
if not URL or not SECRET:
    raise SystemExit(0)

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

# ── ฝั่งกลุ่ม + Shopee + สถิติรายวัน (หน้า dashboard ใช้ทำการ์ด/กราฟ/ตารางรายกลุ่ม) ──
ST, CFG = H / 'fb-hub/state', H / 'fb-hub/config'
lines = lambda p: (p.read_text(errors='replace').splitlines() if p.exists() else [])
names = {}
for l in lines(CFG / 'groups.tsv'):
    f = l.split('\t')
    if len(f) >= 2 and f[0].strip().isdigit():
        names[f[0].strip()] = f[1].strip()

daily = {}                       # วันที่ → {own, group, links}
def bump(day, k):
    daily.setdefault(day, {'own': 0, 'group': 0, 'links': 0})[k] += 1
for l in lines(H / 'fb-hub/state/progress.log'):
    m = re.match(r'^(\d{4}-\d\d-\d\d) \d\d:\d\d:\d\d (\[group\] )?SENT\s', l)
    if m:
        bump(m.group(1), 'group' if m.group(2) else 'own')

groups, gsent = {}, []
for l in lines(ST / 'replies.tsv'):
    f = l.split('\t')
    if len(f) < 5 or '/groups/' not in f[2]:
        continue
    gm = re.search(r'/groups/(\d+)/', f[2])
    gid = gm.group(1) if gm else '?'
    link = f[6].strip() if len(f) >= 7 else ''
    g = groups.setdefault(gid, {'id': gid, 'name': names.get(gid, gid), 'total': 0, 'days': {}, 'links': 0})
    g['total'] += 1
    g['days'][f[0][:10]] = g['days'].get(f[0][:10], 0) + 1
    g['links'] += bool(link)
    gsent.append({'at': f[0], 'who': f[1], 'url': f[2], 'text': f[4][:600], 'topic': f[5][:120] if len(f) >= 6 else '',
                  'link': link, 'group': names.get(gid, gid)})
gsent.reverse()

links_total = 0
for l in lines(ST / 'shopee-posted.tsv'):
    if re.match(r'^\d{4}-\d\d-\d\d', l):
        links_total += 1
        bump(l[:10], 'links')

commission = None
try:
    commission = json.loads((ST / 'shopee-commission.json').read_text())
except (OSError, ValueError):
    pass

status = (JOBS / '.status').read_text().strip() if (JOBS / '.status').exists() else ''
snap = {
    'taken_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'status': status,
    'queue': sorted(p.name for p in JOBS.glob('*.job')),
    'sent': sent[:120],
    'rounds': rounds,
    'watch_log': '\n'.join(tail(LOGS / 'fb-watch.log', 60)),
    'group_log': '\n'.join(tail(LOGS / 'fb-group-watch.log', 40)),
    'notes': [],
    'group_sent': gsent[:150],
    'groups': sorted(groups.values(), key=lambda g: -g['total']),
    'daily': [{'day': d, **daily[d]} for d in sorted(daily)[-30:]],
    'links_total': links_total,
    'shopee_mode': 'api' if os.environ.get('SHOPEE_APP_ID', '').strip() else 'list',
    'commission': commission,
}

req = urllib.request.Request(
    URL + '/api/push',
    data=json.dumps(snap, ensure_ascii=False).encode(),
    headers={'Content-Type': 'application/json', 'x-secret': SECRET},
    method='POST')
print(urllib.request.urlopen(req, timeout=25).read().decode())
