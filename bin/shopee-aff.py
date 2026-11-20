#!/usr/bin/env python3
"""shopee-aff.py — หาสินค้า Shopee ที่เข้ากับโพสต์ + ทำลิงก์ affiliate ของคุณ (นายหน้า Shopee)

    shopee-aff.py --find "กระเป๋า ผ้า แม่ลูกอ่อน" [5]   หาสินค้า → JSON [{name, price, commission, link, product_url}]
    shopee-aff.py --link <ลิงก์สินค้า Shopee> [subId]     แปลงลิงก์สินค้าเป็นลิงก์ affiliate สั้น (ต้องมี API)
    shopee-aff.py --selftest                              ยิง API จริง 1 ครั้ง เช็กว่าคีย์ใช้ได้
    shopee-aff.py --import <ไฟล์รายงาน.csv>              นำเข้ารายงานคอมมิชชั่นจากหน้า Shopee Affiliate (ไปโชว์บน dashboard)
    shopee-aff.py --stats                                 ลิงก์ที่แปะไปแล้ว + คอมมิชชั่นที่นำเข้า
    shopee-aff.py --demo                                  เช็กตัวเอง (ไม่ต่อเน็ต)

มี 2 โหมด เลือกอัตโนมัติ:
  1) โหมด API — ตั้ง SHOPEE_APP_ID + SHOPEE_APP_SECRET ใน ~/fb-hub/.env
     (ขอจากหน้า Shopee Affiliate → Open API · ต้องได้รับอนุมัติก่อน ไม่ใช่ทุกบัญชีได้)
     หาสินค้าจากคำค้นได้เอง + สร้างลิงก์สั้นพร้อม subId (แยกยอดตามกลุ่มได้ในรายงาน Shopee)
  2) โหมดรายการ — ยังไม่มี API ก็ใช้ได้
     สร้างลิงก์เองจากหน้า Shopee Affiliate (Custom Link) แล้ววางลง ~/fb-hub/config/shopee-links.tsv
     บอทเลือกจากรายการนี้ตามคำค้น — ไม่เดา ไม่แต่งลิงก์เอง

ลิงก์ที่ใช้ได้ต้องเป็น https://s.shopee.co.th/... หรือ https://shope.ee/... หรือ https://shopee.co.th/... เท่านั้น
"""
import csv, hashlib, io, json, os, re, sys, time, urllib.request
from datetime import datetime

HUB = os.path.expanduser("~/fb-hub")
LINKS = os.path.join(HUB, "config/shopee-links.tsv")
POSTED = os.path.join(HUB, "state/shopee-posted.tsv")
COMMISSION = os.path.join(HUB, "state/shopee-commission.json")
DEFAULT_API = "https://open-api.affiliate.shopee.co.th/graphql"
SHOPEE = re.compile(r"^https://(s\.shopee\.co\.th|shope\.ee|shopee\.co\.th)/\S+$")


def _load_env():
    try:
        for line in open(os.path.join(HUB, ".env"), encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.split(" #")[0].strip().strip("\"'"))
    except OSError:
        pass


def words(s):
    """ตัดคำแบบหยาบ: คั่นด้วยช่องว่าง/จุลภาค + ตัดเป็นชิ้น 3 ตัวอักษรไว้จับภาษาไทยที่ไม่เว้นวรรค"""
    s = s.lower()
    toks = {t for t in re.split(r"[\s,/|]+", s) if len(t) >= 2}
    flat = re.sub(r"\s+", "", s)
    return toks | {flat[i:i + 3] for i in range(max(0, len(flat) - 2))}


# ── โหมดรายการ ─────────────────────────────────────────────────
def load_list(text):
    """คำค้น⇥ชื่อสินค้า⇥ลิงก์ affiliate⇥ราคา(ไม่บังคับ)⇥คอมมิชชั่น%(ไม่บังคับ)"""
    out = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        f = line.split("\t") + [""] * 5
        kw, name, link = f[0].strip(), f[1].strip(), f[2].strip()
        if not SHOPEE.match(link):
            continue
        out.append({"keywords": kw, "name": name, "link": link, "price": f[3].strip(), "commission": f[4].strip(), "product_url": ""})
    return out


def find_in_list(rows, query, n=5):
    q = words(query)
    scored = []
    for r in rows:
        kw = words(r["keywords"] + " " + r["name"])
        s = len(q & kw)
        if s >= 2:
            scored.append((s, r))
    scored.sort(key=lambda x: -x[0])
    return [r for _, r in scored[:n]]


# ── โหมด API ───────────────────────────────────────────────────
def sign(app_id, secret, ts, payload):
    return hashlib.sha256(f"{app_id}{ts}{payload}{secret}".encode()).hexdigest()


def gql(query, variables=None):
    app_id, secret = os.environ.get("SHOPEE_APP_ID", "").strip(), os.environ.get("SHOPEE_APP_SECRET", "").strip()
    if not app_id or not secret:
        raise RuntimeError("ยังไม่ได้ตั้ง SHOPEE_APP_ID / SHOPEE_APP_SECRET ใน ~/fb-hub/.env")
    payload = json.dumps({"query": query, "variables": variables or {}}, separators=(",", ":"), ensure_ascii=False)
    ts = str(int(time.time()))
    req = urllib.request.Request(
        os.environ.get("SHOPEE_API_URL", "").strip() or DEFAULT_API,
        data=payload.encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": f"SHA256 Credential={app_id}, Timestamp={ts}, Signature={sign(app_id, secret, ts, payload)}"},
        method="POST")
    body = json.loads(urllib.request.urlopen(req, timeout=25).read().decode())
    if body.get("errors"):
        raise RuntimeError("Shopee API ตอบ error: " + json.dumps(body["errors"], ensure_ascii=False)[:400])
    return body.get("data") or {}


FULL_FIELDS = "productName itemId price commissionRate sales shopName offerLink productLink imageUrl"
MIN_FIELDS = "productName offerLink productLink"


def find_api(query, n=5):
    q = "query($k:String,$l:Int){productOfferV2(keyword:$k,sortType:2,page:1,limit:$l){nodes{%s}}}"
    try:
        data = gql(q % FULL_FIELDS, {"k": query, "l": n})
    except RuntimeError as e:
        if "Cannot query field" not in str(e) and "field" not in str(e).lower():
            raise
        data = gql(q % MIN_FIELDS, {"k": query, "l": n})   # ชื่อฟิลด์เปลี่ยน → ขอเท่าที่จำเป็น
    out = []
    for it in ((data.get("productOfferV2") or {}).get("nodes") or []):
        link = it.get("offerLink") or ""
        if not SHOPEE.match(link):
            continue
        rate = it.get("commissionRate")
        out.append({"name": it.get("productName", ""), "price": str(it.get("price") or ""),
                    "commission": f"{float(rate) * 100:.1f}%" if rate not in (None, "") else "",
                    "sales": it.get("sales"), "shop": it.get("shopName", ""),
                    "link": link, "product_url": it.get("productLink", ""), "image": it.get("imageUrl", "")})
    return out


def short_link(url, sub_id=""):
    sub = [re.sub(r"[^A-Za-z0-9]", "", sub_id)[:50]] if sub_id else []
    m = "mutation($u:String!,$s:[String]){generateShortLink(input:{originUrl:$u,subIds:$s}){shortLink}}"
    link = ((gql(m, {"u": url, "s": sub}).get("generateShortLink") or {}).get("shortLink") or "")
    if not SHOPEE.match(link):
        raise RuntimeError(f"ได้ลิงก์หน้าตาไม่ใช่ Shopee กลับมา: {link[:80]!r}")
    return link


def has_api():
    return bool(os.environ.get("SHOPEE_APP_ID", "").strip() and os.environ.get("SHOPEE_APP_SECRET", "").strip())


def cmd_find(query, n=5):
    if has_api():
        res = find_api(query, n)
    else:
        try:
            res = find_in_list(load_list(open(LINKS, encoding="utf-8").read()), query, n)
        except OSError:
            res = []
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if not res:
        print("ไม่เจอสินค้าที่เข้ากับคำค้นนี้ — คอมเมนต์เปล่า ๆ ไม่ต้องแปะลิงก์", file=sys.stderr)
    return 0


# ── รายงานคอมมิชชั่น (ไฟล์ CSV ที่ดาวน์โหลดจากหน้า Shopee Affiliate) ─────
# หัวคอลัมน์ของ Shopee เปลี่ยนได้และมีทั้งไทย/อังกฤษ → หาคอลัมน์ด้วยคำ ไม่ผูกชื่อเป๊ะ
def _col(headers, *keys):
    for h in headers:
        hl = h.lower()
        if any(k in hl for k in keys):
            return h
    return None


def _num(s):
    s = re.sub(r"[^0-9.\-]", "", str(s or ""))
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def summarize_csv(text):
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    if not rows:
        return None
    hd = list(rows[0].keys())
    c_com = _col(hd, "net commission", "คอมมิชชั่นสุทธิ", "ค่าคอมมิชชั่นสุทธิ", "commission", "คอมมิชชั่น")
    c_date = _col(hd, "purchase time", "order time", "เวลาสั่งซื้อ", "วันที่สั่งซื้อ", "date", "เวลา", "วันที่")
    c_sub = _col(hd, "sub_id", "sub id", "subid")
    c_status = _col(hd, "status", "สถานะ")
    if not c_com:
        raise ValueError("หาคอลัมน์คอมมิชชั่นในไฟล์ไม่เจอ หัวคอลัมน์ที่เห็น: " + ", ".join(hd[:15]))
    by_day, by_sub, total, orders = {}, {}, 0.0, 0
    for r in rows:
        st = (r.get(c_status) or "").lower() if c_status else ""
        if any(w in st for w in ("cancel", "ยกเลิก", "invalid")):
            continue
        v = _num(r.get(c_com))
        total += v; orders += 1
        d = (r.get(c_date) or "")[:10] if c_date else ""
        if d:
            by_day[d] = by_day.get(d, 0) + v
        s = (r.get(c_sub) or "").strip() if c_sub else ""
        if s:
            by_sub[s] = by_sub.get(s, 0) + v
    return {"imported_at": datetime.now().strftime("%Y-%m-%d %H:%M"), "orders": orders, "total": round(total, 2),
            "by_day": {k: round(v, 2) for k, v in sorted(by_day.items())[-60:]},
            "by_sub": {k: round(v, 2) for k, v in sorted(by_sub.items(), key=lambda x: -x[1])[:30]}}


def cmd_import(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "utf-8", "cp874", "tis-620"):
        try:
            text = raw.decode(enc); break
        except UnicodeDecodeError:
            continue
    s = summarize_csv(text)
    if not s:
        print("ไฟล์ว่าง"); return 1
    os.makedirs(os.path.dirname(COMMISSION), exist_ok=True)
    json.dump(s, open(COMMISSION, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"✅ นำเข้าแล้ว: {s['orders']} ออเดอร์ · คอมมิชชั่นรวม ฿{s['total']:,.2f} → dashboard รอบถัดไป")
    return 0


def posted_rows():
    try:
        return [l.rstrip("\n").split("\t") for l in open(POSTED, encoding="utf-8") if l.strip()]
    except OSError:
        return []


def cmd_stats():
    rows = posted_rows()
    today = datetime.now().strftime("%Y-%m-%d")
    print(f"ลิงก์ที่แปะไปแล้ว: {len(rows)} ครั้ง (วันนี้ {sum(r[0].startswith(today) for r in rows)})")
    try:
        c = json.load(open(COMMISSION, encoding="utf-8"))
        print(f"คอมมิชชั่น (นำเข้า {c['imported_at']}): ฿{c['total']:,.2f} จาก {c['orders']} ออเดอร์")
    except (OSError, ValueError, KeyError):
        print("คอมมิชชั่น: ยังไม่ได้นำเข้า — ดาวน์โหลดรายงานจากหน้า Shopee Affiliate แล้ว shopee-aff.py --import <ไฟล์>")
    return 0


def demo():
    rows = load_list("# c\nกระเป๋าผ้า แม่ลูกอ่อน\tกระเป๋าใส่ของลูก\thttps://s.shopee.co.th/AbC\t259\t8%\n"
                     "หูฟัง บลูทูธ\tหูฟังไร้สาย\thttps://evil.example/x\n"
                     "ที่ลับมีด ครัว\tที่ลับมีด 3 ชั้น\thttps://shope.ee/Xyz\n")
    assert len(rows) == 2, "ลิงก์ที่ไม่ใช่ Shopee ต้องถูกทิ้ง"
    hit = find_in_list(rows, "มีใครแนะนำกระเป๋าใส่ของลูกอ่อนบ้าง", 3)
    assert hit and hit[0]["link"].endswith("AbC"), hit
    assert not find_in_list(rows, "แมวไม่กินข้าว", 3), "ไม่เกี่ยวต้องไม่เจอ"
    assert sign("1", "s", "100", "{}") == hashlib.sha256(b"1100{}s").hexdigest()
    csvt = "﻿Order ID,Purchase Time,Order Status,Net Commission(฿),Sub_id1\n1,2026-11-01 10:00,Completed,12.50,g111\n" \
           "2,2026-11-01 11:00,Cancelled,99,g111\n3,2026-11-02 09:00,Pending,7.5,g222\n"
    s = summarize_csv(csvt)
    assert s["orders"] == 2 and s["total"] == 20.0 and s["by_day"]["2026-11-01"] == 12.5 and s["by_sub"]["g111"] == 12.5, s
    try:
        summarize_csv("a,b\n1,2\n"); raise AssertionError("ไม่มีคอลัมน์คอมมิชชั่นต้อง error")
    except ValueError:
        pass
    print("✅ shopee-aff demo ผ่าน")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "--demo":
        sys.exit(demo())
    _load_env()
    try:
        if a[0] == "--find":
            sys.exit(cmd_find(a[1], int(a[2]) if len(a) > 2 else 5))
        if a[0] == "--link":
            if not has_api():
                sys.exit("โหมดรายการทำลิงก์เองไม่ได้ — ไปที่หน้า Shopee Affiliate → Custom Link แล้ววางลิงก์ที่ได้ลง config/shopee-links.tsv")
            print(short_link(a[1], a[2] if len(a) > 2 else "")); sys.exit(0)
        if a[0] == "--selftest":
            if not has_api():
                print("โหมดรายการ (ไม่มี API) —", len(load_list(open(LINKS, encoding="utf-8").read())) if os.path.exists(LINKS) else 0, "ลิงก์ใน config/shopee-links.tsv")
                sys.exit(0)
            r = find_api("กระเป๋า", 2)
            print(json.dumps(r, ensure_ascii=False, indent=1))
            print("✅ API ใช้ได้" if r else "⚠️ ต่อ API ได้แต่ไม่ได้สินค้ากลับมา")
            sys.exit(0 if r else 1)
        if a[0] == "--import":
            sys.exit(cmd_import(a[1]))
        if a[0] == "--stats":
            sys.exit(cmd_stats())
    except (RuntimeError, ValueError, OSError) as e:
        print(f"❌ {e}", file=sys.stderr); sys.exit(1)
    sys.exit(__doc__)
