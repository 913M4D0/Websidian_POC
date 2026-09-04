import type { Metadata } from 'next';
import './globals.css';
import './workbench.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://websidian-memory-universe.dark-box-2837.chatgpt.site'),
  title: 'Websidian — Issue Memory',
  description:
    '이슈의 원문과 처리 기록을 보존하고 시간·공통 자료·관련 내용을 따라 조직의 기억을 탐색합니다.',
  openGraph: {
    title: 'Websidian — Issue Memory',
    description: '조직의 이슈와 처리 기록을 시간 · 자료 · 관련 내용으로 탐색합니다.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Websidian Development Memory Graph' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Websidian — Issue Memory',
    description: '조직의 이슈와 처리 기록을 시간 · 자료 · 관련 내용으로 탐색합니다.',
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
