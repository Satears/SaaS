import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { getUser, getTeamForUser, toPublicUser } from '@/lib/db/queries';
import { brand } from '@/lib/brand';
import { SWRConfig } from 'swr';

export const metadata: Metadata = {
  title: `${brand.name} · ${brand.tagline}`,
  description: brand.description
};

export const viewport: Viewport = {
  maximumScale: 1
};

const manrope = Manrope({ subsets: ['latin'] });

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`bg-white dark:bg-gray-950 text-black dark:text-white ${manrope.className}`}
    >
      <body className="min-h-[100dvh] bg-gray-50">
        <SWRConfig
          value={{
            fallback: {
              // We do NOT await here
              // Only components that read this data will suspend
              // 必须脱敏：fallback 会被序列化进 RSC 载荷 / HTML
              '/api/user': getUser().then((u) => (u ? toPublicUser(u) : null)),
              '/api/team': getTeamForUser()
            }
          }}
        >
          {children}
        </SWRConfig>
      </body>
    </html>
  );
}
