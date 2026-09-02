import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://websidian-memory-universe.dark-box-2837.chatgpt.site'),
  title: 'Websidian — Development Memory Notebook',
  description:
    '시간, 변경 소스, Query 관련도로 개발 이력을 연결하고 기록하는 Development Memory Notebook.',
  openGraph: {
    title: 'Websidian — Development Memory Notebook',
    description: '조직의 개발 히스토리를 시간 · 소스 · 관련도로 기록하고 탐색하는 Memory Graph.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Websidian Development Memory Notebook' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Websidian — Development Memory Notebook',
    description: '조직의 개발 히스토리를 시간 · 소스 · 관련도로 기록하고 탐색하는 Memory Graph.',
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
