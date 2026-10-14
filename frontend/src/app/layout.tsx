import type { Metadata, Viewport } from "next";
import { Kantumruy_Pro, Ubuntu } from "next/font/google";

import { MotionProvider } from "@/components/MotionProvider";
import { ToastProvider } from "@/components/ui";
import { themeInitScript } from "@/lib/theme";

import "./globals.css";

const ubuntu = Ubuntu({ weight: ["300", "400", "500", "700"], subsets: ["latin"], variable: "--nf-ubuntu" });
const khmer = Kantumruy_Pro({ subsets: ["khmer"], variable: "--nf-khmer" });

export const metadata: Metadata = {
  title: { default: "Bondeth AI · បណ្ឌិត AI", template: "%s · Bondeth AI" },
  description: "Open-source Khmer & English speech-to-text, text-to-speech and voice cloning.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d12" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is replaced before first paint by the inline script; the DOM wins on hydration.
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${ubuntu.variable} ${khmer.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
