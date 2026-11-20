import type { Metadata, Viewport } from 'next';
import { Arimo, Geist_Mono, Open_Sans } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/tatva/AppShell';

// Arimo for headings, Open Sans for body and UI, Geist Mono only for timestamps
// and codes. next/font self-hosts them and sizes the fallback to match, so
// swapping in the real font doesn't shift the layout.
const arimo = Arimo({ subsets: ['latin'], variable: '--font-arimo', display: 'swap' });
const openSans = Open_Sans({ subsets: ['latin'], variable: '--font-open-sans', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');
const DESCRIPTION = 'Voice-first meeting assistant. Tatva turns your meetings into searchable knowledge, and Pooja answers questions and follows up for you.';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e0e10',
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Tatva', template: '%s · Tatva' },
  description: DESCRIPTION,
  applicationName: 'Tatva',
  // Shared links (WhatsApp, Commudle, Slack): crawlers land on /login, which
  // inherits these. The image is a static file, so it needs no login.
  openGraph: {
    type: 'website',
    siteName: 'Tatva',
    title: 'Tatva · Voice-first meeting assistant',
    description: DESCRIPTION,
    url: '/',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Tatva: your meetings, answered by voice' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tatva · Voice-first meeting assistant',
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
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
    <html lang="en" className={`dark h-full ${arimo.variable} ${openSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Lets the Tatva Recorder extension recognise this app on any domain (extension/page-marker.js). */}
        <meta name="tatva-app" content="web" />
        {/* Icon font: "block" avoids flashing ligature names before it loads. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
      </head>
      <body className="h-full min-h-screen bg-surface font-sans text-body-md text-on-surface antialiased">
        <AppShell authEnabled={!!process.env.TATVA_ACCESS_CODE?.trim()}>{children}</AppShell>
      </body>
    </html>
  );
}
