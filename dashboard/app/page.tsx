import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

type Sent = { at: string; who: string; url: string; kind: string };
type Snap = {
  taken_at: string;
  status: string;
  queue: string[];
  sent: Sent[];
  rounds: { name: string; at: string; head: string; body: string }[];
  watch_log: string;
  notes: string[];
};

async function load(): Promise<{ snap: Snap | null; updated: string | null }> {
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

  return (
    <main>
      <header>
        <h1>🤖 บอทตอบคอมเมนต์ FB</h1>
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
              <div className="n">{sentToday.length}</div>
              <div className="l">ตอบไปวันนี้</div>
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
            <h2>ตอบไปแล้ว ({snap.sent.length} รายการล่าสุด)</h2>
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
.card .n{font-size:30px;font-weight:700;line-height:1.1}
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
@media(max-width:520px){.card.wide{grid-column:span 2}h1{font-size:17px}}
`;
