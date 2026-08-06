import { neon } from '@neondatabase/serverless';

// มินิที่บ้านยิง snapshot มาที่นี่ทุก 5 นาที — Vercel เข้าถึงเครื่องบ้านตรง ๆ ไม่ได้ (อยู่หลัง Tailscale)
// เก็บแถวเดียวทับไปเรื่อย ๆ ไม่ต้องเก็บประวัติ ตัว log จริงอยู่บนมินิอยู่แล้ว
export async function POST(req: Request) {
  if (req.headers.get('x-secret') !== process.env.PUSH_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.text();
  if (body.length > 2_000_000) return Response.json({ error: 'too large' }, { status: 413 });

  const sql = neon(process.env.DATABASE_URL!);
  await sql`CREATE TABLE IF NOT EXISTS fb_log (
    id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`INSERT INTO fb_log (id, data, updated_at) VALUES (1, ${body}::jsonb, now())
            ON CONFLICT (id) DO UPDATE SET data = ${body}::jsonb, updated_at = now()`;
  return Response.json({ ok: true, bytes: body.length });
}
