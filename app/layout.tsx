import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/tatva/AppShell';

// Geist for UI and headings, Geist Mono for timestamps, numbers and codes.
const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0e0e10',
};

export const metadata: Metadata = {
  title: { default: 'Tatva', template: '%s · Tatva' },
  description: 'Voice-first meeting assistant: meetings become knowledge, Pooja answers and acts.',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/brand/tatva-mark-small.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark h-full ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Icon font: "block" avoids flashing ligature names before it loads. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
      </head>
      <body className="h-full min-h-screen bg-surface font-sans text-body-md text-on-surface antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
