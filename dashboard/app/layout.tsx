export const metadata = {
  title: 'บอทตอบคอมเมนต์ FB — log',
  description: 'ดูว่าบอทบนมินิตอบใครไปบ้าง',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </head>
      <body>{children}</body>
    </html>
  );
}
