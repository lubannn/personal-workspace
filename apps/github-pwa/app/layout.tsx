import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "./service-worker-registration";

import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Workspace",
  description: "A static Personal Workspace backed by a private GitHub data repository.",
  applicationName: "Personal Workspace",
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
