import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Yoru — Your shared universe', template: '%s · Yoru' },
  description: 'A private home for your favorite movies, series and animated stories.',
  robots: { index: false, follow: false },
  icons: { icon: { url: '/favicon.svg?v=orange-logo-1', type: 'image/svg+xml' }, apple: '/yoru-logo.png' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
