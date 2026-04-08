import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const appName = process.env.NEXT_PUBLIC_APP_NAME || "Restaurant Agent";
const brandColor = process.env.NEXT_PUBLIC_BRAND_COLOR || "#EA580C";
const rootStyle = { "--brand": brandColor } as CSSProperties & Record<"--brand", string>;

export const metadata: Metadata = {
  title: `${appName} — Agent Dashboard`,
  description: `WhatsApp AI ordering agent dashboard for ${appName}`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={rootStyle}
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Toaster position="top-right" richColors />
        {children}
      </body>
    </html>
  );
}
