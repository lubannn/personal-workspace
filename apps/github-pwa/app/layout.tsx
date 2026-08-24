import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Workspace · GitHub Preview",
  description: "A static, GitHub-backed Personal Workspace PWA preview.",
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
      <body>{children}</body>
    </html>
  );
}
