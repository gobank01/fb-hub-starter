import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

export const dynamic = 'force-dynamic';

type Sent = { at: string; who: string; url: string; kind: string };
type GSent = { at: string; who: string; url: string; text: string; topic: string; link: string; group: string };
type Group = { id: string; name: string; total: number; days: Record<string, number>; links: number };
type Day = { day: string; own: number; group: number; links: number };
type Commission = { imported_at: string; orders: number; total: number; by_day: Record<string, number>; by_sub: Record<string, number> };
type Snap = {
  taken_at: string;
  status: string;
  queue: string[];
  sent: Sent[];
  rounds: { name: string; at: string; head: string; body: string }[];
  watch_log: string;
  notes: string[];
  // ของใหม่ (ฝั่งกลุ่ม + Shopee) — เครื่องที่ยังไม่อัปเดตจะไม่มีช่องพวกนี้ หน้าต้องไม่พัง
  group_log?: string;
  group_sent?: GSent[];
  groups?: Group[];
  daily?: Day[];
  links_total?: number;
  shopee_mode?: 'api' | 'list';
  commission?: Commission | null;
};

const baht = (n: number) => '฿' + n.toLocaleString('th-TH', { maximumFractionDigits: 2 });

// วันที่ย้อนหลัง n วัน (เวลาไทย) เรียงเก่า→ใหม่
function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }));
  }
  return out;
}

// กราฟแท่งซ้อน 14 วัน: โพสต์ตัวเอง + ในกลุ่ม — ทำด้วย CSS ล้วน ไม่ต้องพึ่งไลบรารีกราฟ
function Bars({ daily }: { daily: Day[] }) {
  const map = Object.fromEntries(daily.map((d) => [d.day, d]));
  const days = lastDays(14).map((day) => map[day] ?? { day, own: 0, group: 0, links: 0 });
  const max = Math.max(1, ...days.map((d) => d.own + d.group));
  return (
    <div className="bars" role="img" aria-label="จำนวนคอมเมนต์ 14 วันล่าสุด">
      {days.map((d) => (
        <div className="bar" key={d.day} title={`${d.day}: ตอบโพสต์ตัวเอง ${d.own} · ในกลุ่ม ${d.group} · ลิงก์ ${d.links}`}>
          <div className="stack">
            <div className="seg group" style={{ height: `${(d.group / max) * 100}%` }} />
            <div className="seg own" style={{ height: `${(d.own / max) * 100}%` }} />
          </div>
          <div className="n mono">{d.own + d.group || ''}</div>
          <div className="d mono">{d.day.slice(8)}</div>
        </div>
      ))}
    </div>
  );
}

async function load(): Promise<{ snap: Snap | null; updated: string | null }> {
  // ดูหน้าตาก่อน deploy โดยไม่ต้องมีฐานข้อมูล: DEMO_SNAPSHOT=../demo-snapshot.json npm run dev
  if (process.env.DEMO_SNAPSHOT) {
    return { snap: JSON.parse(readFileSync(process.env.DEMO_SNAPSHOT, 'utf8')), updated: new Date().toISOString() };
  }
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const r = await sql`SELECT data, updated_at FROM fb_log WHERE id = 1`;
    if (!r.length) return { snap: null, updated: null };
    return { snap: r[0].data as Snap, updated: r[0].updated_at as string };
  } catch {
    return { snap: null, updated: null };
  }
}

const th = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) : '—';

// สดแค่ไหน — เกิน 15 นาทีแปลว่ามินิหยุดส่งแล้ว ต้องเห็นทันทีไม่ใช่เดา
function Fresh({ updated }: { updated: string | null }) {
  if (!updated) return <span className="pill bad">ยังไม่เคยได้ข้อมูล</span>;
  const mins = Math.round((Date.now() - new Date(updated).getTime()) / 60000);
  const cls = mins <= 15 ? 'ok' : mins <= 60 ? 'warn' : 'bad';
  return (
    <span className={`pill ${cls}`}>
      อัปเดตเมื่อ {mins < 1 ? 'ไม่ถึงนาที' : `${mins} นาที`}ที่แล้ว
    </span>
  );
}

export default async function Page() {
  const { snap, updated } = await load();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const sentToday = (snap?.sent ?? []).filter((s) => s.at.startsWith(today));
  const daily = snap?.daily ?? [];
  const todayRow = daily.find((d) => d.day === today);
  const week = lastDays(7);
  const groups = snap?.groups ?? [];
  const gsent = snap?.group_sent ?? [];
  const com = snap?.commission ?? null;

  return (
    <main>
      <header>
        <h1>🤖 บอทคอมเมนต์ FB</h1>
        <Fresh updated={updated} />
      </header>

      {!snap ? (
        <p className="empty">
          ยังไม่มีข้อมูลจากมินิ — เช็คว่า <code>com.fbhub.logpush</code> ทำงานอยู่ไหม
        </p>
      ) : (
        <>
          <section className="cards">
            <div className="card">
              <div className="n">{todayRow?.own ?? sentToday.length}</div>
              <div className="l">ตอบใต้โพสต์ตัวเอง วันนี้</div>
            </div>
            <div className="card">
              <div className="n">{todayRow?.group ?? 0}</div>
              <div className="l">คอมเมนต์ในกลุ่ม วันนี้</div>
            </div>
            <div className="card">
              <div className="n">{todayRow?.links ?? 0}</div>
              <div className="l">ลิงก์ Shopee วันนี้ (รวม {snap.links_total ?? 0})</div>
            </div>
            <div className="card">
              <div className="n gold">{com ? baht(com.total) : '—'}</div>
              <div className="l">{com ? `คอมมิชชั่น ${com.orders} ออเดอร์` : 'คอมมิชชั่น (ยังไม่นำเข้า)'}</div>
            </div>
            <div className="card">
              <div className="n">{snap.queue.length}</div>
              <div className="l">งานรอในคิว</div>
            </div>
            <div className="card wide">
              <div className="s">{snap.status || 'ว่าง'}</div>
              <div className="l">สถานะตอนนี้</div>
            </div>
          </section>

          <section>
            <h2>14 วันล่าสุด <span className="key own" /> โพสต์ตัวเอง <span className="key group" /> ในกลุ่ม</h2>
            <Bars daily={daily} />
          </section>

          {groups.length > 0 && (
            <section>
              <h2>รายกลุ่ม</h2>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>กลุ่ม</th>
                      <th className="r">วันนี้</th>
                      <th className="r">7 วัน</th>
                      <th className="r">ทั้งหมด</th>
                      <th className="r">มีลิงก์</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.id}>
                        <td>
                          <a href={`https://www.facebook.com/groups/${g.id}`} target="_blank" rel="noreferrer">{g.name}</a>
                        </td>
                        <td className="r mono">{g.days[today] ?? 0}</td>
                        <td className="r mono">{week.reduce((a, d) => a + (g.days[d] ?? 0), 0)}</td>
                        <td className="r mono">{g.total}</td>
                        <td className="r mono">{g.links}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {com && (
            <section>
              <h2>คอมมิชชั่น Shopee (นำเข้าเมื่อ {com.imported_at})</h2>
              <div className="scroll">
                <table>
                  <thead>
                    <tr><th>วันที่</th><th className="r">คอมมิชชั่น</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(com.by_day).reverse().slice(0, 14).map(([d, v]) => (
                      <tr key={d}><td className="mono">{d}</td><td className="r mono">{baht(v)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Object.keys(com.by_sub).length > 0 && (
                <p className="dim small">
                  แยกตาม Sub ID (g&lt;เลขกลุ่ม&gt; = มาจากกลุ่มนั้น):{' '}
                  {Object.entries(com.by_sub).map(([k, v]) => `${k} ${baht(v)}`).join(' · ')}
                </p>
              )}
            </section>
          )}

          {gsent.length > 0 && (
            <section>
              <h2>คอมเมนต์ในกลุ่ม ({gsent.length} รายการล่าสุด)</h2>
              {gsent.slice(0, 40).map((g, i) => (
                <details key={i}>
                  <summary>
                    <span className="mono">{g.at}</span>
                    <span className="dim"> · {g.group}</span>
                    {g.link && <span className="tag gold">ลิงก์</span>}
                    <div className="head">{g.topic || g.who}</div>
                  </summary>
                  <div className="convo">
                    <div className="who">ใต้โพสต์ของ {g.who} · <a href={g.url} target="_blank" rel="noreferrer">เปิดโพสต์ ↗</a></div>
                    <div className="bubble">{g.text}</div>
                    {g.link && (
                      <div className="dim small">
                        ลิงก์ที่แปะ: <a href={g.link} target="_blank" rel="noreferrer">{g.link}</a>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </section>
          )}

          {snap.queue.length > 0 && (
            <section>
              <h2>คิวงาน</h2>
              <ul className="queue">
                {snap.queue.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2>ตอบใต้โพสต์ตัวเองแล้ว ({snap.sent.length} รายการล่าสุด)</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>ตอบใคร</th>
                    <th>โพสต์</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.sent.length === 0 && (
                    <tr>
                      <td colSpan={3} className="dim">
                        ยังไม่มี
                      </td>
                    </tr>
                  )}
                  {snap.sent.map((s, i) => (
                    <tr key={i}>
                      <td className="mono nowrap">{s.at}</td>
                      <td>
                        {s.kind !== 'SENT' && <span className="tag">{s.kind}</span>}
                        {s.who}
                      </td>
                      <td>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer">
                            เปิดโพสต์ ↗
                          </a>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>รายงานแต่ละรอบ</h2>
            {snap.rounds.map((r) => (
              <details key={r.name}>
                <summary>
                  <span className="mono">{r.name}</span>
                  <span className="dim"> · {r.at}</span>
                  <div className="head">{r.head}</div>
                </summary>
                <pre>{r.body}</pre>
              </details>
            ))}
          </section>

          <section>
            <h2>ล็อกรอบเวลา</h2>
            <pre className="log">{snap.watch_log}</pre>
          </section>

          {snap.group_log && (
            <section>
              <h2>ล็อกฝั่งกลุ่ม</h2>
              <pre className="log">{snap.group_log}</pre>
            </section>
          )}

          <footer>
            เก็บข้อมูลจากมินิเมื่อ {snap.taken_at} · หน้านี้รีเฟรชเองทุก 60 วินาที
          </footer>
        </>
      )}

      <meta httpEquiv="refresh" content="60" />
      <style>{CSS}</style>
    </main>
  );
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#0f1115;color:#e6e8eb;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:20px 16px 60px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}
h1{font-size:20px;margin:0;flex:1}
h2{font-size:15px;margin:28px 0 10px;color:#9aa3ad;font-weight:600}
.pill{font-size:12px;padding:4px 10px;border-radius:99px;white-space:nowrap}
.pill.ok{background:#12331f;color:#4ade80}
.pill.warn{background:#3a2f11;color:#fbbf24}
.pill.bad{background:#3a1618;color:#f87171}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.card{background:#171a21;border:1px solid #232833;border-radius:12px;padding:14px}
.card.wide{grid-column:span 2}
.card .n{font-size:30px;font-weight:700;line-height:1.1;word-break:break-all}
.card .s{font-size:14px;font-weight:600;word-break:break-all}
.card .l{font-size:12px;color:#8b939d;margin-top:4px}
.queue{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.queue li{background:#171a21;border:1px solid #232833;border-radius:8px;padding:8px 12px;font-size:13px;font-family:ui-monospace,monospace}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;color:#8b939d;font-weight:600;font-size:12px;padding:8px;border-bottom:1px solid #232833}
td{padding:8px;border-bottom:1px solid #1b1f27;vertical-align:top}
.mono{font-family:ui-monospace,monospace;font-size:12px}
.nowrap{white-space:nowrap}
.dim{color:#6b7280}
.tag{display:inline-block;background:#1e2a3a;color:#7dd3fc;font-size:11px;padding:1px 6px;border-radius:4px;margin-right:6px}
a{color:#60a5fa;text-decoration:none}
a:hover{text-decoration:underline}
details{background:#171a21;border:1px solid #232833;border-radius:10px;margin-bottom:8px;overflow:hidden}
summary{padding:12px 14px;cursor:pointer;font-size:13px}
summary .head{color:#e6e8eb;margin-top:4px;font-size:14px}
pre{margin:0;padding:14px;background:#0b0d11;overflow-x:auto;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
pre.log{border:1px solid #232833;border-radius:10px;max-height:340px;overflow-y:auto}
.empty{background:#171a21;border:1px solid #232833;border-radius:12px;padding:20px;color:#9aa3ad}
code{background:#232833;padding:2px 6px;border-radius:4px;font-size:13px}
footer{margin-top:30px;color:#6b7280;font-size:12px}
.r{text-align:right}
.small{font-size:12px}
.gold{color:#fbbf24}
.tag.gold{background:#3a2f11;color:#fbbf24;margin-left:6px}
.key{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:middle}
.key.own,.seg.own{background:#60a5fa}
.key.group,.seg.group{background:#fbbf24}
.bars{display:grid;grid-template-columns:repeat(14,1fr);gap:4px;align-items:end;height:160px;background:#171a21;border:1px solid #232833;border-radius:12px;padding:12px 10px 6px}
.bar{display:flex;flex-direction:column;align-items:center;height:100%;min-width:0}
.stack{flex:1;width:100%;max-width:26px;display:flex;flex-direction:column-reverse;justify-content:flex-start}
.seg{width:100%;border-radius:2px 2px 0 0}
.bar .n{font-size:10px;color:#9aa3ad;height:14px}
.bar .d{font-size:10px;color:#6b7280}
.convo{padding:0 14px 14px}
.convo .who{font-size:12px;color:#8b939d;margin-bottom:6px}
.bubble{background:#2a2410;border:1px solid #3a2f11;border-radius:12px;padding:10px 12px;white-space:pre-wrap;word-break:break-word}
@media(max-width:520px){.card.wide{grid-column:span 2}h1{font-size:17px}}
`;
