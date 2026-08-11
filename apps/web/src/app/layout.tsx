import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import PasswordGate from './PasswordGate';
import './globals.css';

export const metadata: Metadata = {
  title: 'GHG 碳盤查平台',
  description: '溫室氣體排放盤查填報系統',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body style={{ margin: 0, padding: 0 }}>
        <SessionProvider>
          {/* 未改密碼者一律先導到 /change-password，見 PasswordGate 註解 */}
          <PasswordGate />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
