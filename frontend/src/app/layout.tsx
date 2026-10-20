import type { Metadata, Viewport } from "next";
import { Kantumruy_Pro, Ubuntu } from "next/font/google";
import { Suspense } from "react";
import { LocaleEffects } from "@/components/LocaleEffects";
import { localeInitScript } from "@/lib/i18n";
import { SITE_URL, PUBLIC_ROBOTS } from "@/lib/seo";

import { MotionProvider } from "@/components/MotionProvider";
import { ToastProvider } from "@/components/ui";
import { themeInitScript } from "@/lib/theme";

import "./globals.css";

const ubuntu = Ubuntu({ weight: ["300", "400", "500", "700"], subsets: ["latin"], variable: "--nf-ubuntu" });
const khmer = Kantumruy_Pro({ subsets: ["khmer"], variable: "--nf-khmer" });

const description = "Open-source Khmer & English speech-to-text, text-to-speech and voice cloning.";

export const metadata: Metadata = {
  // Share images (app/opengraph-image.png etc.) need an absolute URL that crawlers can reach.
  metadataBase: SITE_URL,
  applicationName: "Bondeth AI",
  robots: PUBLIC_ROBOTS,
  title: { default: "Bondeth AI · បណ្ឌិត AI", template: "%s · Bondeth AI" },
  description,
  openGraph: { type: "website", siteName: "Bondeth AI", title: "Bondeth AI · Speak Khmer. Be heard.", description },
  twitter: { card: "summary_large_image", title: "Bondeth AI · Speak Khmer. Be heard.", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b18" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is replaced before first paint by the inline script; the DOM wins on hydration.
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${ubuntu.variable} ${khmer.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: localeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
          <Suspense fallback={null}><LocaleEffects /></Suspense>
        </MotionProvider>
      </body>
    </html>
  );
}
