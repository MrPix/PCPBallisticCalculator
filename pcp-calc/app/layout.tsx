import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PCP Ballistic Calculator",
    template: "%s · PCP Ballistic Calculator",
  },
  description:
    "Offline-first ballistic calculator for PCP air rifles: measured drop, fitted ballistic coefficient, weather correction and hold-over tables for .177 pellets and slugs.",
  applicationName: "PCP Ballistic Calculator",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  authors: [{ name: "PCP Ballistic Calculator" }],
  keywords: ["ballistics", "PCP", "air rifle", "pellet", "slug", "hold over", "mrad", ".177"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1016" },
    { media: "(prefers-color-scheme: light)", color: "#eef2f7" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
