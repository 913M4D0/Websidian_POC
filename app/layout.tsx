import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Websidian — Development Memory Universe',
  description:
    '이슈, 의사결정, 코드 변경과 장애 이력을 연결해 탐색하는 3D Development Memory Universe.',
  openGraph: {
    title: 'Websidian — Development Memory Universe',
    description: '조직의 개발 히스토리를 연결하고 탐색하는 3D Memory Graph.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Websidian Development Memory Universe' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Websidian — Development Memory Universe',
    description: '조직의 개발 히스토리를 연결하고 탐색하는 3D Memory Graph.',
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
