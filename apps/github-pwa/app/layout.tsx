import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "./service-worker-registration";

import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus",
  description: "Nexus is a personal workspace backed by a private GitHub data repository.",
  applicationName: "Nexus",
  robots: { index: false, follow: false },
  manifest: "manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#f2f0ea",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><ServiceWorkerRegistration />{children}</body>
    </html>
  );
}
