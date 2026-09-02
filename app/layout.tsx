import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Websidian — Development Memory Observatory',
  description:
    '시간, 변경 소스, Query 관련도로 개발 이력을 연결해 탐색하는 3D Development Memory Observatory.',
  openGraph: {
    title: 'Websidian — Development Memory Observatory',
    description: '조직의 개발 히스토리를 시간 · 소스 · 관련도로 탐색하는 3D Memory Graph.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Websidian Development Memory Observatory' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Websidian — Development Memory Observatory',
    description: '조직의 개발 히스토리를 시간 · 소스 · 관련도로 탐색하는 3D Memory Graph.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <body>{children}</body>
    </html>
  );
}
